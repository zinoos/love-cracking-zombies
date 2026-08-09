/* Adresse des Spielservers.
   Leer lassen = derselbe Host, von dem die Seite kommt (Standardfall: alles auf
   Cloud Run). Nur setzen, wenn Client und Server getrennt laufen, z.B.
   Client auf Firebase Hosting, Server auf Cloud Run:
     window.GAME_SERVER = 'neon-strike-abc123-ew.a.run.app';
   Zum schnellen Testen geht auch  ?server=host:port  in der URL. */
window.GAME_SERVER = '';

/* Firebase-Konfiguration fuer Google-Auth.
   Aus der Firebase Console → Projekt → Einstellungen → Allgemein → Web-App. */
window.FIREBASE_CONFIG = {
  apiKey: "AIzaSyCEb8KaIupgmTyGn5A12Z5W3ZgDzwKqwKE",
  authDomain: "love-cracking-zombies.firebaseapp.com",
  projectId: "love-cracking-zombies",
  storageBucket: "love-cracking-zombies.firebasestorage.app",
  messagingSenderId: "145201122323",
  appId: "1:145201122323:web:f4064b34dfc7350472c3e6"
};
