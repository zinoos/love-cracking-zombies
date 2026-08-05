/* Prueft Firebase-ID-Tokens serverseitig gegen Googles oeffentliche Zertifikate.
   Ohne diese Pruefung koennte jeder Client eine beliebige Identitaet behaupten
   und sich Sterne gutschreiben lassen. Kein Admin-SDK noetig - genau das macht
   verifyIdToken() intern auch. */
const https = require('https');
const crypto = require('crypto');

const CERT_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let certs = null;
let certsExpire = 0;
let inFlight = null;

function fetchJson(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, res => {
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error('HTTP ' + res.statusCode));
      }
      let body = '';
      res.setEncoding('utf8');
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try {
          // Cache-Dauer aus dem Header uebernehmen
          const cc = res.headers['cache-control'] || '';
          const m = /max-age=(\d+)/.exec(cc);
          resolve({ data: JSON.parse(body), maxAge: m ? parseInt(m[1], 10) : 3600 });
        } catch (e) { reject(e); }
      });
    });
    req.setTimeout(8000, () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

async function getCerts() {
  if (certs && Date.now() < certsExpire) return certs;
  if (inFlight) return inFlight;
  inFlight = fetchJson(CERT_URL).then(({ data, maxAge }) => {
    certs = data;
    certsExpire = Date.now() + Math.max(60, maxAge - 60) * 1000;
    inFlight = null;
    return certs;
  }).catch(e => {
    inFlight = null;
    // Abgelaufene Zertifikate lieber weiterbenutzen als gar keine Anmeldung
    if (certs) return certs;
    throw e;
  });
  return inFlight;
}

function b64url(s) {
  return Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
}

/**
 * @returns {Promise<{uid,name,email,picture}>} wirft bei ungueltigem Token
 */
async function verifyIdToken(token, projectId) {
  if (typeof token !== 'string' || token.length > 8192) throw new Error('kein Token');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('Token-Format');

  let header, payload;
  try {
    header = JSON.parse(b64url(parts[0]).toString('utf8'));
    payload = JSON.parse(b64url(parts[1]).toString('utf8'));
  } catch (_) { throw new Error('Token nicht lesbar'); }

  if (header.alg !== 'RS256') throw new Error('falscher Algorithmus');
  if (!header.kid) throw new Error('kein kid');

  const all = await getCerts();
  const pem = all[header.kid];
  if (!pem) throw new Error('unbekanntes Zertifikat');

  const v = crypto.createVerify('RSA-SHA256');
  v.update(parts[0] + '.' + parts[1]);
  if (!v.verify(pem, b64url(parts[2]))) throw new Error('Signatur ungueltig');

  const now = Math.floor(Date.now() / 1000);
  const skew = 300;
  if (typeof payload.exp !== 'number' || payload.exp <= now - skew) throw new Error('Token abgelaufen');
  if (typeof payload.iat !== 'number' || payload.iat > now + skew) throw new Error('iat in der Zukunft');
  if (payload.aud !== projectId) throw new Error('falsches Projekt');
  if (payload.iss !== 'https://securetoken.google.com/' + projectId) throw new Error('falscher Aussteller');
  if (!payload.sub || typeof payload.sub !== 'string') throw new Error('keine uid');

  return {
    uid: payload.sub,
    name: payload.name || (payload.email ? String(payload.email).split('@')[0] : ''),
    email: payload.email || '',
    picture: payload.picture || ''
  };
}

module.exports = { verifyIdToken };
