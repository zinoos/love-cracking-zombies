/* Prozeduraler Sound per WebAudio - keine Asset-Dateien noetig. */
const SFX = (() => {
  let ctx = null, master = null, muted = false;
  let noiseBuf = null;

  function init() {
    if (ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 8; comp.attack.value = 0.003;
    master.connect(comp).connect(ctx.destination);

    const len = ctx.sampleRate * 1.2;
    noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  function resume() { init(); if (ctx && ctx.state === 'suspended') ctx.resume(); }

  function gainAt(vol, t, attack, decay) {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol), t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    return g;
  }

  function noise(t, dur, vol, filterType, f0, f1) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    const flt = ctx.createBiquadFilter();
    flt.type = filterType || 'bandpass';
    flt.frequency.setValueAtTime(f0, t);
    if (f1) flt.frequency.exponentialRampToValueAtTime(Math.max(40, f1), t + dur);
    flt.Q.value = 1.2;
    const g = gainAt(vol, t, 0.004, dur);
    src.connect(flt).connect(g).connect(master);
    src.start(t); src.stop(t + dur + 0.05);
  }

  function tone(t, dur, vol, type, f0, f1) {
    const o = ctx.createOscillator();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f0, t);
    if (f1) o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = gainAt(vol, t, 0.006, dur);
    o.connect(g).connect(master);
    o.start(t); o.stop(t + dur + 0.05);
  }

  /** vol wird ueber Distanz zum Spieler skaliert */
  function dist2vol(d) {
    if (d == null) return 1;
    return Math.max(0, 1 - d / 900) ** 1.6;
  }

  const api = {
    resume,
    get muted() { return muted; },
    toggle() { muted = !muted; if (master) master.gain.value = muted ? 0 : 0.5; return muted; },
    setVolume(v) { if (master) master.gain.value = muted ? 0 : v; },

    /** Mündungsknall - Klangfarbe je Waffe. */
    shoot(d, weapon) {
      if (!ctx || muted) return;
      const t = ctx.currentTime, v = dist2vol(d);
      if (v <= 0.01) return;
      switch (weapon) {
        case 'ak47':
          noise(t, 0.07, 0.5 * v, 'bandpass', 2000, 420);
          tone(t, 0.08, 0.3 * v, 'square', 260, 60);
          break;
        case 'sniper':
          noise(t, 0.22, 0.7 * v, 'lowpass', 3200, 240);
          tone(t, 0.28, 0.45 * v, 'sawtooth', 180, 34);
          tone(t + 0.01, 0.12, 0.2 * v, 'square', 700, 90);
          break;
        case 'shotgun':
          noise(t, 0.18, 0.72 * v, 'lowpass', 1800, 200);
          tone(t, 0.16, 0.36 * v, 'square', 150, 45);
          break;
        case 'minigun':
          noise(t, 0.05, 0.34 * v, 'bandpass', 2600, 700);
          tone(t, 0.05, 0.2 * v, 'square', 380, 120);
          break;
        case 'bazooka':
          noise(t, 0.45, 0.6 * v, 'lowpass', 900, 120);
          tone(t, 0.5, 0.35 * v, 'sawtooth', 220, 50);
          break;
        default:
          noise(t, 0.09, 0.55 * v, 'bandpass', 2400, 500);
          tone(t, 0.10, 0.32 * v, 'square', 340, 70);
          tone(t + 0.005, 0.05, 0.16 * v, 'sawtooth', 900, 180);
      }
    },
    boom(d) {
      if (!ctx || muted) return;
      const t = ctx.currentTime, v = dist2vol(d);
      if (v <= 0.01) return;
      noise(t, 0.9, 0.85 * v, 'lowpass', 1400, 60);
      tone(t, 0.8, 0.5 * v, 'sawtooth', 110, 22);
      tone(t + 0.02, 0.35, 0.3 * v, 'square', 60, 28);
      noise(t + 0.04, 0.5, 0.3 * v, 'highpass', 900, 300);
    },
    /** Schwerthieb - Luftzug, bei Treffer zusaetzlich ein Klirren. */
    swing(d, hits) {
      if (!ctx || muted) return;
      const t = ctx.currentTime, v = dist2vol(d);
      noise(t, 0.14, 0.3 * v, 'bandpass', 900, 3200);
      tone(t, 0.1, 0.12 * v, 'triangle', 420, 900);
      if (hits > 0) {
        noise(t + 0.02, 0.1, 0.4 * v, 'bandpass', 3200, 1400);
        tone(t + 0.02, 0.16, 0.22 * v, 'square', 1500, 600);
      }
    },
    throwNade(d) {
      if (!ctx || muted) return;
      const t = ctx.currentTime, v = dist2vol(d);
      noise(t, 0.12, 0.24 * v, 'bandpass', 700, 2200);
      tone(t, 0.08, 0.14 * v, 'triangle', 520, 260);
    },
    impact(d) {
      if (!ctx || muted) return;
      const t = ctx.currentTime, v = dist2vol(d) * 0.6;
      if (v <= 0.01) return;
      noise(t, 0.06, 0.3 * v, 'highpass', 3000, 1200);
    },
    hit(d) {
      if (!ctx || muted) return;
      const t = ctx.currentTime, v = dist2vol(d);
      noise(t, 0.07, 0.4 * v, 'bandpass', 900, 300);
      tone(t, 0.08, 0.25 * v, 'triangle', 180, 90);
    },
    hitmark() {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      tone(t, 0.05, 0.28, 'square', 1500, 1500);
      tone(t + 0.03, 0.05, 0.22, 'square', 2100, 2100);
    },
    death(d) {
      if (!ctx || muted) return;
      const t = ctx.currentTime, v = dist2vol(d);
      noise(t, 0.5, 0.5 * v, 'lowpass', 1400, 120);
      tone(t, 0.55, 0.4 * v, 'sawtooth', 180, 28);
      tone(t + 0.02, 0.3, 0.2 * v, 'square', 90, 40);
    },
    kill() {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      [523, 659, 880].forEach((f, i) => tone(t + i * 0.07, 0.16, 0.3, 'triangle', f, f * 1.01));
    },
    reload() {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      noise(t, 0.05, 0.3, 'bandpass', 1800, 900);
      noise(t + 0.9, 0.06, 0.34, 'bandpass', 1200, 600);
    },
    reloaded() {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      noise(t, 0.05, 0.36, 'bandpass', 2600, 1400);
      tone(t, 0.06, 0.16, 'square', 620, 900);
    },
    dash(d) {
      if (!ctx || muted) return;
      const t = ctx.currentTime, v = dist2vol(d);
      noise(t, 0.22, 0.3 * v, 'bandpass', 400, 2200);
    },
    pickup() {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      [660, 990].forEach((f, i) => tone(t + i * 0.06, 0.14, 0.26, 'sine', f, f * 1.5));
    },
    empty() {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      noise(t, 0.04, 0.22, 'highpass', 4000, 2000);
    },
    ui(up) {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      tone(t, 0.07, 0.14, 'triangle', up ? 520 : 380, up ? 780 : 300);
    },
    countdown(n) {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      tone(t, 0.16, 0.3, 'triangle', n > 0 ? 440 : 880, n > 0 ? 440 : 1320);
    },
    win() {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      [523, 659, 784, 1046].forEach((f, i) => tone(t + i * 0.13, 0.4, 0.3, 'triangle', f, f));
    },
    lose() {
      if (!ctx || muted) return;
      const t = ctx.currentTime;
      [392, 330, 262].forEach((f, i) => tone(t + i * 0.17, 0.5, 0.28, 'sawtooth', f, f * 0.98));
    }
  };
  return api;
})();
