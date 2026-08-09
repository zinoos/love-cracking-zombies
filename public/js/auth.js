const AUTH = (() => {
  let profile = null;
  let currentUser = null;
  const listeners = [];

  const isLocal = /^(localhost|127\.\d+\.\d+\.\d+)$/.test(location.hostname);

  let firebaseReady = false;

  function initFirebase() {
    if (typeof firebase === 'undefined' || !window.FIREBASE_CONFIG || !window.FIREBASE_CONFIG.apiKey) {
      console.warn('Firebase SDK not loaded');
      return;
    }
    try {
      firebase.initializeApp(window.FIREBASE_CONFIG);
      firebaseReady = true;
    } catch (e) {
      if (e.code === 'app/duplicate-app') {
        firebaseReady = true;
      } else {
        console.warn('Firebase init error:', e.message);
      }
    }
  }

  function guestUid() {
    if (isLocal) return 'guest_' + [...Array(24)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
    let uid = localStorage.getItem('ns_guest_uid');
    if (!uid) {
      uid = 'guest_' + [...Array(24)].map(() => Math.floor(Math.random() * 16).toString(16)).join('');
      localStorage.setItem('ns_guest_uid', uid);
    }
    return uid;
  }

  function emit() { listeners.forEach(fn => fn(state())); }

  function state() {
    return {
      signedIn: !!currentUser,
      guest: !currentUser,
      name: currentUser ? (currentUser.displayName || '') : '',
      photo: currentUser ? (currentUser.photoURL || '') : '',
      profile
    };
  }

  function init() {
    initFirebase();
    if (!firebaseReady) return;
    try {
      firebase.auth().onAuthStateChanged(async (user) => {
        currentUser = user;
        if (user) {
          try {
            const idToken = await user.getIdToken();
            NET.send({ t: C.MSG.AUTH, idToken, name: user.displayName || '' });
          } catch (e) {
            console.warn('Failed to get ID token:', e.message);
          }
        }
        emit();
      });
    } catch (e) {
      console.warn('Firebase Auth init error:', e.message);
    }
  }

  async function signInWithGoogle() {
    if (!firebaseReady) return;
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const result = await firebase.auth().signInWithPopup(provider);
      const user = result.user;
      currentUser = user;
      const idToken = await user.getIdToken();
      NET.send({ t: C.MSG.AUTH, idToken, name: user.displayName || '' });
      emit();
    } catch (e) {
      if (e.code !== 'auth/popup-closed-by-user') {
        console.warn('Sign in failed:', e.message);
      }
    }
  }

  async function signOut() {
    if (!firebaseReady) return;
    try {
      await firebase.auth().signOut();
      currentUser = null;
      profile = null;
      emit();
      localStorage.removeItem('ns_guest_uid');
      window.location.reload();
    } catch (e) {
      console.warn('Sign out error:', e.message);
    }
  }

  function pushToken() {
    if (currentUser) {
      try {
        currentUser.getIdToken().then(idToken => {
          NET.send({ t: C.MSG.AUTH, idToken, name: currentUser.displayName || '' });
        });
      } catch (e) { /* ignore */ }
    } else {
      NET.send({ t: C.MSG.AUTH, idToken: null, guestUid: guestUid() });
    }
  }

  function setProfile(p) { profile = p; emit(); }

  return {
    init, pushToken, setProfile, state,
    signInWithGoogle, signOut,
    available: () => !!firebaseReady,
    blocked: () => !firebaseReady,
    playAsGuest() {
      pushToken();
    },
    onChange(fn) { listeners.push(fn); fn(state()); },
    get user() { return currentUser; },
    get profile() { return profile; },
    get stars() { return profile ? profile.stars : 0; },
    get isGuest() { return !currentUser; },
    get isSignedIn() { return !!currentUser; },
    get signedIn() { return !!currentUser; }
  };
})();
