/* Partikel, Decals, Schwebetexte, Screenshake, Leichen-/Kill-Animation. */
const FX = (() => {
  const parts = [];
  const rings = [];
  const arcs = [];
  const texts = [];
  const decals = [];
  const corpses = [];
  const trails = [];
  let shakeMag = 0, shakeT = 0, shakeSeed = Math.random() * 999;
  let flashA = 0, flashColor = '#fff';
  let slowmo = 0;

  const rnd = (a, b) => a + Math.random() * (b - a);

  /* Einstellungen koennen Partikel ganz abschalten und das Wackeln daempfen.
     SETTINGS wird vor fx.js geladen; die Abfrage bleibt trotzdem defensiv,
     damit fx.js auch allein lauffaehig ist (Tests laden es einzeln). */
  const magPartikel = () => (typeof SETTINGS === 'undefined' ? true : SETTINGS.eff.particles);
  const wackelFaktor = () => (typeof SETTINGS === 'undefined' ? 1 : SETTINGS.eff.shake);

  function part(o) {
    if (!magPartikel()) return;
    if (parts.length > 1400) parts.shift();
    const p = Object.assign({
      x: 0, y: 0, vx: 0, vy: 0, life: .5, max: .5, r: 2, color: '#fff',
      grav: 0, drag: 2.2, glow: 1, shape: 'dot', spin: 0, ang: 0, fade: 1
    }, o);
    /* max gehoert zur Lebensdauer und wird hier gesetzt. Frueher griff burst()
       dafuer nachtraeglich auf das zuletzt eingefuegte Partikel zu - sobald
       part() nichts mehr einfuegt (Partikel aus), war das ein Zugriff ins
       Leere und der Effekt stuerzte ab. */
    if (o && o.max === undefined) p.max = p.life;
    parts.push(p);
  }

  function burst(x, y, n, opts) {
    for (let i = 0; i < n; i++) {
      const a = opts.ang !== undefined ? opts.ang + rnd(-opts.spread, opts.spread) : rnd(0, Math.PI * 2);
      const s = rnd(opts.spdMin || 40, opts.spdMax || 200);
      part(Object.assign({}, opts, {
        x: x + rnd(-2, 2), y: y + rnd(-2, 2),
        vx: Math.cos(a) * s, vy: Math.sin(a) * s,
        ang: a, spin: rnd(-8, 8),
        life: rnd(opts.lifeMin || .25, opts.lifeMax || .6),
        r: rnd(opts.rMin || 1.2, opts.rMax || 3.4),
        max: undefined
      }));
    }
  }

  const API = {
    parts, rings, arcs, texts, decals, corpses, trails,

    muzzle(x, y, ang, color) {
      burst(x, y, 9, { ang, spread: .38, spdMin: 160, spdMax: 430, color: '#fff3c4', rMin: 1, rMax: 2.6, lifeMin: .06, lifeMax: .16, drag: 6 });
      burst(x, y, 5, { ang, spread: .8, spdMin: 20, spdMax: 90, color: 'rgba(180,180,190,.5)', rMin: 3, rMax: 7, lifeMin: .2, lifeMax: .45, drag: 1.4, shape: 'smoke' });
      rings.push({ x, y, r: 2, max: 22, life: .14, t: .14, color: color || '#ffd166', w: 3 });
      // Huelse
      const sa = ang + Math.PI / 2 + rnd(-.3, .3);
      part({ x, y, vx: Math.cos(sa) * rnd(70, 150), vy: Math.sin(sa) * rnd(70, 150) - 40, color: '#e0b64a', r: 1.8, life: .8, max: .8, grav: 340, drag: .6, shape: 'shell', spin: rnd(-16, 16) });
    },

    impact(x, y, ang) {
      burst(x, y, 10, { ang: ang + Math.PI, spread: 1.0, spdMin: 60, spdMax: 260, color: '#ffe6a8', rMin: .8, rMax: 2.2, lifeMin: .12, lifeMax: .35, drag: 4 });
      burst(x, y, 4, { ang: ang + Math.PI, spread: 1.4, spdMin: 10, spdMax: 60, color: 'rgba(200,200,210,.35)', rMin: 2, rMax: 5, lifeMin: .3, lifeMax: .6, shape: 'smoke', drag: 1 });
      rings.push({ x, y, r: 1, max: 12, life: .16, t: .16, color: '#ffe6a8', w: 2 });
      if (magPartikel()) decals.push({ x, y, r: rnd(2, 3.4), a: .5, kind: 'hole' });
      if (decals.length > 160) decals.shift();
    },

    blood(x, y, ang, color) {
      burst(x, y, 14, { ang, spread: .9, spdMin: 60, spdMax: 320, color: color || '#ff3b57', rMin: 1.2, rMax: 3.6, lifeMin: .2, lifeMax: .55, drag: 3, grav: 120 });
      rings.push({ x, y, r: 2, max: 26, life: .2, t: .2, color: color || '#ff3b57', w: 2.5 });
      if (magPartikel()) decals.push({ x, y, r: rnd(4, 9), a: .34, kind: 'blood', color: color || '#8b1024' });
      if (decals.length > 160) decals.shift();
    },

    dash(x, y, dx, dy, color) {
      burst(x, y, 16, { ang: Math.atan2(-dy, -dx), spread: .6, spdMin: 60, spdMax: 240, color, rMin: 1, rMax: 3, lifeMin: .2, lifeMax: .45, drag: 3 });
      rings.push({ x, y, r: 6, max: 40, life: .28, t: .28, color, w: 3 });
    },

    death(x, y, color, ang) {
      burst(x, y, 42, { spdMin: 60, spdMax: 420, color, rMin: 1.4, rMax: 4.6, lifeMin: .35, lifeMax: 1.0, drag: 2.4, grav: 90 });
      burst(x, y, 20, { spdMin: 20, spdMax: 140, color: 'rgba(255,255,255,.55)', rMin: 3, rMax: 9, lifeMin: .4, lifeMax: .9, shape: 'smoke', drag: 1.2 });
      burst(x, y, 12, { ang, spread: .7, spdMin: 120, spdMax: 380, color: '#ff3b57', rMin: 1.5, rMax: 3.5, lifeMin: .3, lifeMax: .7, grav: 200, drag: 2 });
      rings.push({ x, y, r: 4, max: 120, life: .5, t: .5, color, w: 5 });
      rings.push({ x, y, r: 2, max: 70, life: .34, t: .34, color: '#fff', w: 2.5 });
      if (magPartikel()) decals.push({ x, y, r: 16, a: .4, kind: 'blood', color: '#7d0f20' });
    },

    corpse(p, ang) {
      corpses.push({
        x: p.x, y: p.y, ang: p.a || 0, color: p.color, pattern: p.pattern,
        vx: Math.cos(ang) * 150, vy: Math.sin(ang) * 150, spin: rnd(-9, 9), rot: 0,
        life: 3.2, max: 3.2, name: p.name, zombie: !!p.zombie
      });
      if (corpses.length > 12) corpses.shift();
    },

    /** Explosion: Feuerball, Rauch, Trueummer, Druckwelle, Brandfleck. */
    explosion(x, y, radius, kind) {
      const big = radius / 110;
      burst(x, y, Math.round(34 * big), {
        spdMin: 80, spdMax: 260 * big, color: '#fff0b8', rMin: 2, rMax: 6 * big,
        lifeMin: .12, lifeMax: .3, drag: 4
      });
      burst(x, y, Math.round(30 * big), {
        spdMin: 60, spdMax: 340 * big, color: '#ff8c2a', rMin: 2.5, rMax: 7 * big,
        lifeMin: .25, lifeMax: .55, drag: 3
      });
      burst(x, y, Math.round(22 * big), {
        spdMin: 20, spdMax: 150 * big, color: 'rgba(70,66,62,.75)', rMin: 5, rMax: 15 * big,
        lifeMin: .5, lifeMax: 1.3, shape: 'smoke', drag: 1.1
      });
      // Trueummer
      burst(x, y, Math.round(16 * big), {
        spdMin: 120, spdMax: 420 * big, color: '#6b6157', rMin: 1.5, rMax: 3.5,
        lifeMin: .4, lifeMax: .9, grav: 320, drag: 1.4, shape: 'shell', spin: 12
      });
      rings.push({ x, y, r: 4, max: radius * 1.15, life: .34, t: .34, color: '#ffd27a', w: 7 });
      rings.push({ x, y, r: 2, max: radius * 1.6, life: .5, t: .5, color: 'rgba(255,255,255,.8)', w: 3 });
      if (magPartikel()) decals.push({ x, y, r: radius * 0.42, a: .5, kind: 'scorch' });
      if (decals.length > 160) decals.shift();
      void kind;
    },

    /** Schwerthieb: Klingenbogen plus Funken. */
    swing(x, y, ang, color) {
      arcs.push({ x, y, ang, life: .22, t: .22, color: color || '#dbe7f7' });
      burst(x + Math.cos(ang) * 34, y + Math.sin(ang) * 34, 7, {
        ang, spread: .8, spdMin: 60, spdMax: 220, color: '#eaf2ff',
        rMin: 1, rMax: 2.6, lifeMin: .1, lifeMax: .26, drag: 5
      });
    },

    /** Muendung des Flammenwerfers: Glut und Rauch statt Muendungsblitz. */
    flameMuzzle(x, y, ang) {
      burst(x, y, 5, {
        ang, spread: .3, spdMin: 90, spdMax: 240, color: '#ffcf6a',
        rMin: 1.5, rMax: 3.6, lifeMin: .1, lifeMax: .26, drag: 5
      });
      burst(x, y, 3, {
        ang, spread: .6, spdMin: 20, spdMax: 70, color: 'rgba(90,80,74,.5)',
        rMin: 3, rMax: 7, lifeMin: .3, lifeMax: .6, shape: 'smoke', drag: 1.4
      });
    },

    /** Brennender Spieler: kleine Flammenzungen. */
    burn(x, y) {
      burst(x, y, 5, {
        ang: -Math.PI / 2, spread: .9, spdMin: 20, spdMax: 70,
        color: '#ff9d3c', rMin: 1.5, rMax: 3.5, lifeMin: .25, lifeMax: .5,
        drag: 1.6, grav: -60
      });
      burst(x, y, 2, {
        ang: -Math.PI / 2, spread: .7, spdMin: 10, spdMax: 40,
        color: 'rgba(80,70,66,.6)', rMin: 3, rMax: 6, lifeMin: .4, lifeMax: .8,
        shape: 'smoke', drag: 1.1, grav: -40
      });
    },

    /** Discofunken - fuer Sergios Schallplatte. */
    party(x, y) {
      const farben = ['#ff3b8d', '#ffd166', '#3fd0ff', '#b16bff', '#4ade80'];
      for (let i = 0; i < 10; i++) {
        burst(x, y, 1, {
          spdMin: 60, spdMax: 240, color: farben[i % farben.length],
          rMin: 1.4, rMax: 3.2, lifeMin: .2, lifeMax: .5, drag: 3.4
        });
      }
      rings.push({ x, y, r: 3, max: 30, life: .26, t: .26, color: farben[Math.floor(Math.random() * 5)], w: 2.5 });
    },

    pickup(x, y, type) {
      const col = type === 'health' ? '#4ade80' : '#ffd166';
      burst(x, y, 18, { spdMin: 40, spdMax: 180, color: col, rMin: 1.2, rMax: 3, lifeMin: .3, lifeMax: .6, drag: 3 });
      rings.push({ x, y, r: 4, max: 46, life: .35, t: .35, color: col, w: 3 });
    },

    text(x, y, str, color, size, up) {
      texts.push({ x, y, str, color: color || '#fff', size: size || 16, life: .95, max: .95, vy: up === undefined ? -46 : up, vx: rnd(-14, 14) });
      if (texts.length > 40) texts.shift();
    },

    trail(x0, y0, x1, y1, color) {
      if (!magPartikel()) return;
      trails.push({ x0, y0, x1, y1, color: color || '#ffd166', life: .16, max: .16 });
      if (trails.length > 90) trails.shift();
    },

    shake(mag, time) {
      const f = wackelFaktor();
      if (f <= 0) return;
      shakeMag = Math.max(shakeMag, mag * f);
      shakeT = Math.max(shakeT, time || .25);
    },
    flash(color, a) { flashColor = color; flashA = Math.max(flashA, a); },
    slow(t) { slowmo = Math.max(slowmo, t); },
    get slowmo() { return slowmo; },

    get shakeOffset() {
      if (shakeT <= 0) return { x: 0, y: 0 };
      const k = shakeMag * (shakeT);
      const t = performance.now() / 42 + shakeSeed;
      return { x: Math.sin(t * 1.7) * k + Math.sin(t * 4.3) * k * .4, y: Math.cos(t * 2.1) * k + Math.cos(t * 5.1) * k * .4 };
    },
    get flashAlpha() { return flashA; },
    get flashCol() { return flashColor; },

    clear() {
      parts.length = 0; rings.length = 0; arcs.length = 0; texts.length = 0;
      decals.length = 0; corpses.length = 0; trails.length = 0;
      shakeMag = 0; shakeT = 0; flashA = 0; slowmo = 0;
    },

    update(dt) {
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.life -= dt;
        if (p.life <= 0) { parts.splice(i, 1); continue; }
        p.vy += p.grav * dt;
        const d = Math.max(0, 1 - p.drag * dt);
        p.vx *= d; p.vy *= d;
        p.x += p.vx * dt; p.y += p.vy * dt;
        p.ang += p.spin * dt;
      }
      for (let i = rings.length - 1; i >= 0; i--) {
        const r = rings[i]; r.t -= dt;
        if (r.t <= 0) { rings.splice(i, 1); continue; }
        const k = 1 - r.t / r.life;
        r.r = 2 + (r.max - 2) * (1 - Math.pow(1 - k, 3));
      }
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i]; t.life -= dt;
        if (t.life <= 0) { texts.splice(i, 1); continue; }
        t.y += t.vy * dt; t.x += t.vx * dt; t.vy *= (1 - 1.6 * dt);
      }
      for (let i = trails.length - 1; i >= 0; i--) {
        trails[i].life -= dt;
        if (trails[i].life <= 0) trails.splice(i, 1);
      }
      for (let i = arcs.length - 1; i >= 0; i--) {
        arcs[i].t -= dt;
        if (arcs[i].t <= 0) arcs.splice(i, 1);
      }
      for (let i = corpses.length - 1; i >= 0; i--) {
        const c = corpses[i]; c.life -= dt;
        if (c.life <= 0) { corpses.splice(i, 1); continue; }
        c.x += c.vx * dt; c.y += c.vy * dt;
        c.vx *= (1 - 3.2 * dt); c.vy *= (1 - 3.2 * dt);
        c.rot += c.spin * dt; c.spin *= (1 - 2.4 * dt);
      }
      for (let i = decals.length - 1; i >= 0; i--) {
        decals[i].a -= dt * 0.02;
        if (decals[i].a <= 0) decals.splice(i, 1);
      }
      if (shakeT > 0) { shakeT = Math.max(0, shakeT - dt); if (shakeT === 0) shakeMag = 0; }
      if (flashA > 0) flashA = Math.max(0, flashA - dt * 3.2);
      if (slowmo > 0) slowmo = Math.max(0, slowmo - dt);
    }
  };
  return API;
})();
