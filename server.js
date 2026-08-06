/* NEON STRIKE - Server: statisches Hosting, WebSocket-Lobbys, Match-Loop. */
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { WebSocketServer } = require('ws');

const C = require('./shared/constants.js');
const MAPS = require('./shared/maps.js');
const { Match } = require('./server/match.js');
const { botName } = require('./server/bots.js');
const { verifyIdToken } = require('./server/auth.js');
const STARS = require('./server/stars.js');

const PORT = process.env.PORT || 3000;
// Projekt, dessen ID-Tokens akzeptiert werden (muss zur Client-Config passen)
const AUTH_PROJECT = process.env.AUTH_PROJECT || 'nosershooter';
const app = express();
app.use(express.static(path.join(__dirname, 'public'), { maxAge: 0 }));
app.use('/shared', express.static(path.join(__dirname, 'shared'), { maxAge: 0 }));
// Firebase-SDK lokal ausliefern - kein CDN noetig, Spiel bleibt LAN-tauglich
app.use('/vendor/firebase', express.static(path.join(__dirname, 'node_modules', 'firebase'), { maxAge: '1h' }));
app.get('/health', (_req, res) => res.json({ ok: true, rooms: rooms.size, players: clients.size }));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map();     // code -> Room
const clients = new Map();   // id -> Client
const sessions = new Map();  // Sitzungsschluessel -> Client, fuer Wiederaufnahme
let CLIENT_ID = 1;

/* Dauer der Vorbereitungsphasen. Tests setzen den Faktor herunter, sonst
   wartet jeder Durchlauf 18 Sekunden auf Kartenwahl, Sperre und Waffenwahl. */
const PHASE_SCALE = Number(process.env.PHASE_SCALE || 1);

/* Wie lange ein Platz nach einem Verbindungsabriss reserviert bleibt. Lang
   genug fuer einen Tunnel-Neustart oder ein kurzes Funkloch, kurz genug, dass
   eine Lobby nicht ewig von Karteileichen blockiert wird. */
const RECONNECT_GRACE = Number(process.env.RECONNECT_GRACE || 60000);
// Ohne ein einziges Lebenszeichen so lange -> Verbindung gilt als tot
const SILENCE_TIMEOUT = Number(process.env.SILENCE_TIMEOUT || 40000);

function send(ws, obj) {
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify(obj)); } catch (_) { /* ignore */ }
  }
}

function sanitizeName(n) {
  n = String(n || '').replace(/[^\p{L}\p{N} _.\-]/gu, '').trim().slice(0, 14);
  return n || 'Player';
}

function sanitizeSkin(s) {
  s = s || {};
  const hex = /^#[0-9a-fA-F]{6}$/;
  return {
    color: hex.test(s.color) ? s.color : '#5c7a2e',
    trail: hex.test(s.trail) ? s.trail : '#ffd166',
    pattern: C.SKIN_PATTERNS.includes(s.pattern) ? s.pattern : 'solid'
  };
}

function newCode() {
  let code;
  let guard = 0;
  do {
    code = String(Math.floor(Math.random() * 900000) + 100000);
  } while (rooms.has(code) && guard++ < 5000);
  return code;
}

class Room {
  constructor(host) {
    this.code = newCode();
    this.hostId = host.id;
    this.members = new Map();
    this.mode = 'ffa';
    this.state = 'lobby';
    this.match = null;
    this.mapId = null;
    this.snapAcc = 0;
    this.lastResult = null;
    /* Vorbereitung vor dem Match: Kartenwahl, Waffensperre, Waffenwahl.
       Laeuft im Raum, nicht im Match - die Karte steht ja erst am Ende der
       ersten Phase fest, vorher gibt es gar kein Match. */
    this.phase = null;        // 'vote' | 'wheel' | 'pick'
    this.phaseT = 0;
    this.mapChoices = [];
    this.mapVotes = new Map();   // Spieler-ID -> Karten-ID
    this.banned = [];
    this.picks = new Map();      // Spieler-ID -> Waffe
    rooms.set(this.code, this);
    this.add(host);
  }

  get humans() { return [...this.members.values()].filter(m => !m.bot); }

  add(client) {
    if (this.members.size >= C.MAX_PLAYERS) return false;
    client.roomCode = this.code;
    this.members.set(client.id, client);
    this.autoTeam(client);
    return true;
  }

  autoTeam(m) {
    if (C.MODES[this.mode].teams === 1) { m.team = 0; return; }
    const counts = [0, 0];
    for (const o of this.members.values()) if (o !== m) counts[o.team || 0]++;
    m.team = counts[0] <= counts[1] ? 0 : 1;
  }

  remove(id) {
    const m = this.members.get(id);
    if (!m) return;
    this.members.delete(id);
    if (this.match) this.match.removePlayer(id);
    if (m.bot) { /* nichts */ }
    if (this.hostId === id) {
      const next = this.humans[0];
      if (next) this.hostId = next.id;
    }
    if (this.humans.length === 0) {
      rooms.delete(this.code);
      return;
    }
    this.broadcastRoom();
    if (this.match && this.state === 'match') {
      const alive = [...this.match.players.values()];
      if (alive.length <= 1) this.match.end(alive[0] ? alive[0].id : null);
    }
  }

  addBot() {
    if (this.members.size >= C.MAX_PLAYERS) return;
    const hues = ['#a8322f', '#2f4a7a', '#a08b4f', '#6b4a9c', '#3f7d8c', '#c2a05a'];
    const bot = {
      id: CLIENT_ID++, ws: null, bot: true,
      name: botName(),
      skin: { color: hues[Math.floor(Math.random() * hues.length)], trail: '#ffffff', pattern: C.SKIN_PATTERNS[Math.floor(Math.random() * C.SKIN_PATTERNS.length)] },
      team: 0, ready: true
    };
    this.members.set(bot.id, bot);
    this.autoTeam(bot);
    this.broadcastRoom();
  }

  setMode(mode) {
    if (!C.MODES[mode]) return;
    this.mode = mode;
    const cfg = C.MODES[mode];
    // Teams neu verteilen
    const list = [...this.members.values()];
    if (cfg.teams === 1) list.forEach(m => { m.team = 0; });
    else list.forEach((m, i) => { m.team = i % 2; });
    this.broadcastRoom();
  }

  setTeam(id, team) {
    const m = this.members.get(id);
    if (!m || C.MODES[this.mode].teams === 1) return;
    m.team = team ? 1 : 0;
    this.broadcastRoom();
  }

  canStart() {
    const cfg = C.MODES[this.mode];
    const n = this.members.size;
    if (n < cfg.min) return `At least ${cfg.min} players needed`;
    if (n > cfg.max) return `At most ${cfg.max} players in ${cfg.name}`;
    if (cfg.teams > 1) {
      const counts = [0, 0];
      for (const m of this.members.values()) counts[m.team]++;
      if (counts[0] !== cfg.perTeam || counts[1] !== cfg.perTeam) {
        return `Teams have to be ${cfg.perTeam} vs ${cfg.perTeam}`;
      }
    }
    return null;
  }

  /** Was sich seit dem Kartenstart veraendert hat, als Paare [Feld, Wert].
      Der Client erzeugt die Karte selbst aus der ID - es muessen also nur die
      Sprengungen uebertragen werden. */
  tileDiff() {
    const frisch = MAPS.generate(this.mapId).tiles;
    const jetzt = this.match.map.tiles;
    const out = [];
    for (let i = 0; i < jetzt.length; i++) if (jetzt[i] !== frisch[i]) out.push(i, jetzt[i]);
    return out;
  }

  /** Alles, was ein Client braucht, um das Match aufzubauen. Wird beim Start
      verschickt und noch einmal, wenn jemand nach einem Abriss zurueckkommt. */
  matchInfo(member, resumed) {
    const sim = this.match.players.get(member.id);
    return {
      t: C.MSG.MATCH,
      mapId: this.mapId,
      mapName: MAPS.generate(this.mapId).name,
      mode: this.mode,
      countdown: resumed ? 0 : C.COUNTDOWN,
      resumed: !!resumed,
      you: member.id,
      /* Keine Auswahl mehr im Match: gewaehlt wird in der Vorbereitung,
         bevor die Karte ueberhaupt geladen ist. */
      choices: [],
      banned: this.banned,
      // Nur die gesprengten Felder nachreichen, nicht die ganze Karte
      tiles: resumed ? this.tileDiff() : undefined,
      players: [...this.members.values()].map(m => {
        const s = this.match.players.get(m.id);
        return {
          id: m.id, name: m.name, color: m.skin.color, trail: m.skin.trail,
          pattern: m.skin.pattern, team: m.team, bot: !!m.bot,
          weapon: s ? s.weaponKey : 'pistol',
          // Gekaufter Skin mit eigener Bewegung, falls angelegt
          fx: m.uid ? (STARS.get(m.uid).skin || '') : ''
        };
      })
    };
  }

  /* ---------------- Vorbereitung ----------------
     Drei Phasen nacheinander, jede mit eigener Uhr. Bots stimmen sofort ab,
     damit eine Runde mit Bots nicht auf Zeitablauf warten muss. */

  start() {
    const err = this.canStart();
    if (err) return err;
    this.beginVote();
    return null;
  }

  /** Phase 1: drei Karten zur Wahl. */
  beginVote() {
    this.state = 'prematch';
    this.phase = 'vote';
    this.phaseT = C.PREMATCH.VOTE_TIME * PHASE_SCALE;
    this.mapVotes.clear();
    this.picks.clear();
    this.banned = [];

    // Drei verschiedene Karten ziehen
    const alle = [];
    for (let i = 0; i < MAPS.count; i++) alle.push(i);
    this.mapChoices = [];
    for (let i = 0; i < C.PREMATCH.MAP_CHOICES && alle.length; i++) {
      this.mapChoices.push(alle.splice(Math.floor(Math.random() * alle.length), 1)[0]);
    }
    for (const m of this.members.values()) {
      if (m.bot) this.mapVotes.set(m.id, this.mapChoices[Math.floor(Math.random() * this.mapChoices.length)]);
    }
    this.broadcastPhase();
  }

  /** Phase 2: zwei Glücksräder drehen je eine Waffe heraus, die wegfaellt.
      Der Server wuerfelt sofort und schickt das Ergebnis mit - der Client
      laesst die Raeder nur noch sichtbar darauf zulaufen. So kann kein
      Client ein anderes Ergebnis anzeigen als die anderen. */
  beginWheel() {
    // Karte mit den meisten Stimmen; bei Gleichstand entscheidet der Zufall
    const zaehler = new Map();
    for (const id of this.mapVotes.values()) zaehler.set(id, (zaehler.get(id) || 0) + 1);
    let best = -1, sieger = [];
    for (const wahl of this.mapChoices) {
      const n = zaehler.get(wahl) || 0;
      if (n > best) { best = n; sieger = [wahl]; }
      else if (n === best) sieger.push(wahl);
    }
    this.mapId = sieger[Math.floor(Math.random() * sieger.length)];

    // Zwei verschiedene Waffen ziehen, aber nie so viele, dass zu wenig bleibt
    const topf = C.WEAPON_ORDER.slice();
    const anzahl = Math.min(C.PREMATCH.BANS, Math.max(0, topf.length - 3));
    this.banned = [];
    for (let i = 0; i < anzahl; i++) {
      this.banned.push(topf.splice(Math.floor(Math.random() * topf.length), 1)[0]);
    }

    this.phase = 'wheel';
    this.phaseT = C.PREMATCH.WHEEL_TIME * PHASE_SCALE;
    this.broadcastPhase();
  }

  /** Phase 3: freie Waffenwahl aus allem, was nicht gesperrt ist. */
  beginPick() {
    this.phase = 'pick';
    this.phaseT = C.PREMATCH.PICK_TIME * PHASE_SCALE;
    for (const m of this.members.values()) {
      if (m.bot) this.picks.set(m.id, this.zufallsWaffe());
    }
    this.broadcastPhase();
  }

  zufallsWaffe() {
    const erlaubt = C.WEAPON_ORDER.filter(w => !this.banned.includes(w));
    return erlaubt[Math.floor(Math.random() * erlaubt.length)];
  }

  /** Stand der laufenden Phase an alle schicken. */
  broadcastPhase() {
    for (const m of this.humans) send(m.ws, this.phasePayload(m));
    this.broadcastRoom();
  }

  phasePayload(member) {
    const p = {
      t: C.MSG.PHASE,
      phase: this.phase,
      time: Math.max(0, Math.round(this.phaseT * 10) / 10,),
      mode: this.mode,
      players: [...this.members.values()].map(m => ({ id: m.id, name: m.name, bot: !!m.bot }))
    };
    if (this.phase === 'vote') {
      p.maps = this.mapChoices.map(id => ({ id, name: MAPS.generate(id).name }));
      p.votes = this.mapChoices.map(id => [...this.mapVotes.values()].filter(v => v === id).length);
      p.you = this.mapVotes.get(member.id);
      p.gesamt = this.members.size;
    } else if (this.phase === 'wheel') {
      p.mapId = this.mapId;
      p.mapName = MAPS.generate(this.mapId).name;
      p.weapons = C.WEAPON_ORDER;
      p.banned = this.banned;          // Ergebnis steht schon fest
      p.dauer = C.PREMATCH.WHEEL_TIME * PHASE_SCALE;
    } else if (this.phase === 'pick') {
      p.mapId = this.mapId;
      p.mapName = MAPS.generate(this.mapId).name;
      p.banned = this.banned;
      p.you = this.picks.get(member.id);
      p.taken = [...this.members.values()].map(m => ({ id: m.id, w: this.picks.get(m.id) || null }));
    }
    return p;
  }

  /** Stimme entgegennehmen. Der Server prueft die Phase, nicht der Client. */
  vote(client, wahl) {
    if (this.state !== 'prematch') return;
    if (this.phase === 'vote') {
      const id = Number(wahl);
      if (!this.mapChoices.includes(id)) return;
      this.mapVotes.set(client.id, id);
    } else if (this.phase === 'pick') {
      if (!C.WEAPON_ORDER.includes(wahl) || this.banned.includes(wahl)) return;
      this.picks.set(client.id, wahl);
    } else return;      // Waehrend der Glücksräder gibt es nichts zu waehlen
    this.broadcastPhase();
    // Wenn alle gewaehlt haben, muss niemand die Uhr abwarten
    const stimmen = this.phase === 'vote' ? this.mapVotes : this.picks;
    if (stimmen.size >= this.members.size) this.phaseT = Math.min(this.phaseT, 1.2);
  }

  stepPhase(dt) {
    if (this.state !== 'prematch') return;
    const vorher = Math.ceil(this.phaseT);
    this.phaseT -= dt;
    if (Math.ceil(this.phaseT) !== vorher && this.phaseT > 0) this.broadcastPhase();
    if (this.phaseT > 0) return;
    if (this.phase === 'vote') this.beginWheel();
    else if (this.phase === 'wheel') this.beginPick();
    else this.startMatch();
  }

  startMatch() {
    this.match = new Match(this, this.mode, this.mapId);
    for (const m of this.members.values()) {
      this.match.addPlayer(m);
      // Wer nichts gewaehlt hat, bekommt eine erlaubte Waffe zugelost
      const w = this.picks.get(m.id) || this.zufallsWaffe();
      this.match.forceWeapon(m.id, w);
    }
    this.phase = null;
    this.state = 'match';
    for (const m of this.humans) send(m.ws, this.matchInfo(m, false));
  }

  onMatchEnd(match) {
    const board = match.scoreboard();
    const teams = match.mode.teams;

    // Sterne verteilen: Rang nach Kills, obere Haelfte gewinnt, untere verliert
    const entries = board.map((p, i) => {
      const member = this.members.get(p.id);
      return {
        uid: member && !member.bot ? member.uid : null,
        name: p.name,
        rank: i + 1,
        kills: p.kills,
        deaths: p.deaths,
        wonTeam: teams > 1 && match.winner !== null && p.team === match.winner
      };
    });
    const awards = STARS.award(entries);

    const boardWithStars = board.map((p, i) => {
      const member = this.members.get(p.id);
      const a = member && member.uid ? awards.get(member.uid) : null;
      return {
        ...p, rank: i + 1,
        stars: a ? a.delta : null, total: a ? a.after : null, capped: a ? a.capped : false,
        gold: a ? a.gold : null, goldTotal: a ? a.goldTotal : null
      };
    });

    this.lastResult = {
      t: C.MSG.END,
      winner: match.winner,
      mode: this.mode,
      teams,
      teamScore: match.teamScore,
      board: boardWithStars,
      mapName: match.map.name
    };
    setTimeout(() => {
      for (const m of this.humans) {
        send(m.ws, this.lastResult);
        if (m.uid) send(m.ws, { t: C.MSG.ME, profile: STARS.publicProfile(m.uid) });
      }
      this.state = 'lobby';
      this.match = null;
      this.broadcastRoom();
    }, 2200);
  }

  roomPayload() {
    return {
      t: C.MSG.ROOM,
      code: this.code,
      host: this.hostId,
      mode: this.mode,
      state: this.state,
      maxPlayers: C.MAX_PLAYERS,
      canStart: this.canStart(),
      members: [...this.members.values()].map(m => ({
        id: m.id, name: m.name, skin: m.skin, team: m.team, bot: !!m.bot, host: m.id === this.hostId,
        stars: m.uid ? STARS.get(m.uid).stars : null, guest: !m.bot && !m.uid
      }))
    };
  }

  broadcastRoom() {
    const p = this.roomPayload();
    for (const m of this.humans) send(m.ws, p);
  }

  chat(from, text) {
    text = String(text || '').slice(0, 120).trim();
    if (!text) return;
    const msg = { t: C.MSG.CHAT, name: from.name, color: from.skin.color, text, ts: Date.now() };
    for (const m of this.humans) send(m.ws, msg);
  }

  update(dt) {
    if (this.state === 'prematch') { this.stepPhase(dt); return; }
    if (!this.match) return;
    this.match.step(dt);
    this.snapAcc += dt;
    const interval = 1 / C.SNAP_RATE;
    if (this.snapAcc >= interval) {
      this.snapAcc -= interval;
      for (const m of this.humans) {
        if (this.match) send(m.ws, this.match.snapshotFor(m.id));
      }
      if (this.match) this.match.clearEvents();
    }
  }
}

/* ---------------- WebSocket ---------------- */

wss.on('connection', (ws, req) => {
  const client = {
    id: CLIENT_ID++, ws, bot: false,
    name: 'Player', skin: sanitizeSkin({}), team: 0, roomCode: null, alive: true,
    uid: null, authName: '',
    session: crypto.randomBytes(16).toString('hex'),
    lastSeen: Date.now(), goneAt: 0
  };
  clients.set(client.id, client);
  sessions.set(client.session, client);
  void req;
  send(ws, { t: C.MSG.HELLO, id: client.id, session: client.session, maxPlayers: C.MAX_PLAYERS, modes: C.MODES, authProject: AUTH_PROJECT });

  /* Die Verbindung kann waehrend des Spiels auf einen anderen Datensatz
     umgehaengt werden (Wiederaufnahme). Deshalb immer ueber wsOwner gehen und
     nicht ueber die Variable client, sonst landen Eingaben nach dem
     Wiederverbinden beim alten, leeren Datensatz. */
  let wsOwner = client;

  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw); } catch (_) { return; }
    wsOwner.lastSeen = Date.now();
    if (msg.t === C.MSG.HELLO && msg.session && msg.session !== wsOwner.session) {
      const resumed = resume(msg.session, ws, wsOwner);
      if (resumed) { wsOwner = resumed; return; }
    }
    handle(wsOwner, msg);
  });

  ws.on('close', () => {
    if (wsOwner.ws !== ws) return;          // Verbindung wurde schon uebernommen
    /* Nicht sofort aus dem Raum werfen. Ein kurzer Aussetzer - Funkloch,
       Tunnel-Neustart, Browser-Tab im Hintergrund - hat vorher gereicht, um
       mitten im Match endgueltig rauszufliegen: der Client verband sich neu,
       bekam eine neue ID und war in keinem Raum mehr. Auf dem Bildschirm
       blieb das letzte Bild stehen. Jetzt bleibt der Platz reserviert. */
    wsOwner.ws = null;
    wsOwner.goneAt = Date.now();
  });

  ws.on('pong', () => { wsOwner.alive = true; wsOwner.lastSeen = Date.now(); });
});

/** Eine neue Verbindung an einen bestehenden Spieler haengen. */
function resume(session, ws, temp) {
  const old = sessions.get(session);
  if (!old || old === temp || !clients.has(old.id)) return null;

  // Alte Verbindung sauber schliessen, falls sie noch offen sein sollte
  if (old.ws && old.ws !== ws) { try { old.ws.close(); } catch (_) {} }
  old.ws = ws;
  old.alive = true;
  old.lastSeen = Date.now();
  old.goneAt = 0;

  // Den frisch angelegten Platzhalter wieder abraeumen
  sessions.delete(temp.session);
  clients.delete(temp.id);

  send(ws, {
    t: C.MSG.HELLO, id: old.id, session: old.session,
    maxPlayers: C.MAX_PLAYERS, modes: C.MODES, authProject: AUTH_PROJECT, resumed: true
  });

  const room = rooms.get(old.roomCode);
  if (room) {
    send(ws, room.roomPayload());
    if (room.state === 'match' && room.match) send(ws, room.matchInfo(old, true));
    else if (room.lastResult) send(ws, room.lastResult);
  }
  if (old.uid) send(ws, { t: C.MSG.ME, profile: STARS.publicProfile(old.uid) });
  console.log(`  Spieler ${old.id} (${old.name}) wieder verbunden`);
  return old;
}

function handle(client, msg) {
  const M = C.MSG;
  const room = rooms.get(client.roomCode);

  switch (msg.t) {
    case M.HELLO:
      client.name = sanitizeName(msg.name);
      client.skin = sanitizeSkin(msg.skin);
      if (room) room.broadcastRoom();
      break;

    case M.PING:
      send(client.ws, { t: M.PONG, ts: msg.ts });
      break;

    case M.AUTH: {
      // Abmelden
      if (!msg.idToken) {
        client.uid = null; client.authName = '';
        send(client.ws, { t: M.ME, profile: null });
        if (room) room.broadcastRoom();
        break;
      }
      verifyIdToken(msg.idToken, AUTH_PROJECT).then(u => {
        client.uid = u.uid;
        client.authName = u.name;
        if (u.name) client.name = sanitizeName(u.name);
        STARS.touch(u.uid, u.name, u.picture);
        send(client.ws, { t: M.ME, profile: STARS.publicProfile(u.uid), name: client.name });
        const r = rooms.get(client.roomCode);
        if (r) r.broadcastRoom();
      }).catch(e => {
        client.uid = null;
        send(client.ws, { t: M.ERROR, msg: 'Sign-in rejected: ' + e.message });
        send(client.ws, { t: M.ME, profile: null });
      });
      break;
    }

    case M.BOARDREQ:
      send(client.ws, {
        t: M.BOARD,
        list: STARS.leaderboard(C.STARS.LEADERBOARD_SIZE),
        you: client.uid ? STARS.publicProfile(client.uid) : null
      });
      break;

    case M.CREATE: {
      if (room) room.remove(client.id);
      client.name = sanitizeName(msg.name || client.name);
      client.skin = sanitizeSkin(msg.skin || client.skin);
      const r = new Room(client);
      if (msg.mode && C.MODES[msg.mode]) r.mode = msg.mode;
      r.broadcastRoom();
      break;
    }

    case M.JOIN: {
      const code = String(msg.code || '').replace(/\D/g, '').slice(0, C.CODE_LEN);
      const target = rooms.get(code);
      if (!target) return send(client.ws, { t: M.ERROR, msg: 'No room with that code' });
      if (target.state === 'match') return send(client.ws, { t: M.ERROR, msg: 'Match already running' });
      if (target.members.size >= C.MAX_PLAYERS) return send(client.ws, { t: M.ERROR, msg: 'Lobby is full (6/6)' });
      if (room) room.remove(client.id);
      client.name = sanitizeName(msg.name || client.name);
      client.skin = sanitizeSkin(msg.skin || client.skin);
      target.add(client);
      target.broadcastRoom();
      break;
    }

    case M.LEAVE:
      if (room) { room.remove(client.id); client.roomCode = null; }
      break;

    case M.CHAT:
      if (room) room.chat(client, msg.text);
      break;

    case M.SETUP:
      if (room && room.hostId === client.id && room.state === 'lobby') room.setMode(msg.mode);
      break;

    case M.TEAM:
      if (!room) break;
      if (room.hostId === client.id) room.setTeam(msg.id, msg.team);
      else if (msg.id === client.id) room.setTeam(client.id, msg.team);
      break;

    case M.ADDBOT:
      if (room && room.hostId === client.id && room.state === 'lobby') room.addBot();
      break;

    case M.KICK:
      if (room && room.hostId === client.id && msg.id !== client.id) {
        const victim = room.members.get(msg.id);
        if (victim && !victim.bot) {
          send(victim.ws, { t: M.ERROR, msg: 'You were removed from the lobby', kicked: true });
          victim.roomCode = null;
        }
        room.remove(msg.id);
      }
      break;

    case M.START: {
      if (!room || room.hostId !== client.id || room.state !== 'lobby') break;
      const err = room.start();
      if (err) send(client.ws, { t: M.ERROR, msg: err });
      break;
    }

    case M.INPUT:
      if (room && room.match) room.match.setInput(client.id, msg);
      break;

    case M.PICK:
      if (room && room.match) room.match.pickWeapon(client.id, msg.w);
      break;

    // Stimme in der Vorbereitung: Karte, Waffensperre oder Waffenwahl
    case M.VOTE:
      if (room) room.vote(client, msg.v);
      break;

    case M.SHOP:
      send(client.ws, {
        t: M.SHOP,
        skins: C.SHOP_SKINS,
        profile: client.uid ? STARS.publicProfile(client.uid) : null
      });
      break;

    case M.BUY: {
      if (!client.uid) {
        send(client.ws, { t: M.ERROR, msg: 'You have to be signed in to buy' });
        break;
      }
      const r = STARS.buySkin(client.uid, String(msg.id || ''));
      if (!r.ok) send(client.ws, { t: M.ERROR, msg: r.grund });
      else {
        send(client.ws, { t: M.ME, profile: r.profil });
        send(client.ws, { t: M.SHOP, skins: C.SHOP_SKINS, profile: r.profil });
      }
      break;
    }

    case M.EQUIP: {
      if (!client.uid) break;
      const r = STARS.equipSkin(client.uid, String(msg.id || ''));
      if (!r.ok) send(client.ws, { t: M.ERROR, msg: r.grund });
      else {
        send(client.ws, { t: M.ME, profile: r.profil });
        /* Auch der Shop muss es erfahren, sonst steht auf der Karte weiter
           "Equip", obwohl die Farbe laengst anliegt. */
        send(client.ws, { t: M.SHOP, skins: C.SHOP_SKINS, profile: r.profil });
        const rr = rooms.get(client.roomCode);
        if (rr) rr.broadcastRoom();
      }
      break;
    }
  }
}

/* ---------------- Loop ---------------- */

let last = Date.now();
setInterval(() => {
  const now = Date.now();
  let dt = (now - last) / 1000;
  last = now;
  if (dt > 0.25) dt = 0.25;
  for (const room of rooms.values()) {
    try { room.update(dt); } catch (e) { console.error('room update', e); }
  }
}, 1000 / C.TICK_RATE);

/* Verbindungen pruefen und abgelaufene Plaetze freigeben.

   Frueher galt eine Verbindung schon als tot, wenn ein einziges Pong ausblieb.
   Ueber einen Tunnel oder in einem Hintergrund-Tab passiert das leicht - der
   Spieler flog mitten im Match raus, obwohl seine Daten weiter ankamen.
   Massgeblich ist jetzt, wann zuletzt ueberhaupt etwas empfangen wurde; der
   Client meldet sich alle zwei Sekunden mit einem Ping. */
setInterval(() => {
  const now = Date.now();
  for (const c of clients.values()) {
    if (c.bot) continue;
    if (c.ws) {
      if (now - c.lastSeen > SILENCE_TIMEOUT) {
        try { c.ws.terminate(); } catch (_) {}
        c.ws = null;
        c.goneAt = now;
        continue;
      }
      try { c.ws.ping(); } catch (_) {}
      continue;
    }
    // Ohne Verbindung: Platz noch eine Weile halten, dann raeumen
    if (c.goneAt && now - c.goneAt > RECONNECT_GRACE) {
      const room = rooms.get(c.roomCode);
      if (room) room.remove(c.id);
      sessions.delete(c.session);
      clients.delete(c.id);
      console.log(`  Spieler ${c.id} (${c.name}) endgueltig entfernt`);
    }
  }
}, 5000);

/* Erst die Bestenliste einlesen, dann Verbindungen annehmen - sonst koennte
   ein frueher Spieler eine leere Liste sehen und mit 0 Sternen ueberschrieben
   werden. */
STARS.init().catch(e => console.warn('  Bestenliste:', e.message)).then(() => {
  server.listen(PORT, () => {
    console.log(`\n  NEON STRIKE laeuft`);
    console.log(`  Lokal:  http://localhost:${PORT}`);
    const nets = require('os').networkInterfaces();
    for (const name of Object.keys(nets)) {
      for (const net of nets[name] || []) {
        if (net.family === 'IPv4' && !net.internal) console.log(`  LAN:    http://${net.address}:${PORT}   (${name})`);
      }
    }
    console.log('');
  });
});
