  /* Baut dist/ fuer statisches Hosting.
    Kopiert public/ und shared/ in dist/ und traegt die Serveradresse ein. */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');

const serverArg = process.argv.slice(2).find(a => a.startsWith('--server='));
const GAME_SERVER = serverArg ? serverArg.split('=').slice(1).join('=').trim() : '';

function rimraf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyDir(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else fs.copyFileSync(s, d);
  }
}

rimraf(DIST);
copyDir(path.join(ROOT, 'public'), DIST);
copyDir(path.join(ROOT, 'shared'), path.join(DIST, 'shared'));

// Serveradresse eintragen
const cfgPath = path.join(DIST, 'js', 'config.js');
let cfg = fs.readFileSync(cfgPath, 'utf8');
const re = /^window\.GAME_SERVER\s*=\s*'[^']*';/m;
if (!re.test(cfg)) {
  console.error('config.js: Zuweisung "window.GAME_SERVER = ...;" am Zeilenanfang nicht gefunden');
  process.exit(1);
}
cfg = cfg.replace(re, `window.GAME_SERVER = '${GAME_SERVER}';`);

// Firebase config inject — only replace if env vars are set
if (process.env.FIREBASE_API_KEY) cfg = cfg.replace(/apiKey:\s*"[^"]*"/, `apiKey: "${process.env.FIREBASE_API_KEY}"`);
if (process.env.FIREBASE_PROJECT_ID) cfg = cfg.replace(/projectId:\s*"[^"]*"/, `projectId: "${process.env.FIREBASE_PROJECT_ID}"`);
if (process.env.FIREBASE_APP_ID) cfg = cfg.replace(/appId:\s*"[^"]*"/, `appId: "${process.env.FIREBASE_APP_ID}"`);
if (process.env.FIREBASE_SENDER_ID) cfg = cfg.replace(/messagingSenderId:\s*"[^"]*"/, `messagingSenderId: "${process.env.FIREBASE_SENDER_ID}"`);

fs.writeFileSync(cfgPath, cfg);

function count(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? count(path.join(dir, e.name)) : 1;
  }
  return n;
}

console.log(`dist/ gebaut: ${count(DIST)} Dateien`);
console.log(GAME_SERVER
  ? `Spielserver: ${GAME_SERVER}`
  : 'Spielserver: gleiche Domain (nur sinnvoll, wenn alles auf einem Server laeuft)\n' +
    '  Fuer getrenntes Hosting:  npm run build:hosting -- --server=DEINE-SERVER-URL');
