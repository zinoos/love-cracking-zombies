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
    p = {
      uid, name: '', photo: '', stars: 0, matches: 0, wins: 0, kills: 0, deaths: 0,
      best: 0, last: 0, gold: 0, owned: '', skin: ''
    };
    players.set(uid, p);
    dirty.add(uid);
  }
  /* Aeltere Eintraege kennen Gold und Shop noch nicht. Beim ersten Zugriff
     ergaenzen, damit der Rest des Codes sich nicht darum kuemmern muss. */
  if (p.gold === undefined) { p.gold = 0; dirty.add(uid); }
  if (p.owned === undefined) { p.owned = ''; dirty.add(uid); }
  if (p.skin === undefined) { p.skin = ''; dirty.add(uid); }
  // Freunde kamen spaeter dazu - alte Eintraege haben die Felder nicht
  if (p.friends === undefined) { p.friends = ''; dirty.add(uid); }
  if (p.reqIn === undefined) { p.reqIn = ''; dirty.add(uid); }
  if (p.reqOut === undefined) { p.reqOut = ''; dirty.add(uid); }
  return p;
}

/** Gekaufte Skins als Liste. Gespeichert wird ein Text, damit ein Eintrag in
    Firestore ein flaches Feld bleibt. */
function ownedList(p) {
  return String(p.owned || '').split(',').filter(Boolean);
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
 * Sterne und Gold nach einem Match verteilen.
 * @param entries [{uid, name, rank, kills, deaths, wonTeam}] - rank 1-basiert
 * @returns Map uid -> {before, delta, after, capped, gold, goldTotal}
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
    // Gold gibt es immer - auch fuer den letzten Platz
    const gold = C.goldFor(e.rank, total, e.kills || 0, !!e.wonTeam);
    p.gold = (p.gold || 0) + gold;
    p.matches++;
    p.kills += e.kills || 0;
    p.deaths += e.deaths || 0;
    if (e.rank === 1) p.wins++;
    if (after > p.best) p.best = after;
    dirty.add(e.uid);
    out.set(e.uid, { before, delta, after, capped, rank: e.rank, gold, goldTotal: p.gold });
  }
  save();
  return out;
}

/* ---------------- Skinshop ---------------- */

/** Kaufversuch. Gibt {ok, grund, profil} zurueck - der Server entscheidet. */
function buySkin(uid, id) {
  const skin = C.SHOP_SKINS.find(s => s.id === id);
  if (!skin) return { ok: false, grund: 'Unbekannter Skin' };
  const p = get(uid);
  const besitzt = ownedList(p);
  if (besitzt.includes(id)) return { ok: false, grund: 'Gehoert dir schon' };
  if ((p.gold || 0) < skin.price) {
    return { ok: false, grund: `Zu wenig Gold - ${skin.price - (p.gold || 0)} fehlen` };
  }
  p.gold -= skin.price;
  besitzt.push(id);
  p.owned = besitzt.join(',');
  p.skin = id;                     // frisch gekauft = direkt anlegen
  dirty.add(uid);
  save();
  return { ok: true, profil: publicProfile(uid) };
}

/** Gekauften Skin anlegen oder mit leerer Kennung wieder ablegen. */
function equipSkin(uid, id) {
  const p = get(uid);
  if (id && !ownedList(p).includes(id)) return { ok: false, grund: 'Nicht gekauft' };
  p.skin = id || '';
  dirty.add(uid);
  save();
  return { ok: true, profil: publicProfile(uid) };
}

/* ---------------- Freunde ----------------

   Die drei Listen liegen wie owned als Textfeld, damit ein Spieler in
   Firestore ein einziges flaches Dokument bleibt. friends ist beidseitig:
   jede Aenderung fasst immer beide Eintraege an, sonst haette einer einen
   Freund, der ihn nicht kennt. */

const liste = (p, feld) => String(p[feld] || '').split(',').filter(Boolean);

function setzeListe(uid, p, feld, werte) {
  p[feld] = [...new Set(werte)].join(',');
  dirty.add(uid);
}

/** Kurzprofil fuer die Freundesliste - nie das ganze Konto herausgeben. */
function kurz(uid) {
  const p = players.get(uid);
  return {
    uid,
    name: (p && p.name) || 'Player',
    photo: (p && p.photo) || '',
    stars: (p && p.stars) || 0
  };
}

/** Alles, was ein Client ueber seine Freunde wissen darf. */
function friendState(uid) {
  const p = get(uid);
  return {
    friends: liste(p, 'friends').map(kurz),
    incoming: liste(p, 'reqIn').map(kurz),
    outgoing: liste(p, 'reqOut').map(kurz)
  };
}

/** Anfrage stellen. Hat der andere schon angefragt, wird daraus sofort eine
    Freundschaft - sonst haengen zwei Anfragen ueber Kreuz und keiner kommt
    weiter. */
function request(vonUid, zuUid) {
  if (!zuUid || vonUid === zuUid) return { ok: false, grund: 'Not possible' };
  const a = get(vonUid), b = get(zuUid);
  if (liste(a, 'friends').includes(zuUid)) return { ok: false, grund: 'Already friends' };

  if (liste(a, 'reqIn').includes(zuUid)) return accept(vonUid, zuUid);
  if (liste(a, 'reqOut').includes(zuUid)) return { ok: false, grund: 'Request already sent' };

  if (liste(a, 'friends').length >= C.FRIENDS.MAX) return { ok: false, grund: 'Your friend list is full' };
  if (liste(b, 'friends').length >= C.FRIENDS.MAX) return { ok: false, grund: 'Their friend list is full' };
  if (liste(b, 'reqIn').length >= C.FRIENDS.REQ_MAX) return { ok: false, grund: 'They have too many requests' };

  setzeListe(vonUid, a, 'reqOut', [...liste(a, 'reqOut'), zuUid]);
  setzeListe(zuUid, b, 'reqIn', [...liste(b, 'reqIn'), vonUid]);
  save();
  return { ok: true, beide: [vonUid, zuUid], art: 'request' };
}

function accept(uid, anderer) {
  const a = get(uid), b = get(anderer);
  if (!liste(a, 'reqIn').includes(anderer)) return { ok: false, grund: 'No such request' };
  setzeListe(uid, a, 'reqIn', liste(a, 'reqIn').filter(x => x !== anderer));
  setzeListe(anderer, b, 'reqOut', liste(b, 'reqOut').filter(x => x !== uid));
  setzeListe(uid, a, 'friends', [...liste(a, 'friends'), anderer]);
  setzeListe(anderer, b, 'friends', [...liste(b, 'friends'), uid]);
  save();
  return { ok: true, beide: [uid, anderer], art: 'accept' };
}

function decline(uid, anderer) {
  const a = get(uid), b = get(anderer);
  setzeListe(uid, a, 'reqIn', liste(a, 'reqIn').filter(x => x !== anderer));
  setzeListe(anderer, b, 'reqOut', liste(b, 'reqOut').filter(x => x !== uid));
  save();
  return { ok: true, beide: [uid, anderer], art: 'decline' };
}

/** Eigene Anfrage zuruecknehmen - Gegenstueck zu decline. */
function cancel(uid, anderer) {
  const a = get(uid), b = get(anderer);
  setzeListe(uid, a, 'reqOut', liste(a, 'reqOut').filter(x => x !== anderer));
  setzeListe(anderer, b, 'reqIn', liste(b, 'reqIn').filter(x => x !== uid));
  save();
  return { ok: true, beide: [uid, anderer], art: 'cancel' };
}

function removeFriend(uid, anderer) {
  const a = get(uid), b = get(anderer);
  setzeListe(uid, a, 'friends', liste(a, 'friends').filter(x => x !== anderer));
  setzeListe(anderer, b, 'friends', liste(b, 'friends').filter(x => x !== uid));
  save();
  return { ok: true, beide: [uid, anderer], art: 'remove' };
}

/** Sind die beiden befreundet? Fuer den Beitritt zur Lobby eines Freundes. */
function areFriends(a, b) {
  return liste(get(a), 'friends').includes(b);
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
    best: p.best, rank: r.rank, totalPlayers: r.total,
    gold: p.gold || 0, owned: ownedList(p), skin: p.skin || ''
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

module.exports = {
  init, get, touch, award, leaderboard, rankOf, publicProfile, save,
  buySkin, equipSkin, ownedList,
  friendState, request, accept, decline, cancel, removeFriend, areFriends
};
