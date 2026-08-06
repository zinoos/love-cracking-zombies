/* WebSocket-Client mit Auto-Reconnect und Ping-Messung.

   Der Sitzungsschluessel ist der Kern der Wiederaufnahme: bei einem Abriss
   mitten im Match meldet sich der Client damit zurueck und bekommt seinen
   alten Platz, statt als neuer Spieler ohne Raum dazustehen. */
const NET = (() => {
  let ws = null;
  let myId = null;
  let connected = false;
  let pingMs = 0;
  let reconnectT = null;
  let attempt = 0;
  let session = null;
  const handlers = {};

  try { session = sessionStorage.getItem('ns_session') || null; } catch (_) { /* egal */ }

  /* Nachgeladene Adresse aus config.js. Der Spielserver haengt an einem
     Tunnel, dessen Adresse sich bei jedem Neustart aendert. Ohne das hier
     haemmert eine offene Seite endlos gegen die tote alte Adresse, obwohl
     nebenan laengst eine neue veroeffentlicht ist. */
  let frisch = null;

  /** Serveradresse: ?server=… > frisch geholt > window.GAME_SERVER > selber Host. */
  function url() {
    const q = new URLSearchParams(location.search).get('server');
    const override = (q || frisch || window.GAME_SERVER || '').trim();
    if (override) {
      if (/^wss?:\/\//i.test(override)) return override;
      // Blanker Host: ueber HTTPS immer wss, sonst ws
      const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
      return `${proto}//${override.replace(/^https?:\/\//i, '').replace(/\/+$/, '')}`;
    }
    const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${proto}//${location.host}`;
  }

  function connect() {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) return;
    try { ws = new WebSocket(url()); } catch (e) { scheduleReconnect(); return; }

    ws.onopen = () => {
      connected = true;
      attempt = 0;
      emit('open');
    };
    ws.onclose = () => {
      connected = false;
      emit('close');
      scheduleReconnect();
    };
    ws.onerror = () => { /* onclose folgt */ };
    ws.onmessage = ev => {
      let m;
      try { m = JSON.parse(ev.data); } catch (_) { return; }
      if (m.t === C.MSG.HELLO) {
        myId = m.id;
        if (m.session) {
          session = m.session;
          try { sessionStorage.setItem('ns_session', session); } catch (_) { /* egal */ }
        }
      }
      if (m.t === C.MSG.PONG) { pingMs = Math.round(performance.now() - m.ts); emit('ping', pingMs); return; }
      emit(m.t, m);
      emit('*', m);
    };
  }

  /* config.js liegt auf Hosting mit no-cache, holt also wirklich die zuletzt
     veroeffentlichte Adresse. Ein eigener Parser statt eval: hier wird fremder
     Text ausgewertet, und ausgefuehrt werden soll davon nichts. */
  function adresseNachladen() {
    if (new URLSearchParams(location.search).get('server')) return; // Testvorgabe schlaegt alles
    fetch('/js/config.js?t=' + Date.now(), { cache: 'no-store' })
      .then(r => (r.ok ? r.text() : null))
      .then(text => {
        if (!text) return;
        const m = text.match(/^window\.GAME_SERVER\s*=\s*'([^']*)';/m);
        if (!m || !m[1] || m[1] === frisch || m[1] === window.GAME_SERVER) return;
        frisch = m[1];
        attempt = 0;                       // neue Adresse verdient neue Versuche
        emit('serverwechsel', frisch);
      })
      .catch(() => { /* offline - naechster Versuch kommt von allein */ });
  }

  /* Schnell der erste Versuch, danach in groesseren Schritten. Ein Aussetzer
     von einer Sekunde soll nicht eineinhalb Sekunden Wartezeit kosten. */
  function scheduleReconnect() {
    if (reconnectT) return;
    // Nach drei Fehlversuchen liegt es eher an der Adresse als am Netz
    if (attempt === 3 || (attempt > 3 && attempt % 5 === 0)) adresseNachladen();
    const delay = Math.min(4000, 300 * Math.pow(1.8, attempt++));
    reconnectT = setTimeout(() => { reconnectT = null; connect(); }, delay);
  }

  function emit(evt, data) { (handlers[evt] || []).forEach(fn => fn(data)); }

  setInterval(() => {
    if (connected) send({ t: C.MSG.PING, ts: performance.now() });
  }, 2000);

  function send(obj) {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
  }

  return {
    connect, send,
    on(evt, fn) { (handlers[evt] = handlers[evt] || []).push(fn); },
    get id() { return myId; },
    get connected() { return connected; },
    get ping() { return pingMs; },
    get session() { return session; },
    get target() { return url(); }
  };
})();
