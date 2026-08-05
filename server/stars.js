/* Sterne und Bestenliste. Der Server ist alleinige Quelle - Clients melden
   nie eigene Punktestaende, sie bekommen sie nur mitgeteilt.

   Ablage: lokal eine JSON-Datei, in der Cloud Firestore. Der Unterschied ist
   noetig, weil der freie Render-Plan keine Festplatte hat - dort wuerde die
   Datei bei jedem Neustart verschwinden und die Bestenliste jedes Mal bei
   null anfangen. Gespielt wird in beiden Faellen aus derselben Map im
   Speicher, nur Laden und Sichern unterscheiden sich. */
const fs = require('fs');
const path = require('path');
const C = require('../shared/constants.js');
const store = require('./store.js');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'players.json');
const REMOTE = store.available();

let players = new Map();   // uid -> record
const dirty = new Set();   // uids mit ungesicherten Aenderungen
let pending = Promise.resolve();   // laufender Schreibvorgang

function loadFile() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    players = new Map(Object.entries(JSON.parse(raw)));
    console.log(`  Bestenliste geladen: ${players.size} Spieler (Datei)`);
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('  Bestenliste nicht lesbar:', e.message);
    players = new Map();
  }
}

function saveFile() {
  try {
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(players)), 'utf8');
    fs.renameSync(tmp, FILE);   // atomar - kein halb geschriebener Stand
    dirty.clear();
  } catch (e) {
    console.warn('  Bestenliste nicht speicherbar:', e.message);
  }
}

/** Sichern. Bei Firestore asynchron und nur die geaenderten Eintraege.
    Schreibvorgaenge werden aneinandergehaengt: wer wartet, wartet damit auch
    auf einen schon laufenden Vorgang. Ohne diese Kette lieferte save() bei
    laufendem Schreiben sofort ein erfuelltes Promise - der Aufrufer glaubte,
    es sei gesichert, obwohl noch nichts angekommen war. */
function save() {
  if (!REMOTE) {
    if (dirty.size) saveFile();
    return Promise.resolve();
  }
  if (!dirty.size) return pending;
  const batch = [...dirty].map(uid => players.get(uid)).filter(Boolean);
  dirty.clear();
  pending = pending
    .then(() => store.saveMany(batch))
    .catch(e => {
      console.warn('  Bestenliste nicht speicherbar:', e.message);
      for (const rec of batch) dirty.add(rec.uid);   // beim naechsten Takt erneut versuchen
    });
  return pending;
}

/** Beim Start einmal alles einlesen. server.js wartet darauf.
    Bei Dateibetrieb ist beim Import schon geladen - der Aufruf ist dann
    nur noch eine Formsache. */
async function init() {
  if (!REMOTE) { save(); return; }
  try {
    players = await store.loadAll();
    console.log(`  Bestenliste geladen: ${players.size} Spieler (Firestore)`);
  } catch (e) {
    console.warn('  Firestore nicht erreichbar, starte mit leerer Liste:', e.message);
    players = new Map();
  }
  purgeDemo();
  await save();
}

function get(uid) {
  let p = players.get(uid);
  if (!p) {
    p = { uid, name: '', photo: '', stars: 0, matches: 0, wins: 0, kills: 0, deaths: 0, best: 0, last: 0 };
    players.set(uid, p);
    dirty.add(uid);
  }
  return p;
}

/** Namen/Bild aus dem Google-Profil uebernehmen. */
function touch(uid, name, photo) {
  const p = get(uid);
  if (name && p.name !== name) { p.name = String(name).slice(0, 32); dirty.add(uid); }
  if (photo && p.photo !== photo) { p.photo = String(photo).slice(0, 300); dirty.add(uid); }
  p.last = Date.now();
  dirty.add(uid);
  return p;
}

/**
 * Sterne nach einem Match verteilen.
 * @param entries [{uid, name, rank, kills, deaths, wonTeam}] - rank 1-basiert
 * @returns Map uid -> {before, delta, after, capped}
 */
function award(entries) {
  const total = entries.length;
  const out = new Map();
  for (const e of entries) {
    if (!e.uid) continue;                 // Gaeste und Bots sammeln nichts
    const p = touch(e.uid, e.name);
    const delta = C.starDelta(e.rank, total, !!e.wonTeam);
    const before = p.stars;
    let after = before + delta;
    let capped = false;
    if (after < C.STARS.MIN) { after = C.STARS.MIN; capped = true; }   // nie unter 0
    p.stars = after;
    p.matches++;
    p.kills += e.kills || 0;
    p.deaths += e.deaths || 0;
    if (e.rank === 1) p.wins++;
    if (after > p.best) p.best = after;
    dirty.add(e.uid);
    out.set(e.uid, { before, delta, after, capped, rank: e.rank });
  }
  save();
  return out;
}

/* Reihenfolge: Sterne, dann Siege, Kills, Spiele, zuletzt Name.
   Wer angemeldet war, aber noch nicht gespielt hat, steht mit 0 Sternen
   ganz unten - taucht aber auf. */
function byRank(a, b) {
  return b.stars - a.stars
    || b.wins - a.wins
    || b.kills - a.kills
    || b.matches - a.matches
    || String(a.name || '').localeCompare(String(b.name || ''));
}

function sorted() {
  return [...players.values()].sort(byRank);
}

/** Alle je angemeldeten Spieler, nach Sternen sortiert. */
function leaderboard(limit) {
  const list = sorted().slice(0, limit || C.STARS.LEADERBOARD_SIZE);
  return list.map((p, i) => ({
    rank: i + 1, uid: p.uid, name: p.name || 'Spieler', photo: p.photo,
    stars: p.stars, matches: p.matches, wins: p.wins, kills: p.kills, deaths: p.deaths, best: p.best
  }));
}

/** Platz eines Spielers in der Gesamtliste (auch ausserhalb der Top-N). */
function rankOf(uid) {
  const all = sorted();
  const i = all.findIndex(p => p.uid === uid);
  return { rank: i < 0 ? null : i + 1, total: all.length };
}

function publicProfile(uid) {
  const p = players.get(uid);
  if (!p) return null;
  const r = rankOf(uid);
  return {
    uid: p.uid, name: p.name, photo: p.photo, stars: p.stars,
    matches: p.matches, wins: p.wins, kills: p.kills, deaths: p.deaths,
    best: p.best, rank: r.rank, totalPlayers: r.total
  };
}

/** Frueher eingestreute Beispieleintraege entfernen. Echte Firebase-UIDs
    tragen nie das demo-Flag oder das Praefix, koennen also nicht getroffen
    werden. */
function purgeDemo() {
  let n = 0;
  for (const [uid, p] of players) {
    if (p.demo === true || uid.startsWith('demo:')) { players.delete(uid); dirty.delete(uid); n++; }
  }
  if (n) console.log(`  ${n} Beispieleintraege entfernt`);
}

/* Die Datei liegt lokal und ist sofort da - also gleich beim Import lesen.
   Firestore braucht dagegen einen Netzaufruf, das erledigt init(). */
if (!REMOTE) { loadFile(); purgeDemo(); }

setInterval(save, 20000).unref();
/* Beim Herunterfahren nur die Datei - ein Firestore-Schreibvorgang wuerde es
   im exit-Handler ohnehin nicht mehr rechtzeitig hinaus schaffen. Deshalb
   wird oben alle 20 Sekunden gesichert und direkt nach jedem Match. */
process.on('exit', () => { if (!REMOTE && dirty.size) saveFile(); });
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await save(); process.exit(0); });
}

module.exports = { init, get, touch, award, leaderboard, rankOf, publicProfile, save };
