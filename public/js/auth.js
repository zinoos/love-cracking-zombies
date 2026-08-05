/* Google-Anmeldung. Der Client haelt nur das ID-Token; geprueft und in Sterne
   umgerechnet wird ausschliesslich auf dem Server. */
const AUTH = (() => {
  let user = null;          // Firebase-User
  let profile = null;       // Serverprofil mit Sternen
  let guest = false;
  let refreshTimer = 0;
  const listeners = [];

  // Gast-Entscheidung merken, sonst muss man sie bei jedem Neuladen wiederholen
  const GUEST_KEY = 'ns_guest';
  function rememberGuest(on) {
    try { on ? localStorage.setItem(GUEST_KEY, '1') : localStorage.removeItem(GUEST_KEY); }
    catch (_) { /* Privatmodus */ }
  }
  try { guest = localStorage.getItem(GUEST_KEY) === '1'; } catch (_) { guest = false; }

  const available = () =>
    typeof firebase !== 'undefined' && !!firebase.auth && !!FB.app;

  function emit() { listeners.forEach(fn => fn(state())); }

  function state() {
    return {
      signedIn: !!user,
      guest,
      name: user ? (user.displayName || user.email || 'Spieler') : '',
      photo: user ? user.photoURL : '',
      profile
    };
  }

  /** Token holen und an den Spielserver schicken. */
  async function pushToken(force) {
    if (!user) { NET.send({ t: C.MSG.AUTH, idToken: null }); return; }
    try {
      const token = await user.getIdToken(!!force);
      NET.send({ t: C.MSG.AUTH, idToken: token });
    } catch (e) {
      console.warn('[Auth] Token konnte nicht geholt werden:', e.message);
    }
  }

  function init() {
    if (!available()) {
      console.info('[Auth] Firebase Auth nicht geladen - nur Gastmodus');
      return;
    }
    firebase.auth().onAuthStateChanged(u => {
      user = u || null;
      if (user) guest = false;
      profile = null;
      emit();
      if (NET.connected) pushToken(false);

      clearInterval(refreshTimer);
      if (user) {
        // ID-Tokens laufen nach einer Stunde ab
        refreshTimer = setInterval(() => pushToken(true), 45 * 60 * 1000);
      }
    });
  }

  async function signIn() {
    if (!available()) throw new Error('Firebase Auth ist nicht verfügbar');
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    try {
      await firebase.auth().signInWithPopup(provider);
    } catch (e) {
      // Popup geblockt oder geschlossen -> Weiterleitung als Rueckfallweg
      if (e.code === 'auth/popup-blocked' || e.code === 'auth/operation-not-supported-in-this-environment') {
        await firebase.auth().signInWithRedirect(provider);
        return;
      }
      throw e;
    }
  }

  async function signOut() {
    if (available() && firebase.auth().currentUser) await firebase.auth().signOut();
    user = null; profile = null; guest = false;
    rememberGuest(false);
    NET.send({ t: C.MSG.AUTH, idToken: null });
    emit();
  }

  function playAsGuest() { guest = true; rememberGuest(true); emit(); }

  function setProfile(p) { profile = p; emit(); }

  return {
    init, signIn, signOut, playAsGuest, pushToken, setProfile, state, available,
    onChange(fn) { listeners.push(fn); fn(state()); },
    get user() { return user; },
    get profile() { return profile; },
    get stars() { return profile ? profile.stars : 0; },
    get isGuest() { return guest && !user; }
  };
})();
