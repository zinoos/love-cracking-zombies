/* WebSocket-Client mit Auto-Reconnect und Ping-Messung. */
const NET = (() => {
  let ws = null;
  let myId = null;
  let connected = false;
  let pingMs = 0;
  let reconnectT = null;
  const handlers = {};

  /** Serveradresse: ?server=… > window.GAME_SERVER > selber Host wie die Seite. */
  function url() {
    const q = new URLSearchParams(location.search).get('server');
    const override = (q || window.GAME_SERVER || '').trim();
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
      if (m.t === C.MSG.HELLO) myId = m.id;
      if (m.t === C.MSG.PONG) { pingMs = Math.round(performance.now() - m.ts); emit('ping', pingMs); return; }
      emit(m.t, m);
      emit('*', m);
    };
  }

  function scheduleReconnect() {
    if (reconnectT) return;
    reconnectT = setTimeout(() => { reconnectT = null; connect(); }, 1500);
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
    get target() { return url(); }
  };
})();
