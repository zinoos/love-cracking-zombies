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
  // Uniformfarben - militaerisch, aber klar unterscheidbar
  const PALETTE = ['#5c7a2e', '#2f5d3a', '#a08b4f', '#c2a05a', '#2f4a7a', '#3f7d8c', '#a8322f', '#6b4a9c', '#4a5560', '#cfd8e3'];
  const skin = loadSkin();
  let profileName = localStorage.getItem('ns_name') || '';

  function loadSkin() {
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
    localStorage.setItem('ns_skin', JSON.stringify(skin));
    localStorage.setItem('ns_name', profileName);
  }
  function hsl2hex(h) {
    const f = n => {
      const k = (n + h / 30) % 12, a = .55 * Math.min(.62, 1 - .62);
      const c = .62 - a * Math.max(-1, Math.min(k - 3, Math.min(9 - k, 1)));
      return Math.round(255 * c).toString(16).padStart(2, '0');
    };
    return '#' + f(0) + f(8) + f(4);
  }

  function buildSkinUI() {
    const mkSwatches = (host, key, slider) => {
      host.innerHTML = '';
      PALETTE.forEach(col => {
        const b = document.createElement('button');
        b.className = 'sw' + (skin[key] === col ? ' sel' : '');
        b.style.background = col; b.style.color = col;
        b.onclick = () => {
          skin[key] = col;
          [...host.children].forEach(c => c.classList.remove('sel'));
          b.classList.add('sel');
          SFX.ui(true);
        };
        host.appendChild(b);
      });
      slider.oninput = () => {
        skin[key] = hsl2hex(+slider.value);
        [...host.children].forEach(c => c.classList.remove('sel'));
      };
    };
    mkSwatches($('sw-body'), 'color', $('hue-body'));
    mkSwatches($('sw-trail'), 'trail', $('hue-trail'));

    const prow = $('pattern-row');
    prow.innerHTML = '';
    const labels = { solid: 'EINFARBIG', stripe: 'STREIFEN', dots: 'FLECKTARN', ring: 'RANGSTREIFEN', shard: 'SPLITTERTARN' };
    C.SKIN_PATTERNS.forEach(p => {
      const b = document.createElement('button');
      b.className = 'pat' + (skin.pattern === p ? ' sel' : '');
      b.textContent = labels[p] || p;
      b.onclick = () => {
        skin.pattern = p;
        [...prow.children].forEach(c => c.classList.remove('sel'));
        b.classList.add('sel');
        SFX.ui(true);
      };
      prow.appendChild(b);
    });
  }

  const skinCv = $('skin-cv');
  const skinCtx = skinCv.getContext('2d');
  let skinT = 0;
  function drawSkinPreview(dt) {
    skinT += dt;
    const w = skinCv.width, h = skinCv.height;
    skinCtx.clearRect(0, 0, w, h);
    // Plattform
    skinCtx.save();
    skinCtx.translate(w / 2, h / 2 + 22);
    skinCtx.strokeStyle = 'rgba(63,208,255,.22)';
    skinCtx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      skinCtx.globalAlpha = .5 - i * .13;
      skinCtx.beginPath();
      skinCtx.ellipse(0, 30, 78 + i * 22 + Math.sin(skinT * 1.4 + i) * 4, 26 + i * 8, 0, 0, 7);
      skinCtx.stroke();
    }
    skinCtx.globalAlpha = 1;
    skinCtx.restore();

    // Spur-Partikel
    for (let i = 0; i < 26; i++) {
      const a = skinT * .8 + i * (Math.PI * 2 / 26);
      const rr = 92 + Math.sin(skinT * 1.7 + i) * 10;
      const x = w / 2 + Math.cos(a) * rr, y = h / 2 + 20 + Math.sin(a) * rr * .34;
      skinCtx.globalAlpha = .25 + .35 * Math.abs(Math.sin(a * 2 + skinT));
      skinCtx.fillStyle = skin.trail;
      skinCtx.beginPath(); skinCtx.arc(x, y, 2.4, 0, 7); skinCtx.fill();
    }
    skinCtx.globalAlpha = 1;

    const ang = Math.sin(skinT * .55) * 0.75;
    RENDER.drawAvatar(skinCtx, w / 2, h / 2 - 10, 74, skin, ang, skinT);

    skinCtx.font = '600 12px Rajdhani, sans-serif';
    skinCtx.fillStyle = 'rgba(160,190,225,.7)';
    skinCtx.textAlign = 'center';
    skinCtx.fillText((profileName || 'Spieler').toUpperCase(), w / 2, h - 26);
    skinCtx.textAlign = 'left';
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
        b.innerHTML = `${m.short}<small>${m.key === 'ffa' ? 'bis 6' : m.perTeam * 2 + ' Spieler'}</small>`;
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
        k.className = 'kick'; k.textContent = '✕'; k.title = 'Entfernen';
        k.onclick = () => NET.send({ t: C.MSG.KICK, id: m.id });
        row.appendChild(k);
      }
      list.appendChild(row);
    });

    $('host-tools').style.display = isHost ? 'flex' : 'none';
    const startBtn = $('btn-start');
    startBtn.style.display = isHost ? 'block' : 'none';
    startBtn.disabled = !!r.canStart;
    startBtn.textContent = r.canStart ? r.canStart.toUpperCase() : 'MATCH STARTEN';
    $('lobby-err').textContent = isHost ? '' : 'Warte auf den Host…';
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
    const pct = (hp / C.HP_MAX) * 100;
    const fill = $('hp-fill');
    fill.style.width = pct + '%';
    fill.classList.toggle('low', pct <= 30);
    $('hp-num').textContent = Math.round(hp);
    if (hp < lastHp - 0.5) {
      const v = $('dmg-vig');
      v.style.opacity = Math.min(.85, (1 - hp / C.HP_MAX) * .9 + .2);
      setTimeout(() => { v.style.opacity = 0; }, 160);
    }
    lastHp = hp;

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
      if (left > 0) cloak.textContent = `UNSICHTBAR ${left.toFixed(1)}s`;
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

  function boardHTML(board, teams, myId, withStars) {
    const cls = withStars ? 'brow starcol' : 'brow';
    const rows = (list) => list.map(p => `
      <div class="${cls} ${p.id === myId ? 'me' : ''}">
        <div class="av" style="background:${p.color};color:${p.color}"></div>
        <div>${esc(p.name)}${p.bot ? ' <span style="opacity:.5;font-size:10px">BOT</span>' : ''}</div>
        <div class="num">${p.kills}</div>
        <div class="num">${p.deaths}</div>
        <div class="num">${p.damage}</div>
        <div class="num">${p.streak}</div>
        ${withStars ? `<div class="num">${p.stars === null || p.stars === undefined
          ? '<span class="delta flat" title="Gast oder Bot">—</span>'
          : starBadge(p.stars) + (p.capped ? '<span class="capped" title="Nicht unter 0">⌊0⌋</span>' : '')}</div>` : ''}
      </div>`).join('');
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
    } else {
      won = payload.winner === myId;
    }
    title.className = 'result-title ' + (draw ? 'draw' : won ? 'win' : 'lose');
    title.textContent = draw ? 'UNENTSCHIEDEN' : won ? 'SIEG' : 'NIEDERLAGE';
    const sub = payload.teams > 1
      ? `${payload.mapName} · ${C.MODES[payload.mode].name} · ${payload.teamScore[0]} : ${payload.teamScore[1]}`
      : `${payload.mapName} · ${C.MODES[payload.mode].name}`;
    $('result-sub').textContent = sub;
    $('result-board').innerHTML = boardHTML(payload.board, payload.teams, myId, true);
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
    $('pick-hint').textContent = 'Keine Wahl = zufällige der drei';

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
      $('pick-hint').textContent = C.WEAPONS[key].name + ' gewählt';
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
    const photo = $('acct-photo');
    const name = $('acct-name');
    const stars = $('acct-stars');
    const out = $('btn-signout');
    if (!name) return;
    // Der Knopf ist immer da: angemeldet -> abmelden, als Gast -> anmelden
    out.style.display = '';
    if (st.signedIn) {
      name.textContent = st.name;
      photo.src = st.photo || '';
      photo.style.display = st.photo ? 'block' : 'none';
      stars.textContent = '★ ' + (st.profile ? st.profile.stars : 0);
      stars.style.display = '';
      out.textContent = 'Abmelden';
      out.dataset.action = 'signout';
      $('chip-rank').textContent = st.profile && st.profile.rank
        ? `Platz ${st.profile.rank} von ${st.profile.totalPlayers}`
        : 'noch kein Platz';
    } else {
      name.textContent = 'Gast';
      photo.style.display = 'none';
      stars.style.display = 'none';
      out.textContent = 'Anmelden';
      out.dataset.action = 'signin';
      $('chip-rank').textContent = 'Gast — keine Sterne';
    }
  }

  function starBadge(n) {
    const s = n > 0 ? '+' + n : String(n);
    const cls = n > 0 ? 'up' : n < 0 ? 'down' : 'flat';
    return `<span class="delta ${cls}">${s} ★</span>`;
  }

  function renderBoard(payload) {
    const list = payload.list || [];
    const host = $('lb-list');
    host.innerHTML = list.map(p => `
      <div class="brow lb-row ${payload.you && p.uid === payload.you.uid ? 'me' : ''}">
        <div class="lb-rank r${p.rank <= 3 ? p.rank : ''}">${p.rank}</div>
        <div>${p.photo ? `<img class="lb-photo" src="${esc(p.photo)}" alt="" />` : '<span class="lb-photo ph"></span>'}</div>
        <div class="lb-name">${esc(p.name)}${p.matches === 0 ? '<span class="lb-demo">NOCH KEIN SPIEL</span>' : ''}</div>
        <div class="num lb-stars">${p.stars}</div>
        <div class="num">${p.wins}</div>
        <div class="num">${p.matches}</div>
        <div class="num">${p.deaths ? (p.kills / p.deaths).toFixed(2) : p.kills.toFixed(2)}</div>
      </div>`).join('');
    $('lb-empty').style.display = list.length ? 'none' : 'block';

    const you = $('board-you');
    if (payload.you) {
      const y = payload.you;
      you.style.display = 'flex';
      you.innerHTML =
        `<div class="you-rank">${y.rank ? '#' + y.rank : '—'}</div>` +
        `<div class="you-main"><b>${esc(y.name || 'Du')}</b>` +
        `<span>${y.matches} Spiele · ${y.wins} Siege · Bestwert ★ ${y.best}</span></div>` +
        `<div class="you-stars">★ ${y.stars}</div>`;
    } else {
      you.style.display = 'flex';
      you.innerHTML = '<div class="you-main"><b>Nicht angemeldet</b>' +
        '<span>Als Gast werden keine Sterne gezählt.</span></div>';
    }

    // Beispielverteilung fuer die aktuelle Lobbygroesse zeigen
    const ex = $('star-example');
    if (ex) {
      ex.innerHTML = [2, 4, 6].map(n => {
        const row = [];
        for (let r = 1; r <= n; r++) row.push(starBadge(C.starDelta(r, n, false)));
        return `<div class="ex-row"><span class="ex-n">${n} Spieler</span>${row.join('')}</div>`;
      }).join('');
    }
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
      $(t).textContent = on ? 'verbunden' : 'getrennt';
    });
  }
  function setPing(ms, jitter) {
    const el = $('chip-ping');
    // Schwankung mit anzeigen - sie ist fuer das Spielgefuehl wichtiger als der Ping
    el.textContent = jitter > 6 ? `${ms} ms ±${jitter}` : `${ms} ms`;
    el.classList.toggle('warn', ms > 120 || jitter > 25);
  }

  function tick(dt) {
    if (current !== 'scr-game') drawBg(dt);
    if (current === 'scr-skins') drawSkinPreview(dt);
  }

  return {
    $, show, currentScreen, toast, skin, buildSkinUI, saveSkin,
    get name() { return profileName; },
    set name(v) { profileName = v; },
    renderRoom, addChat, updateHUD, setScorePlate, killfeed, centerMsg, reconnecting,
    setWeapon, setGrenades, reloadBar, weaponPicker, pickerAssigned, pickerOpen,
    respawnUI, hitmark, showScoreboard, showResult, setConn, setPing, serverNotice,
    renderAccount, renderBoard, starBadge, tick, esc,
    get room() { return roomState; }
  };
})();
