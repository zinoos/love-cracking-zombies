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
const PROTOKOLL = path.join(ROOT, 'watchdog.log');
const PIDDATEI = path.join(ROOT, '.watchdog.pid');

// cloudflared: erst im Projekt suchen, dann im Pfad
const CF = process.env.CLOUDFLARED
  || [path.join(ROOT, 'cloudflared.exe'), path.join(ROOT, 'bin', 'cloudflared.exe')]
    .find(p => fs.existsSync(p))
  || 'cloudflared';

const PRUEF_INTERVALL = 30000;   // wie oft die Adresse geprueft wird
/* 25 s waren zu knapp: der erste Startversuch lief regelmaessig in den
   Abbruch, obwohl der Tunnel ein paar Sekunden spaeter stand. */
const ANLAUF = 60000;            // so lange darf ein Tunnel zum Starten brauchen

let server = null, tunnel = null, aktuelleAdresse = null, laeuft = true;

const zeit = () => new Date().toLocaleString('de-CH');
const schlaf = ms => new Promise(r => setTimeout(r, ms));

/* Selber ins Protokoll schreiben statt die Ausgabe beim Start umzuleiten.
   Die Umleitung brauchte verschachtelte Anfuehrungszeichen in der Autostart-
   Datei, die cmd falsch zerlegt hat - und ohne Protokoll war hinterher nicht
   zu sehen, warum nichts lief. */
function sag(...a) {
  const zeile = `[${zeit()}] ` + a.join(' ');
  console.log(zeile);
  try { fs.appendFileSync(PROTOKOLL, zeile + '\n'); } catch (_) { /* egal */ }
}

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

/* Wer haelt den Port? Nach einem harten Abbruch des Waechters bleibt sein
   Spielserver zurueck - unter Windows laeuft beim Beenden per TerminateProcess
   kein Aufraeumen mehr. Der naechste Waechter kaeme dann nie hoch, weil sein
   Server den Port nicht binden kann. */
function portBesetztVon() {
  const pids = new Set();
  if (process.platform === 'win32') {
    const r = spawnSync('netstat', ['-ano', '-p', 'tcp'], { encoding: 'utf8' });
    /* Nicht auf das Statuswort pruefen - auf einem deutschen Windows steht da
       "ABHOEREN" statt "LISTENING". Ein lauschender Eintrag ist stattdessen
       daran zu erkennen, dass die Gegenstelle 0.0.0.0:0 bzw. [::]:0 ist. */
    for (const z of String(r.stdout || '').split('\n')) {
      const m = z.match(/^\s*TCP\s+(\S+):(\d+)\s+(\S+)\s+\S+\s+(\d+)\s*$/);
      if (m && Number(m[2]) === PORT && /:0$/.test(m[3])) pids.add(Number(m[4]));
    }
  } else {
    const r = spawnSync('lsof', ['-ti', `tcp:${PORT}`, '-sTCP:LISTEN'], { encoding: 'utf8' });
    for (const z of String(r.stdout || '').split('\n')) if (z.trim()) pids.add(Number(z.trim()));
  }
  pids.delete(process.pid);
  return [...pids];
}

function raeumePort() {
  const alt = portBesetztVon();
  if (!alt.length) return;
  sag('Port', PORT, 'ist noch belegt (' + alt.join(', ') + ') - wird freigeraeumt');
  for (const pid of alt) {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
      else process.kill(pid, 'SIGKILL');
    } catch (_) { /* schon weg */ }
  }
}

function starteServer() {
  if (server && !server.killed) return;
  sag('Spielserver wird gestartet');
  /* Eigene Prozessgruppe und keine geteilte Konsole. Vorher lief der Server
     mit stdio:'inherit' an derselben Konsole wie der Waechter - wurde er von
     aussen hart beendet, ging das Konsolenereignis an die ganze Gruppe und
     riss den Waechter mit (Exitcode 0xC000013A). Genau der sollte ja
     ueberleben und neu starten. */
  server = spawn(process.execPath, ['server.js'], {
    cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'], env: process.env,
    detached: true, windowsHide: true
  });
  // Ausgabe des Servers mitschreiben, sonst waere sie jetzt verloren
  const mit = d => { try { fs.appendFileSync(PROTOKOLL, String(d)); } catch (_) { /* egal */ } };
  server.stdout.on('data', mit);
  server.stderr.on('data', mit);
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
  raeumePort();          // Reste eines abgestuerzten Vorgaengers
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
  /* In eigener Gruppe nimmt kill() den Server nicht mehr sicher mit -
     unter Windows deshalb ueber die Prozesskennung abraeumen. */
  if (server && server.pid) {
    try {
      if (process.platform === 'win32') spawnSync('taskkill', ['/F', '/T', '/PID', String(server.pid)], { stdio: 'ignore' });
      else process.kill(-server.pid);
    } catch (_) { try { server.kill(); } catch (__) { /* egal */ } }
  }
  process.exit(0);
}
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(sig, beenden);
process.on('exit', () => {
  if (laeuft) { laeuft = false; toeteTunnel(); }
  try { if (fs.readFileSync(PIDDATEI, 'utf8').trim() === String(process.pid)) fs.rmSync(PIDDATEI); }
  catch (_) { /* egal */ }
});
// Ein Absturz soll im Protokoll stehen und nicht stillschweigend enden
process.on('uncaughtException', e => { sag('Abbruch:', e && e.stack || e); beenden(); });

/* Nur ein Waechter gleichzeitig - zwei wuerden sich gegenseitig die Tunnel
   abschiessen (toeteTunnel raeumt per taskkill alle cloudflared-Prozesse ab). */
function laeuftSchon() {
  let alt;
  try { alt = Number(fs.readFileSync(PIDDATEI, 'utf8').trim()); } catch (_) { return false; }
  if (!alt || alt === process.pid) return false;
  try { process.kill(alt, 0); return true; } catch (_) { return false; }
}
if (laeuftSchon()) {
  sag('Es laeuft bereits ein Waechter - dieser Start wird beendet.');
  process.exit(0);
}
try { fs.writeFileSync(PIDDATEI, String(process.pid)); } catch (_) { /* egal */ }

sag('Waechter gestartet (PID ' + process.pid + '). Prueft alle', PRUEF_INTERVALL / 1000, 'Sekunden.');
hauptschleife().catch(e => { sag('Schleife abgebrochen:', e && e.stack || e); beenden(); });
