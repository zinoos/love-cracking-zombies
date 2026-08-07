const fs = require('fs');
const path = require('path');
const C = require('../shared/constants.js');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'players.json');

let players = new Map();
const dirty = new Set();

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
    fs.renameSync(tmp, FILE);
    dirty.clear();
  } catch (e) {
    console.warn('  Bestenliste nicht speicherbar:', e.message);
  }
}

function save() {
  if (dirty.size) saveFile();
  return Promise.resolve();
}

async function init() {
  save();
}

function get(uid) {
  let p = players.get(uid);
  if (!p) {
    const startDp = uid.startsWith('guest_') ? 500000 : 0;
    p = {
      uid, name: '', photo: '', stars: 0, matches: 0, wins: 0, kills: 0, deaths: 0,
      best: 0, last: 0, damagePoints: startDp, upgrades: []
    };
    players.set(uid, p);
    dirty.add(uid);
  }
  return p;
}

function touch(uid, name, photo) {
  const p = get(uid);
  if (name && p.name !== name) { p.name = String(name).slice(0, 32); dirty.add(uid); }
  if (photo && p.photo !== photo) { p.photo = String(photo).slice(0, 300); dirty.add(uid); }
  p.last = Date.now();
  dirty.add(uid);
  return p;
}

function award(entries) {
  const total = entries.length;
  const out = new Map();
  for (const e of entries) {
    if (!e.uid) continue;
    const p = touch(e.uid, e.name);
    const delta = C.starDelta(e.rank, total, !!e.wonTeam);
    const before = p.stars;
    let after = before + delta;
    let capped = false;
    if (after < C.STARS.MIN) { after = C.STARS.MIN; capped = true; }
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

function byRank(a, b) {
  return b.stars - a.stars
    || b.wins - a.wins
    || b.kills - a.kills
    || b.matches - a.matches
    || String(a.name || '').localeCompare(String(b.name || ''));
}

function buyUpgrade(uid, upgradeId) {
  const p = get(uid);
  const up = C.UPGRADES[upgradeId];
  if (!up || p.upgrades.includes(upgradeId)) return { ok: false, reason: 'already owned or invalid' };
  if (up.tier > 1) {
    const prev = Object.values(C.UPGRADES).find(u => u.branch === up.branch && u.tier === up.tier - 1);
    if (prev && !p.upgrades.includes(prev.id)) return { ok: false, reason: 'prerequisite not met' };
  }
  if (p.damagePoints < up.cost) return { ok: false, reason: 'not enough DP' };
  p.damagePoints -= up.cost;
  p.upgrades.push(upgradeId);
  dirty.add(uid);
  save();
  return { ok: true, after: p.damagePoints };
}

function sorted() {
  return [...players.values()].sort(byRank);
}

function leaderboard(limit) {
  const list = sorted().slice(0, limit || C.STARS.LEADERBOARD_SIZE);
  return list.map((p, i) => ({
    rank: i + 1, uid: p.uid, name: p.name || 'Spieler', photo: p.photo,
    stars: p.stars, matches: p.matches, wins: p.wins, kills: p.kills, deaths: p.deaths, best: p.best
  }));
}

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
    damagePoints: p.damagePoints || 0, upgrades: p.upgrades || []
  };
}

function addDp(uid, amount) {
  const p = get(uid);
  if (!amount) return p.damagePoints || 0;
  p.damagePoints = (p.damagePoints || 0) + amount;
  dirty.add(uid);
  save();
  return p.damagePoints;
}

function purgeDemo() {
  let n = 0;
  for (const [uid, p] of players) {
    if (p.demo === true || uid.startsWith('demo:')) { players.delete(uid); dirty.delete(uid); n++; }
  }
  if (n) console.log(`  ${n} Beispieleintraege entfernt`);
}

loadFile();
purgeDemo();

process.on('exit', () => { if (dirty.size) saveFile(); });
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, async () => { await save(); process.exit(0); });
}

module.exports = {
  init, get, touch, award, leaderboard, rankOf, publicProfile, buyUpgrade, addDp, save
};
