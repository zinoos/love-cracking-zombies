/* Dauerhafte Ablage der Bestenliste in Firestore.

   Warum ueberhaupt: auf dem freien Render-Plan gibt es keine Festplatte. Jeder
   Neustart - und der Dienst startet nach 15 Minuten ohne Spieler neu - wuerde
   eine lokale JSON-Datei mitnehmen. Die Bestenliste soll aber jeden Spieler
   behalten, der sich je angemeldet hat.

   Umgesetzt ohne zusaetzliche Pakete: JWT selbst signieren (RS256 kann Node),
   damit gegen Google ein Zugriffstoken holen, dann die Firestore-REST-API.
   Ohne hinterlegten Schluessel meldet sich das Modul als "nicht verfuegbar"
   und stars.js bleibt bei der lokalen Datei - so laeuft die Entwicklung
   unveraendert weiter. */
const https = require('https');
const crypto = require('crypto');
const fs = require('fs');

const SCOPE = 'https://www.googleapis.com/auth/datastore';
const COLLECTION = 'players';

let creds = null;
try {
  const raw = process.env.GOOGLE_SERVICE_ACCOUNT
    || (process.env.GOOGLE_SERVICE_ACCOUNT_FILE && fs.readFileSync(process.env.GOOGLE_SERVICE_ACCOUNT_FILE, 'utf8'));
  if (raw) {
    // Render gibt mehrzeilige Werte teils base64-kodiert weiter
    const text = raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
    creds = JSON.parse(text);
  }
} catch (e) {
  console.warn('  Dienstkonto nicht lesbar:', e.message);
}

const PROJECT = process.env.FIREBASE_PROJECT_ID || (creds && creds.project_id);
const BASE = PROJECT && `/v1/projects/${PROJECT}/databases/(default)/documents`;

function available() { return !!(creds && creds.private_key && PROJECT); }

/* ---------- HTTP ---------- */

function request(method, host, path, body, token) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? null
      : (typeof body === 'string' ? body : JSON.stringify(body));
    const headers = {};
    if (token) headers.Authorization = 'Bearer ' + token;
    if (data) {
      headers['Content-Length'] = Buffer.byteLength(data);
      headers['Content-Type'] = typeof body === 'string'
        ? 'application/x-www-form-urlencoded' : 'application/json';
    }
    const req = https.request({ host, path, method, headers, timeout: 15000 }, res => {
      let buf = '';
      res.on('data', c => buf += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(buf ? JSON.parse(buf) : {});
        } else {
          reject(new Error(`${method} ${path} -> ${res.statusCode}: ${buf.slice(0, 200)}`));
        }
      });
    });
    req.on('timeout', () => req.destroy(new Error('Zeitueberschreitung')));
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

/* ---------- Zugriffstoken ---------- */

const b64url = buf => Buffer.from(buf).toString('base64')
  .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let token = null, tokenExp = 0;

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (token && now < tokenExp - 60) return token;

  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64url(JSON.stringify({
    iss: creds.client_email, scope: SCOPE,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  }));
  const sig = b64url(crypto.createSign('RSA-SHA256')
    .update(`${header}.${claim}`).sign(creds.private_key));

  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion: `${header}.${claim}.${sig}`
  }).toString();
  const res = await request('POST', 'oauth2.googleapis.com', '/token', body);
  token = res.access_token;
  tokenExp = now + (res.expires_in || 3600);
  return token;
}

/* ---------- Firestore-Werte <-> einfache Objekte ---------- */

const NUMBERS = new Set(['stars', 'matches', 'wins', 'kills', 'deaths', 'best', 'last']);

function toFields(rec) {
  const fields = {};
  for (const [k, v] of Object.entries(rec)) {
    if (v === undefined || v === null) continue;
    if (NUMBERS.has(k)) fields[k] = { integerValue: String(Math.round(v)) };
    else if (typeof v === 'boolean') fields[k] = { booleanValue: v };
    else fields[k] = { stringValue: String(v) };
  }
  return fields;
}

function fromFields(fields) {
  const out = {};
  for (const [k, v] of Object.entries(fields || {})) {
    if ('integerValue' in v) out[k] = Number(v.integerValue);
    else if ('doubleValue' in v) out[k] = Number(v.doubleValue);
    else if ('booleanValue' in v) out[k] = v.booleanValue;
    else if ('stringValue' in v) out[k] = v.stringValue;
  }
  return out;
}

/* Firestore-Dokumentnamen duerfen kein "/" enthalten und nicht mit "." beginnen.
   Firebase-UIDs sind zwar harmlos, aber der Schutz kostet nichts. */
const docId = uid => encodeURIComponent(uid).replace(/\./g, '%2E');

/* ---------- oeffentlich ---------- */

/** Alle Spieler laden. Gibt eine Map uid -> record zurueck. */
async function loadAll() {
  const out = new Map();
  const tk = await accessToken();
  let pageToken = '';
  do {
    const q = `?pageSize=300${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`;
    const res = await request('GET', 'firestore.googleapis.com', `${BASE}/${COLLECTION}${q}`, undefined, tk);
    for (const doc of res.documents || []) {
      const rec = fromFields(doc.fields);
      if (rec.uid) out.set(rec.uid, rec);
    }
    pageToken = res.nextPageToken || '';
  } while (pageToken);
  return out;
}

/** Geaenderte Spieler schreiben - ein Commit fuer alle. */
async function saveMany(records) {
  if (!records.length) return;
  const tk = await accessToken();
  // Firestore nimmt bis zu 500 Schreibvorgaenge pro Commit
  for (let i = 0; i < records.length; i += 400) {
    const batch = records.slice(i, i + 400);
    await request('POST', 'firestore.googleapis.com',
      `/v1/projects/${PROJECT}/databases/(default)/documents:commit`, {
        writes: batch.map(rec => ({
          update: {
            name: `projects/${PROJECT}/databases/(default)/documents/${COLLECTION}/${docId(rec.uid)}`,
            fields: toFields(rec)
          }
        }))
      }, tk);
  }
}

module.exports = { available, loadAll, saveMany };
