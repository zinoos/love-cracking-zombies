/* Waechter fuer den Betrieb ueber einen Cloudflare-Schnelltunnel.

   Warum es den braucht: ein Schnelltunnel bekommt bei jedem Start eine neue
   Zufallsadresse und stirbt gelegentlich einfach weg - der cloudflared-Prozess
   laeuft dann noch, aber die Adresse antwortet nicht mehr. Auf der Webseite
   steht dann "Kein Spielserver erreichbar", obwohl der Spielserver auf dem PC
   laeuft. Von Hand war das jedes Mal: Tunnel neu starten, neue Adresse in den
   Client schreiben, neu veroeffentlichen.

   Der Waechter macht genau das automatisch:
     1. Spielserver gestartet halten
     2. Tunnel gestartet halten und seine Adresse auslesen
     3. Adresse regelmaessig anpingen - antwortet sie nicht, Tunnel neu starten
     4. Bei neuer Adresse: dist/ neu bauen und zu Firebase Hosting schicken

   Start:  npm run watchdog
   Ende:   Fenster schliessen oder Strg+C - Kindprozesse werden mitgenommen. */
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const https = require('https');
const http = require('http');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.PORT || 3000);
const LOG = path.join(ROOT, 'tunnel.log');
const STATE = path.join(ROOT, '.watchdog.json');

// cloudflared: erst im Projekt suchen, dann im Pfad
const CF = process.env.CLOUDFLARED
  || [path.join(ROOT, 'cloudflared.exe'), path.join(ROOT, 'bin', 'cloudflared.exe')]
    .find(p => fs.existsSync(p))
  || 'cloudflared';

const PRUEF_INTERVALL = 30000;   // wie oft die Adresse geprueft wird
const ANLAUF = 25000;            // so lange darf ein Tunnel zum Starten brauchen

let server = null, tunnel = null, aktuelleAdresse = null, laeuft = true;

const zeit = () => new Date().toLocaleTimeString('de-CH');
const sag = (...a) => console.log(`[${zeit()}]`, ...a);
const schlaf = ms => new Promise(r => setTimeout(r, ms));

/** Eine Adresse anpingen. Gibt true zurueck, wenn /health antwortet. */
function erreichbar(url, timeoutMs) {
  return new Promise(res => {
    const mod = url.startsWith('https') ? https : http;
    const req = mod.get(url + '/health', { timeout: timeoutMs || 12000 }, r => {
      let b = '';
      r.on('data', c => b += c);
      r.on('end', () => {
        try { res(JSON.parse(b).ok === true); } catch (_) { res(false); }
      });
    });
    req.on('timeout', () => { req.destroy(); res(false); });
    req.on('error', () => res(false));
  });
}

/* ---------------- Spielserver ---------------- */

function starteServer() {
  if (server && !server.killed) return;
  sag('Spielserver wird gestartet');
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, stdio: 'inherit', env: process.env
  });
  server.on('exit', code => {
    if (!laeuft) return;
    sag(`Spielserver beendet (Code ${code}) - Neustart in 3 s`);
    server = null;
    setTimeout(starteServer, 3000);
  });
}

/* ---------------- Tunnel ---------------- */

function toeteTunnel() {
  if (!tunnel) return;
  try { tunnel.kill(); } catch (_) { /* schon weg */ }
  tunnel = null;
  // Uebriggebliebene Prozesse abraeumen - ein toter Tunnel haelt den Namen sonst
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/IM', 'cloudflared.exe'], { stdio: 'ignore' });
  } else {
    spawnSync('pkill', ['-f', 'cloudflared'], { stdio: 'ignore' });
  }
}

/** Tunnel starten und auf seine Adresse warten. */
async function starteTunnel() {
  toeteTunnel();
  try { fs.rmSync(LOG, { force: true }); } catch (_) { /* egal */ }
  sag('Tunnel wird gestartet');
  tunnel = spawn(CF, ['tunnel', '--url', `http://localhost:${PORT}`, '--logfile', LOG], {
    cwd: ROOT, stdio: 'ignore'
  });
  tunnel.on('error', e => sag('cloudflared laesst sich nicht starten:', e.message));

  const bis = Date.now() + ANLAUF;
  while (Date.now() < bis) {
    await schlaf(800);
    let text = '';
    try { text = fs.readFileSync(LOG, 'utf8'); } catch (_) { continue; }
    const treffer = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/g);
    if (!treffer || !treffer.length) continue;
    const url = treffer[treffer.length - 1];
    // Erst melden, wenn die Adresse auch wirklich antwortet
    if (await erreichbar(url, 8000)) return url;
  }
  return null;
}

/* ---------------- Veroeffentlichen ---------------- */

function merkeAdresse(url) {
  try { fs.writeFileSync(STATE, JSON.stringify({ url, ts: Date.now() }, null, 1)); }
  catch (_) { /* egal */ }
}

function letzteAdresse() {
  try { return JSON.parse(fs.readFileSync(STATE, 'utf8')).url; } catch (_) { return null; }
}

/** dist/ mit der neuen Adresse bauen und zu Firebase schicken. */
function veroeffentliche(url) {
  const host = url.replace(/^https?:\/\//, '');
  sag('Baue dist/ mit', host);
  const bau = spawnSync(process.execPath, [path.join('scripts', 'build-hosting.js'), `--server=${host}`],
    { cwd: ROOT, encoding: 'utf8' });
  if (bau.status !== 0) {
    sag('Bau fehlgeschlagen:', (bau.error && bau.error.code) || (bau.stderr || '').trim());
    return false;
  }

  sag('Veroeffentliche auf Firebase Hosting');
  /* Ueber die Shell aufrufen: npx ist unter Windows eine .cmd-Datei, die
     spawnSync ohne shell mit EINVAL ablehnt - der Fehler kam dann ohne
     jede Ausgabe zurueck und war von aussen nicht zu deuten. */
  const dep = spawnSync('npx firebase-tools deploy --only hosting',
    { cwd: ROOT, encoding: 'utf8', shell: true });
  if (dep.status !== 0) {
    const grund = (dep.error && dep.error.code)
      || (dep.stderr || dep.stdout || '').trim().split('\n').slice(-3).join(' ')
      || `Abbruch mit Code ${dep.status}`;
    sag('Veroeffentlichen fehlgeschlagen:', grund);
    return false;
  }
  sag('Live:', host);
  return true;
}

/* ---------------- Schleife ---------------- */

async function tunnelSicherstellen(grund) {
  const url = await starteTunnel();
  if (!url) { sag('Tunnel kam nicht hoch - naechster Versuch beim naechsten Durchlauf'); return; }
  sag(`Tunnel steht (${grund}):`, url);
  if (url !== aktuelleAdresse || url !== letzteAdresse()) {
    aktuelleAdresse = url;
    if (veroeffentliche(url)) merkeAdresse(url);
  } else {
    aktuelleAdresse = url;
  }
}

async function hauptschleife() {
  starteServer();
  await schlaf(3000);
  await tunnelSicherstellen('Start');

  while (laeuft) {
    await schlaf(PRUEF_INTERVALL);
    if (!laeuft) break;

    // Erst der lokale Server - ohne ihn hilft der beste Tunnel nichts
    if (!await erreichbar(`http://localhost:${PORT}`, 5000)) {
      sag('Spielserver antwortet nicht');
      starteServer();
      await schlaf(4000);
    }

    if (!aktuelleAdresse) { await tunnelSicherstellen('keine Adresse'); continue; }
    if (!await erreichbar(aktuelleAdresse, 12000)) {
      // Zweiter Versuch - ein einzelner Aussetzer ist noch kein toter Tunnel
      await schlaf(4000);
      if (await erreichbar(aktuelleAdresse, 12000)) continue;
      sag('Tunnel antwortet nicht mehr:', aktuelleAdresse);
      await tunnelSicherstellen('Neustart');
    }
  }
}

function beenden() {
  if (!laeuft) return;
  laeuft = false;
  sag('Waechter wird beendet');
  toeteTunnel();
  if (server) { try { server.kill(); } catch (_) { /* egal */ } }
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, beenden);
process.on('exit', () => { if (laeuft) { laeuft = false; toeteTunnel(); } });

sag('Waechter gestartet. Prueft alle', PRUEF_INTERVALL / 1000, 'Sekunden.');
hauptschleife().catch(e => { console.error(e); beenden(); });
