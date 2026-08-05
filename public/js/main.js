/* Client-Kern: Input, Prediction, Interpolation, Event-Handling, Spielschleife. */
(() => {
  const $ = UI.$;

  /* Interpolationsverzoegerung: Gegner werden bewusst leicht verzoegert
     dargestellt, damit zwischen zwei Snapshots sauber interpoliert werden kann.
     Bei gleichmaessiger Leitung reicht wenig, bei schwankender Ankunftszeit
     (Tunnel, WLAN, weite Strecke) braucht es mehr - sonst stottern die Gegner,
     weil der Puffer leerlaeuft. Wird darum laufend nachgefuehrt. */
  const INTERP_MIN = 90, INTERP_MAX = 320;
  const EXTRAPOLATE_MAX = 140;   // so lange darf ohne neuen Snapshot fortgeschrieben werden
  let INTERP_MS = 110;
  let lastSnapAt = 0, snapGapAvg = 1000 / C.SNAP_RATE, snapJitter = 0;

  function trackSnapshotTiming(now) {
    if (lastSnapAt) {
      const gap = now - lastSnapAt;
      snapGapAvg += (gap - snapGapAvg) * 0.08;
      snapJitter += (Math.abs(gap - snapGapAvg) - snapJitter) * 0.08;
      // Grundpuffer = ein Snapshotabstand, plus Reserve fuer die Schwankung
      const want = snapGapAvg + snapJitter * 2.5 + 45;
      INTERP_MS += (Math.max(INTERP_MIN, Math.min(INTERP_MAX, want)) - INTERP_MS) * 0.05;
    }
    lastSnapAt = now;
  }

  const G = {
    myId: null,
    map: null,
    mode: 'ffa',
    mapName: '',
    inMatch: false,
    matchState: 'countdown',
    timeLeft: 0,
    teamScore: [0, 0],
    scoreboard: [],
    players: new Map(),
    bullets: new Map(),
    pickups: [],
    mines: [],
    mouse: { x: 0, y: 0 },
    mouseWorld: null,
    recoil: 0,
    myTeam: 0,

    playerList() { return [...G.players.values()].filter(p => p.visible); },
    bulletList() { return [...G.bullets.values()]; },
    mePlayer() { return G.players.get(G.myId); },
    viewTarget() {
      const me = G.mePlayer();
      return me ? { x: me.rx, y: me.ry } : { x: C.WORLD / 2, y: C.WORLD / 2 };
    },
    get netStats() {
      return {
        ping: NET.ping,
        interp: Math.round(INTERP_MS),
        jitter: Math.round(snapJitter),
        gap: Math.round(snapGapAvg)
      };
    }
  };
  window.G = G;

  /* ================= Input ================= */
  const keys = Object.create(null);
  let mouseDown = false;
  let seq = 0;
  const pending = [];
  let wantReload = false, wantDash = false, wantGrenade = false;

  const pred = { x: 0, y: 0, vx: 0, vy: 0, dashT: 0, dashX: 0, dashY: 0, speedMult: 1 };
  let localAmmo = 6, localFireCd = 0, localReload = 0, localDashCd = 0, localGrenades = C.GRENADES, localSpin = 0;
  const errOff = { x: 0, y: 0 };
  const weapon = () => G.myWeapon || C.WEAPONS.pistol;

  /* Tastenzustand nach Aktion, nicht nach Zeichen. Die Zuordnung kommt aus
     den Einstellungen, damit sich jeder die Belegung umlegen kann. */
  const held = {};

  addEventListener('keydown', e => {
    const tag = (e.target && e.target.tagName) || '';
    if (tag === 'INPUT' || tag === 'TEXTAREA') {
      if (e.key === 'Escape') e.target.blur();
      return;
    }
    keys[e.key.toLowerCase()] = true;
    for (const a of SETTINGS.ACTIONS) if (SETTINGS.matches(a.id, e)) held[a.id] = true;

    if (SETTINGS.matches('score', e)) {
      e.preventDefault();
      if (G.inMatch) UI.showScoreboard(true, buildBoard(), C.MODES[G.mode].teams, G.myId);
    }
    if (SETTINGS.matches('reload', e)) wantReload = true;
    if (SETTINGS.matches('dash', e)) wantDash = true;
    if (SETTINGS.matches('mute', e)) UI.toast(SFX.toggle() ? 'Sound aus' : 'Sound an');
    if (SETTINGS.matches('chat', e) && G.inMatch) {
      const inp = document.getElementById('chat-inp');
      if (inp) { e.preventDefault(); inp.focus(); }
    }
    if (e.key === 'Escape' && G.inMatch) leaveMatch();
  });
  addEventListener('keyup', e => {
    keys[e.key.toLowerCase()] = false;
    for (const a of SETTINGS.ACTIONS) if (SETTINGS.matches(a.id, e)) held[a.id] = false;
    if (SETTINGS.matches('score', e)) UI.showScoreboard(false);
  });
  addEventListener('blur', () => {
    for (const k in keys) keys[k] = false;
    for (const k in held) held[k] = false;
    mouseDown = false;
  });

  const cv = RENDER.canvas;
  cv.addEventListener('mousemove', e => {
    const r = cv.getBoundingClientRect();
    G.mouse.x = e.clientX - r.left;
    G.mouse.y = e.clientY - r.top;
  });
  cv.addEventListener('mousedown', e => {
    if (e.button === 0) { mouseDown = true; SFX.resume(); }
    if (e.button === 2) { e.preventDefault(); wantGrenade = true; }
  });
  addEventListener('mouseup', e => { if (e.button === 0) mouseDown = false; });
  cv.addEventListener('contextmenu', e => e.preventDefault());

  function currentInput() {
    return {
      u: !!held.up,
      d: !!held.down,
      l: !!held.left,
      r: !!held.right,
      f: mouseDown,
      rl: wantReload,
      ds: wantDash,
      g: wantGrenade,
      gd: grenadeRange(),
      a: aimAngle()
    };
  }

  /** Granate soll dort liegen bleiben, wo der Cursor steht. */
  function grenadeRange() {
    if (!G.mouseWorld) return C.GRENADE_RANGE_DEFAULT;
    const d = Math.hypot(G.mouseWorld.x - pred.x, G.mouseWorld.y - pred.y);
    return Math.round(Math.max(C.GRENADE_RANGE_MIN, Math.min(C.GRENADE_RANGE_MAX, d)));
  }

  function aimAngle() {
    const me = G.mePlayer();
    if (!me || !G.mouseWorld) return me ? me.ra : 0;
    return Math.atan2(G.mouseWorld.y - pred.y, G.mouseWorld.x - pred.x);
  }

  /* ================= Prediction ================= */
  function applyInput(inp, dt) {
    const ent = {
      x: pred.x, y: pred.y, vx: pred.vx, vy: pred.vy,
      dashT: pred.dashT, dashX: pred.dashX, dashY: pred.dashY,
      speedMult: weapon().speedMult
    };
    if (inp.ds && pred.dashT <= 0 && localDashCd <= 0) {
      let dx = (inp.r ? 1 : 0) - (inp.l ? 1 : 0);
      let dy = (inp.d ? 1 : 0) - (inp.u ? 1 : 0);
      if (dx === 0 && dy === 0) { dx = Math.cos(inp.a); dy = Math.sin(inp.a); }
      const l = Math.hypot(dx, dy) || 1;
      ent.dashX = dx / l; ent.dashY = dy / l;
      ent.dashT = C.DASH_TIME;
      localDashCd = C.DASH_CD * (weapon().heavy ? C.DASH_CD_HEAVY : 1);
    }
    PHYS.stepPlayer(G.map, ent, { up: inp.u, down: inp.d, left: inp.l, right: inp.r }, dt);
    pred.x = ent.x; pred.y = ent.y; pred.vx = ent.vx; pred.vy = ent.vy;
    pred.dashT = ent.dashT; pred.dashX = ent.dashX; pred.dashY = ent.dashY;
  }

  const INPUT_DT = 1 / 60;
  let inputAcc = 0;

  function inputTick(dt) {
    if (!G.inMatch || !G.map) return;
    inputAcc += dt;
    let guard = 0;
    while (inputAcc >= INPUT_DT && guard++ < 5) {
      inputAcc -= INPUT_DT;
      const me = G.mePlayer();
      const alive = me && me.alive;
      const inp = currentInput();
      if (!alive) { inp.f = false; inp.ds = false; }
      inp.seq = ++seq;
      inp.t = C.MSG.INPUT;
      NET.send(inp);

      if (alive) {
        applyInput(inp, INPUT_DT);
        pending.push({ seq: inp.seq, inp });
        if (pending.length > 200) pending.shift();
        predictWeapon(inp, INPUT_DT);
      }
      wantReload = false; wantDash = false; wantGrenade = false;
    }
    localDashCd = Math.max(0, localDashCd - dt);
    G.recoil = Math.max(0, G.recoil - dt * 3.4);
    G.spinAngle = (G.spinAngle || 0) + localSpin * dt * 26;
  }

  function predictWeapon(inp, dt) {
    const w = weapon();
    localFireCd = Math.max(0, localFireCd - dt);

    if (w.spinUp) {
      if (inp.f && localReload <= 0 && localAmmo > 0) localSpin = Math.min(1, localSpin + dt / w.spinUp);
      else localSpin = Math.max(0, localSpin - dt / (w.spinUp * 0.7));
    } else localSpin = 1;

    if (localReload > 0) {
      localReload -= dt;
      if (localReload <= 0) localAmmo = w.mag;
      return;
    }
    /* Schwert und Minenleger haben kein Magazin (mag 0 bzw. Nachschub nur
       ueber die Explosion). Ohne diese Sperre war "feuern mit leerer Waffe"
       beim Schwert dauerhaft wahr: die Funktion sprang hier heraus, der
       Nahkampfzweig weiter unten wurde nie erreicht - und damit sah man den
       eigenen Hieb nie, nur den der Gegner. Dazu lief bei gehaltener Taste
       das Nachladegeraeusch in jedem Bild. */
    if (!w.melee && !w.mine && ((inp.rl && localAmmo < w.mag) || (inp.f && localAmmo <= 0))) {
      localReload = w.reload;
      SFX.reload();
      return;
    }
    // Nahkampf: kein Munitionsverbrauch, sofortige Rueckmeldung
    if (w.melee) {
      if (inp.f && localFireCd <= 0) {
        localFireCd = w.fireCd;
        const ang = inp.a;
        const me = G.players.get(G.myId);
        if (me) me.swingT = w.swingTime;
        FX.swing(pred.x, pred.y, ang, UI.skin.trail);
        FX.shake(3, .1);
        SFX.swing(0, 0);
      }
      return;
    }
    // Mine: Vorhersage waere irrefuehrend, der Server entscheidet
    if (w.mine) {
      if (inp.f && localFireCd <= 0) localFireCd = w.fireCd;
      return;
    }

    if (inp.f && localAmmo > 0 && localFireCd <= 0 && (!w.spinUp || localSpin >= 1)) {
      localAmmo--;
      localFireCd = w.fireCd;
      const ang = inp.a;
      const mx = pred.x + Math.cos(ang) * (C.PLAYER_R + 14);
      const my = pred.y + Math.sin(ang) * (C.PLAYER_R + 14);
      const heavy = w.recoil > 150;
      const lastShot = w.lastShotMult && localAmmo === 0;
      if (w.fire) FX.flameMuzzle(mx, my, ang);
      else FX.muzzle(mx, my, ang, UI.skin.trail);
      if (lastShot) { FX.shake(9, .3); FX.flash('#ffd166', .12); }
      FX.shake(heavy ? 6 : 2.6, heavy ? .2 : .12);
      SFX.shoot(0, w.key);
      G.recoil = Math.min(1, G.recoil + (w.recoil / 260));
      pred.vx -= Math.cos(ang) * w.recoil * 0.5;
      pred.vy -= Math.sin(ang) * w.recoil * 0.5;
    }
  }

  function reconcile(me) {
    // Server-Zustand uebernehmen und offene Inputs erneut anwenden
    const before = { x: pred.x, y: pred.y };
    pred.x = me.x; pred.y = me.y; pred.vx = me.vx; pred.vy = me.vy;
    pred.dashT = me.dt;
    while (pending.length && pending[0].seq <= me.seq) pending.shift();
    for (const p of pending) applyInput(p.inp, INPUT_DT);
    // Sprungfehler weich ausgleichen
    const dx = before.x - pred.x, dy = before.y - pred.y;
    if (Math.hypot(dx, dy) < 90) { errOff.x += dx; errOff.y += dy; }
    else { errOff.x = 0; errOff.y = 0; }
  }

  /* ================= Netz-Handling ================= */
  NET.on('open', () => {
    UI.setConn(true);
    NET.send({ t: C.MSG.HELLO, name: UI.name, skin: UI.skin, session: NET.session });
  });
  let connectFails = 0, everConnected = false;
  NET.on('open', () => { connectFails = 0; everConnected = true; UI.serverNotice(false); });
  NET.on('close', () => {
    UI.setConn(false);
    connectFails++;
    /* Im Match sofort sagen, dass die Verbindung weg ist. Vorher blieb einfach
       das letzte Bild stehen und niemand wusste, was los war. */
    if (G.inMatch) UI.reconnecting(true);
    // Nie verbunden gewesen -> sofort sagen, dass der Spielserver fehlt.
    // Auf Firebase Hosting allein gibt es keinen WebSocket.
    // Waehrend des Spiels erst nach mehreren Aussetzern, damit kurze
    // Verbindungshaenger keinen Alarm ausloesen.
    if (!everConnected || connectFails >= 3) UI.serverNotice(true, NET.target);
  });
  NET.on('ping', ms => UI.setPing(ms, G.inMatch ? Math.round(snapJitter) : 0));

  NET.on(C.MSG.HELLO, m => {
    const warImMatch = G.inMatch;
    G.myId = m.id;
    // Nach (Wieder-)Verbindung Anmeldung erneut nachweisen
    AUTH.pushToken(false);
    if (m.resumed) return;               // MATCH-Nachricht folgt gleich
    UI.reconnecting(false);
    /* Neue Verbindung ohne Wiederaufnahme, obwohl wir im Match waren: der
       Platz war zu lange leer und ist verfallen. Ohne diesen Zweig blieb der
       Spieler im Spielbildschirm haengen und bekam nie wieder ein Bild. */
    if (warImMatch) {
      resetMatch();
      UI.show('scr-menu');
      UI.toast('Verbindung zu lange weg - das Match lief ohne dich weiter', 'err');
    }
  });

  NET.on(C.MSG.ME, m => {
    AUTH.setProfile(m.profile);
    if (m.name) {
      UI.name = m.name;
      const inp = $('inp-name');
      if (inp && !inp.value) inp.value = m.name;
    }
  });

  NET.on(C.MSG.BOARD, m => UI.renderBoard(m));

  // Vorbereitung: Karte waehlen, Waffe sperren, Waffe waehlen
  NET.on(C.MSG.PHASE, m => UI.renderPhase(m));
  UI.onPhaseVote(v => NET.send({ t: C.MSG.VOTE, v }));

  NET.on(C.MSG.SHOP, m => UI.renderShop(m));
  UI.onShop(
    id => NET.send({ t: C.MSG.BUY, id }),
    id => NET.send({ t: C.MSG.EQUIP, id })
  );

  NET.on(C.MSG.ERROR, m => {
    UI.toast(m.msg, 'err');
    if (m.kicked) { resetMatch(); UI.show('scr-menu'); }
    if (UI.currentScreen() === 'scr-join') $('join-err').textContent = m.msg;
  });

  NET.on(C.MSG.ROOM, m => {
    UI.renderRoom(m, G.myId);
    // Nur aus Menue/Join heraus in die Lobby springen - Skinlocker/Hilfe nicht unterbrechen
    const from = UI.currentScreen();
    if (!G.inMatch && (from === 'scr-menu' || from === 'scr-join' || from === 'scr-game')) UI.show('scr-lobby');
    const me = m.members.find(x => x.id === G.myId);
    if (me) G.myTeam = me.team;
  });

  NET.on(C.MSG.CHAT, m => UI.addChat(m.name, m.color, m.text));

  NET.on(C.MSG.MATCH, m => startMatch(m));

  NET.on(C.MSG.END, m => {
    G.inMatch = false;
    UI.showScoreboard(false);
    UI.respawnUI(false);
    const mine = (m.board || []).find(p => p.id === G.myId);
    FB.log('match_end', {
      mode: m.mode, map: m.mapName,
      won: (m.teams > 1 ? m.winner === G.myTeam : m.winner === G.myId) ? 1 : 0,
      kills: mine ? mine.kills : 0,
      deaths: mine ? mine.deaths : 0,
      duration_s: G.matchStartedAt ? Math.round((performance.now() - G.matchStartedAt) / 1000) : 0
    });
    UI.showResult(m, G.myId, G.myTeam);
  });

  NET.on(C.MSG.SNAP, onSnapshot);

  /* ================= Match ================= */
  function startMatch(m) {
    G.myId = m.you;
    G.mode = m.mode;
    G.mapName = m.mapName;
    G.map = MAPS.instance(m.mapId);      // eigene Kopie - Sprengungen bleiben im Match
    // Bei Wiederaufnahme die schon gesprengten Felder nachziehen
    if (m.tiles) for (let i = 0; i < m.tiles.length; i += 2) G.map.tiles[m.tiles[i]] = m.tiles[i + 1];
    RENDER.buildMap(G.map);
    RENDER.resize();
    FX.clear();
    G.players.clear();
    G.bullets.clear();
    G.pickups = [];
    pending.length = 0;
    seq = 0;
    localFireCd = 0; localReload = 0; localDashCd = 0;
    localGrenades = C.GRENADES; localSpin = 0;
    errOff.x = errOff.y = 0;
    G.teamScore = [0, 0];
    G.scoreboard = [];
    G.spinAngle = 0;
    lastSnapAt = 0; snapJitter = 0; snapGapAvg = 1000 / C.SNAP_RATE; INTERP_MS = 110;

    const teams = C.MODES[m.mode].teams;
    m.players.forEach(p => {
      const wKey = C.WEAPONS[p.weapon] ? p.weapon : 'pistol';
      G.players.set(p.id, {
        id: p.id, name: p.name, color: p.color, trail: p.trail, pattern: p.pattern,
        team: p.team, bot: p.bot, weapon: wKey, fx: p.fx || '',
        teamColor: teams > 1 ? C.TEAM_COLORS[p.team] : (p.id === m.you ? '#ffffff' : '#ff9d6b'),
        buf: [], rx: C.WORLD / 2, ry: C.WORLD / 2, ra: 0,
        hp: C.HP_MAX, alive: true, visible: false, mv: 0, bush: false,
        walkPhase: Math.random() * 6, dash: false, invul: false, spinAngle: 0
      });
      if (p.id === m.you) {
        G.myTeam = p.team;
        G.myWeaponKey = wKey;
        G.myWeapon = C.WEAPONS[wKey];
      }
    });
    localAmmo = weapon().mag;
    UI.setWeapon(G.myWeaponKey);

    /* Die Waffe steht beim Matchstart laengst fest - gewaehlt wird in der
       Vorbereitung, bevor die Karte ueberhaupt geladen ist. Nur wenn der
       Server ausnahmsweise doch Angebote mitschickt, gibt es hier noch eine
       Auswahl. */
    if (!m.resumed && m.choices && m.choices.length > 1) {
      UI.weaponPicker(m.choices, (m.countdown || C.COUNTDOWN) - 1.2, key => {
        NET.send({ t: C.MSG.PICK, w: key });
        applyMyWeapon(key);
        FB.log('weapon_picked', { weapon: key, mode: m.mode, map: m.mapName });
      });
    } else {
      UI.pickerOpen(false);
    }

    $('mapname').textContent = m.mapName.toUpperCase() + ' · ' + C.MODES[m.mode].name.toUpperCase();
    G.inMatch = true;
    G.matchState = m.resumed ? 'live' : 'countdown';
    G.matchStartedAt = performance.now();
    UI.reconnecting(false);
    FB.log('match_start', {
      mode: m.mode, map: m.mapName,
      players: m.players.length,
      bots: m.players.filter(p => p.bot).length
    });
    UI.show('scr-game');
    SFX.resume();
    UI.toast(m.resumed ? 'Wieder im Spiel' : `Map: ${m.mapName}`, 'ok');
  }

  /** Eigene Waffe uebernehmen (nach Wahl oder Serverzuteilung). */
  function applyMyWeapon(key) {
    if (!C.WEAPONS[key]) return;
    G.myWeaponKey = key;
    G.myWeapon = C.WEAPONS[key];
    localAmmo = C.WEAPONS[key].mag;
    localReload = 0; localFireCd = 0; localSpin = 0;
    const me = G.players.get(G.myId);
    if (me) me.weapon = key;
    UI.setWeapon(key);
  }

  function resetMatch() {
    G.inMatch = false;
    G.map = null;
    G.players.clear();
    G.bullets.clear();
    FX.clear();
  }

  function leaveMatch() {
    NET.send({ t: C.MSG.LEAVE });
    resetMatch();
    UI.show('scr-menu');
    UI.toast('Match verlassen');
  }

  let lastCountdownSecond = -1;

  function onSnapshot(s) {
    if (!G.inMatch) return;
    const now = performance.now();
    trackSnapshotTiming(now);
    G.matchState = s.st;
    G.timeLeft = s.tl;
    G.teamScore = s.ts;
    G.scoreboard = s.sb || [];

    if (s.st === 'countdown') {
      const sec = Math.ceil(s.cd);
      if (sec !== lastCountdownSecond) {
        lastCountdownSecond = sec;
        // Waehrend der Waffenwahl keine Ziffer einblenden - die Karte hat
        // ihre eigene Restzeit und die Ziffer laege mitten auf der Ueberschrift
        if (sec > 0 && !UI.pickerOpen()) { UI.centerMsg(String(sec), '#3fd0ff'); SFX.countdown(sec); }
      }
    }

    const seen = new Set();
    for (const ps of s.ps) {
      const p = G.players.get(ps.i);
      if (!p) continue;
      seen.add(ps.i);
      p.buf.push({ t: now, x: ps.x, y: ps.y, a: ps.a });
      while (p.buf.length > 24) p.buf.shift();
      p.hp = ps.h; p.alive = !!ps.al; p.mv = ps.mv; p.bush = !!ps.bu;
      p.invul = !!ps.iv; p.dash = !!ps.ds; p.spin = ps.sp || 0;
      p.burning = !!ps.bu2;
      p.cloaked = !!ps.ck;
      if (ps.w >= 0 && C.WEAPON_ORDER[ps.w]) p.weapon = C.WEAPON_ORDER[ps.w];
      p.visible = true;
    }
    for (const p of G.players.values()) {
      if (!seen.has(p.id)) { p.visible = false; p.buf.length = 0; }
    }

    // Geschosse
    const bseen = new Set();
    for (const b of s.bs) {
      bseen.add(b.i);
      let e = G.bullets.get(b.i);
      const owner = G.players.get(b.o);
      if (!e) {
        e = { i: b.i, id: b.i, x: b.x, y: b.y, a: b.a, ty: b.ty || 0, s: b.s, color: owner ? owner.trail : '#ffd166' };
        G.bullets.set(b.i, e);
      } else {
        e.x += (b.x - e.x) * 0.5;
        e.y += (b.y - e.y) * 0.5;
        e.a = b.a; e.s = b.s; e.ty = b.ty || 0;
      }
      const sp = b.s || 900;
      e.vx = Math.cos(b.a) * sp;
      e.vy = Math.sin(b.a) * sp;
    }
    for (const id of [...G.bullets.keys()]) if (!bseen.has(id)) G.bullets.delete(id);

    G.pickups = s.pk;
    G.mines = s.mi || [];
    if (s.tc) RENDER.updateTiles(s.tc);

    if (s.me) {
      const me = G.players.get(G.myId);
      if (me && me.alive) reconcile(s.me);
      else { pred.x = s.me.x; pred.y = s.me.y; pred.vx = 0; pred.vy = 0; pending.length = 0; }
      localAmmo = s.me.am;
      localReload = s.me.rl;
      localDashCd = s.me.dc;
      localGrenades = s.me.gr;
      UI.updateHUD({
        hp: s.me.hp, am: s.me.am, rl: s.me.rl, dc: s.me.dc,
        gr: s.me.gr, sp: s.me.sp, ck: s.me.ck || 0
      }, { timeLeft: s.tl });
      UI.respawnUI(!s.me.al, s.me.rs);
    }

    (s.ev || []).forEach(handleEvent);
    updateScorePlate();
    if ($('scoreboard').classList.contains('show')) {
      UI.showScoreboard(true, buildBoard(), C.MODES[G.mode].teams, G.myId);
    }
  }

  function buildBoard() {
    return G.scoreboard.map(e => {
      const p = G.players.get(e.i) || { name: '?', color: '#888', bot: false };
      return { id: e.i, name: p.name, color: p.color, bot: p.bot, team: e.t, kills: e.k, deaths: e.d, damage: e.dm, streak: e.s };
    }).sort((a, b) => b.kills - a.kills || a.deaths - b.deaths || b.damage - a.damage);
  }

  function updateScorePlate() {
    const teams = C.MODES[G.mode].teams;
    if (teams > 1) {
      UI.setScorePlate([
        { label: 'A', value: G.teamScore[0], cls: 't0' },
        { label: 'B', value: G.teamScore[1], cls: 't1' }
      ]);
    } else {
      const mine = G.scoreboard.find(e => e.i === G.myId);
      const lead = G.scoreboard.reduce((a, b) => (b.k > (a ? a.k : -1) ? b : a), null);
      UI.setScorePlate([
        { label: 'me', value: mine ? mine.k : 0, cls: 'me' },
        { label: 'top', value: lead ? lead.k : 0, cls: '' }
      ]);
    }
  }

  function dist2me(x, y) {
    const me = G.mePlayer();
    return me ? Math.hypot(me.rx - x, me.ry - y) : 0;
  }

  function handleEvent(ev) {
    const me = G.mePlayer();
    switch (ev.e) {
      case 'shot': {
        if (ev.id === G.myId) return; // lokal bereits vorhergesagt
        const p = G.players.get(ev.id);
        const w = C.WEAPONS[ev.w];
        if (w && w.fire) FX.flameMuzzle(ev.x, ev.y, ev.a);
        else if (w && w.boomerang) FX.party(ev.x, ev.y);
        else FX.muzzle(ev.x, ev.y, ev.a, p ? p.trail : '#ffd166');
        SFX.shoot(dist2me(ev.x, ev.y), ev.w);
        break;
      }
      // Schallplatte prallt von einer Wand ab
      case 'discwall':
        FX.party(ev.x, ev.y);
        SFX.impact(dist2me(ev.x, ev.y));
        break;
      // Platte ist wieder in Sergios Hand
      case 'disccatch': {
        FX.party(ev.x, ev.y);
        if (ev.id === G.myId) { localAmmo = weapon().mag; UI.setGrenades(localGrenades); }
        break;
      }
      case 'nade': {
        SFX.throwNade(dist2me(ev.x, ev.y));
        if (ev.id === G.myId) {
          localGrenades = ev.left;
          UI.setGrenades(ev.left);
        }
        break;
      }
      case 'boom': {
        const d = dist2me(ev.x, ev.y);
        FX.explosion(ev.x, ev.y, ev.r, ev.kind);
        SFX.boom(d);
        const near = Math.max(0, 1 - d / 800);
        FX.shake(6 + 22 * near, .35 + .3 * near);
        if (near > 0.55) FX.flash('#ffb060', .18 * near);
        break;
      }
      case 'impact':
        FX.impact(ev.x, ev.y, ev.a);
        SFX.impact(dist2me(ev.x, ev.y));
        break;
      case 'hit': {
        const victim = G.players.get(ev.id);
        FX.blood(ev.x, ev.y, ev.a, '#ff3b57');
        SFX.hit(dist2me(ev.x, ev.y));
        if (ev.by === G.myId) {
          UI.hitmark(ev.hp <= 0);
          SFX.hitmark();
          FX.text(ev.x, ev.y - 12, String(ev.d), '#ffd166', 17);
        } else if (ev.id === G.myId) {
          FX.shake(7, .3);
          FX.flash('#ff2b4a', .16);
        }
        void victim;
        break;
      }
      case 'kill': {
        const victim = G.players.get(ev.id);
        const killer = ev.by ? G.players.get(ev.by) : null;
        if (victim) {
          FX.death(ev.x, ev.y, victim.color, ev.a);
          FX.corpse({ x: ev.x, y: ev.y, a: victim.ra, color: victim.color, pattern: victim.pattern, name: victim.name }, ev.a);
          victim.alive = false;
        }
        SFX.death(dist2me(ev.x, ev.y));
        UI.killfeed(
          killer ? killer.name : 'Welt', killer ? killer.color : '#8fa4c4',
          victim ? victim.name : '?', victim ? victim.color : '#8fa4c4',
          ev.by === G.myId || ev.id === G.myId
        );
        if (ev.by === G.myId) {
          SFX.kill();
          FX.shake(5, .3);
          FX.flash('#ffffff', .1);
          const multi = ['', '', 'DOPPELKILL', 'TRIPLEKILL', 'QUAD KILL', 'MASSAKER'];
          if (ev.multi >= 2) UI.centerMsg(multi[Math.min(ev.multi, 5)], '#ffd166');
          else if (ev.streak === 3) UI.centerMsg('SERIE x3', '#4ade80');
          else if (ev.streak >= 5) UI.centerMsg('UNAUFHALTSAM x' + ev.streak, '#ff9d3c');
          else UI.centerMsg('AUSGESCHALTET', '#4ade80');
          if (ev.dist > 500) FX.text(ev.x, ev.y - 34, 'WEITSCHUSS ' + ev.dist + 'px', '#3fd0ff', 15);
        } else if (ev.id === G.myId) {
          FX.shake(12, .5);
          FX.flash('#ff2b4a', .3);
          UI.centerMsg('ELIMINIERT VON ' + (killer ? killer.name.toUpperCase() : '???'), '#ff5c7a');
        }
        break;
      }
      case 'dash': {
        const p = G.players.get(ev.id);
        FX.dash(ev.x, ev.y, ev.dx, ev.dy, p ? p.trail : '#fff');
        SFX.dash(dist2me(ev.x, ev.y));
        break;
      }
      case 'reload': if (ev.id !== G.myId) SFX.reload(); else UI.reloadBar(ev.t); break;
      case 'wpick': {
        const p = G.players.get(ev.id);
        if (p) p.weapon = ev.w;
        if (ev.id === G.myId) { applyMyWeapon(ev.w); UI.pickerAssigned(ev.w); }
        break;
      }
      case 'burn': {
        FX.burn(ev.x, ev.y);
        if (ev.id === G.myId) FX.flash('#ff7a2a', .06);
        break;
      }
      case 'swing': {
        if (ev.id === G.myId) return;   // lokal vorhergesagt
        const p = G.players.get(ev.id);
        if (p) p.swingT = C.WEAPONS.sword.swingTime;
        FX.swing(ev.x, ev.y, ev.a, p ? p.trail : '#dbe7f7');
        SFX.swing(dist2me(ev.x, ev.y), ev.hits);
        break;
      }
      case 'mineout':
        SFX.throwNade(dist2me(ev.x, ev.y));
        break;
      case 'mineset':
        if (ev.id === G.myId) { SFX.ui(false); UI.toast('Mine scharf — Linksklick zündet'); }
        break;
      case 'mineboom':
        // Explosion selbst kommt als 'boom'
        break;
      case 'reloaded': if (ev.id === G.myId) SFX.reloaded(); break;
      case 'pickup':
        FX.pickup(ev.x, ev.y, ev.t);
        if (ev.by === G.myId) { SFX.pickup(); FX.text(ev.x, ev.y - 16, ev.t === 'health' ? '+' + C.PACK_HEAL + ' HP' : 'MAGAZIN', ev.t === 'health' ? '#4ade80' : '#ffd166', 16); }
        break;
      case 'spawn': {
        const p = G.players.get(ev.id);
        FX.rings.push({ x: ev.x, y: ev.y, r: 4, max: 60, life: .4, t: .4, color: p ? p.color : '#fff', w: 3 });
        break;
      }
      case 'go':
        UI.centerMsg('LOS!', '#4ade80');
        SFX.countdown(0);
        break;
      case 'over':
        UI.centerMsg('MATCH VORBEI', '#ffd166');
        FX.slow(1.2);
        break;
    }
    void me;
  }

  /* ================= Interpolation + Loop ================= */
  function interpolate(dt) {
    const renderT = performance.now() - INTERP_MS;
    for (const p of G.players.values()) {
      if (p.id === G.myId) {
        errOff.x *= Math.pow(0.0025, dt);
        errOff.y *= Math.pow(0.0025, dt);
        p.rx = pred.x + errOff.x;
        p.ry = pred.y + errOff.y;
        p.ra = G.mouseWorld ? Math.atan2(G.mouseWorld.y - p.ry, G.mouseWorld.x - p.rx) : p.ra;
        p.mv = Math.hypot(pred.vx, pred.vy);
        p.bush = G.map ? PHYS.inBush(G.map, p.rx, p.ry) : false;
        p.dash = pred.dashT > 0;
        p.spinAngle = G.spinAngle || 0;
      } else if (p.buf.length >= 2) {
        const newest = p.buf[p.buf.length - 1];
        if (renderT > newest.t) {
          /* Puffer leergelaufen (verspaeteter Snapshot). Statt einzufrieren und
             dann zu springen, kurz mit der letzten Geschwindigkeit weiterlaufen. */
          const prev = p.buf[p.buf.length - 2];
          const span = newest.t - prev.t;
          const ahead = Math.min(renderT - newest.t, EXTRAPOLATE_MAX);
          const k = span > 0 ? ahead / span : 0;
          p.rx = newest.x + (newest.x - prev.x) * k;
          p.ry = newest.y + (newest.y - prev.y) * k;
          p.ra = newest.a;
        } else {
          let i = p.buf.length - 1;
          while (i > 0 && p.buf[i - 1].t > renderT) i--;
          const b = p.buf[i], a = p.buf[Math.max(0, i - 1)];
          const span = b.t - a.t;
          const k = span > 0 ? Math.max(0, Math.min(1, (renderT - a.t) / span)) : 1;
          p.rx = a.x + (b.x - a.x) * k;
          p.ry = a.y + (b.y - a.y) * k;
          let da = b.a - a.a;
          while (da > Math.PI) da -= Math.PI * 2;
          while (da < -Math.PI) da += Math.PI * 2;
          p.ra = a.a + da * k;
        }
      } else if (p.buf.length === 1) {
        p.rx = p.buf[0].x; p.ry = p.buf[0].y; p.ra = p.buf[0].a;
      }
      p.walkPhase += (p.mv || 0) * dt * 0.09;
      if (p.swingT > 0) p.swingT = Math.max(0, p.swingT - dt);
      if (p.id !== G.myId) p.spinAngle = (p.spinAngle || 0) + (p.spin || 0) * dt * 26;
    }

    for (const b of G.bullets.values()) {
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
  }

  let last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;

    UI.tick(dt);

    if (G.inMatch && G.map) {
      const slow = FX.slowmo > 0 ? 0.35 : 1;
      inputTick(dt);
      interpolate(dt * slow);
      RENDER.draw(G, dt * slow);
      /* Erst nach dem Zeichnen umrechnen: draw() ruecht die Kamera nach, und
         mit der alten Kameraposition lag der Zielpunkt um ein Bild daneben.
         Seit die Bodenebene gestaucht ist, faellt das in der Hoehe staerker
         auf als vorher. */
      if (G.mouse) G.mouseWorld = RENDER.screenToWorld(G.mouse.x, G.mouse.y);
    }
    requestAnimationFrame(frame);
  }

  /* ================= Menue-Verdrahtung ================= */
  function bindUI() {
    const nameInp = $('inp-name');
    nameInp.value = UI.name;
    nameInp.addEventListener('input', () => {
      UI.name = nameInp.value.slice(0, 14);
      UI.saveSkin();
      NET.send({ t: C.MSG.HELLO, name: UI.name, skin: UI.skin });
    });

    document.querySelectorAll('[data-back]').forEach(b => {
      b.onclick = () => UI.show(b.dataset.back);
    });

    $('btn-create').onclick = () => {
      SFX.resume();
      FB.log('lobby_create');
      NET.send({ t: C.MSG.CREATE, name: UI.name, skin: UI.skin });
    };
    $('btn-join').onclick = () => {
      SFX.resume();
      $('join-err').textContent = '';
      UI.show('scr-join');
      setTimeout(() => digits[0].focus(), 120);
    };
    $('btn-skins').onclick = () => { UI.buildSkinUI(); UI.show('scr-skins'); };
    $('btn-help').onclick = () => UI.show('scr-help');
    $('btn-board').onclick = () => {
      NET.send({ t: C.MSG.BOARDREQ });
      UI.show('scr-board');
      FB.log('leaderboard_open');
    };
    $('btn-shop').onclick = () => {
      NET.send({ t: C.MSG.SHOP });
      UI.show('scr-shop');
      FB.log('shop_open');
    };

    /* ---- Anmeldung ----
       Wird die Anmeldung vom Geraet abgefangen, darf niemand vor einem toten
       Knopf sitzen: der Hinweis erklaert die Lage und der Gastweg wird zum
       Hauptknopf. Gespielt werden kann immer. */
    function anmeldungBlockiert(text) {
      $('login-blocked').classList.add('show');
      if (text) $('login-err').textContent = text;
      $('btn-google').disabled = true;
      $('btn-google').style.opacity = .45;
      $('btn-guest').classList.add('primary-fallback');
      $('btn-guest').textContent = 'Ohne Anmeldung spielen';
    }

    // SDK gar nicht geladen -> Filter hat es schon vorher geblockt
    if (AUTH.blocked()) anmeldungBlockiert('');

    $('btn-google').onclick = async () => {
      $('login-err').textContent = '';
      const btn = $('btn-google');
      btn.disabled = true;
      const alt = btn.querySelector('b').textContent;
      btn.querySelector('b').textContent = 'ANMELDEFENSTER OFFEN …';
      try {
        await AUTH.signIn();
        FB.log('login', { method: 'google' });
      } catch (e) {
        switch (e.grund) {
          case 'blockiert':
          case 'popup':
            anmeldungBlockiert('');
            break;
          case 'abgebrochen':
            $('login-err').textContent = 'Anmeldung abgebrochen.';
            break;
          case 'domain':
            $('login-err').textContent = 'Diese Adresse ist in Firebase nicht freigegeben '
              + '(Authentication → Settings → Authorized domains).';
            break;
          case 'projekt':
            $('login-err').textContent = 'Google-Anmeldung ist im Firebase-Projekt nicht aktiviert.';
            break;
          default:
            $('login-err').textContent = e.message;
        }
        FB.log('login_failed', { reason: e.grund || 'unbekannt' });
      } finally {
        btn.querySelector('b').textContent = alt;
        if (!AUTH.blocked()) btn.disabled = false;
      }
    };
    $('btn-guest').onclick = () => { AUTH.playAsGuest(); FB.log('login', { method: 'guest' }); };
    $('btn-signout').onclick = async () => {
      // Angemeldet -> abmelden. Als Gast -> zurueck zum Anmeldebildschirm.
      await AUTH.signOut();
      UI.show('scr-login');
      $('login-err').textContent = '';
      FB.log('logout');
    };

    // Login-Screen verlassen, sobald angemeldet oder Gastmodus gewaehlt
    AUTH.onChange(st => {
      UI.renderAccount(st);
      if ((st.signedIn || st.guest) && UI.currentScreen() === 'scr-login') UI.show('scr-menu');
      if (!st.signedIn && !st.guest && UI.currentScreen() === 'scr-menu') UI.show('scr-login');
    });
    $('btn-skin-save').onclick = () => {
      UI.saveSkin();
      NET.send({ t: C.MSG.HELLO, name: UI.name, skin: UI.skin });
      UI.toast('Skin gespeichert', 'ok');
      UI.show('scr-menu');
    };

    // Code-Eingabe
    const digits = [...document.querySelectorAll('#code-input .digit')];
    digits.forEach((d, i) => {
      d.addEventListener('input', () => {
        d.value = d.value.replace(/\D/g, '').slice(0, 1);
        d.classList.toggle('filled', !!d.value);
        if (d.value && i < digits.length - 1) digits[i + 1].focus();
        if (digits.every(x => x.value)) doJoin();
      });
      d.addEventListener('keydown', e => {
        if (e.key === 'Backspace' && !d.value && i > 0) digits[i - 1].focus();
        if (e.key === 'Enter') doJoin();
      });
      d.addEventListener('paste', e => {
        const txt = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
        if (!txt) return;
        e.preventDefault();
        txt.split('').forEach((ch, k) => { if (digits[k]) { digits[k].value = ch; digits[k].classList.add('filled'); } });
        if (txt.length === 6) doJoin();
      });
    });
    window.digits = digits;

    function doJoin() {
      const code = digits.map(d => d.value).join('');
      if (code.length !== 6) { $('join-err').textContent = 'Bitte 6 Ziffern eingeben'; return; }
      FB.log('lobby_join');
      NET.send({ t: C.MSG.JOIN, code, name: UI.name, skin: UI.skin });
    }
    $('btn-do-join').onclick = doJoin;

    // Lobby
    $('room-code').onclick = () => {
      const code = $('room-code').textContent;
      navigator.clipboard?.writeText(code).then(
        () => { $('copy-hint').textContent = 'kopiert!'; setTimeout(() => $('copy-hint').textContent = 'klicken zum kopieren', 1600); },
        () => UI.toast('Kopieren nicht möglich: ' + code)
      );
    };
    $('btn-leave').onclick = () => { NET.send({ t: C.MSG.LEAVE }); UI.show('scr-menu'); };
    /* Tab zu = bewusst weg. Ohne diese Meldung bliebe der Platz die volle
       Schonfrist reserviert und die anderen warteten auf eine Karteileiche. */
    addEventListener('pagehide', () => { try { NET.send({ t: C.MSG.LEAVE }); } catch (_) { /* egal */ } });
    $('btn-addbot').onclick = () => NET.send({ t: C.MSG.ADDBOT });
    $('btn-shuffle').onclick = () => {
      const r = UI.room;
      if (!r) return;
      const ids = r.members.map(m => m.id).sort(() => Math.random() - 0.5);
      ids.forEach((id, i) => NET.send({ t: C.MSG.TEAM, id, team: i % 2 }));
    };
    $('btn-start').onclick = () => { SFX.resume(); NET.send({ t: C.MSG.START }); };

    const chatInp = $('chat-inp');
    const sendChat = () => {
      const v = chatInp.value.trim();
      if (!v) return;
      NET.send({ t: C.MSG.CHAT, text: v });
      chatInp.value = '';
    };
    $('chat-send').onclick = sendChat;
    chatInp.addEventListener('keydown', e => { if (e.key === 'Enter') sendChat(); });

    $('btn-result-back').onclick = () => {
      UI.show(NET.connected && UI.room ? 'scr-lobby' : 'scr-menu');
    };
  }

  /* ================= Start ================= */
  bindUI();
  UI.wireSettings();
  SETTINGS.apply();          // gespeicherte Grafikstufe sofort setzen
  UI.buildSkinUI();
  RENDER.resize();
  AUTH.init();
  NET.connect();
  requestAnimationFrame(frame);

  // Erste Nutzerinteraktion schaltet Audio frei
  ['pointerdown', 'keydown'].forEach(ev => addEventListener(ev, () => SFX.resume(), { once: true }));
})();
