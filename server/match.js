/* Autoritative Match-Simulation: Bewegung, Waffen, Geschosse, Explosionen,
   zerstoerbares Terrain, Pickups, Sichtbarkeits-Filter und Snapshots. */
const C = require('../shared/constants.js');
const MAPS = require('../shared/maps.js');
const PHYS = require('../shared/physics.js');
const { botThink } = require('./bots.js');

let PROJ_ID = 1;

// Ereignisse, die die Position ihres Ausloesers verraten
const POSITION_EVENTS = new Set(['swing', 'shot', 'reload', 'reloaded', 'dash', 'mineset', 'mineout', 'nade']);

function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

class Match {
  constructor(room, mode, mapId) {
    this.room = room;
    this.mode = C.MODES[mode] || C.MODES.ffa;
    this.map = MAPS.instance(mapId);      // eigene Kopie - Zerstoerung bleibt im Match
    this.mapId = this.map.id;
    this.tick = 0;
    this.time = 0;
    this.timeLeft = this.mode.time;
    this.state = 'countdown';   // countdown | live | over
    this.countdown = C.COUNTDOWN;
    this.players = new Map();
    this.projectiles = [];
    this.pickups = [];
    this.events = [];
    this.tileChanges = [];
    this.teamScore = [0, 0];
    this.winner = null;

    this.map.packs.forEach((p, i) => {
      this.pickups.push({
        id: i + 1, type: p.type,
        x: p.x * C.TILE + C.TILE / 2, y: p.y * C.TILE + C.TILE / 2,
        active: true, respawnAt: 0
      });
    });
  }

  static randomWeapon() {
    const keys = C.WEAPON_ORDER;
    return keys[Math.floor(Math.random() * keys.length)];
  }

  /** n verschiedene Waffen zur Auswahl ziehen. */
  static weaponChoices(n) {
    const pool = C.WEAPON_ORDER.slice();
    const out = [];
    while (out.length < n && pool.length) {
      out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
    }
    return out;
  }

  addPlayer(member) {
    const choices = Match.weaponChoices(C.WEAPON_CHOICES);
    const wKey = choices[0];          // vorlaeufig, bis gewaehlt wird
    const w = C.WEAPONS[wKey];
    const p = {
      id: member.id,
      name: member.name,
      color: member.skin.color,
      pattern: member.skin.pattern,
      trail: member.skin.trail,
      team: member.team,
      bot: !!member.bot,
      weaponKey: wKey,
      weapon: w,
      choices,
      picked: false,
      speedMult: w.speedMult,
      x: 0, y: 0, vx: 0, vy: 0,
      aim: 0,
      hp: C.HP_MAX,
      alive: true,
      ammo: w.mag,
      grenades: C.GRENADES,
      grenadeCd: 0,
      spin: 0,
      spreadAcc: 0,
      reloadT: 0,
      fireCd: 0,
      dashT: 0, dashX: 0, dashY: 0, dashCd: 0,
      respawnT: 0,
      invulT: C.SPAWN_INVUL,
      lastHitAt: -99,
      lastFireAt: -99,
      cloakUntil: 0,
      kills: 0, deaths: 0, damage: 0,
      streak: 0, bestStreak: 0,
      multiWindow: 0, multiCount: 0,
      lastSeq: 0,
      input: { up: false, down: false, left: false, right: false, shoot: false, reload: false, dash: false, grenade: false, aim: 0, seq: 0 },
      botMem: {}
    };
    this.players.set(p.id, p);
    // Bots entscheiden sich sofort
    if (p.bot) this.pickWeapon(p.id, choices[Math.floor(Math.random() * choices.length)]);
    this.respawn(p, true);
    return p;
  }

  /** Waffe aus den angebotenen waehlen. Nur waehrend des Countdowns. */
  pickWeapon(id, key) {
    const p = this.players.get(id);
    if (!p || p.picked) return false;
    if (this.state !== 'countdown' && !p.bot) return false;
    if (!p.choices.includes(key)) return false;
    const w = C.WEAPONS[key];
    if (!w) return false;
    p.weaponKey = key;
    p.weapon = w;
    p.speedMult = w.speedMult;
    p.ammo = w.mag;
    p.picked = true;
    this.events.push({ e: 'wpick', id: p.id, w: key });
    return true;
  }

  /** Waffe direkt setzen. Die Wahl passiert seit der Vorbereitung im Raum,
      bevor das Match ueberhaupt existiert - hier wird sie nur uebernommen. */
  forceWeapon(id, key) {
    const p = this.players.get(id);
    const w = C.WEAPONS[key];
    if (!p || !w) return false;
    p.weaponKey = key;
    p.weapon = w;
    p.speedMult = w.speedMult;
    p.ammo = w.mag;
    p.picked = true;
    p.choices = [key];
    return true;
  }

  /** Wer bis zum Start nicht gewaehlt hat, bekommt eine der drei zugelost. */
  finalizeChoices() {
    for (const p of this.players.values()) {
      if (p.picked) continue;
      const key = p.choices[Math.floor(Math.random() * p.choices.length)];
      p.picked = false;                 // pickWeapon prueft das Flag
      this.pickWeapon(p.id, key);
    }
  }

  removePlayer(id) { this.players.delete(id); }

  spawnPoint(team) {
    const list = this.mode.teams === 1 ? this.map.spawns.ffa : this.map.spawns[team] || this.map.spawns.ffa;
    let best = null, bestScore = -Infinity;
    for (const s of list) {
      const wx = s.x * C.TILE + C.TILE / 2, wy = s.y * C.TILE + C.TILE / 2;
      let score = Math.random() * 40;
      for (const o of this.players.values()) {
        if (!o.alive) continue;
        if (this.mode.teams > 1 && o.team === team) continue;
        score += Math.min(700, Math.hypot(o.x - wx, o.y - wy));
      }
      if (score > bestScore) { bestScore = score; best = { x: wx, y: wy }; }
    }
    return best || { x: C.WORLD / 2, y: C.WORLD / 2 };
  }

  respawn(p, initial) {
    const s = this.spawnPoint(p.team);
    p.x = s.x; p.y = s.y;
    p.vx = 0; p.vy = 0;
    p.hp = C.HP_MAX;
    p.alive = true;
    p.ammo = p.weapon.mag;
    p.reloadT = 0; p.fireCd = 0; p.dashT = 0; p.dashCd = 0;
    p.spin = 0; p.spreadAcc = 0;
    p.invulT = C.SPAWN_INVUL;
    p.respawnT = 0;
    p.streak = 0;
    p.burnUntil = 0; p.burnBy = null; p.burnTick = 0;
    p.cloakUntil = 0;
    // Gelegte Mine verschwindet mit dem Traeger
    if (p.mine) { this.events.push({ e: 'minegone', id: p.id }); p.mine = null; }
    if (p.weapon && p.weapon.mine) p.ammo = 1;
    if (!initial) this.events.push({ e: 'spawn', id: p.id, x: p.x, y: p.y });
  }

  setInput(id, msg) {
    const p = this.players.get(id);
    if (!p || p.bot) return;
    p.input = {
      up: !!msg.u, down: !!msg.d, left: !!msg.l, right: !!msg.r,
      shoot: !!msg.f, reload: !!msg.rl, dash: !!msg.ds, grenade: !!msg.g,
      aim: typeof msg.a === 'number' ? msg.a : p.input.aim,
      gd: typeof msg.gd === 'number' ? msg.gd : C.GRENADE_RANGE_DEFAULT,
      seq: msg.seq | 0
    };
    // Einmal-Aktionen rasten ein: treffen zwei Pakete zwischen zwei Ticks ein,
    // wuerde das zweite den Tastendruck sonst ueberschreiben und verschlucken.
    if (msg.g) { p.latchGrenade = true; p.latchGd = p.input.gd; }
    if (msg.ds) p.latchDash = true;
    if (msg.rl) p.latchReload = true;
    p.lastSeq = Math.max(p.lastSeq, msg.seq | 0);
  }

  /* ---------------- Simulation ---------------- */

  step(dt) {
    this.time += dt;
    this.tick++;

    if (this.state === 'countdown') {
      this.countdown -= dt;
      if (this.countdown <= 0) {
        this.finalizeChoices();
        this.state = 'live';
        this.events.push({ e: 'go' });
      }
      return;
    }
    if (this.state === 'over') return;

    this.timeLeft = Math.max(0, this.timeLeft - dt);

    for (const p of this.players.values()) {
      if (p.bot) botThink(this, p, dt);
      this.stepPlayer(p, dt);
    }
    this.stepProjectiles(dt);
    this.stepPickups(dt);
    this.checkEnd();
  }

  stepPlayer(p, dt) {
    const w = p.weapon;
    p.invulT = Math.max(0, p.invulT - dt);
    p.dashCd = Math.max(0, p.dashCd - dt);
    p.fireCd = Math.max(0, p.fireCd - dt);
    p.grenadeCd = Math.max(0, p.grenadeCd - dt);
    p.spreadAcc = Math.max(0, p.spreadAcc - dt * 0.22);
    if (p.multiWindow > 0) {
      p.multiWindow -= dt;
      if (p.multiWindow <= 0) p.multiCount = 0;
    }

    if (!p.alive) {
      p.respawnT -= dt;
      p.spin = 0;
      p.latchGrenade = p.latchDash = p.latchReload = false;
      if (p.respawnT <= 0) this.respawn(p, false);
      return;
    }

    const inp = p.input;
    p.aim = inp.aim;

    // Eingerastete Einmal-Aktionen einlesen und verbrauchen
    const wantDash = inp.dash || p.latchDash;
    const wantGrenade = inp.grenade || p.latchGrenade;
    const wantReload = inp.reload || p.latchReload;
    const grenadeDist = p.latchGrenade ? (p.latchGd || inp.gd) : inp.gd;
    p.latchDash = p.latchGrenade = p.latchReload = false;

    // Dash
    if (wantDash && p.dashCd <= 0 && p.dashT <= 0) {
      let dx = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
      let dy = (inp.down ? 1 : 0) - (inp.up ? 1 : 0);
      if (dx === 0 && dy === 0) { dx = Math.cos(p.aim); dy = Math.sin(p.aim); }
      const l = Math.hypot(dx, dy) || 1;
      p.dashX = dx / l; p.dashY = dy / l;
      p.dashT = C.DASH_TIME;
      // Schwere Waffen bremsen auch das Ausweichen
      p.dashCd = C.DASH_CD * (w.heavy ? C.DASH_CD_HEAVY : 1);
      this.events.push({ e: 'dash', id: p.id, x: p.x, y: p.y, dx: p.dashX, dy: p.dashY });
    }

    PHYS.stepPlayer(this.map, p, inp, dt);

    // Granate
    if (wantGrenade && p.grenades > 0 && p.grenadeCd <= 0) this.throwGrenade(p, grenadeDist);

    /* Nachladen. Schwert und Minenleger sind ausgenommen: beide haben
       reload = 0, das Schwert dauerhaft ammo = 0. Ohne die Sperre loeste ein
       Schwerttraeger bei gehaltener Maustaste in jedem Tick ein Reload-Event
       aus - in einem Testmatch ueber 12000 Stueck, alle an jeden Client
       gesendet. Die Mine bekommt ihren Nachschub ohnehin nur ueber die
       Explosion, nie ueber Nachladen. */
    if (p.reloadT > 0) {
      p.reloadT -= dt;
      p.spin = 0;
      if (p.reloadT <= 0) { p.ammo = w.mag; this.events.push({ e: 'reloaded', id: p.id }); }
    } else if (!w.melee && !w.mine && !w.boomerang &&
      ((wantReload && p.ammo < w.mag) || (inp.shoot && p.ammo <= 0))) {
      p.reloadT = w.reload;
      this.events.push({ e: 'reload', id: p.id, t: w.reload });
    }

    // Anlauf (Minigun)
    if (w.spinUp) {
      if (inp.shoot && p.reloadT <= 0 && p.ammo > 0) p.spin = Math.min(1, p.spin + dt / w.spinUp);
      else p.spin = Math.max(0, p.spin - dt / (w.spinUp * 0.7));
    } else p.spin = 1;

    // Angriff - je nach Waffenart Hieb, Mine oder Geschoss
    if (inp.shoot && p.fireCd <= 0 && p.reloadT <= 0) {
      if (w.melee) this.swing(p);
      else if (w.mine) this.mineAction(p);
      else if (p.ammo > 0 && (!w.spinUp || p.spin >= 1)) this.fire(p);
    }
    if (p.mine) this.stepMine(p, dt);

    // Brandschaden
    if (p.burnUntil && this.time < p.burnUntil) {
      const before = p.hp;
      p.hp -= C.BURN_DPS * dt;
      p.lastHitAt = this.time;
      p.burnTick = (p.burnTick || 0) + dt;
      if (p.burnTick >= 0.4) {                 // nicht jeden Tick ein Event senden
        p.burnTick = 0;
        this.events.push({ e: 'burn', id: p.id, x: p.x, y: p.y, hp: Math.max(0, p.hp) });
      }
      const killer = this.players.get(p.burnBy);
      if (killer && killer !== p) killer.damage += Math.min(C.BURN_DPS * dt, before);
      if (p.hp <= 0) {
        this.kill(p, killer && killer !== p ? killer : null, p.x, p.y, Math.random() * 7);
        return;
      }
    }

    // Regeneration
    if (this.time - p.lastHitAt > C.REGEN_DELAY && p.hp < C.HP_MAX) {
      p.hp = Math.min(C.HP_MAX, p.hp + C.REGEN_RATE * dt);
    }
  }

  muzzlePoint(p, ang) {
    const d = C.PLAYER_R + 14;
    const x = p.x + Math.cos(ang) * d, y = p.y + Math.sin(ang) * d;
    if (PHYS.tileAtWorld(this.map, x, y) === C.T_WALL) return { x: p.x, y: p.y };
    return { x, y };
  }

  fire(p) {
    const w = p.weapon;
    p.ammo--;
    // Letzte Patrone im Magazin schlaegt bei manchen Waffen doppelt zu
    const lastShot = w.lastShotMult && p.ammo === 0;
    const shotDmg = w.dmg * (lastShot ? w.lastShotMult : 1);
    p.fireCd = w.fireCd;
    // Lautlose Waffen verraten die Position im Busch nicht
    if (!w.silent) p.lastFireAt = this.time;
    const spread = Math.min(w.spreadMax === undefined ? w.spread : w.spreadMax, w.spread + p.spreadAcc);
    p.spreadAcc += w.spreadGrow || 0;

    const base = p.aim + (p.dashT > 0 ? (Math.random() - 0.5) * 0.12 : 0);
    const m = this.muzzlePoint(p, base);

    if (w.boomerang) {
      /* Die Platte fliegt geradeaus und kehrt um - an der ersten Wand oder
         am Ende der Reichweite. Getroffene Spieler merkt sie sich, damit ein
         Wurf nicht mehrfach am selben Gegner Schaden macht; auf dem Rueckweg
         zaehlt jeder wieder neu. */
      this.projectiles.push({
        id: PROJ_ID++, type: 'disc', owner: p.id, team: p.team,
        x: m.x, y: m.y, sx: m.x, sy: m.y,
        vx: Math.cos(base) * w.bulletSpeed, vy: Math.sin(base) * w.bulletSpeed,
        dmg: shotDmg, falloffStart: w.falloffStart, falloffMin: w.falloffMin,
        weapon: w, hits: [], strecke: 0, zurueck: false,
        life: 6, spin: 0
      });
    } else if (w.projectile === 'rocket') {
      const ang = base + (Math.random() - 0.5) * 2 * spread;
      this.projectiles.push({
        id: PROJ_ID++, type: 'rocket', owner: p.id, team: p.team,
        x: m.x, y: m.y, sx: m.x, sy: m.y,
        vx: Math.cos(ang) * w.bulletSpeed, vy: Math.sin(ang) * w.bulletSpeed,
        life: w.fuse || 4.0, weapon: w,
        bounce: w.bounce || 0, fuse: w.fuse || 0
      });
    } else {
      const pellets = w.pellets || 1;
      for (let i = 0; i < pellets; i++) {
        const ang = base + (Math.random() - 0.5) * 2 * spread;
        this.projectiles.push({
          id: PROJ_ID++, type: 'bullet', owner: p.id, team: p.team,
          x: m.x, y: m.y, sx: m.x, sy: m.y,
          vx: Math.cos(ang) * w.bulletSpeed, vy: Math.sin(ang) * w.bulletSpeed,
          life: w.bulletLife || C.BULLET_LIFE,
          maxLife: w.bulletLife || C.BULLET_LIFE,
          dmg: shotDmg, falloffStart: w.falloffStart, falloffMin: w.falloffMin,
          pierce: w.pierce || 0, hits: [], burn: w.burn || 0, fire: !!w.fire
        });
      }
    }

    p.vx -= Math.cos(base) * w.recoil;
    p.vy -= Math.sin(base) * w.recoil;
    this.events.push({
      e: 'shot', id: p.id, x: m.x, y: m.y, a: base, ammo: p.ammo, w: p.weaponKey,
      big: lastShot ? 1 : 0
    });
  }

  /* ---------------- Nahkampf ---------------- */
  swing(p) {
    const w = p.weapon;
    p.fireCd = w.fireCd;
    p.lastFireAt = this.time;
    const reach = w.range + C.PLAYER_R;
    let hits = 0;
    for (const o of this.players.values()) {
      if (!o.alive || o.id === p.id || o.invulT > 0) continue;
      if (this.mode.teams > 1 && o.team === p.team) continue;
      const dx = o.x - p.x, dy = o.y - p.y;
      const d = Math.hypot(dx, dy);
      if (d > reach) continue;
      /* Beim Rundumschlag (arc = 2 PI) faellt die Winkelpruefung weg - der
         Hieb trifft in jede Richtung, auch in den Ruecken. */
      if (w.arc < Math.PI * 2) {
        let rel = Math.atan2(dy, dx) - p.aim;
        while (rel > Math.PI) rel -= Math.PI * 2;
        while (rel < -Math.PI) rel += Math.PI * 2;
        if (Math.abs(rel) > w.arc / 2) continue;
      }
      if (!PHYS.los(this.map, p.x, p.y, o.x, o.y)) continue;   // nicht durch Waende
      this.damage(o, {
        owner: p.id, dmg: w.dmg, sx: p.x, sy: p.y,
        vx: Math.cos(p.aim), vy: Math.sin(p.aim), falloffStart: 0, falloffMin: 1
      }, o.x, o.y);
      hits++;
    }
    this.events.push({ e: 'swing', id: p.id, x: p.x, y: p.y, a: p.aim, hits });
  }

  /* ---------------- Minen ----------------
     Erster Klick wirft die Mine (fliegt ueber Waende), zweiter Klick zuendet
     sie. Nachschub gibt es erst nach der Explosion. */
  mineAction(p) {
    const w = p.weapon;
    p.fireCd = w.fireCd;
    if (!p.mine) {
      const dist = clamp(p.input.gd || 240, C.MINE_RANGE_MIN, w.range);
      const m = this.muzzlePoint(p, p.aim);
      p.mine = {
        state: 'flying',
        x: m.x, y: m.y,
        tx: p.x + Math.cos(p.aim) * dist,
        ty: p.y + Math.sin(p.aim) * dist,
        t: 0, armT: 0
      };
      p.ammo = 0;
      this.events.push({ e: 'mineout', id: p.id, x: m.x, y: m.y, tx: p.mine.tx, ty: p.mine.ty });
      return;
    }
    if (p.mine.state === 'armed' && p.mine.armT <= 0) this.detonateMine(p);
  }

  stepMine(p, dt) {
    const m = p.mine;
    if (m.state === 'flying') {
      m.t += dt;
      const k = Math.min(1, m.t / C.MINE_FLIGHT);
      // Fliegt in gerader Linie ueber alles hinweg
      m.x += (m.tx - m.x) * Math.min(1, dt / Math.max(0.016, C.MINE_FLIGHT - m.t + dt));
      m.y += (m.ty - m.y) * Math.min(1, dt / Math.max(0.016, C.MINE_FLIGHT - m.t + dt));
      if (k >= 1) {
        m.x = m.tx; m.y = m.ty;
        m.state = 'armed';
        m.armT = C.MINE_ARM_DELAY;
        this.events.push({ e: 'mineset', id: p.id, x: m.x, y: m.y });
      }
    } else if (m.armT > 0) {
      m.armT = Math.max(0, m.armT - dt);
    }
  }

  detonateMine(p) {
    const w = p.weapon;
    const m = p.mine;
    if (!m) return;
    p.mine = null;
    p.ammo = 1;                     // Nachschub erst jetzt
    this.explode(m.x, m.y, {
      dmg: w.blastDmg, radius: w.blastRadius, min: w.blastMin,
      wallBreak: w.wallBreak, bushBreak: w.bushBreak,
      owner: p.id, team: p.team, selfFactor: w.selfFactor, kind: 'mine'
    });
    this.events.push({ e: 'mineboom', id: p.id, x: m.x, y: m.y });
  }

  throwGrenade(p, dist) {
    p.grenades--;
    p.grenadeCd = C.GRENADE_CD;
    const m = this.muzzlePoint(p, p.aim);
    // Anfangstempo so waehlen, dass die Granate nach Ablauf des Zuenders
    // genau auf der gewuenschten Distanz liegt: d = v0/k * (1 - e^(-k*t))
    const want = clamp(dist || p.input.gd || C.GRENADE_RANGE_DEFAULT, C.GRENADE_RANGE_MIN, C.GRENADE_RANGE_MAX);
    // Die Granate startet bereits vor dem Spieler - diesen Vorsprung abziehen,
    // sonst landet sie systematisch zu weit hinter dem Fadenkreuz.
    const travel = Math.max(20, want - Math.hypot(m.x - p.x, m.y - p.y));
    const k = C.GRENADE_DRAG;
    const v0 = travel * k / (1 - Math.exp(-k * C.GRENADE_FUSE));
    this.projectiles.push({
      id: PROJ_ID++, type: 'grenade', owner: p.id, team: p.team,
      x: m.x, y: m.y, sx: m.x, sy: m.y,
      vx: Math.cos(p.aim) * v0, vy: Math.sin(p.aim) * v0,
      fuse: C.GRENADE_FUSE, life: C.GRENADE_FUSE
    });
    this.events.push({ e: 'nade', id: p.id, x: m.x, y: m.y, left: p.grenades });
  }

  stepProjectiles(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const b = this.projectiles[i];

      if (b.type === 'grenade') {
        b.fuse -= dt;
        const drag = Math.max(0, 1 - C.GRENADE_DRAG * dt);
        b.vx *= drag; b.vy *= drag;
        // Achsenweise mit Abprall
        let nx = b.x + b.vx * dt;
        if (PHYS.tileAtWorld(this.map, nx, b.y) === C.T_WALL) { b.vx = -b.vx * C.GRENADE_BOUNCE; nx = b.x; }
        let ny = b.y + b.vy * dt;
        if (PHYS.tileAtWorld(this.map, b.x, ny) === C.T_WALL) { b.vy = -b.vy * C.GRENADE_BOUNCE; ny = b.y; }
        b.x = nx; b.y = ny;
        if (b.fuse <= 0) {
          this.explode(b.x, b.y, {
            dmg: C.GRENADE_DMG, radius: C.GRENADE_RADIUS, min: C.GRENADE_MIN,
            wallBreak: C.GRENADE_WALLBREAK, bushBreak: C.GRENADE_BUSHBREAK,
            owner: b.owner, team: b.team, selfFactor: C.GRENADE_SELF, kind: 'nade'
          });
          this.projectiles.splice(i, 1);
        }
        continue;
      }

      /* Schallplatte: hin, abprallen, umkehren, zurueck in die Hand.
         Sie verschwindet nie an einer Wand - nur beim Fangen oder wenn ihr
         Werfer stirbt. Sonst haette man nach einem Fehlwurf gar keine Waffe
         mehr. */
      if (b.type === 'disc') {
        const w = b.weapon;
        b.life -= dt;
        const wirf = this.players.get(b.owner);
        b.spin += dt * 18;

        if (!b.zurueck) {
          let bx = b.x + b.vx * dt, by = b.y + b.vy * dt;
          /* Die erste Wand schickt die Platte zurueck. Achsenweise geprueft,
             damit sie auch in einer Ecke sauber umkehrt. */
          if (PHYS.tileAtWorld(this.map, bx, b.y) === C.T_WALL) {
            b.zurueck = true;
            this.events.push({ e: 'discwall', id: b.id, x: b.x, y: b.y });
            bx = b.x;
          }
          if (PHYS.tileAtWorld(this.map, b.x, by) === C.T_WALL) {
            if (!b.zurueck) this.events.push({ e: 'discwall', id: b.id, x: b.x, y: b.y });
            b.zurueck = true;
            by = b.y;
          }
          b.strecke += Math.hypot(bx - b.x, by - b.y);
          b.x = bx; b.y = by;
          if (b.strecke >= w.range) b.zurueck = true;
          if (b.zurueck) b.hits.length = 0;      // Rueckweg trifft erneut
        } else if (wirf && wirf.alive) {
          // Zurueck zum Werfer - fliegt dabei durch Waende, sonst bliebe sie haengen
          const dx = wirf.x - b.x, dy = wirf.y - b.y;
          const d = Math.hypot(dx, dy) || 1;
          b.vx = dx / d * w.returnSpeed; b.vy = dy / d * w.returnSpeed;
          b.x += b.vx * dt; b.y += b.vy * dt;
          if (d < C.PLAYER_R + 10) {
            wirf.ammo = w.mag;                   // gefangen: naechster Wurf frei
            this.events.push({ e: 'disccatch', id: wirf.id, x: b.x, y: b.y });
            this.projectiles.splice(i, 1);
            continue;
          }
        } else {
          // Werfer ist tot - Platte loest sich auf
          this.projectiles.splice(i, 1);
          continue;
        }

        // Treffer auf Hin- und Rueckweg
        for (const p of this.players.values()) {
          if (!p.alive || p.id === b.owner || p.invulT > 0) continue;
          if (this.mode.teams > 1 && p.team === b.team) continue;
          if (b.hits.includes(p.id)) continue;
          if (Math.hypot(p.x - b.x, p.y - b.y) > C.PLAYER_R + C.BULLET_R + 4) continue;
          b.hits.push(p.id);
          this.damage(p, b, b.x, b.y);
        }
        if (b.life <= 0) {
          if (wirf) wirf.ammo = w.mag;           // nie dauerhaft ohne Waffe dastehen
          this.projectiles.splice(i, 1);
        }
        continue;
      }

      // Abprallende Sprenggeschosse (Granatwerfer): wie eine Granate, aber
      // schneller und mit Aufschlagzuender auf Gegner.
      if (b.type === 'rocket' && b.bounce) {
        b.life -= dt;
        let bx = b.x + b.vx * dt;
        if (PHYS.tileAtWorld(this.map, bx, b.y) === C.T_WALL) { b.vx = -b.vx * b.bounce; bx = b.x; }
        let by = b.y + b.vy * dt;
        if (PHYS.tileAtWorld(this.map, b.x, by) === C.T_WALL) { b.vy = -b.vy * b.bounce; by = b.y; }
        b.x = bx; b.y = by;
        // Direkttreffer zuenden sofort
        let direct = null;
        for (const p of this.players.values()) {
          if (!p.alive || p.id === b.owner || p.invulT > 0) continue;
          if (this.mode.teams > 1 && p.team === b.team) continue;
          if (Math.hypot(p.x - b.x, p.y - b.y) <= C.PLAYER_R + C.BULLET_R) { direct = p; break; }
        }
        if (direct || b.life <= 0) {
          this.explodeRocket(b, b.x, b.y);
          this.projectiles.splice(i, 1);
        }
        continue;
      }

      const nx = b.x + b.vx * dt, ny = b.y + b.vy * dt;

      // Spielertreffer suchen
      let hit = null, hitT = 2;
      for (const p of this.players.values()) {
        if (!p.alive || p.id === b.owner) continue;
        if (this.mode.teams > 1 && p.team === b.team) continue;
        if (p.invulT > 0) continue;
        if (b.hits && b.hits.includes(p.id)) continue;
        const r = PHYS.segPointDist2(b.x, b.y, nx, ny, p.x, p.y);
        if (r.d2 <= (C.PLAYER_R + C.BULLET_R) * (C.PLAYER_R + C.BULLET_R) && r.t < hitT) {
          hitT = r.t; hit = p;
        }
      }

      const wall = PHYS.bulletWallHit(this.map, b.x, b.y, nx, ny);
      const wallT = wall ? Math.hypot(wall.x - b.x, wall.y - b.y) / (Math.hypot(nx - b.x, ny - b.y) || 1) : 2;

      if (hit && hitT <= wallT) {
        const hx = b.x + (nx - b.x) * hitT, hy = b.y + (ny - b.y) * hitT;
        if (b.type === 'rocket') {
          this.explodeRocket(b, hx, hy, hit);
          this.projectiles.splice(i, 1);
          continue;
        }
        this.damage(hit, b, hx, hy);
        b.hits.push(hit.id);
        if (b.hits.length > b.pierce) { this.projectiles.splice(i, 1); continue; }
      }
      if (wall) {
        if (b.type === 'rocket') this.explodeRocket(b, wall.x, wall.y);
        else this.events.push({ e: 'impact', x: wall.x, y: wall.y, a: Math.atan2(b.vy, b.vx) });
        this.projectiles.splice(i, 1);
        continue;
      }

      b.x = nx; b.y = ny;
      b.life -= dt;
      if (b.life <= 0) this.projectiles.splice(i, 1);
    }
  }

  explodeRocket(b, x, y, direct) {
    const w = b.weapon;
    this.explode(x, y, {
      dmg: w.blastDmg, radius: w.blastRadius, min: w.blastMin,
      wallBreak: w.wallBreak, bushBreak: w.bushBreak,
      owner: b.owner, team: b.team, selfFactor: w.selfFactor, kind: 'rocket',
      // Bazooka: wer direkt getroffen wird, stirbt - Splash bleibt abgestuft
      direct: w.oneShot ? direct : null
    });
  }

  /** Terrain sprengen, dann Schaden verteilen (Blast geht durch das eigene Loch). */
  explode(x, y, o) {
    const broken = this.breakTiles(x, y, o.wallBreak || 0, o.bushBreak || 0);
    this.events.push({ e: 'boom', x, y, r: o.radius, kind: o.kind, by: o.owner });

    const shooter = this.players.get(o.owner);
    for (const p of this.players.values()) {
      if (!p.alive || p.invulT > 0) continue;
      const d = Math.hypot(p.x - x, p.y - y);
      if (d > o.radius + C.PLAYER_R) continue;
      const isSelf = p.id === o.owner;
      if (!isSelf && this.mode.teams > 1 && p.team === o.team) continue;  // kein Team-Beschuss
      if (!PHYS.los(this.map, x, y, p.x, p.y)) continue;

      const k = clamp(1 - Math.max(0, d - C.PLAYER_R) / o.radius, 0, 1);
      let dmg = Math.round(o.dmg * (o.min + (1 - o.min) * k) * (isSelf ? o.selfFactor : 1));
      // Direkttreffer einer Oneshot-Waffe ignoriert die Abstufung
      if (o.direct && p.id === o.direct.id && !isSelf) dmg = C.HP_MAX;
      if (dmg <= 0) continue;

      const before = p.hp;
      p.hp -= dmg;
      p.lastHitAt = this.time;
      if (shooter && !isSelf) shooter.damage += Math.min(dmg, before);

      this.events.push({
        e: 'hit', id: p.id, by: o.owner, x: p.x, y: p.y,
        d: dmg, a: Math.atan2(p.y - y, p.x - x), hp: Math.max(0, p.hp), blast: 1
      });
      if (p.hp <= 0) this.kill(p, isSelf ? null : shooter, p.x, p.y, Math.atan2(p.y - y, p.x - x));
    }
    return broken;
  }

  /** Waende zu Schutt, Buesche weg. Aussenmauer bleibt stehen. */
  breakTiles(x, y, wallR, bushR) {
    if (wallR <= 0 && bushR <= 0) return 0;
    const T = C.TILE, n = this.map.n;
    const maxR = Math.max(wallR, bushR);
    const ctx = x / T, cty = y / T;
    const x0 = Math.max(1, Math.floor(ctx - maxR)), x1 = Math.min(n - 2, Math.ceil(ctx + maxR));
    const y0 = Math.max(1, Math.floor(cty - maxR)), y1 = Math.min(n - 2, Math.ceil(cty + maxR));
    let count = 0;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        const d = Math.hypot(tx + 0.5 - ctx, ty + 0.5 - cty);
        const i = ty * n + tx;
        const v = this.map.tiles[i];
        if (v === C.T_WALL && d <= wallR) {
          this.map.tiles[i] = C.T_RUBBLE;
          this.tileChanges.push({ x: tx, y: ty, v: C.T_RUBBLE });
          count++;
        } else if (v === C.T_BUSH && d <= bushR) {
          this.map.tiles[i] = C.T_FLOOR;
          this.tileChanges.push({ x: tx, y: ty, v: C.T_FLOOR });
          count++;
        }
      }
    }
    return count;
  }

  damage(target, bullet, hx, hy) {
    const shooter = this.players.get(bullet.owner);
    const dist = Math.hypot(hx - bullet.sx, hy - bullet.sy);
    let dmg = bullet.dmg;
    if (bullet.falloffStart && dist > bullet.falloffStart) {
      const f = 1 - (dist - bullet.falloffStart) / 700;
      dmg *= clamp(f, bullet.falloffMin, 1);
    }
    dmg = Math.max(1, Math.round(dmg));
    const before = target.hp;
    target.hp -= dmg;
    target.lastHitAt = this.time;
    if (shooter) shooter.damage += Math.min(dmg, before);

    // Brandwirkung: laeuft weiter, auch wenn das Ziel aus der Reichweite flieht
    if (bullet.burn) {
      target.burnUntil = this.time + bullet.burn;
      target.burnBy = bullet.owner;
    }

    this.events.push({
      e: 'hit', id: target.id, by: bullet.owner, x: hx, y: hy,
      d: dmg, a: Math.atan2(bullet.vy, bullet.vx), hp: Math.max(0, target.hp)
    });

    if (target.hp <= 0) this.kill(target, shooter, hx, hy, Math.atan2(bullet.vy, bullet.vx));
  }

  kill(victim, killer, hx, hy, ang) {
    if (!victim.alive) return;
    victim.alive = false;
    victim.hp = 0;
    victim.deaths++;
    victim.respawnT = C.RESPAWN_TIME;
    victim.streak = 0;

    let multi = 0;
    if (killer && killer !== victim) {
      killer.kills++;
      killer.streak++;
      killer.bestStreak = Math.max(killer.bestStreak, killer.streak);
      killer.multiCount = killer.multiWindow > 0 ? killer.multiCount + 1 : 1;
      killer.multiWindow = 3.0;
      multi = killer.multiCount;
      if (this.mode.teams > 1) this.teamScore[killer.team]++;
      // Schwert: nach dem Kill kurz verschwinden, um wieder wegzukommen
      const ct = killer.weapon.cloakTime;
      if (ct) {
        killer.cloakUntil = this.time + ct;
        this.events.push({ e: 'cloak', id: killer.id, t: ct });
      }
    }

    this.events.push({
      e: 'kill', id: victim.id, by: killer ? killer.id : null,
      x: victim.x, y: victim.y, hx, hy, a: ang,
      w: killer ? killer.weaponKey : null,
      multi, streak: killer ? killer.streak : 0,
      dist: killer ? Math.round(Math.hypot(killer.x - victim.x, killer.y - victim.y)) : 0
    });
  }

  stepPickups(dt) {
    for (const pk of this.pickups) {
      if (!pk.active) {
        pk.respawnAt -= dt;
        if (pk.respawnAt <= 0) { pk.active = true; this.events.push({ e: 'pkspawn', id: pk.id }); }
        continue;
      }
      for (const p of this.players.values()) {
        if (!p.alive) continue;
        const d = Math.hypot(p.x - pk.x, p.y - pk.y);
        if (d > C.PLAYER_R + 14) continue;
        if (pk.type === 'health') {
          if (p.hp >= C.HP_MAX) continue;
          p.hp = Math.min(C.HP_MAX, p.hp + C.PACK_HEAL);
          pk.active = false; pk.respawnAt = C.PACK_RESPAWN;
        } else {
          const full = p.ammo >= p.weapon.mag && p.reloadT <= 0 && p.grenades >= C.GRENADES;
          if (full) continue;
          p.ammo = p.weapon.mag; p.reloadT = 0;
          p.grenades = Math.min(C.GRENADES, p.grenades + 1);
          pk.active = false; pk.respawnAt = C.AMMO_PACK_RESPAWN;
        }
        this.events.push({ e: 'pickup', id: pk.id, by: p.id, t: pk.type, x: pk.x, y: pk.y });
        break;
      }
    }
  }

  checkEnd() {
    if (this.state !== 'live') return;
    const lim = this.mode.scoreLimit;
    if (this.mode.teams > 1) {
      for (let t = 0; t < 2; t++) if (this.teamScore[t] >= lim) return this.end(t);
    } else {
      for (const p of this.players.values()) if (p.kills >= lim) return this.end(p.id);
    }
    if (this.timeLeft <= 0) {
      if (this.mode.teams > 1) {
        const w = this.teamScore[0] === this.teamScore[1] ? null : (this.teamScore[0] > this.teamScore[1] ? 0 : 1);
        return this.end(w);
      }
      let best = null;
      for (const p of this.players.values()) if (!best || p.kills > best.kills) best = p;
      return this.end(best ? best.id : null);
    }
  }

  end(winner) {
    this.state = 'over';
    this.winner = winner;
    this.events.push({ e: 'over', w: winner });
    if (this.room) this.room.onMatchEnd(this);
  }

  /* ---------------- Sichtbarkeit + Snapshot ---------------- */

  canSee(viewer, target) {
    if (viewer.id === target.id) return true;
    if (this.mode.teams > 1 && viewer.team === target.team) return true;
    if (!target.alive) return false;
    const dx = target.x - viewer.x, dy = target.y - viewer.y;
    const d = Math.hypot(dx, dy);
    // Sichtkegel: nur was vor einem liegt - der Server schickt den Rest gar nicht
    if (!C.inView(viewer.aim, dx, dy, d)) return false;
    // Getarnt nach einem Schwert-Kill: fuer Gegner komplett weg
    if (target.cloakUntil > this.time) return false;
    if (!PHYS.los(this.map, viewer.x, viewer.y, target.x, target.y)) return false;
    if (PHYS.inBush(this.map, target.x, target.y)) {
      const justFired = this.time - target.lastFireAt < C.FIRE_REVEAL_TIME;
      const close = d < C.BUSH_REVEAL_DIST;
      const viewerInSameBush = PHYS.inBush(this.map, viewer.x, viewer.y) && d < C.BUSH_REVEAL_DIST * 1.6;
      if (!justFired && !close && !viewerInSameBush) return false;
    }
    return true;
  }

  /* Ein getarnter Spieler darf sich nicht ueber seine eigenen Effekte
     verraten: der Rundumschlag waere sonst als Lichtring auf dem Schirm des
     Gegners zu sehen, obwohl die Figur gar nicht mitgeschickt wird. Treffer
     und Kills bleiben drin - die haengen am Opfer, nicht am Taeter. */
  eventVisible(viewer, ev) {
    if (ev.id === undefined || ev.id === viewer.id) return true;
    if (!POSITION_EVENTS.has(ev.e)) return true;
    const src = this.players.get(ev.id);
    if (!src || src.cloakUntil <= this.time) return true;
    return this.mode.teams > 1 && src.team === viewer.team;
  }

  snapshotFor(id) {
    const me = this.players.get(id);
    const ps = [];
    for (const p of this.players.values()) {
      const vis = me ? this.canSee(me, p) : true;
      if (!vis && p.alive) continue;
      ps.push({
        i: p.id,
        x: Math.round(p.x * 10) / 10,
        y: Math.round(p.y * 10) / 10,
        a: Math.round(p.aim * 100) / 100,
        h: Math.round(p.hp),
        t: p.team,
        al: p.alive ? 1 : 0,
        iv: p.invulT > 0 ? 1 : 0,
        ds: p.dashT > 0 ? 1 : 0,
        mv: Math.round(Math.hypot(p.vx, p.vy)),
        bu: PHYS.inBush(this.map, p.x, p.y) ? 1 : 0,
        sp: Math.round(p.spin * 100) / 100,
        w: C.WEAPON_ORDER.indexOf(p.weaponKey),
        bu2: p.burnUntil && this.time < p.burnUntil ? 1 : 0,
        ck: p.cloakUntil > this.time ? 1 : 0,
        rl: p.reloadT > 0 ? Math.round((1 - p.reloadT / p.weapon.reload) * 100) / 100 : 0
      });
    }

    const bs = [];
    for (const b of this.projectiles) {
      if (me && Math.hypot(b.x - me.x, b.y - me.y) > C.VIEW_RADIUS + 260) continue;
      bs.push({
        i: b.id, x: Math.round(b.x), y: Math.round(b.y),
        a: Math.round(Math.atan2(b.vy, b.vx) * 100) / 100,
        o: b.owner,
        // 0 Kugel, 1 Rakete, 2 Granate, 3 Flamme, 4 Schallplatte
        ty: b.type === 'disc' ? 4 : b.type === 'rocket' ? 1 : b.type === 'grenade' ? 2 : (b.fire ? 3 : 0),
        s: Math.round(Math.hypot(b.vx, b.vy)),
        // Restlebensdauer 0..1 -> Client blendet am Reichweitenende aus,
        // statt das Geschoss abrupt verschwinden zu lassen
        l: b.type === 'bullet' ? Math.round(Math.max(0, Math.min(1, b.life / (b.maxLife || b.life || 1))) * 100) / 100 : 1
      });
    }

    const snap = {
      t: C.MSG.SNAP,
      k: this.tick,
      st: this.state,
      cd: this.state === 'countdown' ? Math.max(0, this.countdown) : 0,
      tl: Math.round(this.timeLeft),
      ps, bs,
      pk: this.pickups.map(p => ({ i: p.id, x: p.x, y: p.y, a: p.active ? 1 : 0, ty: p.type })),
      ts: this.teamScore,
      sb: [...this.players.values()].map(p => ({
        i: p.id, k: p.kills, d: p.deaths, dm: Math.round(p.damage), s: p.bestStreak, t: p.team, al: p.alive ? 1 : 0
      })),
      ev: me ? this.events.filter(e => this.eventVisible(me, e)) : this.events
    };
    if (this.tileChanges.length) snap.tc = this.tileChanges;

    // Minen sieht nur, wer sie gelegt hat (im Teammodus auch die Mitspieler)
    const mines = [];
    for (const p of this.players.values()) {
      if (!p.mine || !me) continue;
      const own = p.id === me.id || (this.mode.teams > 1 && p.team === me.team);
      if (!own) continue;
      mines.push({
        i: p.id, x: Math.round(p.mine.x), y: Math.round(p.mine.y),
        s: p.mine.state === 'armed' ? 1 : 0,
        rd: p.mine.armT > 0 ? 0 : 1
      });
    }
    if (mines.length) snap.mi = mines;
    if (me) {
      snap.me = {
        x: Math.round(me.x * 100) / 100, y: Math.round(me.y * 100) / 100,
        vx: Math.round(me.vx * 10) / 10, vy: Math.round(me.vy * 10) / 10,
        hp: Math.round(me.hp), am: me.ammo, rl: Math.round(me.reloadT * 100) / 100,
        dc: Math.round(me.dashCd * 100) / 100, dt: Math.round(me.dashT * 100) / 100,
        gr: me.grenades, sp: Math.round(me.spin * 100) / 100,
        al: me.alive ? 1 : 0, rs: Math.max(0, Math.round(me.respawnT * 10) / 10),
        iv: Math.round(me.invulT * 100) / 100,
        ck: Math.max(0, Math.round((me.cloakUntil - this.time) * 100) / 100),
        seq: me.lastSeq
      };
    }
    return snap;
  }

  scoreboard() {
    return [...this.players.values()].map(p => ({
      id: p.id, name: p.name, color: p.color, team: p.team, bot: p.bot, weapon: p.weaponKey,
      kills: p.kills, deaths: p.deaths, damage: Math.round(p.damage), streak: p.bestStreak
    })).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.damage - a.damage);
  }

  clearEvents() {
    if (this.events.length) this.events = [];
    if (this.tileChanges.length) this.tileChanges = [];
  }
}

module.exports = { Match };
