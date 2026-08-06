/* Geteilte Konstanten - laufen auf Server (require) und Client (global C). */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.C = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const C = {
    // Welt
    TILE: 40,
    GRID: 32,
    get WORLD() { return this.TILE * this.GRID; },

    // Tile-Typen
    T_FLOOR: 0,
    T_WALL: 1,
    T_BUSH: 2,
    T_RUBBLE: 3,   // zerstoerte Wand - begehbar, keine Deckung

    // Spieler
    PLAYER_R: 14,
    SPEED: 185,            // Grundtempo, wird pro Waffe skaliert
    ACCEL: 2300,
    FRICTION: 1900,
    DASH_SPEED: 620,
    DASH_TIME: 0.16,
    DASH_CD: 2.4,
    DASH_CD_HEAVY: 2,      // Faktor auf den Dash-Cooldown bei schweren Waffen
    HP_MAX: 100,
    REGEN_DELAY: 5.0,
    REGEN_RATE: 14,
    RESPAWN_TIME: 3.0,
    SPAWN_INVUL: 1.6,

    BULLET_LIFE: 1.6,
    BULLET_R: 3.5,
    BURN_DPS: 4.5,        // Brandschaden je Sekunde (Flammenwerfer)

    /* ---------------- Waffen ----------------
       Jede Waffe hat drei Stellschrauben, die gegeneinander arbeiten:
         range      wie weit die Geschosse ueberhaupt fliegen (Lebensdauer)
         speedMult  Lauftempo des Traegers (schwer = langsam)
         dmg/fireCd Zeit bis zum Kill

       Ziel: TTK zwischen 0,45 s und 1,6 s. Wer hohen Schaden oder Reichweite
       hat, zahlt mit Tempo, Magazin oder Nachladezeit.
       bulletLife wird aus range/bulletSpeed berechnet - siehe initWeapons(). */
    WEAPONS: {
      pistol: {
        key: 'pistol', name: 'Pistol', short: 'PISTOL', icon: '🔫', tier: 1,
        mag: 15, dmg: 25, fireCd: 0.25, reload: 1.1, auto: false,
        bulletSpeed: 900, range: 400, spread: 0.018, spreadGrow: 0.010, spreadMax: 0.06,
        speedMult: 1.00, falloffStart: 300, falloffMin: 0.55, recoil: 80,
        pros: ['Only weapon with full run speed', '25 damage per hit', '15 rounds',
          'Fastest reload (1.1 s)'],
        cons: ['Medium range', 'No full auto']
      },
      smg: {
        key: 'smg', name: 'SMG', short: 'SMG', icon: '💨', tier: 1,
        mag: 35, dmg: 15, fireCd: 0.075, reload: 2.0, auto: true,
        bulletSpeed: 820, range: 300, spread: 0.05, spreadGrow: 0.011, spreadMax: 0.15,
        speedMult: 1.06, falloffStart: 200, falloffMin: 0.4, recoil: 30,
        pros: ['Very high fire rate', '35 rounds per magazine', 'Fast movement'],
        cons: ['Short range', 'Heavy spread']
      },
      revolver: {
        key: 'revolver', name: 'Revolver', short: 'REVOLVER', icon: '🎰', tier: 2,
        mag: 5, dmg: 40, fireCd: 0.55, reload: 2.2, auto: false,
        bulletSpeed: 1100, range: 420, spread: 0.012, spreadGrow: 0.03, spreadMax: 0.1,
        speedMult: 0.98, falloffStart: 400, falloffMin: 0.7, recoil: 430,
        kick: true,          // Rueckstoss traegt dich - als Fluchtmittel nutzbar
        lastShotMult: 2,     // die letzte Patrone der Trommel schlaegt doppelt zu
        pros: ['40 damage per hit', 'Last round deals double damage (80)',
          'Recoil throws you back — usable to dodge'],
        cons: ['Slow rate of fire', 'Only 5 rounds']
      },
      ak47: {
        key: 'ak47', name: 'AK-47', short: 'AK-47', icon: '🎯', tier: 2,
        mag: 20, dmg: 18, fireCd: 0.13, reload: 2.4, auto: true,
        bulletSpeed: 1000, range: 460, spread: 0.028, spreadGrow: 0.016, spreadMax: 0.13,
        speedMult: 0.90, falloffStart: 420, falloffMin: 0.55, recoil: 40,
        pros: ['Longest range of the automatics', '18 damage per hit'],
        cons: ['Only 20 rounds', 'Spread on full auto', 'Slower run speed']
      },
      shotgun: {
        key: 'shotgun', name: 'Shotgun', short: 'SHOTGUN', icon: '💥', tier: 2,
        mag: 6, dmg: 9, pellets: 8, fireCd: 0.8, reload: 2.6, auto: false,
        // Streuung 15 Prozent weiter als zuvor (0,15) - breiterer Kegel,
        // dafuer sitzen auf Distanz noch weniger Kugeln
        bulletSpeed: 780, range: 210, spread: 0.1725, spreadGrow: 0, spreadMax: 0.1725,
        speedMult: 0.94, falloffStart: 130, falloffMin: 0.2, recoil: 210,
        pros: ['Lethal up close', 'Wide pellet cone - hits even with rough aim'],
        cons: ['Barely any range', 'Slow rate of fire', 'Spreads a lot']
      },
      flamer: {
        key: 'flamer', name: 'Flamethrower', short: 'FLAMER', icon: '🔥', tier: 2,
        mag: 200, dmg: 5, pellets: 2, fireCd: 0.05, reload: 4.0, auto: true,
        bulletSpeed: 620, range: 240, spread: 0.16, spreadGrow: 0, spreadMax: 0.16,
        speedMult: 0.72, falloffStart: 90, falloffMin: 0.35, recoil: 6,
        heavy: true,
        burn: 3.5,   // brennt nach: Schaden ueber Zeit, auch wenn der Gegner flieht
        fire: true,  // Geschosse werden als Flammen gezeichnet, nicht als Kugeln
        pros: ['Sets enemies on fire — damage keeps ticking', '200 units of fuel'],
        cons: ['Short range', 'Very slow', '4 s reload']
      },
      /* Sergio wirft eine Schallplatte, die von Waenden abprallt und wieder
         zurueckkommt. Nachschub gibt es erst, wenn die Platte wieder in seiner
         Hand liegt - wer daneben wirft, steht so lange ohne Waffe da. */
      sergio: {
        key: 'sergio', name: 'Sergio', short: 'SERGIO', icon: '🎧', tier: 2,
        boomerang: true,
        mag: 1, dmg: 22, fireCd: 0.32, reload: 0, auto: false,
        bulletSpeed: 559, range: 280,        // etwas weiter als die Schrotflinte (210)
        spread: 0, spreadGrow: 0, spreadMax: 0,
        speedMult: 1.02, falloffStart: 9999, falloffMin: 1, recoil: 40,
        // Die erste Wand schickt die Platte zurueck - sie springt nicht weiter
        returnSpeed: 620,    // Rueckflug ist schneller als der Hinweg
        pros: ['Turns around at the first wall and flies back', 'Hits on the way out and back',
          'No reloading - the record returns on its own'],
        cons: ['Only one record at a time', 'Can only throw again once it is back',
          'Medium range']
      },
      sword: {
        key: 'sword', name: 'Sword', short: 'SWORD', icon: '⚔️', tier: 2,
        melee: true, arc: Math.PI * 2,  // Rundumschlag - trifft in alle Richtungen
        swingTime: 0.26,                // Dauer der sichtbaren Drehung
        cloakTime: 0.5,                 // nach einem Kill so lange unsichtbar
        mag: 0, dmg: 25, fireCd: 0.495, reload: 0, auto: true,
        range: 68, bulletSpeed: 1, spread: 0, spreadGrow: 0, spreadMax: 0,
        speedMult: 1.20, falloffStart: 9999, falloffMin: 1, recoil: 0,
        pros: ['Hits all around - 360 degrees, even behind you', 'Fastest movement in the game',
          'Invisible for 0.5 s after every kill', 'No ammo'],
        cons: ['Melee only (68 px)', 'Three hits needed', 'Slow swing rate',
          'Hopeless at range']
      },
      mine: {
        key: 'mine', name: 'Miner', short: 'MINES', icon: '🧨', tier: 3,
        mine: true,
        mag: 1, dmg: 0, fireCd: 0.35, reload: 0, auto: false,
        range: 310, bulletSpeed: 1, spread: 0, spreadGrow: 0, spreadMax: 0,
        speedMult: 0.86, recoil: 0,
        blastDmg: 99, blastMin: 1,   // voller Schaden im ganzen Radius
        blastRadius: 96, wallBreak: 1.2, bushBreak: 1.6, selfFactor: 1,
        pros: ['99 damage across the whole radius', 'Flies over walls', 'Invisible to enemies'],
        cons: ['Short throw (310 px)', 'Only one mine at a time',
          'Has to be detonated by hand', 'No resupply until it explodes']
      },
      crossbow: {
        key: 'crossbow', name: 'Crossbow', short: 'CROSSBOW', icon: '🏹', tier: 2,
        mag: 1, dmg: 55, fireCd: 0.3, reload: 1.25, auto: false,
        bulletSpeed: 1150, range: 580, spread: 0.006, spreadGrow: 0, spreadMax: 0.006,
        speedMult: 0.92, falloffStart: 700, falloffMin: 0.85, recoil: 90,
        silent: true,
        pros: ['Silent — will not give you away in a bush', 'Very accurate'], cons: ['One bolt per load', '2 hits needed']
      },
      grenadier: {
        key: 'grenadier', name: 'Grenadier', short: 'GRENADIER', icon: '🎳', tier: 3,
        mag: 5, dmg: 0, fireCd: 0.9, reload: 3.4, auto: false,
        projectile: 'rocket', bulletSpeed: 520, range: 560, spread: 0.02, spreadGrow: 0, spreadMax: 0.02,
        speedMult: 0.80, recoil: 140,
        heavy: true,
        blastDmg: 55, blastRadius: 92, blastMin: 0.3, wallBreak: 0, bushBreak: 1.8,
        selfFactor: 0.5,
        bounce: 0.55, fuse: 1.5,   // prallt ab und geht erst nach Zeit hoch -> um Ecken schiessen
        pros: ['Bounces off walls — hits around corners', 'Splash damage'],
        cons: ['Does not blow up walls', 'Only detonates after 1.5 s']
      },
      minigun: {
        key: 'minigun', name: 'Minigun', short: 'MINIGUN', icon: '⚙️', tier: 3,
        mag: 100, dmg: 9, fireCd: 0.055, reload: 5.0, auto: true,
        bulletSpeed: 950, range: 400, spread: 0.045, spreadGrow: 0.005, spreadMax: 0.14,
        speedMult: 0.62, falloffStart: 340, falloffMin: 0.45, recoil: 20,
        heavy: true,
        spinUp: 0.55,
        pros: ['100 rounds without reloading'], cons: ['Very slow', 'Spin-up time', '5 s reload', 'Short range']
      },
      sniper: {
        key: 'sniper', name: 'Sniper', short: 'SNIPER', icon: '🔭', tier: 3,
        mag: 5, dmg: 70, fireCd: 1.25, reload: 3.0, auto: false,
        bulletSpeed: 1900, range: 780, spread: 0.003, spreadGrow: 0.02, spreadMax: 0.09,
        speedMult: 0.84, falloffStart: 4000, falloffMin: 1, recoil: 170,
        pierce: 1, laser: true,
        pros: ['Longest range', 'No damage falloff', 'Pierces'], cons: ['Long reload', 'Slow']
      },
      bazooka: {
        key: 'bazooka', name: 'Bazooka', short: 'BAZOOKA', icon: '🚀', tier: 3,
        mag: 4, dmg: 0, fireCd: 1.5, reload: 4.0, auto: false,
        projectile: 'rocket', bulletSpeed: 430, range: 900, spread: 0.01, spreadGrow: 0, spreadMax: 0.01,
        speedMult: 0.58, recoil: 250,
        blastDmg: 75, blastRadius: 108, blastMin: 0.32, wallBreak: 1.5, bushBreak: 2.0,
        selfFactor: 0.55,
        heavy: true,
        pros: ['75 splash damage', 'Blows up walls'],
        cons: ['Only 4 rockets', 'Slowest of all', 'Sluggish projectile — easy to dodge', 'Sluggish dash']
      }
    },
    WEAPON_ORDER: ['sword', 'pistol', 'smg', 'revolver', 'ak47', 'shotgun', 'flamer',
      'crossbow', 'sergio', 'mine', 'grenadier', 'minigun', 'sniper', 'bazooka'],

    /* ---------------- Minen ---------------- */
    MINE_FLIGHT: 0.55,      // Flugzeit bis zum Aufschlag
    MINE_RANGE_MIN: 60,
    MINE_ARM_DELAY: 0.35,   // kurz nach der Landung noch nicht zuendbar

    /* ---------------- Granaten ---------------- */
    GRENADES: 2,
    GRENADE_FUSE: 1.0,
    // Die Wurfstaerke wird aus der Cursordistanz berechnet, damit die Granate
    // dort liegen bleibt, wo gezielt wurde. Starke Bremsung + schwacher Abprall,
    // sonst rollt sie nach einem Wandtreffer am Werfer vorbei.
    GRENADE_DRAG: 3.4,
    GRENADE_BOUNCE: 0.3,
    GRENADE_RANGE_MIN: 70,
    GRENADE_RANGE_MAX: 430,
    GRENADE_RANGE_DEFAULT: 240,
    GRENADE_DMG: 80,
    GRENADE_RADIUS: 115,
    GRENADE_MIN: 0.3,
    GRENADE_WALLBREAK: 1.4,
    GRENADE_BUSHBREAK: 2.2,
    GRENADE_SELF: 0.6,
    GRENADE_CD: 0.7,

    // Pickups
    PACK_HEAL: 45,
    PACK_RESPAWN: 14,
    AMMO_PACK_RESPAWN: 10,

    /* Sicht: der Spieler sieht nur nach vorn, wie ein Mensch.
       Der Kegel dreht sich mit der Blickrichtung. Direkt um sich herum
       nimmt man alles wahr (FOV_NEAR), sonst nur innerhalb von FOV. */
    FOV: 1.85,            // ~106 Grad Oeffnungswinkel
    FOV_NEAR: 95,         // Rundumwahrnehmung auf Tuchfuehlung
    BUSH_REVEAL_DIST: 62,
    FIRE_REVEAL_TIME: 0.7,
    VIEW_RADIUS: 620,

    // Netz
    TICK_RATE: 60,
    SNAP_RATE: 30,
    get DT() { return 1 / this.TICK_RATE; },

    // Lobby
    MAX_PLAYERS: 6,
    CODE_LEN: 6,

    MAP_COUNT: 17,

    MODES: {
      ffa: { key: 'ffa', name: 'Free for all', short: 'FFA', teams: 1, perTeam: 6, min: 2, max: 6, scoreLimit: 12, time: 300 },
      '1v1': { key: '1v1', name: '1 vs 1', short: '1v1', teams: 2, perTeam: 1, min: 2, max: 2, scoreLimit: 8, time: 240 },
      '2v2': { key: '2v2', name: '2 vs 2', short: '2v2', teams: 2, perTeam: 2, min: 4, max: 4, scoreLimit: 15, time: 300 },
      '3v3': { key: '3v3', name: '3 vs 3', short: '3v3', teams: 2, perTeam: 3, min: 6, max: 6, scoreLimit: 20, time: 300 }
    },

    TEAM_COLORS: ['#3fb9ff', '#ff5c7a'],
    TEAM_NAMES: ['Blue', 'Red'],

    SKIN_PATTERNS: ['solid', 'stripe', 'dots', 'ring', 'shard'],

    // Verbindungs-Codes
    COUNTDOWN: 6.0,   // Zeit fuer Waffen-Slotmaschine + 3-2-1

    /* ---------------- Sterne ----------------
       Nach jedem Match wird nach Kills sortiert. Die obere Haelfte gewinnt
       Sterne, die untere verliert welche - symmetrisch um die Tabellenmitte.
       delta = (mitte - platz) * SCALE, Platz 1 zusaetzlich WIN_BONUS.
       Beispiel 6 Spieler: +7 +3 +1 -1 -3 -5
       Beispiel 2 Spieler: +3 -1
       Sterne koennen nie unter MIN fallen. */
    STARS: {
      SCALE: 2,
      WIN_BONUS: 2,
      TEAM_WIN_BONUS: 2,   // zusaetzlich fuer jeden im Siegerteam
      MIN: 0,
      LEADERBOARD_SIZE: 100
    },

    /* ---------------- Gold ----------------
       Waehrung fuer den Skinshop. Anders als Sterne kann Gold nie verloren
       gehen - auch der letzte Platz bekommt etwas, sonst lohnt sich ein
       aussichtsloses Match nicht mehr. */
    GOLD: {
      BASE: 10,          // bekommt jeder, der das Match beendet
      PER_RANK: 8,       // je Platz nach oben
      WIN_BONUS: 15,     // zusaetzlich fuer Platz 1
      PER_KILL: 2,
      TEAM_WIN_BONUS: 10
    },

    /* ---------------- Ablauf vor dem Match ----------------
       Erst waehlen alle gemeinsam die Karte. Dann drehen zwei Glücksräder
       je eine Waffe aus, die fuer diese Runde gesperrt ist - das entscheidet
       der Zufall, niemand stimmt darueber ab. Zuletzt sucht sich jeder aus
       dem Rest seine Waffe aus. */
    PREMATCH: {
      VOTE_TIME: 8,      // Kartenwahl
      WHEEL_TIME: 5,     // Glücksräder drehen und anhalten
      PICK_TIME: 5,      // Waffenwahl
      MAP_CHOICES: 3,    // Karten zur Auswahl
      BANS: 2            // so viele Waffen dreht der Zufall heraus
    },

    MSG: {
      HELLO: 'hello', CREATE: 'create', JOIN: 'join', LEAVE: 'leave',
      CHAT: 'chat', SETUP: 'setup', START: 'start', INPUT: 'in',
      ADDBOT: 'addbot', KICK: 'kick', TEAM: 'team', READY: 'ready',
      ROOM: 'room', ERROR: 'err', MATCH: 'match', SNAP: 's', END: 'end', PONG: 'pong', PING: 'ping',
      AUTH: 'auth', ME: 'me', BOARD: 'board', BOARDREQ: 'boardreq', PICK: 'pick',
      // Vorbereitung: Server meldet die Phase, Client schickt seine Stimme
      PHASE: 'phase', VOTE: 'vote',
      // Skinshop
      SHOP: 'shop', BUY: 'buy', EQUIP: 'equip'
    },

    WEAPON_CHOICES: 3,   // Zur Auswahl gestellte Waffen vor dem Match

    /** Liegt ein Ziel im Sichtfeld? Winkel relativ zur Blickrichtung. */
    inView(aim, dx, dy, dist) {
      if (dist <= this.FOV_NEAR) return true;      // direkt daneben merkt man immer
      if (dist > this.VIEW_RADIUS) return false;
      let d = Math.atan2(dy, dx) - aim;
      while (d > Math.PI) d -= Math.PI * 2;
      while (d < -Math.PI) d += Math.PI * 2;
      return Math.abs(d) <= this.FOV / 2;
    },

    /** Sterne-Aenderung fuer einen Platz. rank ist 1-basiert. */
    starDelta(rank, total, wonTeam) {
      const mid = (total + 1) / 2;
      let d = Math.round((mid - rank) * this.STARS.SCALE);
      if (rank === 1) d += this.STARS.WIN_BONUS;
      if (wonTeam) d += this.STARS.TEAM_WIN_BONUS;
      return d;
    },

    /** Gold fuer einen Platz. Nie negativ - der letzte Platz bekommt BASE. */
    goldFor(rank, total, kills, wonTeam) {
      const g = this.GOLD;
      let v = g.BASE + Math.max(0, total - rank) * g.PER_RANK + (kills || 0) * g.PER_KILL;
      if (rank === 1) v += g.WIN_BONUS;
      if (wonTeam) v += g.TEAM_WIN_BONUS;
      return Math.round(v);
    },

    /* ---------------- Skinshop ----------------
       Farben mit eigener Bewegung. Der Preis richtet sich nach dem Aufwand
       der Animation, nicht nach der Farbe - eine Flamme faellt im Spiel
       staerker auf als ein Leuchten. */
    SHOP_SKINS: [
      {
        id: 'neon', name: 'Neon', price: 120, color: '#3fd0ff', trail: '#9ef1ff',
        anim: 'pulse', desc: 'A ring of light pulsing to the beat'
      },
      {
        id: 'inferno', name: 'Inferno', price: 220, color: '#ff5c2a', trail: '#ffd166',
        anim: 'flame', desc: 'Tongues of flame rise off your body'
      },
      {
        id: 'toxic', name: 'Toxic', price: 180, color: '#7cff4a', trail: '#c8ff9b',
        anim: 'bubble', desc: 'Bubbling streaks drift upward'
      },
      {
        id: 'frost', name: 'Frost', price: 180, color: '#7fd7ff', trail: '#ffffff',
        anim: 'frost', desc: 'Ice crystals swirl around you'
      },
      {
        id: 'void', name: 'Void', price: 260, color: '#8b5cf6', trail: '#d8b4fe',
        anim: 'void', desc: 'A dark veil trails behind you'
      },
      {
        id: 'gold', name: 'Gold', price: 400, color: '#ffd166', trail: '#fff3c4',
        anim: 'sparkle', desc: 'Golden sparks jump with every step'
      },
      {
        id: 'storm', name: 'Storm', price: 240, color: '#7aa2ff', trail: '#e8f0ff',
        anim: 'storm', desc: 'Lightning flickers all around you'
      },
      {
        id: 'sakura', name: 'Sakura', price: 200, color: '#ff9ec7', trail: '#ffe1ee',
        anim: 'petals', desc: 'Petals drift down around you'
      },
      {
        id: 'magma', name: 'Magma', price: 280, color: '#ff7043', trail: '#ffbe57',
        anim: 'magma', desc: 'Glowing drops fall to the ground'
      },
      {
        id: 'ghost', name: 'Ghost', price: 300, color: '#b8c6e8', trail: '#ffffff',
        anim: 'ghost', desc: 'Afterimages trail behind you'
      },
      {
        id: 'prism', name: 'Prism', price: 350, color: '#ff5c7a', trail: '#3fd0ff',
        anim: 'prism', desc: 'The ring of light keeps changing color'
      },
      {
        id: 'disco', name: 'Disco', price: 450, color: '#c05cff', trail: '#ffd166',
        anim: 'disco', desc: 'Spotlight beams circle like in a club'
      },
      {
        id: 'nebel', name: 'Mist', price: 160, color: '#9aa7b8', trail: '#dfe7f2',
        anim: 'mist', desc: 'Thick haze drifts around your feet'
      },
      {
        id: 'runen', name: 'Runes', price: 320, color: '#5ce1b4', trail: '#c9fff0',
        anim: 'runes', desc: 'Glowing sigils circle around you'
      }
    ]
  };

  /* Reichweite in Geschoss-Lebensdauer umrechnen. So ist "range" die eine
     Zahl, an der man dreht - Speed und Lebensdauer bleiben konsistent. */
  for (const key of Object.keys(C.WEAPONS)) {
    const w = C.WEAPONS[key];
    if (w.range && w.bulletSpeed) w.bulletLife = w.range / w.bulletSpeed;
    if (!w.falloffStart) w.falloffStart = w.range || 500;
    if (w.falloffMin === undefined) w.falloffMin = 1;
  }

  return C;
});
