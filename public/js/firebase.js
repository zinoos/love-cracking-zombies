/* Firebase-Anbindung (Analytics).
   Laeuft komplett optional: fehlt das SDK oder das Internet, spielt das Spiel
   unveraendert weiter - jeder Aufruf ist dann ein No-Op. */
const FB = (() => {
  /* Hauptprojekt: Anmeldung + Hosting. Hier liegt die Web-App, deren
     ID-Tokens der Spielserver akzeptiert (AUTH_PROJECT). */
  const firebaseConfig = {
    apiKey: 'AIzaSyAekIp6ND_2jQrqMV-otuoHuf-b_ksmBig',
    authDomain: 'nosershooter-2f2c4.firebaseapp.com',
    projectId: 'nosershooter',
    storageBucket: 'nosershooter.firebasestorage.app',
    messagingSenderId: '906681721229',
    appId: '1:906681721229:web:4761fba9af2ca6f220ddc4'
  };

  /* Analytics laeuft weiter im urspruenglichen Projekt - als zweite,
     benannte App, damit sich beide nicht in die Quere kommen. */
  const analyticsConfig = {
    apiKey: 'AIzaSyBCKO1TbAFMBZ2rEFlghH2ubBcOYLWyT5k',
    authDomain: 'shootergame2d.firebaseapp.com',
    projectId: 'shootergame2d',
    storageBucket: 'shootergame2d.firebasestorage.app',
    messagingSenderId: '641088522308',
    appId: '1:641088522308:web:8189a1543dd92b5c841411',
    measurementId: 'G-TXNHHTD3EG'
  };

  let app = null;
  let analyticsApp = null;
  let analytics = null;
  let ready = false;
  let disabled = false;
  const queue = [];
  const QUEUE_MAX = 30;

  function optedOut() {
    try { return localStorage.getItem('ns_analytics') === 'off'; } catch (_) { return false; }
  }

  function init() {
    if (typeof firebase === 'undefined' || !firebase.initializeApp) {
      console.info('[Firebase] SDK nicht geladen - Analytics aus');
      disabled = true;
      return;
    }
    try {
      app = firebase.apps && firebase.apps.length ? firebase.app() : firebase.initializeApp(firebaseConfig);
    } catch (e) {
      console.warn('[Firebase] initializeApp fehlgeschlagen:', e.message);
      disabled = true;
      return;
    }

    if (optedOut()) {
      console.info('[Firebase] Analytics per Opt-out deaktiviert');
      disabled = true;
      return;
    }
    if (!firebase.analytics || !firebase.analytics.isSupported) {
      disabled = true;
      return;
    }

    // isSupported() prueft Cookies, IndexedDB und Browser-Kontext
    firebase.analytics.isSupported().then(ok => {
      if (!ok) {
        console.info('[Firebase] Analytics in dieser Umgebung nicht unterstuetzt');
        disabled = true;
        return;
      }
      try {
        analyticsApp = firebase.apps.find(a => a.name === 'analytics')
          || firebase.initializeApp(analyticsConfig, 'analytics');
        analytics = analyticsApp.analytics();
        ready = true;
        flush();
      } catch (e) {
        console.warn('[Firebase] Analytics-Start fehlgeschlagen:', e.message);
        disabled = true;
      }
    }).catch(() => { disabled = true; });
  }

  function flush() {
    while (queue.length) {
      const [name, params] = queue.shift();
      send(name, params);
    }
  }

  function send(name, params) {
    try { analytics.logEvent(name, params || {}); }
    catch (e) { /* Analytics darf nie das Spiel stoeren */ }
  }

  /** Event melden. Vor der Initialisierung wird gepuffert. */
  function log(name, params) {
    if (disabled) return;
    if (ready) return send(name, params);
    if (queue.length < QUEUE_MAX) queue.push([name, params]);
  }

  function setEnabled(on) {
    try { localStorage.setItem('ns_analytics', on ? 'on' : 'off'); } catch (_) { /* ignore */ }
    if (analytics && firebase.analytics) {
      try { analytics.setAnalyticsCollectionEnabled(!!on); } catch (_) { /* ignore */ }
    }
    disabled = !on;
  }

  init();

  return {
    log, setEnabled,
    get app() { return app; },
    get enabled() { return ready && !disabled; },
    config: firebaseConfig
  };
})();
