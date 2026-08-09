/* Menue-, Lobby- und HUD-Steuerung. */
const UI = (() => {
  const $ = id => document.getElementById(id);
  const screens = [...document.querySelectorAll('.screen')];
  // Startscreen aus dem DOM ableiten - sonst laeuft der Zustand auseinander,
  // sobald sich der erste aktive Screen im HTML aendert.
  let current = (document.querySelector('.screen.active') || screens[0]).id;

  /* ---------- Screens ---------- */
  function show(id) {
    if (current === id) return;
    screens.forEach(s => s.classList.toggle('active', s.id === id));
    current = id;
    SFX.ui(true);
  }
  const currentScreen = () => current;

  /* ---------- Toast ---------- */
  function toast(msg, type) {
    const el = document.createElement('div');
    el.className = 'toast' + (type ? ' ' + type : '');
    el.textContent = msg;
    $('toast').appendChild(el);
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 320); }, 2600);
  }

  /* ---------- Menue-Hintergrund ---------- */
  const bg = $('bgfx');
  const bgx = bg.getContext('2d');
  const stars = [];
  const drifters = [];
  function initBg() {
    bg.width = window.innerWidth; bg.height = window.innerHeight;
    stars.length = 0; drifters.length = 0;
    for (let i = 0; i < 130; i++) {
      stars.push({ x: Math.random() * bg.width, y: Math.random() * bg.height, r: Math.random() * 1.6 + .3, s: Math.random() * .5 + .1, a: Math.random() });
    }
    for (let i = 0; i < 16; i++) {
      drifters.push({
        x: Math.random() * bg.width, y: Math.random() * bg.height,
        vx: (Math.random() - .5) * 22, vy: (Math.random() - .5) * 22,
        r: 26 + Math.random() * 90, hue: 190 + Math.random() * 90, a: .04 + Math.random() * .05
      });
    }
  }
  window.addEventListener('resize', initBg);
  initBg();

  let bgT = 0;
  function drawBg(dt) {
    bgT += dt;
    bgx.clearRect(0, 0, bg.width, bg.height);
    for (const d of drifters) {
      d.x += d.vx * dt; d.y += d.vy * dt;
      if (d.x < -d.r) d.x = bg.width + d.r; if (d.x > bg.width + d.r) d.x = -d.r;
      if (d.y < -d.r) d.y = bg.height + d.r; if (d.y > bg.height + d.r) d.y = -d.r;
      const g = bgx.createRadialGradient(d.x, d.y, 0, d.x, d.y, d.r);
      g.addColorStop(0, `hsla(${d.hue},90%,60%,${d.a})`);
      g.addColorStop(1, 'hsla(0,0%,0%,0)');
      bgx.fillStyle = g;
      bgx.fillRect(d.x - d.r, d.y - d.r, d.r * 2, d.r * 2);
    }
    for (const s of stars) {
      s.y += s.s * 12 * dt * 4;
      if (s.y > bg.height) { s.y = -2; s.x = Math.random() * bg.width; }
      const tw = .35 + .65 * Math.abs(Math.sin(bgT * 1.6 + s.a * 9));
      bgx.fillStyle = `rgba(150,210,255,${tw * .55})`;
      bgx.fillRect(s.x, s.y, s.r, s.r);
    }
    // Horizontlinien
    bgx.strokeStyle = 'rgba(63,208,255,.05)';
    bgx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const y = (bg.height * .55) + i * 30 + Math.sin(bgT * .6 + i) * 6;
      bgx.beginPath(); bgx.moveTo(0, y); bgx.lineTo(bg.width, y); bgx.stroke();
    }
  }

  /* ---------- Skin ---------- */
  const isLocal = /^(localhost|127\.\d+\.\d+\.\d+)$/.test(location.hostname);
  const skin = loadSkin();
  let profileName = (isLocal ? '' : localStorage.getItem('ns_name')) || '';

  function loadSkin() {
    if (isLocal) return { color: '#5c7a2e', trail: '#ffd166', pattern: 'solid' };
    try {
      const s = JSON.parse(localStorage.getItem('ns_skin') || '{}');
      return {
        color: /^#[0-9a-f]{6}$/i.test(s.color) ? s.color : '#5c7a2e',
        trail: /^#[0-9a-f]{6}$/i.test(s.trail) ? s.trail : '#ffd166',
        pattern: C.SKIN_PATTERNS.includes(s.pattern) ? s.pattern : 'solid'
      };
    } catch (_) { return { color: '#5c7a2e', trail: '#ffd166', pattern: 'solid' }; }
  }
  function saveSkin() {
    if (isLocal) return;
    localStorage.setItem('ns_skin', JSON.stringify(skin));
    localStorage.setItem('ns_name', profileName);
  }
  /* ---------- Lobby ---------- */
  let roomState = null;
  function renderRoom(r, myId) {
    roomState = r;
    $('room-code').textContent = r.code;
    $('pcount').textContent = `${r.members.length}/${r.maxPlayers}`;

    const isHost = r.host === myId;
    const modeRow = $('mode-row');
    if (!modeRow.dataset.built) {
      modeRow.dataset.built = '1';
      Object.values(C.MODES).forEach(m => {
        const b = document.createElement('button');
        b.className = 'mode';
        b.dataset.mode = m.key;
        b.innerHTML = `${m.short}<small>${m.key === 'ffa' ? 'up to 6' : m.perTeam * 2 + ' players'}</small>`;
        b.onclick = () => { if (roomState && roomState.host === NET.id) NET.send({ t: C.MSG.SETUP, mode: m.key }); };
        modeRow.appendChild(b);
      });
    }
    [...modeRow.children].forEach(b => {
      b.classList.toggle('sel', b.dataset.mode === r.mode);
      b.disabled = !isHost;
    });

    const list = $('player-list');
    list.innerHTML = '';
    const teams = C.MODES[r.mode].teams;
    const sorted = [...r.members].sort((a, b) => (a.team - b.team) || (b.host - a.host));
    sorted.forEach(m => {
      const row = document.createElement('div');
      row.className = 'prow';
      const av = document.createElement('div');
      av.className = 'av';
      av.style.background = m.skin.color;
      av.style.color = m.skin.color;
      row.appendChild(av);

      const nm = document.createElement('div');
      nm.className = 'nm';
      nm.textContent = m.name;
      if (teams > 1) nm.style.color = C.TEAM_COLORS[m.team];
      row.appendChild(nm);

      if (m.host) { const t = document.createElement('span'); t.className = 'tag host'; t.textContent = 'HOST'; row.appendChild(t); }
      if (m.bot) { const t = document.createElement('span'); t.className = 'tag bot'; t.textContent = 'BOT'; row.appendChild(t); }

      if (teams > 1) {
        const sw = document.createElement('button');
        sw.className = 'teamsw';
        sw.textContent = C.TEAM_NAMES[m.team];
        sw.style.color = C.TEAM_COLORS[m.team];
        sw.style.borderColor = C.TEAM_COLORS[m.team] + '66';
        if (isHost || m.id === myId) sw.onclick = () => NET.send({ t: C.MSG.TEAM, id: m.id, team: m.team ? 0 : 1 });
        else sw.disabled = true;
        row.appendChild(sw);
      }
      if (isHost && m.id !== myId) {
        const k = document.createElement('button');
        k.className = 'kick'; k.textContent = '✕'; k.title = 'Remove';
        k.onclick = () => NET.send({ t: C.MSG.KICK, id: m.id });
        row.appendChild(k);
      }
      list.appendChild(row);
    });

    $('host-tools').style.display = isHost ? 'flex' : 'none';
    const startBtn = $('btn-start');
    startBtn.style.display = isHost ? 'block' : 'none';
    startBtn.disabled = !!r.canStart;
    startBtn.textContent = r.canStart ? r.canStart.toUpperCase() : 'START MATCH';
    $('lobby-err').textContent = isHost ? '' : 'Waiting for the host…';
  }

  function addChat(name, color, text, sys) {
    const log = $('chat-log');
    const el = document.createElement('div');
    el.className = 'm' + (sys ? ' sys' : '');
    if (sys) el.textContent = text;
    else {
      const b = document.createElement('b');
      b.textContent = name + ': ';
      b.style.color = color || '#8fb6e0';
      el.appendChild(b);
      el.appendChild(document.createTextNode(text));
    }
    log.appendChild(el);
    while (log.children.length > 60) log.firstChild.remove();
    log.scrollTop = log.scrollHeight;
  }

  /* ---------- HUD ---------- */
  const pips = [];
  let curWeapon = C.WEAPONS.pistol;
  const grenadePips = [];

  function buildGrenades() {
    const host = $('nade-pips');
    if (!host) return;
    host.innerHTML = '';
    grenadePips.length = 0;
    for (let i = 0; i < C.GRENADES; i++) {
      const d = document.createElement('div');
      d.className = 'nade on';
      d.textContent = '✱';
      host.appendChild(d);
      grenadePips.push(d);
    }
  }

  /** Waffe setzen: HUD-Plakette + passende Munitionsanzeige. */
  function setWeapon(key) {
    curWeapon = C.WEAPONS[key] || C.WEAPONS.pistol;
    const plate = $('weapon-plate');
    if (plate) {
      plate.innerHTML =
        `<span class="wico">${curWeapon.icon}</span>` +
        `<span class="wname">${curWeapon.short}</span>`;
      plate.className = 'weapon-plate tier' + curWeapon.tier;
    }
    const host = $('ammo-pips');
    host.innerHTML = '';
    pips.length = 0;
    if (curWeapon.melee) {
      // Nahkampf braucht keine Munition
      host.classList.add('numeric');
      host.classList.remove('low', 'reloading');
      host.innerHTML = '<b id="ammo-num">∞</b>';
      buildGrenades();
      return;
    }
    // Bis 12 Schuss Einzelanzeige, darueber Zahl - 100 Pips waeren unlesbar
    if (curWeapon.mag <= 12) {
      host.classList.remove('numeric');
      for (let i = 0; i < curWeapon.mag; i++) {
        const d = document.createElement('div');
        d.className = 'pip on';
        host.appendChild(d);
        pips.push(d);
      }
    } else {
      host.classList.add('numeric');
      host.innerHTML = `<b id="ammo-num">${curWeapon.mag}</b><i>/${curWeapon.mag}</i>`;
    }
    buildGrenades();
  }

  function setGrenades(n) {
    grenadePips.forEach((p, i) => p.classList.toggle('on', i < n));
  }

  function reloadBar(t) {
    const el = $('reload-ring');
    if (!el) return;
    el.style.animationDuration = (t || 1.5) + 's';
    el.classList.remove('run');
    void el.offsetWidth;
    el.classList.add('run');
  }

  let lastHp = C.HP_MAX;
  function updateHUD(me, matchInfo) {
    if (!me) return;
    const hp = Math.max(0, me.hp);
    const shield = me.sh || 0;
    const total = C.HP_MAX + 45;
    const hpPct = (hp / C.HP_MAX) * 100;
    const shieldPct = (shield / C.HP_MAX) * 100;
    const fill = $('hp-fill');
    fill.style.width = hpPct + '%';
    fill.classList.toggle('low', hpPct <= 30 && shield <= 0);
    $('hp-num').textContent = Math.round(hp);
    if (hp < lastHp - 0.5) {
      const v = $('dmg-vig');
      v.style.opacity = Math.min(.85, (1 - hp / C.HP_MAX) * .9 + .2);
      setTimeout(() => { v.style.opacity = 0; }, 160);
    }
    lastHp = hp;

    let shieldBar = $('shield-fill');
    if (!shieldBar) {
      const hpBar = $('hp-bar');
      shieldBar = document.createElement('i');
      shieldBar.id = 'shield-fill';
      shieldBar.style.cssText = 'position:absolute;left:0;top:0;height:100%;border-radius:7px;' +
        'background:linear-gradient(90deg,#3fd0ff,#63b8ff);transition:width .18s cubic-bezier(.2,.9,.25,1);' +
        'box-shadow:0 0 12px rgba(63,208,255,.4)';
      hpBar.appendChild(shieldBar);
    }
    shieldBar.style.width = shieldPct + '%';
    shieldBar.style.display = shield > 0 ? 'block' : 'none';

    const reloading = me.rl > 0;
    const host = $('ammo-pips');
    if (curWeapon.melee) { if (me.gr !== undefined) setGrenades(me.gr); }
    else if (curWeapon.mine) {
      // Zustand statt Zahl: bereit / unterwegs bzw. scharf
      const num = $('ammo-num');
      if (num) num.textContent = me.am > 0 ? '1' : '•';
      host.classList.toggle('low', me.am === 0);
    }
    host.classList.toggle('reloading', reloading);
    if (pips.length) {
      pips.forEach((p, i) => p.classList.toggle('on', !reloading && i < me.am));
    } else {
      const num = $('ammo-num');
      if (num) num.textContent = reloading ? '–' : me.am;
      host.classList.toggle('low', !reloading && me.am <= curWeapon.mag * 0.2);
    }
    if (me.gr !== undefined) setGrenades(me.gr);

    // Minigun-Anlauf
    const spin = $('spin-bar');
    if (spin) {
      spin.style.display = curWeapon.spinUp ? 'block' : 'none';
      if (curWeapon.spinUp) $('spin-fill').style.width = ((me.sp || 0) * 100) + '%';
    }

    // Tarnung nach einem Schwert-Kill: Restzeit anzeigen
    const cloak = $('cloak-badge');
    if (cloak) {
      const left = me.ck || 0;
      cloak.classList.toggle('show', left > 0);
      if (left > 0) cloak.textContent = `INVISIBLE ${left.toFixed(1)}s`;
    }

    // Balken auf den tatsaechlichen Cooldown der Waffe beziehen
    const dashMax = C.DASH_CD * (curWeapon.heavy ? C.DASH_CD_HEAVY : 1);
    const dashPct = me.dc > 0 ? (1 - me.dc / dashMax) * 100 : 100;
    $('dash-fill').style.width = Math.max(0, dashPct) + '%';

    if (matchInfo) {
      const t = matchInfo.timeLeft;
      const m = Math.floor(t / 60), s = Math.floor(t % 60);
      const timer = $('timer');
      timer.textContent = `${m}:${String(s).padStart(2, '0')}`;
      timer.classList.toggle('low', t <= 30);
    }
  }

  /* ---------- Vorbereitung: Karte, Sperre, Waffe ----------
     Der Server fuehrt Regie und schickt bei jeder Aenderung den kompletten
     Stand. Die Oberflaeche zeichnet nur, was ankommt, und meldet Klicks
     zurueck - so kann kein Client eine Sperre umgehen. */

  let phaseSend = null;      // Rueckmeldung an main.js
  let phaseMax = 1;
  let phaseLast = null;

  function onPhaseVote(fn) { phaseSend = fn; }

  /** Kleine Kartenvorschau aus der Kachelkarte zeichnen. */
  function malMap(cv, mapId) {
    const map = MAPS.generate(mapId);
    const n = map.n;
    cv.width = n; cv.height = n;
    const g = cv.getContext('2d');
    const bild = g.createImageData(n, n);
    for (let i = 0; i < n * n; i++) {
      const v = map.tiles[i];
      const c = v === C.T_WALL ? [92, 106, 140]
        : v === C.T_BUSH ? [58, 112, 70]
          : v === C.T_RUBBLE ? [74, 68, 58] : [26, 32, 46];
      bild.data[i * 4] = c[0]; bild.data[i * 4 + 1] = c[1];
      bild.data[i * 4 + 2] = c[2]; bild.data[i * 4 + 3] = 255;
    }
    g.putImageData(bild, 0, 0);
  }

  function renderPhase(m) {
    show('scr-prematch');
    const neu = m.phase !== phaseLast;
    phaseLast = m.phase;
    if (neu) {
      phaseMax = m.phase === 'vote' ? C.PREMATCH.VOTE_TIME
        : m.phase === 'wheel' ? C.PREMATCH.WHEEL_TIME
        : m.phase === 'classpick' ? 10 : C.PREMATCH.PICK_TIME;
    }
    phaseMax = Math.max(phaseMax, m.time);

    const stepEls = [...$('prep-steps').children];
    stepEls.forEach(el => {
      const s = el.dataset.step;
      const rang = { vote: 0, wheel: 1, pick: 2, classpick: 2 };
      el.classList.toggle('on', s === (m.phase === 'classpick' ? 'pick' : m.phase));
      el.classList.toggle('done', rang[s] < rang[m.phase]);
    });

    $('prep-time').textContent = Math.ceil(m.time);
    $('prep-fill').style.width = Math.max(0, Math.min(100, (m.time / phaseMax) * 100)) + '%';

    $('map-choices').classList.toggle('show', m.phase === 'vote');
    $('wheels').classList.toggle('show', m.phase === 'wheel');
    $('pick-grid').classList.toggle('show', m.phase === 'pick' || m.phase === 'classpick');

    if (m.phase === 'vote') phaseVote(m);
    else if (m.phase === 'wheel') phaseWheel(m, neu);
    else if (m.phase === 'classpick') phaseClassPick(m);
    else phasePick(m);
  }

  function phaseVote(m) {
    $('prep-title').textContent = 'PICK A MAP';
    $('prep-sub').textContent = m.mode === 'solo' ? 'Choose where to survive.' : 'The map with the most votes gets played.';
    $('prep-note').textContent = m.you === undefined
      ? 'No vote means you do not count.' : '';
    const host = $('map-choices');
    if (host.dataset.sig !== m.maps.map(x => x.id).join(',')) {
      host.dataset.sig = m.maps.map(x => x.id).join(',');
      host.innerHTML = '';
      for (const k of m.maps) {
        const card = document.createElement('div');
        card.className = 'map-card';
        card.dataset.id = k.id;
        const cv = document.createElement('canvas');
        malMap(cv, k.id);
        const b = document.createElement('b');
        b.textContent = k.name;
        const v = document.createElement('div');
        v.className = 'map-votes';
        card.append(cv, b, v);
        card.onclick = () => { if (phaseSend) phaseSend(k.id); SFX.ui(true); };
        host.appendChild(card);
      }
    }
    [...host.children].forEach((card, i) => {
      card.classList.toggle('on', Number(card.dataset.id) === m.you);
      const v = card.querySelector('.map-votes');
      v.innerHTML = '';
      for (let k = 0; k < (m.votes[i] || 0); k++) v.appendChild(document.createElement('i'));
    });
  }

  function waffenKarte(key) {
    const w = C.WEAPONS[key];
    const card = document.createElement('div');
    card.className = 'wcard';
    card.dataset.w = key;
    card.innerHTML = `<div class="wico">${w.icon}</div>`
      + `<div class="wname">${esc(w.short)}</div>`
      + `<div class="wstat">${w.melee ? 'Nahkampf' : w.mine ? 'Falle' : w.dmg + ' Schaden'}</div>`;
    return card;
  }

  /* Glücksräder. Das Ergebnis steht schon fest, wenn die Phase beginnt - der
     Server hat gewuerfelt und schickt es mit. Hier laeuft nur noch die
     Walze sichtbar darauf zu, damit man sieht, was herausfaellt. */
  const ZELLE = 63;          // Hoehe einer Walzenzelle in px, siehe style.css
  let radDaten = null;

  function baueRad(nr, weapons) {
    const rad = $('wheel-' + nr);
    const strip = rad.querySelector('.wheel-strip');
    strip.innerHTML = '';
    /* Die Liste mehrfach hintereinander, damit die Walze lange laufen kann,
       ohne dass eine Luecke sichtbar wird. */
    for (let runde = 0; runde < 8; runde++) {
      for (const key of weapons) {
        const w = C.WEAPONS[key];
        const z = document.createElement('div');
        z.className = 'wheel-cell';
        z.innerHTML = `<div class="wico">${w.icon}</div><div class="wname">${esc(w.short)}</div>`;
        strip.appendChild(z);
      }
    }
    if (!rad.querySelector('.wheel-tag')) {
      const tag = document.createElement('div');
      tag.className = 'wheel-tag';
      tag.textContent = 'BANNED';
      rad.appendChild(tag);
    }
    rad.classList.remove('locked');
    return strip;
  }

  function phaseWheel(m, neu) {
    $('prep-title').textContent = 'WHEEL OF FORTUNE';
    $('prep-sub').textContent = `Map: ${m.mapName} — two weapons drop out for this round.`;
    $('prep-note').textContent = 'Pure luck — nobody votes here.';

    if (neu || !radDaten) {
      radDaten = {
        weapons: m.weapons,
        banned: m.banned.slice(),
        dauer: m.dauer || C.PREMATCH.WHEEL_TIME,
        strips: [baueRad(0, m.weapons), baueRad(1, m.weapons)],
        // Ziel liegt in der vorletzten Runde, damit vorher genug vorbeilaeuft
        ziel: m.banned.map(k => m.weapons.indexOf(k) + m.weapons.length * 6)
      };
      SFX.ui(true);
    }
    radDaten.rest = m.time;
  }

  /** Walzen bewegen. Laeuft im Takt der Oberflaeche, nicht der Nachrichten. */
  function wheelTick() {
    if (!radDaten || phaseLast !== 'wheel') return;
    const { strips, ziel, dauer } = radDaten;
    for (let i = 0; i < strips.length; i++) {
      // Das zweite Rad haelt etwas spaeter - sonst wirkt es wie ein Rad
      const anteil = i === 0 ? 0.62 : 0.9;
      const bis = dauer * anteil;
      const rest = Math.max(0, radDaten.rest - (dauer - bis));
      const p = Math.min(1, 1 - rest / bis);
      // Stark abbremsen: schnell los, langsam ins Ziel
      const eased = 1 - Math.pow(1 - p, 3.2);
      const y = eased * ziel[i] * ZELLE;
      strips[i].style.transform = `translateY(${-y + (190 - ZELLE) / 2}px)`;
      const rad = $('wheel-' + i);
      const fest = p >= 0.999;
      if (fest !== rad.classList.contains('locked')) {
        rad.classList.toggle('locked', fest);
        if (fest) SFX.ui(false);
      }
    }
  }

  function phasePick(m) {
    $('prep-title').textContent = 'PICK YOUR WEAPON';
    $('prep-sub').textContent = `Map: ${m.mapName} — banned: `
      + (m.banned.length ? m.banned.map(k => C.WEAPONS[k].short).join(', ') : 'nichts');
    $('prep-note').textContent = 'No pick means a random allowed weapon.';
    const host = $('pick-grid');
    if (!host.children.length) {
      for (const key of C.WEAPON_ORDER) {
        const card = waffenKarte(key);
        const t = document.createElement('div');
        t.className = 'wtaken';
        card.appendChild(t);
        card.onclick = () => {
          if (card.classList.contains('banned')) return;
          if (phaseSend) phaseSend(key);
          SFX.ui(true);
        };
        host.appendChild(card);
      }
    }
    [...host.children].forEach(card => {
      const key = card.dataset.w;
      card.classList.toggle('banned', m.banned.includes(key));
      card.classList.toggle('on', key === m.you);
      const wer = (m.taken || []).filter(x => x.w === key).length;
      card.querySelector('.wtaken').textContent = wer ? `${wer}× picked` : '';
    });
  }

  function phaseClassPick(m) {
    $('prep-title').textContent = 'PICK YOUR WEAPON CLASS';
    $('prep-sub').textContent = `Map: ${m.mapName} — choose AK-47 or Shotgun`;
    $('prep-note').textContent = 'No pick means AK-47.';
    const host = $('pick-grid');
    if (!host.children.length) {
      host.className = 'classpick-grid';
      const classes = [
        { key: 'ak47', name: 'AK-47', sub: 'Assault Rifle', img: 'img/player.png' },
        { key: 'shotgun', name: 'PUMP GUN', sub: 'Shotgun', img: 'img/Adobe%20Express%20-%20file.png' }
      ];
      for (const cl of classes) {
        const card = document.createElement('button');
        card.className = 'classpick-card';
        card.dataset.w = cl.key;
        card.innerHTML = '<div class="classpick-img"><img src="' + cl.img + '" alt="' + cl.name + '"></div>'
          + '<span class="classpick-name">' + cl.name + '</span>'
          + '<span class="classpick-sub">' + cl.sub + '</span>';
        card.onclick = () => {
          if (phaseSend) phaseSend(cl.key);
          SFX.ui(true);
        };
        host.appendChild(card);
      }
    }
    [...host.children].forEach(card => {
      card.classList.toggle('selected', card.dataset.w === m.you);
    });
  }

  /* ---------- Einstellungen ---------- */

  let lauscht = null;      // Aktion, die gerade auf eine neue Taste wartet

  function renderSettings() {
    const s = SETTINGS.all;
    $('set-perf').checked = !!s.perf;
    $('set-particles').checked = !!s.particles;
    $('set-shake').value = Math.round(s.shake * 100);
    $('set-shake-val').textContent = Math.round(s.shake * 100);
    $('set-sens').value = Math.round(s.sens * 100);
    $('set-sens-val').textContent = Math.round(s.sens * 100);
    [...$('set-quality').children].forEach(b => b.classList.toggle('on', Number(b.dataset.q) === s.quality));

    /* Im Leistungsmodus sind die Einzelregler wirkungslos - das muss man
       sehen, sonst dreht man daran und wundert sich. */
    for (const id of ['set-quality', 'set-particles', 'set-shake']) {
      const el = $(id);
      const row = el.closest('.set-row');
      if (row) row.style.opacity = s.perf ? 0.4 : 1;
      if (el.tagName === 'INPUT') el.disabled = !!s.perf;
      else [...el.children].forEach(b => { b.disabled = !!s.perf; });
    }

    const host = $('keybinds');
    host.innerHTML = '';
    for (const a of SETTINGS.ACTIONS) {
      const row = document.createElement('div');
      row.className = 'kb-row';
      const name = document.createElement('span');
      name.className = 'kb-name';
      name.textContent = a.name;
      const key = document.createElement('button');
      key.className = 'kb-key';
      key.dataset.action = a.id;
      key.textContent = SETTINGS.keysFor(a.id).map(SETTINGS.label).join(' / ') || '—';
      key.onclick = () => starteBelegung(a.id, key);
      row.append(name, key);
      host.appendChild(row);
    }
  }

  function starteBelegung(action, btn) {
    if (lauscht) return;
    lauscht = action;
    btn.classList.add('listening');
    btn.textContent = 'Press a key …';

    const fertig = () => {
      lauscht = null;
      removeEventListener('keydown', onKey, true);
      renderSettings();
    };
    const onKey = ev => {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.code === 'Escape') { fertig(); return; }
      const ersetzt = SETTINGS.bind(action, ev.code);
      fertig();
      if (ersetzt) toast(`${SETTINGS.label(ev.code)} was on “${ersetzt.name}” — freed up there`, 'err');
    };
    addEventListener('keydown', onKey, true);
  }

  function wireSettings() {
    $('btn-settings').onclick = () => { renderSettings(); show('scr-settings'); };
    $('set-perf').onchange = e => { SETTINGS.set('perf', e.target.checked); renderSettings(); };
    $('set-particles').onchange = e => SETTINGS.set('particles', e.target.checked);
    $('set-shake').oninput = e => {
      SETTINGS.set('shake', Number(e.target.value) / 100);
      $('set-shake-val').textContent = e.target.value;
    };
    $('set-sens').oninput = e => {
      SETTINGS.set('sens', Number(e.target.value) / 100);
      $('set-sens-val').textContent = e.target.value;
    };
    [...$('set-quality').children].forEach(b => {
      b.onclick = () => { SETTINGS.set('quality', Number(b.dataset.q)); renderSettings(); };
    });
    $('btn-keys-reset').onclick = () => { SETTINGS.resetKeys(); renderSettings(); toast('Key bindings reset', 'ok'); };
    $('btn-settings-reset').onclick = () => { SETTINGS.reset(); renderSettings(); toast('Settings reset', 'ok'); };
  }

  /** Laufende Messwerte im Einstellungsfenster. */
  function settingsLive() {
    if (current !== 'scr-settings') return;
    const q = RENDER.quality;
    $('perf-live').textContent =
      `Stufe: ${q.name}${q.pinned ? ' (fest)' : ' (automatisch)'} · Zeichenzeit ${q.avgMs} ms/Bild`;
  }

  /* Sichtbares Zeichen, dass die Verbindung weg ist. Ohne das blieb im Match
     einfach das letzte Bild stehen - man haelt es fuer einen Absturz. */
  function reconnecting(on) {
    const el = $('reconnect');
    if (!el) return;
    el.classList.toggle('show', !!on);
  }

  function setScorePlate(entries) {
    const host = $('score-plate');
    const sig = entries.map(e => e.label + e.value + e.cls).join('|');
    if (host.dataset.sig === sig) return;
    const prev = {};
    [...host.children].forEach(c => { prev[c.dataset.k] = c.textContent; });
    host.innerHTML = '';
    entries.forEach(e => {
      const d = document.createElement('div');
      d.className = 'sc ' + e.cls;
      d.dataset.k = e.label;
      d.textContent = e.value;
      if (prev[e.label] !== undefined && prev[e.label] !== String(e.value)) d.classList.add('bump');
      host.appendChild(d);
    });
    host.dataset.sig = sig;
  }

  function killfeed(killerName, killerColor, victimName, victimColor, mine) {
    const host = $('killfeed');
    const el = document.createElement('div');
    el.className = 'kf' + (mine ? ' mine' : '');
    el.innerHTML = `<span style="color:${killerColor}">${esc(killerName)}</span><span class="wep">➤</span><span style="color:${victimColor}">${esc(victimName)}</span>`;
    host.appendChild(el);
    while (host.children.length > 5) host.firstChild.remove();
    setTimeout(() => { el.classList.add('out'); setTimeout(() => el.remove(), 360); }, 5000);
  }

  function esc(s) { return String(s).replace(/[<>&]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c])); }

  let msgTimer = null;
  function centerMsg(text, color) {
    const el = $('center-msg');
    el.textContent = text;
    el.style.color = color || '#fff';
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(msgTimer);
    msgTimer = setTimeout(() => el.classList.remove('show'), 1600);
  }

  function respawnUI(show, t) {
    const el = $('respawn-ui');
    el.classList.toggle('show', !!show);
    if (show) $('rs-time').textContent = t.toFixed(1);
  }

  function hitmark(kill) {
    const el = $('hitmark');
    el.classList.remove('hit', 'killhit');
    void el.offsetWidth;
    el.classList.add(kill ? 'killhit' : 'hit');
  }

  function updateWave(wave, prep, alive) {
    const el = $('wave-display');
    if (!el) return;
    if (prep > 0) {
      el.textContent = 'WAVE ' + (wave + 1) + ' IN ' + Math.ceil(prep);
      el.className = 'wave-display prep';
    } else {
      el.textContent = 'WAVE ' + wave + ' · ' + alive + ' LEFT';
      el.className = 'wave-display live';
    }
  }

  function boardHTML(board, teams, myId, withStars) {
    const cls = withStars ? 'brow starcol' : 'brow';
    const rows = (list) => list.map(p => {
      const extra = p.wave !== undefined ? ` · Wave ${p.wave} · ${p.totalKills || 0} kills` : '';
      return `
      <div class="${cls} ${p.id === myId ? 'me' : ''}">
        <div class="av" style="background:${p.color};color:${p.color}"></div>
        <div>${esc(p.name)}${p.bot ? ' <span style="opacity:.5;font-size:10px">BOT</span>' : ''}${extra ? `<small style="opacity:.6">${extra}</small>` : ''}</div>
        <div class="num">${p.kills}</div>
        <div class="num">${p.deaths}</div>
        <div class="num">${p.damage}</div>
        <div class="num">${p.streak}</div>
        ${withStars ? `<div class="num">${p.stars === null || p.stars === undefined
          ? '<span class="delta flat" title="Guest or bot">—</span>'
          : starBadge(p.stars) + (p.capped ? '<span class="capped" title="Nicht unter 0">⌊0⌋</span>' : '')}</div>` : ''}
      </div>`;
    }).join('');
    const head = `<div class="${cls} head"><div></div><div>SPIELER</div><div class="num">K</div><div class="num">T</div><div class="num">DMG</div><div class="num">SERIE</div>${withStars ? '<div class="num">STERNE</div>' : ''}</div>`;
    if (teams > 1) {
      const t0 = board.filter(p => p.team === 0), t1 = board.filter(p => p.team === 1);
      return head +
        `<div class="bteam" style="color:${C.TEAM_COLORS[0]}">TEAM BLAU</div>${rows(t0)}` +
        `<div class="bteam" style="color:${C.TEAM_COLORS[1]}">TEAM ROT</div>${rows(t1)}`;
    }
    return head + rows(board);
  }

  function showScoreboard(on, board, teams, myId) {
    const el = $('scoreboard');
    el.classList.toggle('show', on);
    if (on) el.innerHTML = boardHTML(board, teams, myId);
  }

  function showResult(payload, myId, myTeam) {
    const title = $('result-title');
    let won = false, draw = false;
    if (payload.teams > 1) {
      if (payload.winner === null) draw = true;
      else won = payload.winner === myTeam;
    } else if (payload.mode === 'solo' || payload.mode === 'coop') {
      won = false;
    } else {
      won = payload.winner === myId;
    }
    title.className = 'result-title ' + (draw ? 'draw' : won ? 'win' : 'lose');
    if (payload.mode === 'solo' || payload.mode === 'coop') {
      title.textContent = payload.mode === 'coop' ? 'TEAM WIPED' : 'DEFEATED';
      $('result-sub').textContent = payload.mapName + ' · Wave ' + (payload.wave || 0) + ' · ' + (payload.kills || 0) + ' zombies killed';
      const dp = $('result-dp');
      if (payload.dpEarned !== undefined) {
        dp.style.display = '';
        dp.innerHTML = `Earned <b>${new Intl.NumberFormat().format(payload.dpEarned)} DP</b> this match · Total: <b>${new Intl.NumberFormat().format(payload.dpTotal || 0)} DP</b>`;
      } else {
        dp.style.display = 'none';
      }
      $('btn-result-skills').style.display = 'block';
    } else {
      $('result-dp').style.display = 'none';
      $('btn-result-skills').style.display = 'none';
      title.textContent = draw ? 'DRAW' : won ? 'VICTORY' : 'DEFEAT';
      const sub = payload.teams > 1
        ? `${payload.mapName} · ${C.MODES[payload.mode].name} · ${payload.teamScore[0]} : ${payload.teamScore[1]}`
        : `${payload.mapName} · ${C.MODES[payload.mode].name}`;
      $('result-sub').textContent = sub;
    }
    $('result-board').innerHTML = boardHTML(payload.board, payload.teams, myId, payload.mode === 'solo');
    show('scr-result');
    if (draw) SFX.ui(true); else won ? SFX.win() : SFX.lose();
  }

  /* ---------- Waffenwahl aus drei Angeboten ---------- */
  let pickTimer = 0;
  let onPick = null;

  function weaponPicker(choices, seconds, callback) {
    const box = $('pickbox');
    if (!box) return;
    onPick = callback;
    const host = $('pick-cards');
    host.innerHTML = '';
    box.classList.add('show');
    box.classList.remove('done');
    $('pick-hint').textContent = 'No pick = a random one of the three';

    choices.forEach((key, i) => {
      const w = C.WEAPONS[key];
      if (!w) return;
      const card = document.createElement('button');
      card.className = 'pick-card tier' + w.tier;
      card.style.animationDelay = (i * 0.09) + 's';
      card.innerHTML =
        `<span class="p-ico">${w.icon}</span>` +
        `<span class="p-name">${esc(w.name)}</span>` +
        `<div class="p-bars">` +
        bar('Schaden', w.projectile === 'rocket' ? w.blastDmg : w.dmg * (w.pellets || 1), 100) +
        bar('Reichweite', w.range, 1100) +
        bar('Tempo', C.SPEED * w.speedMult, C.SPEED * 1.06) +
        `</div>` +
        `<div class="p-stats">` +
        w.pros.map(p => `<span class="pro">+ ${esc(p)}</span>`).join('') +
        w.cons.map(c => `<span class="con">− ${esc(c)}</span>`).join('') +
        `</div>`;
      card.onclick = () => choose(key, card);
      host.appendChild(card);
    });

    function bar(label, val, max) {
      const pct = Math.max(4, Math.min(100, (val / max) * 100));
      return `<div class="p-bar"><span>${label}</span><i><b style="width:${pct}%"></b></i></div>`;
    }

    function choose(key, card) {
      if (box.classList.contains('done')) return;
      box.classList.add('done');
      [...host.children].forEach(c => c.classList.toggle('chosen', c === card));
      $('pick-hint').textContent = C.WEAPONS[key].name + ' picked';
      SFX.pickup();
      if (onPick) onPick(key);
      setTimeout(() => box.classList.remove('show'), 1100);
    }

    // Restzeit anzeigen
    clearInterval(pickTimer);
    let left = Math.max(1, Math.round(seconds));
    $('pick-timer').textContent = left;
    pickTimer = setInterval(() => {
      left--;
      $('pick-timer').textContent = Math.max(0, left);
      if (left <= 0) {
        clearInterval(pickTimer);
        box.classList.remove('show');
      }
    }, 1000);
  }

  function pickerOpen() {
    const box = $('pickbox');
    return !!box && box.classList.contains('show');
  }

  /** Wenn der Server eine Waffe zuteilt (Zeit abgelaufen). */
  function pickerAssigned(key) {
    const box = $('pickbox');
    if (!box) return;
    clearInterval(pickTimer);
    box.classList.remove('show');
    void key;
  }

  /* ---------- Konto + Bestenliste ---------- */
  function renderAccount(st) {
    void st;
  }

  function starBadge(n) {
    const s = n > 0 ? '+' + n : String(n);
    const cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
    return `<span class="delta ${cls}">${s} ★</span>`;
  }

  function renderBoard(payload) {
    void payload;
  }

  /** Dauerhafter Hinweis, wenn kein Spielserver erreichbar ist. */
  function serverNotice(show, target) {
    const el = $('server-notice');
    if (!el) return;
    el.classList.toggle('show', !!show);
    if (show) $('notice-target').textContent = target || '—';
  }

  function setConn(on) {
    [['chip-status', 'conn-text'], ['chip-status2', 'conn-text2']].forEach(([c, t]) => {
      const chip = $(c);
      if (!chip) return;
      chip.classList.toggle('on', on);
      chip.classList.toggle('off', !on);
      $(t).textContent = on ? 'connected' : 'offline';
    });
  }
  function setPing(ms, jitter) {
    const el = $('chip-ping');
    if (!el) return;
    el.textContent = jitter > 6 ? `${ms} ms ±${jitter}` : `${ms} ms`;
    el.classList.toggle('warn', ms > 120 || jitter > 25);
  }

  function tick(dt) {
    if (current !== 'scr-game') drawBg(dt);
    if (current === 'scr-settings') settingsLive();
    if (current === 'scr-prematch') {
      // Uhr weiterlaufen lassen, auch zwischen zwei Nachrichten
      if (radDaten && phaseLast === 'wheel') radDaten.rest = Math.max(0, radDaten.rest - dt);
      wheelTick();
    }
  }

  /* ---------- Skill Tree ---------- */
  let onSkillBuy = null;
  function setOnSkillBuy(fn) { onSkillBuy = fn; }

  function renderSkills(profile, weapon) {
    weapon = weapon || 'ak47';
    const dp = profile ? (profile.damagePoints || 0) : 0;
    const owned = profile ? (profile.upgrades || []) : [];
    $('dp-amount').textContent = dp;

    const host = $('skill-tree');
    host.innerHTML = '';

    const CANVAS = 2400;
    const isShotgun = weapon === 'shotgun';
    const BRANCH_ORDER = isShotgun
      ? ['breacher', 'slugger', 'juggernaut']
      : ['spreader', 'destroyer', 'survivor'];
    const treeArray = isShotgun ? (C.UPGRADE_TREE_SHOTGUN || C.UPGRADE_TREE) : C.UPGRADE_TREE;
    const iconMap = isShotgun ? (C.UPGRADE_ICONS_SHOTGUN || C.UPGRADE_ICONS) : C.UPGRADE_ICONS;
    const rootLabel = isShotgun ? 'PUMP GUN' : 'AK-47';
    const all = treeArray.map(id => C.UPGRADES[id]).filter(Boolean);

    const byBranch = {};
    for (const up of all) {
      if (!byBranch[up.branch]) byBranch[up.branch] = [];
      byBranch[up.branch].push(up);
    }
    for (const b of Object.keys(byBranch)) byBranch[b].sort((a, b) => a.tier - b.tier);

    const angles = isShotgun
      ? { breacher: 200 * Math.PI / 180, slugger: 340 * Math.PI / 180, juggernaut: 90 * Math.PI / 180 }
      : { spreader: 200 * Math.PI / 180, destroyer: 340 * Math.PI / 180, survivor: 90 * Math.PI / 180 };
    const tierDist = [110, 200, 300, 410, 530, 660, 800, 950]; // 8 tiers
    const cx = CANVAS / 2;
    const cy = CANVAS / 2;

    // SVG overlay for lines
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('class', 'st-svg');
    svg.setAttribute('viewBox', '0 0 ' + CANVAS + ' ' + CANVAS);
    host.appendChild(svg);

    // Root node
    const root = document.createElement('div');
    root.className = 'st-node root';
    root.style.left = (cx - 60) + 'px';
    root.style.top = (cy - 60) + 'px';
    root.innerHTML = `<img class="st-root-ico" src="/img/icons/pistol.png" alt=""><span class="st-label">${rootLabel}</span><span class="st-tier">ALWAYS ACTIVE</span>`;
    host.appendChild(root);

    for (const key of BRANCH_ORDER) {
      const ups = byBranch[key] || [];
      const a = angles[key];
      const prevNodes = [{ x: cx, y: cy }];

      for (let i = 0; i < ups.length; i++) {
        const up = ups[i];
        const dist = tierDist[i];
        const nx = cx + Math.cos(a) * dist;
        const ny = cy - Math.sin(a) * dist;

        const isOwned = owned.includes(up.id);
        const prevTier = up.tier > 1 ? all.find(u => u.branch === up.branch && u.tier === up.tier - 1) : null;
        const prereqMet = !prevTier || owned.includes(prevTier.id);
        const canAfford = dp >= up.cost && prereqMet && !isOwned;

        const node = document.createElement('div');
        const cls = ['st-node', 'tier'];
        if (isOwned) cls.push('owned');
        else if (canAfford) cls.push('affordable');
        else cls.push('locked');
        node.className = cls.join(' ');
        node.style.left = (nx - 43) + 'px';
        node.style.top = (ny - 43) + 'px';
        node.style.animationDelay = (i * 0.08) + 's';

        const iconName = iconMap[up.id] || 'bullet';
        node.innerHTML =
          `<img class="st-ico" src="/img/icons/${iconName}.png" alt="">` +
          `<span class="st-label">${esc(up.name)}</span>` +
          `<span class="st-tier-badge">T${up.tier}</span>`;

        node.addEventListener('mouseenter', (e) => showDetail(e, up, isOwned, canAfford));
        node.addEventListener('mouseleave', hideDetail);

        if (canAfford) {
          node.addEventListener('click', (e) => {
            e.stopPropagation();
            if (onSkillBuy) onSkillBuy(up.id);
            hideDetail();
          });
        }

        host.appendChild(node);

        const prev = prevNodes[prevNodes.length - 1];
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', prev.x);
        line.setAttribute('y1', prev.y);
        line.setAttribute('x2', nx);
        line.setAttribute('y2', ny);
        if (isOwned) line.setAttribute('class', 'owned');
        else line.setAttribute('class', 'chain');
        svg.appendChild(line);

        prevNodes.push({ x: nx, y: ny });
      }
    }

    // ---- Pan / drag (set up once) ----
    const vp = $('st-viewport');
    let tx = 0, ty = 0, dragging = false, sx, sy, ox, oy;

    if (!vp._panReady) {
      vp._panReady = true;
      vp.onmousedown = (e) => {
        if (e.target.closest('.st-node')) return;
        e.preventDefault();
        dragging = true;
        sx = e.clientX; sy = e.clientY;
        ox = tx; oy = ty;
        vp.classList.add('grabbing');
        host.classList.add('nopan');
      };
      window.addEventListener('mousemove', (e) => {
        if (!dragging || UI.currentScreen() !== 'scr-skills') return;
        tx = ox + (e.clientX - sx);
        ty = oy + (e.clientY - sy);
        host.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
      });
      window.addEventListener('mouseup', () => {
        if (!dragging) return;
        dragging = false;
        vp.classList.remove('grabbing');
        host.classList.remove('nopan');
      });
      window.addEventListener('resize', () => {
        if (UI.currentScreen() === 'scr-skills') centerView();
      });
    }

    function centerView() {
      const vr = vp.getBoundingClientRect();
      if (!vr.width || !vr.height) return;
      tx = vr.width / 2 - cx;
      ty = vr.height / 2 - cy;
      host.style.transform = 'translate(' + tx + 'px,' + ty + 'px)';
    }

    // Delay until layout is painted (screen transition may still be running)
    setTimeout(() => {
      centerView();
      // Also recenter on first render even if viewport didn't have size yet
      if (!tx && !ty) { const vr = vp.getBoundingClientRect(); if (vr.width) centerView(); }
    }, 80);

    // ---- Detail tooltip ----
    let detailEl = document.getElementById('st-detail');
    if (!detailEl) {
      detailEl = document.createElement('div');
      detailEl.id = 'st-detail';
      detailEl.className = 'st-detail';
      document.body.appendChild(detailEl);
    }

    function showDetail(e, up, isOwned, canAfford) {
      detailEl.innerHTML =
        `<div class="st-d-name">${esc(up.name)}</div>` +
        `<div class="st-d-desc">${esc(up.desc)}</div>` +
        (isOwned
          ? `<div class="st-d-cost owned">OWNED</div>`
          : `<div class="st-d-cost">${new Intl.NumberFormat().format(up.cost)} DP</div>` +
            (canAfford ? `<button class="st-d-buy">BUY</button>` : ''));
      detailEl.classList.add('show');

      const b = detailEl.querySelector('.st-d-buy');
      if (b) b.onclick = (ev) => { ev.stopPropagation(); if (onSkillBuy) onSkillBuy(up.id); hideDetail(); };

      let dx = e.clientX + 24;
      let dy = e.clientY + 24;
      if (dx + 270 > window.innerWidth) dx = e.clientX - 270;
      if (dy + 200 > window.innerHeight) dy = e.clientY - 200;
      detailEl.style.left = Math.max(10, dx) + 'px';
      detailEl.style.top = Math.max(10, dy) + 'px';
    }

    function hideDetail() {
      detailEl.classList.remove('show');
    }
  }

  function updateDpCounter(amount) {
    const el = $('dp-hud');
    if (!el) return;
    el.classList.toggle('show', true);
    $('dp-hud-num').textContent = amount;
  }

  /* ---------- Weapon Selection ---------- */
  const WS_KEY = 'lcw_selectedWeapon';
  function getSelectedWeapon() {
    if (isLocal) return null;
    return localStorage.getItem(WS_KEY) || null;
  }
  function setSelectedWeapon(w) {
    if (isLocal) return;
    localStorage.setItem(WS_KEY, w);
  }

  function showWaveAnnouncement(wave, count) {
    centerMsg('WAVE ' + wave, '#ffd166');
    const el = $('wave-display');
    if (el) { el.textContent = 'WAVE ' + wave + ' · ' + count + ' ZOMBIES'; el.className = 'wave-display live'; }
  }

  function showDowned(show, time) {
    const el = $('downed-overlay');
    if (el) {
      el.style.display = show ? 'flex' : 'none';
      if (show) $('downed-timer').textContent = Math.ceil(time);
    }
  }

  function showRevivePrompt(show, progress) {
    const el = $('revive-prompt');
    if (el) {
      el.style.display = show ? 'flex' : 'none';
      if (show && progress !== undefined) $('revive-fill').style.width = (progress * 100) + '%';
    }
  }

  function renderTeammateHUD(G) {
    const el = $('teammate-hud');
    if (!el) return;
    let html = '';
    for (const p of G.players.values()) {
      if (!p.visible || p.id === G.myId || p.zombie) continue;
      const cls = p.downed ? ' downed' : '';
      const hpPct = p.hpMax ? Math.max(0, Math.round(p.hp / p.hpMax * 100)) : 0;
      html += '<div class="teammate-card' + cls + '">';
      html += '<span class="teammate-name">' + UI.esc(p.name || 'Player') + '</span>';
      html += '<div class="teammate-hp-bar"><i class="teammate-hp-fill" style="width:' + hpPct + '%"></i></div>';
      if (p.downed) html += '<span style="color:#ef4444;font-size:9px">DOWNED</span>';
      else html += '<span style="font-size:9px;color:var(--dim)">' + hpPct + '%</span>';
      html += '</div>';
    }
    el.innerHTML = html;
  }

  return {
    $, show, currentScreen, toast, skin, saveSkin,
    wireSettings, renderSettings,
    renderPhase, onPhaseVote,
    get name() { return profileName; },
    set name(v) { profileName = v; },
    renderRoom, addChat, updateHUD, setScorePlate, killfeed, centerMsg, reconnecting,
    setWeapon, setGrenades, reloadBar, weaponPicker, pickerAssigned, pickerOpen,
    respawnUI, hitmark, showScoreboard, showResult, setConn, setPing, serverNotice,
    updateWave, renderSkills, setOnSkillBuy, updateDpCounter,
    renderAccount, renderBoard, starBadge, tick, esc,
    showWaveAnnouncement, showDowned, showRevivePrompt, renderTeammateHUD,
    get room() { return roomState; },
    getSelectedWeapon, setSelectedWeapon
  };
})();
