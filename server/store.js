const fs = require('fs');
const path = require('path');

const DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const FILE = path.join(DIR, 'players.json');

function loadAll() {
  try {
    const raw = fs.readFileSync(FILE, 'utf8');
    return new Map(Object.entries(JSON.parse(raw)));
  } catch (e) {
    return new Map();
  }
}

function saveMany(records) {
  try {
    const map = new Map();
    try { const raw = fs.readFileSync(FILE, 'utf8'); for (const [k, v] of Object.entries(JSON.parse(raw))) map.set(k, v); } catch (_) {}
    for (const rec of records) map.set(rec.uid, rec);
    fs.mkdirSync(DIR, { recursive: true });
    const tmp = FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(map)), 'utf8');
    fs.renameSync(tmp, FILE);
  } catch (e) {
    console.warn('store saveMany failed:', e.message);
  }
}

module.exports = { available: () => false, loadAll, saveMany };
