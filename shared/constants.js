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
    BURN_DPS: 9,          // Brandschaden je Sekunde (Flammenwerfer)

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
        key: 'pistol', name: 'Pistole', short: 'PISTOLE', icon: '🔫', tier: 1,
        mag: 15, dmg: 18, fireCd: 0.25, reload: 1.1, auto: false,
        bulletSpeed: 900, range: 400, spread: 0.018, spreadGrow: 0.010, spreadMax: 0.06,
        speedMult: 1.00, falloffStart: 300, falloffMin: 0.55, recoil: 80,
        pros: ['Einzige Waffe mit vollem Lauftempo', '15 Schuss', 'Schnellstes Nachladen (1,1 s)'],
        cons: ['Wenig Schaden je Treffer', 'Mittlere Reichweite']
      },
      smg: {
        key: 'smg', name: 'MP', short: 'MP', icon: '💨', tier: 1,
        mag: 35, dmg: 10, fireCd: 0.075, reload: 2.0, auto: true,
        bulletSpeed: 820, range: 300, spread: 0.05, spreadGrow: 0.011, spreadMax: 0.15,
        speedMult: 1.06, falloffStart: 200, falloffMin: 0.4, recoil: 30,
        pros: ['Schnellste Bewegung', 'Sehr hohe Feuerrate'], cons: ['Kurze Reichweite', 'Starke Streuung']
      },
      revolver: {
        key: 'revolver', name: 'Revolver', short: 'REVOLVER', icon: '🎰', tier: 2,
        mag: 5, dmg: 30, fireCd: 0.55, reload: 2.2, auto: false,
        bulletSpeed: 1100, range: 420, spread: 0.012, spreadGrow: 0.03, spreadMax: 0.1,
        speedMult: 0.98, falloffStart: 400, falloffMin: 0.7, recoil: 430,
        kick: true,          // Rueckstoss traegt dich - als Fluchtmittel nutzbar
        lastShotMult: 2,     // die letzte Patrone der Trommel schlaegt doppelt zu
        pros: ['Letzte Patrone macht doppelten Schaden (60)', 'Rückstoß schleudert dich zurück — nutzbar zum Ausweichen'],
        cons: ['Träge Schussfolge', 'Nur 5 Schuss']
      },
      ak47: {
        key: 'ak47', name: 'AK-47', short: 'AK-47', icon: '🎯', tier: 2,
        mag: 20, dmg: 11, fireCd: 0.13, reload: 2.4, auto: true,
        bulletSpeed: 1000, range: 460, spread: 0.028, spreadGrow: 0.016, spreadMax: 0.13,
        speedMult: 0.90, falloffStart: 420, falloffMin: 0.55, recoil: 40,
        pros: ['Größte Reichweite der Automatikwaffen'],
        cons: ['Nur 20 Schuss', 'Wenig Schaden je Treffer', 'Streuung im Dauerfeuer']
      },
      shotgun: {
        key: 'shotgun', name: 'Schrotflinte', short: 'SCHROT', icon: '💥', tier: 2,
        mag: 6, dmg: 9, pellets: 8, fireCd: 0.8, reload: 2.6, auto: false,
        bulletSpeed: 780, range: 210, spread: 0.15, spreadGrow: 0, spreadMax: 0.15,
        speedMult: 0.94, falloffStart: 130, falloffMin: 0.2, recoil: 210,
        pros: ['Tödlich auf Tuchfühlung'], cons: ['Kaum Reichweite', 'Langsame Schussfolge']
      },
      flamer: {
        key: 'flamer', name: 'Flammenwerfer', short: 'FLAMMEN', icon: '🔥', tier: 2,
        mag: 200, dmg: 5, pellets: 2, fireCd: 0.05, reload: 4.0, auto: true,
        bulletSpeed: 620, range: 240, spread: 0.16, spreadGrow: 0, spreadMax: 0.16,
        speedMult: 0.72, falloffStart: 90, falloffMin: 0.35, recoil: 6,
        heavy: true,
        burn: 3.5,   // brennt nach: Schaden ueber Zeit, auch wenn der Gegner flieht
        fire: true,  // Geschosse werden als Flammen gezeichnet, nicht als Kugeln
        pros: ['Setzt Gegner in Brand — Schaden wirkt nach', '200 Einheiten Treibstoff'],
        cons: ['Kurze Reichweite', 'Sehr langsam', '4 s Nachladen']
      },
      sword: {
        key: 'sword', name: 'Schwert', short: 'SCHWERT', icon: '⚔️', tier: 2,
        melee: true, arc: Math.PI * 2,  // Rundumschlag - trifft in alle Richtungen
        swingTime: 0.26,                // Dauer der sichtbaren Drehung
        cloakTime: 1.5,                 // nach einem Kill so lange unsichtbar
        mag: 0, dmg: 40, fireCd: 0.45, reload: 0, auto: true,
        range: 68, bulletSpeed: 1, spread: 0, spreadGrow: 0, spreadMax: 0,
        speedMult: 1.20, falloffStart: 9999, falloffMin: 1, recoil: 0,
        pros: ['Trifft rundum - 360 Grad, auch im Ruecken', 'Schnellste Waffe im Spiel',
          '1,5 s unsichtbar nach jedem Kill', 'Keine Munition'],
        cons: ['Nur Nahkampf (68 px)', 'Drei Treffer noetig', 'Chancenlos auf Distanz']
      },
      mine: {
        key: 'mine', name: 'Minenleger', short: 'MINEN', icon: '🧨', tier: 3,
        mine: true,
        mag: 1, dmg: 0, fireCd: 0.35, reload: 0, auto: false,
        range: 310, bulletSpeed: 1, spread: 0, spreadGrow: 0, spreadMax: 0,
        speedMult: 0.86, recoil: 0,
        blastDmg: 99, blastMin: 1,   // voller Schaden im ganzen Radius
        blastRadius: 96, wallBreak: 1.2, bushBreak: 1.6, selfFactor: 1,
        pros: ['99 Schaden im ganzen Radius', 'Fliegt über Wände', 'Unsichtbar für Gegner'],
        cons: ['Kurze Wurfweite (310 px)', 'Nur eine Mine gleichzeitig',
          'Muss von Hand gezündet werden', 'Erst nach der Explosion gibt es Nachschub']
      },
      crossbow: {
        key: 'crossbow', name: 'Armbrust', short: 'ARMBRUST', icon: '🏹', tier: 2,
        mag: 1, dmg: 55, fireCd: 0.3, reload: 1.25, auto: false,
        bulletSpeed: 1150, range: 580, spread: 0.006, spreadGrow: 0, spreadMax: 0.006,
        speedMult: 0.92, falloffStart: 700, falloffMin: 0.85, recoil: 90,
        silent: true,
        pros: ['Lautlos — verrät dich im Busch nicht', 'Sehr präzise'], cons: ['Ein Bolzen je Ladung', '2 Treffer nötig']
      },
      grenadier: {
        key: 'grenadier', name: 'Granatwerfer', short: 'GRANATW.', icon: '🎳', tier: 3,
        mag: 5, dmg: 0, fireCd: 0.9, reload: 3.4, auto: false,
        projectile: 'rocket', bulletSpeed: 520, range: 560, spread: 0.02, spreadGrow: 0, spreadMax: 0.02,
        speedMult: 0.80, recoil: 140,
        heavy: true,
        blastDmg: 55, blastRadius: 92, blastMin: 0.3, wallBreak: 0, bushBreak: 1.8,
        selfFactor: 0.5,
        bounce: 0.55, fuse: 1.5,   // prallt ab und geht erst nach Zeit hoch -> um Ecken schiessen
        pros: ['Prallt von Wänden ab — Treffer um die Ecke', 'Flächenschaden'],
        cons: ['Sprengt keine Wände', 'Zündet erst nach 1,5 s']
      },
      minigun: {
        key: 'minigun', name: 'Minigun', short: 'MINIGUN', icon: '⚙️', tier: 3,
        mag: 100, dmg: 9, fireCd: 0.055, reload: 5.0, auto: true,
        bulletSpeed: 950, range: 400, spread: 0.045, spreadGrow: 0.005, spreadMax: 0.14,
        speedMult: 0.62, falloffStart: 340, falloffMin: 0.45, recoil: 20,
        heavy: true,
        spinUp: 0.55,
        pros: ['100 Schuss ohne Nachladen'], cons: ['Sehr langsam', 'Anlaufzeit', '5 s Nachladen', 'Kurze Reichweite']
      },
      sniper: {
        key: 'sniper', name: 'Scharfschütze', short: 'SNIPER', icon: '🔭', tier: 3,
        mag: 5, dmg: 70, fireCd: 1.25, reload: 3.0, auto: false,
        bulletSpeed: 1900, range: 780, spread: 0.003, spreadGrow: 0.02, spreadMax: 0.09,
        speedMult: 0.84, falloffStart: 4000, falloffMin: 1, recoil: 170,
        pierce: 1, laser: true,
        pros: ['Größte Reichweite', 'Kein Schadensabfall', 'Durchschlag'], cons: ['Lange Nachladezeit', 'Langsam']
      },
      bazooka: {
        key: 'bazooka', name: 'Bazooka', short: 'BAZOOKA', icon: '🚀', tier: 3,
        mag: 4, dmg: 0, fireCd: 1.5, reload: 4.0, auto: false,
        projectile: 'rocket', bulletSpeed: 430, range: 900, spread: 0.01, spreadGrow: 0, spreadMax: 0.01,
        speedMult: 0.58, recoil: 250,
        blastDmg: 75, blastRadius: 108, blastMin: 0.32, wallBreak: 1.5, bushBreak: 2.0,
        selfFactor: 0.55,
        heavy: true,
        pros: ['75 Schaden Flächentreffer', 'Sprengt Wände'],
        cons: ['Nur 4 Raketen', 'Am langsamsten', 'Träges Geschoss — leicht auszuweichen', 'Träger Dash']
      }
    },
    WEAPON_ORDER: ['sword', 'pistol', 'smg', 'revolver', 'ak47', 'shotgun', 'flamer',
      'crossbow', 'mine', 'grenadier', 'minigun', 'sniper', 'bazooka'],

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
      ffa: { key: 'ffa', name: 'Alle gegen Alle', short: 'FFA', teams: 1, perTeam: 6, min: 2, max: 6, scoreLimit: 12, time: 300 },
      '1v1': { key: '1v1', name: '1 vs 1', short: '1v1', teams: 2, perTeam: 1, min: 2, max: 2, scoreLimit: 8, time: 240 },
      '2v2': { key: '2v2', name: '2 vs 2', short: '2v2', teams: 2, perTeam: 2, min: 4, max: 4, scoreLimit: 15, time: 300 },
      '3v3': { key: '3v3', name: '3 vs 3', short: '3v3', teams: 2, perTeam: 3, min: 6, max: 6, scoreLimit: 20, time: 300 }
    },

    TEAM_COLORS: ['#3fb9ff', '#ff5c7a'],
    TEAM_NAMES: ['Blau', 'Rot'],

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

    MSG: {
      HELLO: 'hello', CREATE: 'create', JOIN: 'join', LEAVE: 'leave',
      CHAT: 'chat', SETUP: 'setup', START: 'start', INPUT: 'in',
      ADDBOT: 'addbot', KICK: 'kick', TEAM: 'team', READY: 'ready',
      ROOM: 'room', ERROR: 'err', MATCH: 'match', SNAP: 's', END: 'end', PONG: 'pong', PING: 'ping',
      AUTH: 'auth', ME: 'me', BOARD: 'board', BOARDREQ: 'boardreq', PICK: 'pick'
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
    }
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
