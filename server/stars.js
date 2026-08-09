const C = require('../shared/constants.js');
const store = require('./store');

let players = new Map();
const dirty = new Set();

function loadFile() {
  players = new Map();
}

async function init() {
  save();
}

let saveTimer = null;
function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; save(); }, 5000);
}

async function save() {
  if (!store.available() || !dirty.size) return;
  for (const uid of dirty) {
    const p = players.get(uid);
    if (p) {
      await store.savePlayer(uid, {
        name: p.name,
        stars: p.stars,
        matches: p.matches,
        wins: p.wins,
        kills: p.kills,
        deaths: p.deaths,
        best: p.best,
        damagePoints: p.damagePoints,
        upgrades: p.upgrades
      });
    }
    dirty.delete(uid);
  }
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
  scheduleSave();
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
  if (store.available()) {
    store.addUpgrade(uid, upgradeId);
    store.setDamagePoints(uid, p.damagePoints);
  }
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
  scheduleSave();
  return p.damagePoints;
}

async function loadPlayer(uid) {
  if (uid.startsWith('guest_')) return null;
  if (!store.available()) return null;
  const profile = await store.getPlayer(uid);
  if (!profile) return null;
  const p = {
    uid: profile.uid,
    name: profile.name || '',
    photo: '',
    stars: profile.stars || 0,
    matches: profile.matches || 0,
    wins: profile.wins || 0,
    kills: profile.kills || 0,
    deaths: profile.deaths || 0,
    best: profile.best || 0,
    last: Date.now(),
    damagePoints: profile.damagePoints || 0,
    upgrades: profile.upgrades || []
  };
  players.set(uid, p);
  return p;
}

process.on('exit', async () => { await save(); });

module.exports = {
  init, get, touch, award, leaderboard, rankOf, publicProfile, buyUpgrade, addDp, save, loadPlayer
};
