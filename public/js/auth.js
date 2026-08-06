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
      name: user ? (user.displayName || user.email || 'Player') : '',
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

  /* Warum das so aufwaendig ist: auf manchen Geraeten - Schulnetz,
     Virenschutz, strenge Erweiterungen - wird die Google-Anmeldung
     abgefangen. Mal fehlt schon das SDK, mal geht das Fenster gar nicht auf,
     mal bleibt es stumm haengen. Ohne Behandlung sieht der Spieler nur einen
     hilflosen Knopf und kommt nicht ins Spiel. Jeder dieser Faelle bekommt
     deshalb eine eigene, verstaendliche Rueckmeldung - und in allen bleibt
     der Gastweg offen. */
  const GRUENDE = {
    'auth/popup-blocked': 'popup',
    'auth/popup-closed-by-user': 'abgebrochen',
    'auth/cancelled-popup-request': 'abgebrochen',
    'auth/user-cancelled': 'abgebrochen',
    'auth/network-request-failed': 'blockiert',
    'auth/internal-error': 'blockiert',
    'auth/unauthorized-domain': 'domain',
    'auth/operation-not-allowed': 'projekt',
    'auth/configuration-not-found': 'projekt'
  };

  /** Fehler in einen kurzen Grund uebersetzen, den die Oberflaeche kennt. */
  function grundVon(e) {
    const code = (e && e.code) || '';
    if (GRUENDE[code]) return GRUENDE[code];
    if (/network|blocked|failed to fetch/i.test((e && e.message) || '')) return 'blockiert';
    return 'unbekannt';
  }

  async function signIn() {
    if (!available()) { const f = new Error('Auth not loaded'); f.grund = 'blockiert'; throw f; }
    const provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    /* Zeitgrenze: ein von einem Filter abgefangenes Fenster meldet oft gar
       nichts zurueck. Ohne diese Grenze bliebe der Knopf ewig deaktiviert. */
    const zeitgrenze = new Promise((_, ab) => setTimeout(() => {
      const f = new Error('Zeitueberschreitung'); f.grund = 'blockiert'; ab(f);
    }, 25000));

    try {
      await Promise.race([firebase.auth().signInWithPopup(provider), zeitgrenze]);
    } catch (e) {
      const grund = e.grund || grundVon(e);
      // Fenster geblockt -> ueber eine Weiterleitung versuchen
      if (grund === 'popup' || (e.code || '') === 'auth/operation-not-supported-in-this-environment') {
        try {
          await firebase.auth().signInWithRedirect(provider);
          return;
        } catch (e2) {
          const f = new Error(e2.message || 'Weiterleitung fehlgeschlagen');
          f.grund = grundVon(e2);
          throw f;
        }
      }
      const f = new Error(e.message || 'Sign-in failed');
      f.grund = grund;
      throw f;
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
    /** Anmeldung auf diesem Geraet ueberhaupt moeglich? */
    blocked: () => !available(),
    onChange(fn) { listeners.push(fn); fn(state()); },
    get user() { return user; },
    get profile() { return profile; },
    get stars() { return profile ? profile.stars : 0; },
    get isGuest() { return guest && !user; }
  };
})();
