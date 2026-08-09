const crypto = require('crypto');

let admin = null;
try {
  admin = require('firebase-admin');
  if (admin && admin.apps && !admin.apps.length) {
    if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
      const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
      admin.initializeApp({ credential: admin.credential.cert(sa) });
      console.log('  Firebase Admin initialisiert (env)');
    } else {
      const saPath = process.env.FIREBASE_SERVICE_ACCOUNT_PATH || './firebase-service-account.json';
      admin.initializeApp({ credential: admin.credential.cert(require(saPath)) });
      console.log('  Firebase Admin initialisiert (file)');
    }
  }
} catch (e) {
  console.warn('  Firebase Admin nicht geladen:', e.message);
}

const store = require('./store');

async function verifyToken(idToken) {
  if (!admin) throw new Error('Firebase not configured');
  const decoded = await admin.auth().verifyIdToken(idToken);
  return decoded;
}

function makeGuest(uid, name) {
  return {
    uid: uid || 'guest_' + crypto.randomBytes(12).toString('hex'),
    name: name || 'Guest',
    picture: '',
    guest: true
  };
}

async function signInOrCreate(uid, playerInfo) {
  const profile = await store.getPlayer(uid);
  if (profile) return profile;
  return store.savePlayer(uid, {
    name: playerInfo.name || 'Player',
    stars: 0, matches: 0, wins: 0, kills: 0, deaths: 0,
    best: 0, damagePoints: 500000
  });
}

async function getProfile(uid) {
  if (uid.startsWith('guest_')) return null;
  return store.getPlayer(uid);
}

module.exports = { verifyToken, signInOrCreate, getProfile, makeGuest };
