/* Einstellungen: Grafikstufe, Leistungsmodus, Effekte und die komplette
   Tastenbelegung. Alles liegt im localStorage, damit es den Browser-Neustart
   ueberlebt.

   Die Belegung wird als Aktion -> Tastenkennung gespeichert. Verglichen wird
   ueber event.code ('KeyW', 'ShiftLeft'), nicht ueber event.key: der Code
   haengt nicht vom Tastaturlayout ab, sonst laege W auf einer franzoesischen
   Tastatur woanders. Fuer die Anzeige gibt es label(). */
const SETTINGS = (() => {
  const KEY = 'ns_settings';

  const ACTIONS = [
    { id: 'up', name: 'Vorwaerts', std: ['KeyW', 'ArrowUp'] },
    { id: 'down', name: 'Rueckwaerts', std: ['KeyS', 'ArrowDown'] },
    { id: 'left', name: 'Links', std: ['KeyA', 'ArrowLeft'] },
    { id: 'right', name: 'Rechts', std: ['KeyD', 'ArrowRight'] },
    { id: 'dash', name: 'Ausweichen', std: ['ShiftLeft', 'ShiftRight'] },
    { id: 'reload', name: 'Nachladen', std: ['KeyR'] },
    { id: 'score', name: 'Punktetafel', std: ['Tab'] },
    { id: 'mute', name: 'Ton an/aus', std: ['KeyM'] },
    { id: 'chat', name: 'Chat', std: ['KeyT'] }
  ];

  const DEFAULTS = {
    quality: -1,      // -1 automatisch, 0 hoch, 1 mittel, 2 niedrig
    perf: false,      // Leistungsmodus
    particles: true,
    shake: 1.0,       // 0 … 1.5
    sens: 1.0,        // Kameravorlauf zum Zeiger, 0 … 2
    keys: {}
  };
  for (const a of ACTIONS) DEFAULTS.keys[a.id] = a.std.slice();

  let data = load();
  const listeners = [];

  function load() {
    const out = JSON.parse(JSON.stringify(DEFAULTS));
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { /* egal */ }
    if (!saved || typeof saved !== 'object') return out;
    for (const k of ['quality', 'perf', 'particles', 'shake', 'sens']) {
      if (saved[k] !== undefined) out[k] = saved[k];
    }
    if (saved.keys && typeof saved.keys === 'object') {
      for (const a of ACTIONS) {
        const v = saved.keys[a.id];
        if (Array.isArray(v) && v.length) out.keys[a.id] = v.filter(x => typeof x === 'string').slice(0, 2);
      }
    }
    return out;
  }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (_) { /* egal */ }
    listeners.forEach(fn => fn(data));
  }

  /* Im Leistungsmodus zaehlt nur noch Bildrate: niedrigste Grafikstufe,
     keine Partikel, kein Wackeln. Die Einzeleinstellungen bleiben gespeichert
     und gelten wieder, sobald der Modus aus ist. */
  const effective = {
    get quality() { return data.perf ? 2 : data.quality; },
    get particles() { return data.perf ? false : data.particles; },
    get shake() { return data.perf ? 0 : data.shake; },
    get sens() { return data.sens; }
  };

  /** Anwenden, was der Renderer wissen muss. */
  function apply() {
    if (typeof RENDER !== 'undefined' && RENDER.setQuality) RENDER.setQuality(effective.quality);
  }

  /** Passt ein Tastendruck zu einer Aktion? */
  function matches(action, ev) {
    const list = data.keys[action] || [];
    if (list.includes(ev.code)) return true;
    // Pfeiltasten und Modifikatoren melden bei manchen Layouts nur key
    return list.includes(ev.key);
  }

  /** Lesbarer Name fuer die Anzeige. */
  function label(code) {
    if (!code) return '—';
    const map = {
      ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
      ShiftLeft: 'Shift links', ShiftRight: 'Shift rechts',
      ControlLeft: 'Strg links', ControlRight: 'Strg rechts',
      AltLeft: 'Alt', AltRight: 'Alt Gr', Space: 'Leertaste', Tab: 'Tab',
      CapsLock: 'Feststell', Enter: 'Enter', Backquote: '^'
    };
    if (map[code]) return map[code];
    if (/^Key[A-Z]$/.test(code)) return code.slice(3);
    if (/^Digit\d$/.test(code)) return code.slice(5);
    if (/^Numpad/.test(code)) return 'Num ' + code.slice(6);
    return code;
  }

  /** Welche Aktion benutzt diesen Code schon? */
  function usedBy(code, exceptAction) {
    for (const a of ACTIONS) {
      if (a.id === exceptAction) continue;
      if ((data.keys[a.id] || []).includes(code)) return a;
    }
    return null;
  }

  return {
    ACTIONS,
    get all() { return data; },
    get eff() { return effective; },
    get(k) { return data[k]; },
    set(k, v) { data[k] = v; save(); apply(); },
    keysFor(action) { return (data.keys[action] || []).slice(); },
    /** Belegung setzen. Doppelbelegungen werden bei der anderen Aktion entfernt. */
    bind(action, code) {
      const doppelt = usedBy(code, action);
      if (doppelt) data.keys[doppelt.id] = (data.keys[doppelt.id] || []).filter(c => c !== code);
      data.keys[action] = [code];
      save();
      return doppelt;
    },
    reset() {
      data = JSON.parse(JSON.stringify(DEFAULTS));
      save(); apply();
    },
    resetKeys() {
      for (const a of ACTIONS) data.keys[a.id] = a.std.slice();
      save();
    },
    matches, label, apply,
    onChange(fn) { listeners.push(fn); }
  };
})();
