/* Adresse des Spielservers.
   Leer lassen = derselbe Host, von dem die Seite kommt (Standardfall: alles auf
   Cloud Run). Nur setzen, wenn Client und Server getrennt laufen, z.B.
   Client auf Firebase Hosting, Server auf Cloud Run:
     window.GAME_SERVER = 'neon-strike-abc123-ew.a.run.app';
   Zum schnellen Testen geht auch  ?server=host:port  in der URL. */
window.GAME_SERVER = '';
