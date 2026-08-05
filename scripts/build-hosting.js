/* Baut dist/ fuer Firebase Hosting.
   Hosting liefert nur statische Dateien aus - deshalb muessen shared/ und die
   Firebase-Bundles, die sonst der Node-Server ausliefert, mit hineinkopiert
   werden. Die Serveradresse fuer WebSockets wird in config.js eingetragen. */
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

// Firebase-SDK: nur die zwei Bundles, die index.html laedt
const fbSrc = path.join(ROOT, 'node_modules', 'firebase');
const fbDst = path.join(DIST, 'vendor', 'firebase');
fs.mkdirSync(fbDst, { recursive: true });
let sdkFiles = 0;
for (const f of ['firebase-app-compat.js', 'firebase-auth-compat.js', 'firebase-analytics-compat.js']) {
  const s = path.join(fbSrc, f);
  if (!fs.existsSync(s)) {
    console.error(`FEHLT: ${s}\n  -> "npm install" ausfuehren`);
    process.exit(1);
  }
  fs.copyFileSync(s, path.join(fbDst, f));
  sdkFiles++;
}

// Serveradresse eintragen
const cfgPath = path.join(DIST, 'js', 'config.js');
let cfg = fs.readFileSync(cfgPath, 'utf8');
// Zeilenanfang verankern - im Kommentar darueber steht ein Beispiel mit
// derselben Zuweisung, das darf nicht getroffen werden.
const re = /^window\.GAME_SERVER\s*=\s*'[^']*';/m;
if (!re.test(cfg)) {
  console.error('config.js: Zuweisung "window.GAME_SERVER = ...;" am Zeilenanfang nicht gefunden');
  process.exit(1);
}
cfg = cfg.replace(re, `window.GAME_SERVER = '${GAME_SERVER}';`);
fs.writeFileSync(cfgPath, cfg);

function count(dir) {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    n += e.isDirectory() ? count(path.join(dir, e.name)) : 1;
  }
  return n;
}

console.log(`dist/ gebaut: ${count(DIST)} Dateien, ${sdkFiles} Firebase-Bundles`);
console.log(GAME_SERVER
  ? `Spielserver: ${GAME_SERVER}`
  : 'Spielserver: gleiche Domain (nur sinnvoll, wenn alles auf Cloud Run laeuft)\n' +
    '  Fuer Hosting + Cloud Run:  npm run build:hosting -- --server=DEINE-CLOUDRUN-URL');
