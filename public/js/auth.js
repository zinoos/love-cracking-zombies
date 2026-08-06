/* Guest-only auth — no login, no sign-in. Everyone plays directly. */
const AUTH = (() => {
  let profile = null;
  const listeners = [];

  function emit() { listeners.forEach(fn => fn(state())); }

  function state() {
    return { signedIn: false, guest: true, name: '', photo: '', profile };
  }

  function init() {}

  function pushToken() { NET.send({ t: C.MSG.AUTH, idToken: null }); }

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
