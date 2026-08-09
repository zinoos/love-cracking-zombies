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
        mag: 6, dmg: 6, pellets: 8, fireCd: 0.8, reload: 2.6, auto: false,
        // Damage nerfed from 9→6 (max 48), spread tightened 0.1725→0.12
        bulletSpeed: 780, range: 210, spread: 0.12, spreadGrow: 0, spreadMax: 0.12,
        speedMult: 0.94, falloffStart: 130, falloffMin: 0.2, recoil: 210,
        pros: ['Lethal up close', 'Consistent pellet spread', 'Forgiving aim'],
        cons: ['Barely any range', 'Slow rate of fire', 'Low per-pellet damage']
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

    UPGRADES: {
      // Spreader — crowd control (stat boosts → powers)
      sp_dmg1:  { id:'sp_dmg1',  name:'Rifled Barrel',    branch:'spreader',  tier:1, cost:4000,  desc:'+4% bullet damage',                     effect:{ damageBonus:0.04 } },
      sp_rate1: { id:'sp_rate1', name:'Light Trigger',    branch:'spreader',  tier:2, cost:5000,  desc:'+4% fire rate',                         effect:{ fireRateBonus:0.04 } },
      scatter:  { id:'scatter',  name:'Scatter Shot',     branch:'spreader',  tier:3, cost:8000,  desc:'Fires 1 extra bullet at ±14° angle',     effect:{ multishot:1, spreadAngles:[0.244] } },
      sp_dmg2:  { id:'sp_dmg2',  name:'Hardened Rounds',  branch:'spreader',  tier:4, cost:10000, desc:'+5% bullet damage',                     effect:{ damageBonus:0.05 } },
      pierce:   { id:'pierce',   name:'Armor Piercing',   branch:'spreader',  tier:5, cost:16000, desc:'All bullets pierce through 1 target',    effect:{ pierce:1 } },
      sp_rate2: { id:'sp_rate2', name:'Hair Trigger',     branch:'spreader',  tier:6, cost:14000, desc:'+6% fire rate',                         effect:{ fireRateBonus:0.06 } },
      fan:      { id:'fan',      name:'Fan Shot',         branch:'spreader',  tier:7, cost:22000, desc:'Fires 2 extra bullets at ±12° and ±24°', effect:{ multishot:2, spreadAngles:[0.209,-0.209,0.419,-0.419] } },
      hail:     { id:'hail',     name:'Hailstorm',        branch:'spreader',  tier:8, cost:32000, desc:'Bullets ricochet off walls + 8% fire rate', effect:{ ricochet:true, fireRateBonus:0.08 } },

      // Destroyer — boss killer
      ds_dmg1:  { id:'ds_dmg1',  name:'Steel Core',       branch:'destroyer', tier:1, cost:4000,  desc:'+4% bullet damage',                         effect:{ damageBonus:0.04 } },
      ds_spd1:  { id:'ds_spd1',  name:'Light Stock',      branch:'destroyer', tier:2, cost:5000,  desc:'+3% move speed',                            effect:{ speedBonus:0.03 } },
      heavy:    { id:'heavy',    name:'Heavy Rounds',     branch:'destroyer', tier:3, cost:8000,  desc:'+30% bullet damage',                         effect:{ bulletDamageMult:1.30 } },
      ds_dmg2:  { id:'ds_dmg2',  name:'Tungsten Tip',     branch:'destroyer', tier:4, cost:10000, desc:'+5% bullet damage',                         effect:{ damageBonus:0.05 } },
      extmag:   { id:'extmag',   name:'Extended Mag',     branch:'destroyer', tier:5, cost:14000, desc:'+8 magazine capacity',                       effect:{ magBonus:8 } },
      ds_crit:  { id:'ds_crit',  name:'Scope Mount',      branch:'destroyer', tier:6, cost:12000, desc:'+5% crit chance',                            effect:{ critChanceBonus:0.05 } },
      headhunter:{ id:'headhunter',name:'Headhunter',     branch:'destroyer', tier:7, cost:20000, desc:'20% chance to deal 2.5× crit damage',         effect:{ critChance:0.20, critMult:2.5 } },
      overkill: { id:'overkill', name:'Overkill',         branch:'destroyer', tier:8, cost:30000, desc:'Kills refill magazine + 35% fire rate 2.5s', effect:{ overkill:true } },

      // Survivor — sustain
      sv_spd1:  { id:'sv_spd1',  name:'Tactical Boots',   branch:'survivor',  tier:1, cost:4000,  desc:'+3% move speed',                            effect:{ speedBonus:0.03 } },
      sv_regen1:{ id:'sv_regen1',name:'Field Dressing',   branch:'survivor',  tier:2, cost:5000,  desc:'+1.5 HP/sec regen',                          effect:{ regenBonus:1.5 } },
      vampiric: { id:'vampiric', name:'Vampiric Rounds',  branch:'survivor',  tier:3, cost:8000,  desc:'6% of damage returned as HP',                 effect:{ lifesteal:0.06 } },
      sv_spd2:  { id:'sv_spd2',  name:'Combat Boots',     branch:'survivor',  tier:4, cost:9000,  desc:'+4% move speed',                            effect:{ speedBonus:0.04 } },
      frost:    { id:'frost',    name:'Frost Ammo',       branch:'survivor',  tier:5, cost:12000, desc:'Hit zombies slowed 30% for 1.5s',              effect:{ slowOnHit:true, slowFactor:0.70, slowDuration:1.5 } },
      sv_regen2:{ id:'sv_regen2',name:'Medkit',           branch:'survivor',  tier:6, cost:11000, desc:'+2 HP/sec regen',                            effect:{ regenBonus:2 } },
      aegis:    { id:'aegis',    name:'Aegis Shield',     branch:'survivor',  tier:7, cost:18000, desc:'Kills grant 12 HP shield (max 35)',           effect:{ shieldOnKill:12 } },
      phoenix:  { id:'phoenix',  name:'Phoenix',          branch:'survivor',  tier:8, cost:28000, desc:'Revive once per match with 40% HP',          effect:{ phoenix:true } },

      // ===== Shotgun Upgrades =====
      // Breacher — close-range devastation (stat boosts → powers)
      sg_b_dmg1:  { id:'sg_b_dmg1', name:'Rifled Choke',    branch:'breacher',  tier:1, cost:4000,  desc:'+4% pellet damage',                       effect:{ damageBonus:0.04 } },
      sg_b_rate1: { id:'sg_b_rate1',name:'Hair Trigger',    branch:'breacher',  tier:2, cost:5000,  desc:'+5% fire rate',                           effect:{ fireRateBonus:0.05 } },
      sg_b_flech: { id:'sg_b_flech',name:'Flechette Rounds',branch:'breacher',  tier:3, cost:8000,  desc:'+3 extra pellets per shot',                effect:{ pelletBonus:3 } },
      sg_b_dmg2:  { id:'sg_b_dmg2', name:'Heavy Gauge',     branch:'breacher',  tier:4, cost:10000, desc:'+6% pellet damage',                       effect:{ damageBonus:0.06 } },
      sg_b_fire:  { id:'sg_b_fire', name:'Dragon\'s Breath',branch:'breacher',  tier:5, cost:16000, desc:'Pellets set enemies on fire (5 DPS/2s)',  effect:{ fireAmmo:true } },
      sg_b_rate2: { id:'sg_b_rate2',name:'Slam-Fire',       branch:'breacher',  tier:6, cost:13000, desc:'+8% fire rate',                           effect:{ fireRateBonus:0.08 } },
      sg_b_tight: { id:'sg_b_tight',name:'Tight Choke',     branch:'breacher',  tier:7, cost:20000, desc:'Spread reduced by 30%',                   effect:{ spreadMult:0.70 } },
      sg_b_carn:  { id:'sg_b_carn', name:'Carnage',         branch:'breacher',  tier:8, cost:30000, desc:'Kills explode for 30 dmg in 100px radius',effect:{ explodeOnKill:30, explodeRadius:100 } },

      // Slugger — precision & range
      sg_s_range: { id:'sg_s_range',name:'Rifled Barrel',   branch:'slugger',   tier:1, cost:4000,  desc:'+12% bullet range',                       effect:{ rangeBonus:0.12 } },
      sg_s_dmg1:  { id:'sg_s_dmg1', name:'Steel Slug',      branch:'slugger',   tier:2, cost:5000,  desc:'+4% pellet damage',                       effect:{ damageBonus:0.04 } },
      sg_s_slug:  { id:'sg_s_slug', name:'Slug Round',      branch:'slugger',   tier:3, cost:8000,  desc:'Converts to single slug: -60% spread, +60% dmg', effect:{ slugMode:true, spreadMult:0.40, bulletDamageMult:1.60 } },
      sg_s_dmg2:  { id:'sg_s_dmg2', name:'Tungsten Core',   branch:'slugger',   tier:4, cost:10000, desc:'+7% pellet damage',                       effect:{ damageBonus:0.07 } },
      sg_s_mag:   { id:'sg_s_mag',  name:'Extended Tube',   branch:'slugger',   tier:5, cost:13000, desc:'+3 magazine capacity',                     effect:{ magBonus:3 } },
      sg_s_crit:  { id:'sg_s_crit', name:'Precision Sight', branch:'slugger',   tier:6, cost:11000, desc:'+7% crit chance',                          effect:{ critChanceBonus:0.07 } },
      sg_s_head:  { id:'sg_s_head', name:'Headhunter',      branch:'slugger',   tier:7, cost:19000, desc:'20% chance to deal 2.5× crit damage',     effect:{ critChance:0.20, critMult:2.5 } },
      sg_s_exec:  { id:'sg_s_exec', name:'Executioner',     branch:'slugger',   tier:8, cost:28000, desc:'Kills refill 2 shells + 30% fire rate 3s', effect:{ executioner:true, fireRateMult:1.30 } },

      // Juggernaut — sustain & defense
      sg_j_hp1:   { id:'sg_j_hp1',  name:'Kevlar Vest',     branch:'juggernaut',tier:1, cost:4000,  desc:'+10 max HP',                               effect:{ maxHpBonus:10 } },
      sg_j_spd1:  { id:'sg_j_spd1', name:'Combat Boots',    branch:'juggernaut',tier:2, cost:5000,  desc:'+3% move speed',                            effect:{ speedBonus:0.03 } },
      sg_j_knock: { id:'sg_j_knock',name:'Concussive Rounds',branch:'juggernaut',tier:3, cost:8000,  desc:'Pellets push enemies back',                   effect:{ knockback:true } },
      sg_j_hp2:   { id:'sg_j_hp2',  name:'Heavy Plating',   branch:'juggernaut',tier:4, cost:9000,  desc:'+15 max HP',                               effect:{ maxHpBonus:15 } },
      sg_j_life:  { id:'sg_j_life', name:'Vampiric Shells', branch:'juggernaut',tier:5, cost:12000, desc:'7% of damage returned as HP',                effect:{ lifesteal:0.07 } },
      sg_j_regen: { id:'sg_j_regen',name:'Field Kit',       branch:'juggernaut',tier:6, cost:11000, desc:'+2 HP/sec regen',                            effect:{ regenBonus:2 } },
      sg_j_shield:{ id:'sg_j_shield',name:'Riot Shield',    branch:'juggernaut',tier:7, cost:18000, desc:'Kills grant 15 HP shield (max 40)',          effect:{ shieldOnKill:15 } },
      sg_j_last:  { id:'sg_j_last', name:'Last Stand',      branch:'juggernaut',tier:8, cost:28000, desc:'Revive once per match with 50% HP',          effect:{ phoenix:true } }
    },
    UPGRADE_TREE: [
      'sp_dmg1','sp_rate1','scatter','sp_dmg2','pierce','sp_rate2','fan','hail',
      'ds_dmg1','ds_spd1','heavy','ds_dmg2','extmag','ds_crit','headhunter','overkill',
      'sv_spd1','sv_regen1','vampiric','sv_spd2','frost','sv_regen2','aegis','phoenix'
    ],
    UPGRADE_TREE_SHOTGUN: [
      'sg_b_dmg1','sg_b_rate1','sg_b_flech','sg_b_dmg2','sg_b_fire','sg_b_rate2','sg_b_tight','sg_b_carn',
      'sg_s_range','sg_s_dmg1','sg_s_slug','sg_s_dmg2','sg_s_mag','sg_s_crit','sg_s_head','sg_s_exec',
      'sg_j_hp1','sg_j_spd1','sg_j_knock','sg_j_hp2','sg_j_life','sg_j_regen','sg_j_shield','sg_j_last'
    ],

    UPGRADE_ICONS: {
      sp_dmg1:'bullet', sp_rate1:'fast-forward', scatter:'cross', sp_dmg2:'missile',
      pierce:'target', sp_rate2:'fast-forward', fan:'explosive', hail:'magazine',
      ds_dmg1:'bullet', ds_spd1:'warrior-boots-lv1', heavy:'bomb', ds_dmg2:'missile',
      extmag:'magazine', ds_crit:'target-02', headhunter:'skull', overkill:'fire',
      sv_spd1:'warrior-boots-lv1', sv_regen1:'medical-kit', vampiric:'potion-02', sv_spd2:'warrior-boots-lv1',
      frost:'ice', sv_regen2:'medical-kit', aegis:'shield', phoenix:'health-points'
    },

    UPGRADE_ICONS_SHOTGUN: {
      sg_b_dmg1:'bullet', sg_b_rate1:'fast-forward', sg_b_flech:'expand-04', sg_b_dmg2:'missile',
      sg_b_fire:'fire', sg_b_rate2:'fast-forward', sg_b_tight:'cross', sg_b_carn:'bomb',
      sg_s_range:'target', sg_s_dmg1:'bullet', sg_s_slug:'spear', sg_s_dmg2:'missile',
      sg_s_mag:'magazine', sg_s_crit:'target-02', sg_s_head:'skull', sg_s_exec:'demon',
      sg_j_hp1:'health-points', sg_j_spd1:'warrior-boots-lv1', sg_j_knock:'bomb', sg_j_hp2:'shield',
      sg_j_life:'potion-02', sg_j_regen:'medical-kit', sg_j_shield:'shield', sg_j_last:'fire'
    },

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
      '3v3': { key: '3v3', name: '3 vs 3', short: '3v3', teams: 2, perTeam: 3, min: 6, max: 6, scoreLimit: 20, time: 300 },
      solo: { key: 'solo', name: 'Zombie Survival', short: 'SURVIVAL', teams: 1, perTeam: 1, min: 1, max: 1, time: 0 },
      coop: { key: 'coop', name: 'Co-op Survival', short: 'CO-OP', teams: 1, perTeam: 6, min: 1, max: 6, time: 0 }
    },

    WAVE_PREP_TIME: 8.0,
    WAVE_INTERVAL: 3.0,
    WAVE_ZOMBIE_R: 16,

    waveFor(n) {
      return {
        count: Math.min(40, 2 + Math.floor(n * 1.8)),
        hp: Math.round(35 + n * 18),
        speed: Math.min(195, 90 + n * 10),
        damage: Math.round(7 + n * 3.2)
      };
    },

    TEAM_COLORS: ['#3fb9ff', '#ff5c7a'],
    TEAM_NAMES: ['Blue', 'Red'],

    COOP_MAX_PLAYERS: 6,
    REVIVE_RANGE: 80,
    REVIVE_TIME: 3.0,
    DOWNED_TIME: 15.0,
    REVIVE_HP_PCT: 0.4,

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
      PLAY: 'play',
      PHASE: 'phase', VOTE: 'vote',
      FRIENDS: 'friends', FRIENDREQ: 'friendreq', FRIENDACT: 'friendact',
      FRIENDJOIN: 'friendjoin',
      BUY: 'buy',
      COOP: 'coop', WAVE: 'wave', REVIVE: 'r'
    },

    /* Obergrenzen fuer die Freundesliste. Ohne sie koennte ein Konto beliebig
       viele Eintraege ansammeln - jeder davon landet in einem einzigen
       Firestore-Feld. */
    FRIENDS: { MAX: 80, REQ_MAX: 50 },

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

  };

  /* Waffen-Lebensdauer aus range berechnen */
  for (const key of Object.keys(C.WEAPONS)) {
    const w = C.WEAPONS[key];
    if (w.range && w.bulletSpeed) w.bulletLife = w.range / w.bulletSpeed;
    if (!w.falloffStart) w.falloffStart = w.range || 500;
    if (w.falloffMin === undefined) w.falloffMin = 1;
  }

  return C;
});
