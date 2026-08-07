/* Guest-only auth — no login, no sign-in. Everyone plays directly. */
const AUTH = (() => {
  let profile = null;
  const listeners = [];

  function guestUid() {
    let uid = localStorage.getItem('ns_guest_uid');
    if (!uid) {
      uid = 'guest_' + [...Array(24)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
      localStorage.setItem('ns_guest_uid', uid);
    }
    return uid;
  }

  function emit() { listeners.forEach(fn => fn(state())); }

  function state() {
    return { signedIn: false, guest: true, name: '', photo: '', profile };
  }

  function init() {}

  function pushToken() { NET.send({ t: C.MSG.AUTH, idToken: null, guestUid: guestUid() }); }

  function setProfile(p) { profile = p; emit(); }

  return {
    init, pushToken, setProfile, state,
    available: () => false,
    blocked: () => true,
    playAsGuest() {},
    signOut() {},
    onChange(fn) { listeners.push(fn); fn(state()); },
    get user() { return null; },
    get profile() { return profile; },
    get stars() { return profile ? profile.stars : 0; },
    get isGuest() { return true; }
  };
})();
