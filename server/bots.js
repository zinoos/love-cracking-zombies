/* Bot-KI: Zielsuche ueber Sichtlinie, Strafen, Deckung, Health-Suche.
   Erzeugt dieselben Input-Objekte wie ein echter Client. */
const C = require('../shared/constants.js');
const PHYS = require('../shared/physics.js');

const BOT_NAMES = ['VEX', 'NOVA', 'ORION', 'ZARA', 'KILO', 'ECHO', 'RAVEN', 'FLUX', 'JINX', 'ATLAS'];
let nameCursor = 0;
function botName() { return BOT_NAMES[nameCursor++ % BOT_NAMES.length] + '-' + (10 + Math.floor(Math.random() * 89)); }

function dirToInput(inp, dx, dy) {
  const l = Math.hypot(dx, dy);
  if (l < 0.01) { inp.up = inp.down = inp.left = inp.right = false; return; }
  dx /= l; dy /= l;
  inp.right = dx > 0.35; inp.left = dx < -0.35;
  inp.down = dy > 0.35; inp.up = dy < -0.35;
}

function randomOpen(map) {
  for (let i = 0; i < 200; i++) {
    const tx = 1 + Math.floor(Math.random() * (map.n - 2));
    const ty = 1 + Math.floor(Math.random() * (map.n - 2));
    if (PHYS.tileAt(map, tx, ty) !== C.T_WALL) {
      return { x: tx * C.TILE + C.TILE / 2, y: ty * C.TILE + C.TILE / 2 };
    }
  }
  return { x: C.WORLD / 2, y: C.WORLD / 2 };
}

/* Wunsch-Kampfdistanz und maximale Feuerreichweite je Waffe. */
/* Wunsch-Kampfdistanz je Waffe. maxRange kommt aus der Waffenreichweite -
   Bots ballern nicht mehr auf Ziele, die ihre Geschosse gar nicht erreichen. */
const WANT = {
  sword: 40, pistol: 230, smg: 170, revolver: 300, ak47: 320, shotgun: 110, flamer: 90,
  crossbow: 420, mine: 260, grenadier: 330, minigun: 260, sniper: 480, bazooka: 340
};
const MIN_RANGE = { bazooka: 170, grenadier: 150, mine: 130 };   // nicht in die eigene Explosion laufen

function aiFor(weaponKey) {
  const w = C.WEAPONS[weaponKey] || C.WEAPONS.pistol;
  return {
    want: WANT[weaponKey] || 230,
    maxRange: (w.range || 500) * 0.92,
    minRange: MIN_RANGE[weaponKey] || 0
  };
}

function botThink(match, p, dt) {
  const m = p.botMem;
  if (m.skill === undefined) {
    m.skill = 0.55 + Math.random() * 0.35;
    m.react = 0.12 + (1 - m.skill) * 0.25;
    m.strafeT = 0; m.strafeDir = 1;
    m.goal = randomOpen(match.map);
    m.repath = 0;
    m.aimErr = 0;
    m.errT = 0;
    m.nadeCd = 4 + Math.random() * 8;
  }
  const ai = aiFor(p.weaponKey);
  const inp = p.input;
  inp.shoot = false; inp.reload = false; inp.dash = false; inp.grenade = false;
  m.nadeCd -= dt;

  if (!p.alive) { inp.up = inp.down = inp.left = inp.right = false; return; }

  // Ziel suchen
  let enemy = null, bestD = Infinity;
  for (const o of match.players.values()) {
    if (o === p || !o.alive) continue;
    if (match.mode.teams > 1 && o.team === p.team) continue;
    const dx = o.x - p.x, dy = o.y - p.y;
    const d = Math.hypot(dx, dy);
    // Bots sehen nur, was auch ein Spieler sehen wuerde
    if (!C.inView(p.aim, dx, dy, d)) continue;
    if (o.cloakUntil > match.time) continue;              // frisch getarnt = unsichtbar
    if (!PHYS.los(match.map, p.x, p.y, o.x, o.y)) continue;
    if (PHYS.inBush(match.map, o.x, o.y) && d > C.BUSH_REVEAL_DIST && match.time - o.lastFireAt > C.FIRE_REVEAL_TIME) continue;
    if (d < bestD) { bestD = d; enemy = o; }
  }

  // Health-Pack Bedarf
  let pack = null;
  if (p.hp < 55) {
    let pd = 520;
    for (const pk of match.pickups) {
      if (!pk.active || pk.type !== 'health') continue;
      const d = Math.hypot(pk.x - p.x, pk.y - p.y);
      if (d < pd) { pd = d; pack = pk; }
    }
  }

  m.errT -= dt;
  if (m.errT <= 0) {
    m.errT = 0.18 + Math.random() * 0.25;
    m.aimErr = (Math.random() - 0.5) * (1 - m.skill) * 0.55;
  }

  m.strafeT -= dt;
  if (m.strafeT <= 0) { m.strafeT = 0.5 + Math.random() * 0.9; m.strafeDir = Math.random() < 0.5 ? 1 : -1; }

  if (enemy) {
    m.lastSeen = { x: enemy.x, y: enemy.y, t: match.time };
    // Vorhalten - langsame Geschosse brauchen mehr Vorhalt
    const projSpeed = p.weapon.bulletSpeed || 900;
    const bulletT = bestD / projSpeed;
    const px = enemy.x + enemy.vx * bulletT * (0.4 + m.skill * 0.6);
    const py = enemy.y + enemy.vy * bulletT * (0.4 + m.skill * 0.6);
    inp.aim = Math.atan2(py - p.y, px - p.x) + m.aimErr;

    // Distanz halten + strafen
    const toX = enemy.x - p.x, toY = enemy.y - p.y;
    const l = Math.hypot(toX, toY) || 1;
    const nx = toX / l, ny = toY / l;
    const want = ai.want;
    /* Totzone um die Wunschdistanz. Frueher waren es feste 60/70 px - damit
       umkreiste ein Schwertbot sein Ziel stundenlang bei 80 px, ohne je in
       seine 62 px Reichweite zu kommen. Im Nahkampf muss die Zone enger sein
       als die Waffe reicht, und weniger gestrafft werden. */
    const melee = !!p.weapon.melee;
    const bandOut = melee ? 10 : 60, bandIn = melee ? 14 : 70;
    const push = bestD > want + bandOut ? 1 : bestD < want - bandIn ? -1 : 0;
    let mvX = nx * push, mvY = ny * push;
    const strafe = melee ? 0.4 : 0.95;
    mvX += -ny * m.strafeDir * strafe;
    mvY += nx * m.strafeDir * strafe;
    // Wand voraus? Ausweichen
    if (PHYS.raycast(match.map, p.x, p.y, mvX, mvY, 70) < 60) {
      m.strafeDir *= -1;
      mvX = -ny * m.strafeDir; mvY = nx * m.strafeDir;
    }
    dirToInput(inp, mvX, mvY);

    if (p.weapon.melee) {
      // Schwert: draufhalten, sobald der Gegner in Reichweite ist
      inp.shoot = bestD < p.weapon.range + C.PLAYER_R * 1.5;
    } else if (p.weapon.mine) {
      // Mine legen, wenn keine liegt; zuenden, wenn der Gegner nah dran ist
      if (!p.mine) inp.shoot = bestD > ai.minRange && bestD < p.weapon.range;
      else if (p.mine.state === 'armed' && p.mine.armT <= 0) {
        const md = Math.hypot(enemy.x - p.mine.x, enemy.y - p.mine.y);
        const selfD = Math.hypot(p.x - p.mine.x, p.y - p.mine.y);
        inp.shoot = md < p.weapon.blastRadius * 0.8 && selfD > p.weapon.blastRadius;
      }
      inp.gd = bestD;
    } else if (p.ammo <= 0) inp.reload = true;
    else if (p.reloadT <= 0 && bestD < ai.maxRange && bestD > ai.minRange && Math.abs(m.aimErr) < 0.22) inp.shoot = true;

    // Granate auf mittlere Distanz, wenn sie nicht vor den Fuessen landet
    if (p.grenades > 0 && m.nadeCd <= 0 && bestD > 170 && bestD < 420 && Math.random() < 0.03) {
      inp.grenade = true;
      inp.gd = bestD;
      m.nadeCd = 9 + Math.random() * 8;
    }

    if (p.hp < 40 && p.dashCd <= 0 && Math.random() < 0.02) inp.dash = true;
    return;
  }

  // Kein Sichtkontakt: Ziel = Pack, letzte Sichtung oder Wanderpunkt
  let goal = m.goal;
  if (pack) goal = pack;
  else if (m.lastSeen && match.time - m.lastSeen.t < 4) goal = m.lastSeen;

  m.repath -= dt;
  const dToGoal = Math.hypot(goal.x - p.x, goal.y - p.y);
  if (dToGoal < 55 || m.repath <= 0) {
    m.goal = randomOpen(match.map);
    m.repath = 5 + Math.random() * 4;
    if (!pack) goal = m.goal;
  }

  let dx = goal.x - p.x, dy = goal.y - p.y;
  const gl = Math.hypot(dx, dy) || 1;
  dx /= gl; dy /= gl;
  // Einfache Hindernisumgehung
  if (PHYS.raycast(match.map, p.x, p.y, dx, dy, 90) < 80) {
    const s = m.strafeDir;
    const ax = -dy * s, ay = dx * s;
    if (PHYS.raycast(match.map, p.x, p.y, ax, ay, 90) > 60) { dx = ax; dy = ay; }
    else { dx = dy * s; dy = -dx * s; m.strafeDir *= -1; }
  }
  dirToInput(inp, dx, dy);
  // Beim Laufen den Kopf schwenken - mit festem Blick nach vorn wuerde ein Bot
  // niemanden mehr entdecken, seit das Sichtfeld ein Kegel ist.
  m.scan = (m.scan || 0) + dt * (1.1 + m.skill * 0.6);
  inp.aim = Math.atan2(dy, dx) + Math.sin(m.scan) * (C.FOV * 0.45);
  if (!p.weapon.melee && !p.weapon.mine && p.ammo < p.weapon.mag && p.reloadT <= 0) inp.reload = true;
}

module.exports = { botThink, botName };
