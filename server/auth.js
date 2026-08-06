const crypto = require('crypto');

function makeGuest(uid, name) {
  return {
    uid: uid || 'guest_' + crypto.randomBytes(12).toString('hex'),
    name: name || 'Guest',
    picture: ''
  };
}

module.exports = { makeGuest };
