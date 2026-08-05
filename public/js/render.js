/* Canvas-Renderer: Map-Backing, Fog-of-War, animierte Spieler, Partikel, Minimap. */
const RENDER = (() => {
  const cv = document.getElementById('cv');
  const ctx = cv.getContext('2d');
  const mm = document.getElementById('minimap');
  const mctx = mm.getContext('2d');

  let W = 0, H = 0, DPR = 1;
  let mapCv = null, mapCtx = null;
  let curMap = null;
  let time = 0;

  const BIOME = {
    urban: { floor: '#262e40', floor2: '#2d374c', wall: '#59698c', wallTop: '#8093bd', edge: '#a8bce6', accent: '#3fd0ff' },
    industrial: { floor: '#2c2a25', floor2: '#34322c', wall: '#70634f', wallTop: '#9a8869', edge: '#c0aa86', accent: '#ff9d3c' },
    forest: { floor: '#1f2e25', floor2: '#25372c', wall: '#48644c', wallTop: '#658767', edge: '#8fb182', accent: '#4ade80' },
    concrete: { floor: '#2b2c31', floor2: '#33343a', wall: '#5e606c', wallTop: '#828694', edge: '#a5a9b6', accent: '#b9c4d6' },
    neon: { floor: '#1b2240', floor2: '#212a50', wall: '#42549c', wallTop: '#5c73cc', edge: '#a3b5ff', accent: '#b16bff' },
    sand: { floor: '#3b3327', floor2: '#453b2d', wall: '#836b45', wallTop: '#a98a5b', edge: '#d0b078', accent: '#ffd166' },
    canyon: { floor: '#352726', floor2: '#3e2e2d', wall: '#7c4e4c', wallTop: '#a26866', edge: '#cc8a8b', accent: '#ff7a5c' }
  };
  const biome = () => BIOME[curMap && curMap.biome] || BIOME.urban;

  function resize() {
    DPR = Math.min(2, window.devicePixelRatio || 1);
    W = cv.clientWidth; H = cv.clientHeight;
    cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  }
  window.addEventListener('resize', resize);

  /* ---------- Statische Map-Ebene ---------- */
  function hash2(tx, ty) {
    let h = (tx * 73856093) ^ (ty * 19349663);
    h = (h ^ (h >>> 13)) >>> 0;
    return (h % 1000) / 1000;
  }

  function isWallAt(tx, ty) {
    if (tx < 0 || ty < 0 || tx >= curMap.n || ty >= curMap.n) return true;
    return curMap.tiles[ty * curMap.n + tx] === C.T_WALL;
  }

  /** Boden (und ggf. Schutt) einer Kachel. */
  function paintGround(g, tx, ty, b) {
    const T = C.TILE, x = tx * T, y = ty * T;
    g.fillStyle = (tx + ty) % 2 === 0 ? b.floor2 : b.floor;
    g.fillRect(x, y, T, T);
    // deterministisches Korn - damit Nachzeichnen nicht flackert
    g.globalAlpha = .05;
    for (let i = 0; i < 6; i++) {
      const a = hash2(tx * 7 + i, ty * 11 + i * 3);
      const c = hash2(ty * 5 + i * 2, tx * 3 + i);
      g.fillStyle = a < .5 ? '#fff' : '#000';
      g.fillRect(x + a * (T - 2), y + c * (T - 2), 2, 2);
    }
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(255,255,255,.028)';
    g.lineWidth = 1;
    g.strokeRect(x + .5, y + .5, T - 1, T - 1);

    if (curMap.tiles[ty * curMap.n + tx] === C.T_RUBBLE) paintRubble(g, tx, ty, b);
  }

  /** Zerstoerte Wand: Schuttbrocken, begehbar, keine Deckung. */
  function paintRubble(g, tx, ty, b) {
    const T = C.TILE, x = tx * T, y = ty * T;
    g.fillStyle = 'rgba(0,0,0,.3)';
    g.fillRect(x, y, T, T);
    for (let i = 0; i < 7; i++) {
      const a = hash2(tx * 13 + i, ty * 17 + i);
      const c = hash2(ty * 5 + i, tx * 3 + i);
      const s = 4 + a * 9;
      g.fillStyle = i % 2 ? shade(b.wall, -14) : shade(b.wallTop, -40);
      g.save();
      g.translate(x + 5 + a * (T - 12), y + 5 + c * (T - 12));
      g.rotate(a * 6);
      g.fillRect(-s / 2, -s / 3, s, s * .66);
      g.restore();
    }
    g.fillStyle = 'rgba(20,14,8,.35)';
    for (let i = 0; i < 5; i++) {
      const a = hash2(tx + i * 31, ty + i * 47);
      g.fillRect(x + a * (T - 3), y + hash2(ty + i * 7, tx + i * 5) * (T - 3), 3, 3);
    }
  }

  /** Wandkoerper inkl. Kanten. */
  function paintWall(g, tx, ty, b) {
    const T = C.TILE, x = tx * T, y = ty * T;
    const grad = g.createLinearGradient(x, y, x, y + T);
    grad.addColorStop(0, b.wallTop);
    grad.addColorStop(1, b.wall);
    g.fillStyle = grad;
    g.fillRect(x, y, T, T);
    g.strokeStyle = b.edge;
    g.lineWidth = 2;
    g.beginPath();
    if (!isWallAt(tx, ty - 1)) { g.moveTo(x, y + 1); g.lineTo(x + T, y + 1); }
    if (!isWallAt(tx, ty + 1)) { g.moveTo(x, y + T - 1); g.lineTo(x + T, y + T - 1); }
    if (!isWallAt(tx - 1, ty)) { g.moveTo(x + 1, y); g.lineTo(x + 1, y + T); }
    if (!isWallAt(tx + 1, ty)) { g.moveTo(x + T - 1, y); g.lineTo(x + T - 1, y + T); }
    g.stroke();
    if (!isWallAt(tx, ty - 1)) {
      g.fillStyle = b.accent;
      g.globalAlpha = .18;
      g.fillRect(x, y, T, 3);
      g.globalAlpha = 1;
    }
  }

  /** Kachelbereich neu malen - beim Aufbau und nach jeder Sprengung. */
  function repaintRegion(tx0, ty0, tx1, ty1) {
    const T = C.TILE, n = curMap.n, b = biome(), g = mapCtx;
    tx0 = Math.max(0, tx0); ty0 = Math.max(0, ty0);
    tx1 = Math.min(n - 1, tx1); ty1 = Math.min(n - 1, ty1);
    g.save();
    g.beginPath();
    g.rect(tx0 * T, ty0 * T, (tx1 - tx0 + 1) * T, (ty1 - ty0 + 1) * T);
    g.clip();
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) paintGround(g, tx, ty, b);
    // Schatten fallen nach unten rechts -> Quellkachel oben/links mitnehmen
    g.fillStyle = 'rgba(0,0,0,.45)';
    for (let ty = ty0 - 1; ty <= ty1; ty++) {
      for (let tx = tx0 - 1; tx <= tx1; tx++) {
        if (isWallAt(tx, ty)) g.fillRect(tx * T + 5, ty * T + 6, T, T);
      }
    }
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      if (isWallAt(tx, ty)) paintWall(g, tx, ty, b);
    }
    g.restore();
  }

  function buildMap(map) {
    curMap = map;
    buildBushSprites();
    const T = C.TILE, n = map.n, size = n * T;
    mapCv = document.createElement('canvas');
    mapCv.width = size; mapCv.height = size;
    mapCtx = mapCv.getContext('2d');
    repaintRegion(0, 0, n - 1, n - 1);
    resetMemory(n);
    aimSmoothed = null;
  }

  /** Zerstoerte Kacheln vom Server uebernehmen und nachzeichnen. */
  function updateTiles(changes) {
    if (!curMap || !mapCtx || !changes || !changes.length) return;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of changes) {
      curMap.tiles[c.y * curMap.n + c.x] = c.v;
      if (c.x < x0) x0 = c.x; if (c.x > x1) x1 = c.x;
      if (c.y < y0) y0 = c.y; if (c.y > y1) y1 = c.y;
    }
    repaintRegion(x0 - 2, y0 - 2, x1 + 2, y1 + 2);
  }


  /* ---------- Kamera ---------- */
  const cam = { x: 0, y: 0, scale: 1, shakeX: 0, shakeY: 0 };

  function updateCamera(g, dt) {
    const target = g.viewTarget();
    // Empfindlichkeit regelt, wie weit die Kamera zum Zeiger zieht
    const sens = typeof SETTINGS !== 'undefined' ? SETTINGS.eff.sens : 1;
    const lead = g.mouseWorld ? 0.14 * sens : 0;
    const tx = target.x + (g.mouseWorld ? (g.mouseWorld.x - target.x) * lead : 0);
    const ty = target.y + (g.mouseWorld ? (g.mouseWorld.y - target.y) * lead : 0);
    const k = 1 - Math.pow(0.0009, dt);
    cam.x += (tx - cam.x) * k;
    cam.y += (ty - cam.y) * k;

    const worldSize = curMap ? curMap.n * C.TILE : 1280;
    cam.scale = Math.max(0.7, Math.min(1.9, Math.min(W / 1000, H / 620)));
    const halfW = W / 2 / cam.scale, halfH = H / 2 / cam.scale;
    cam.x = worldSize <= halfW * 2 ? worldSize / 2 : Math.max(halfW, Math.min(worldSize - halfW, cam.x));
    cam.y = worldSize <= halfH * 2 ? worldSize / 2 : Math.max(halfH, Math.min(worldSize - halfH, cam.y));
  }

  function worldToScreen(x, y) {
    return { x: (x - cam.x) * cam.scale + W / 2 + cam.shakeX, y: (y - cam.y) * cam.scale + H / 2 + cam.shakeY };
  }
  function screenToWorld(sx, sy) {
    return { x: (sx - W / 2 - cam.shakeX) / cam.scale + cam.x, y: (sy - H / 2 - cam.shakeY) / cam.scale + cam.y };
  }

  /* ---------- Adaptive Qualitaet ----------
     Nicht jeder Rechner packt die volle Darstellung. Die Zeichenzeit wird
     gemessen; wird es zaeh, fallen zuerst die teuren Effekte weg (Weichzeichner,
     Strahlendichte, Nebelaufloesung). Erholt sich die Bildrate, geht es wieder
     hoch. So ruckelt es auf schwacher Hardware nicht, ohne dass starke Rechner
     etwas verlieren. */
  const QUALITY = [
    { name: 'hoch', rays: 200, blur: 7, fogScale: 0.5, memEvery: 4 },
    { name: 'mittel', rays: 130, blur: 4, fogScale: 0.4, memEvery: 6 },
    { name: 'niedrig', rays: 80, blur: 0, fogScale: 0.34, memEvery: 10 }
  ];
  let qLevel = 0;
  let drawAvg = 2;
  let qHold = 0;
  let qPinned = -1;      // -1 = automatisch, sonst feste Stufe

  /** Stufe festnageln (0 hoch … 2 niedrig) oder mit -1 zurueck auf automatisch. */
  function setQuality(level) {
    qPinned = (typeof level === 'number' && level >= 0) ? Math.min(QUALITY.length - 1, level | 0) : -1;
    if (qPinned >= 0) qLevel = qPinned;
    drawAvg = 5; qHold = 0;
    return QUALITY[qLevel].name;
  }

  function tuneQuality(ms, dt) {
    // Gleitender Mittelwert - einzelne Ausreisser sollen nichts umschalten
    drawAvg += (ms - drawAvg) * 0.06;
    if (qPinned >= 0) return;
    qHold -= dt;
    if (qHold > 0) return;
    if (drawAvg > 9 && qLevel < QUALITY.length - 1) {
      qLevel++; qHold = 3; drawAvg = 5;
      console.info('[Render] Qualitaet ->', QUALITY[qLevel].name);
    } else if (drawAvg < 3 && qLevel > 0) {
      qLevel--; qHold = 6; drawAvg = 5;
      console.info('[Render] Qualitaet ->', QUALITY[qLevel].name);
    }
  }
  const q = () => QUALITY[qLevel];

  /* ---------- Sichtpolygon ---------- */
  let visPoly = [];
  /**
   * Sichtpolygon als Stern um den Spieler: innerhalb des Blickkegels bis zur
   * vollen Reichweite, ausserhalb nur bis FOV_NEAR. So entsteht in einem Zug
   * die Vereinigung aus Kegel und Nahbereich - ohne Polygon-Verschneidung.
   */
  function computeVisibility(ox, oy, aim) {
    visPoly.length = 0;
    const half = C.FOV / 2;
    const RAYS = q().rays;
    for (let i = 0; i < RAYS; i++) {
      const a = (i / RAYS) * Math.PI * 2;
      let rel = a - aim;
      while (rel > Math.PI) rel -= Math.PI * 2;
      while (rel < -Math.PI) rel += Math.PI * 2;
      const inCone = Math.abs(rel) <= half;
      const max = inCone ? C.VIEW_RADIUS : C.FOV_NEAR;
      const dx = Math.cos(a), dy = Math.sin(a);
      const d = PHYS.raycast(curMap, ox, oy, dx, dy, max);
      visPoly.push(ox + dx * (d + 2), oy + dy * (d + 2));
    }
  }

  /* ---------- Nebel / Schatten ----------
     Die Sichtmaske wird auf eine eigene, halb aufgeloeste Ebene gezeichnet und
     beim Zusammensetzen weichgezeichnet. Das kostet kaum etwas und nimmt der
     Strahlenkante ihre Zacken. */
  let fogCv = null, fogCtx = null;

  /* Gedaechtnis: einmal gesehenes Gelaende bleibt schwach sichtbar. Liegt als
     winziges Canvas in Kachelaufloesung (32x32 px) und wird hochskaliert -
     kostet praktisch nichts und macht die Orientierung viel angenehmer. */
  let memCv = null, memCtx = null;
  function resetMemory(n) {
    memCv = document.createElement('canvas');
    memCv.width = memCv.height = n;
    memCtx = memCv.getContext('2d');
    memCtx.clearRect(0, 0, n, n);
  }

  /** Kacheln entlang der Sichtstrahlen als erkundet markieren.
      Laeuft nur jeden 4. Frame und nur auf jedem 2. Strahl - der Spieler
      bewegt sich in 60 ms nicht weit genug, als dass man es sieht. */
  let seenFrame = 0;
  function markSeen(ox, oy) {
    if (!memCtx) return;
    if (++seenFrame % q().memEvery) return;
    const T = C.TILE, n = memCv.width;
    memCtx.fillStyle = '#fff';
    for (let i = 0; i < visPoly.length; i += 4) {
      const dx = visPoly[i] - ox, dy = visPoly[i + 1] - oy;
      const steps = Math.max(1, Math.ceil(Math.hypot(dx, dy) / T));
      let lastTx = -1, lastTy = -1;
      for (let s = 0; s <= steps; s++) {
        const tx = ((ox + dx * (s / steps)) / T) | 0;
        const ty = ((oy + dy * (s / steps)) / T) | 0;
        if (tx === lastTx && ty === lastTy) continue;   // gleiche Kachel ueberspringen
        lastTx = tx; lastTy = ty;
        if (tx >= 0 && ty >= 0 && tx < n && ty < n) memCtx.fillRect(tx, ty, 1, 1);
      }
    }
  }

  function ensureFog() {
    const fw = Math.max(2, Math.round(W * q().fogScale));
    const fh = Math.max(2, Math.round(H * q().fogScale));
    if (!fogCv) { fogCv = document.createElement('canvas'); fogCtx = fogCv.getContext('2d'); }
    if (fogCv.width !== fw || fogCv.height !== fh) { fogCv.width = fw; fogCv.height = fh; }
  }

  // Blickrichtung fuer die Sicht leicht nachziehen -> kein Springen der Kante
  let aimSmoothed = null;
  function smoothAim(aim, dt) {
    if (aimSmoothed === null) { aimSmoothed = aim; return aim; }
    let d = aim - aimSmoothed;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    aimSmoothed += d * Math.min(1, dt * 26);
    return aimSmoothed;
  }

  function drawFog(me, view) {
    ensureFog();
    const FOG_SCALE = q().fogScale;
    const s = cam.scale * FOG_SCALE;
    const g = fogCtx;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, fogCv.width, fogCv.height);
    g.fillStyle = '#4c5470';
    g.fillRect(0, 0, fogCv.width, fogCv.height);

    // Weltkoordinaten auf die Nebelebene abbilden
    g.setTransform(s, 0, 0, s, fogCv.width / 2 + cam.shakeX * FOG_SCALE, fogCv.height / 2 + cam.shakeY * FOG_SCALE);
    g.translate(-cam.x, -cam.y);

    g.globalCompositeOperation = 'destination-out';

    // Erkundetes Gelaende schwach aufhellen - man weiss, wo man schon war.
    // Nur den sichtbaren Ausschnitt kopieren statt der ganzen Weltflaeche.
    if (memCv) {
      const T = C.TILE, n = curMap.n;
      const tx0 = Math.max(0, Math.floor(view.x0 / T)), ty0 = Math.max(0, Math.floor(view.y0 / T));
      const tx1 = Math.min(n, Math.ceil(view.x1 / T)), ty1 = Math.min(n, Math.ceil(view.y1 / T));
      const tw = tx1 - tx0, th = ty1 - ty0;
      if (tw > 0 && th > 0) {
        g.save();
        g.globalAlpha = 0.42;
        g.imageSmoothingEnabled = true;
        g.drawImage(memCv, tx0, ty0, tw, th, tx0 * T, ty0 * T, tw * T, th * T);
        g.restore();
      }
    }

    // Sichtbares Gebiet ausstanzen, zum Rand hin weicher
    const lg = g.createRadialGradient(me.rx, me.ry, C.FOV_NEAR * 0.6, me.rx, me.ry, C.VIEW_RADIUS);
    lg.addColorStop(0, 'rgba(0,0,0,1)');
    lg.addColorStop(.72, 'rgba(0,0,0,.94)');
    lg.addColorStop(1, 'rgba(0,0,0,.45)');
    g.fillStyle = lg;
    g.beginPath();
    g.moveTo(visPoly[0], visPoly[1]);
    for (let i = 2; i < visPoly.length; i += 2) g.lineTo(visPoly[i], visPoly[i + 1]);
    g.closePath();
    g.fill();
    g.globalCompositeOperation = 'source-over';

    // Weichgezeichnet ueber die Szene legen
    ctx.save();
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.globalCompositeOperation = 'multiply';
    // Weichzeichner ist der teuerste Schritt - faellt auf schwacher Hardware weg
    if (q().blur > 0) ctx.filter = `blur(${q().blur}px)`;
    ctx.drawImage(fogCv, 0, 0, W, H);
    ctx.filter = 'none';
    ctx.restore();
  }

  /* ---------- Zeichen-Helfer ---------- */
  function roundRect(g, x, y, w, h, r) {
    g.beginPath();
    g.moveTo(x + r, y);
    g.arcTo(x + w, y, x + w, y + h, r);
    g.arcTo(x + w, y + h, x, y + h, r);
    g.arcTo(x, y + h, x, y, r);
    g.arcTo(x, y, x + w, y, r);
    g.closePath();
  }

  /* Buesche werden einmal als Sprites gebacken - pro Frame nur noch drawImage. */
  const BUSH_SS = Math.round(C.TILE * 1.7);
  let bushSprites = [];
  function buildBushSprites() {
    bushSprites = [];
    const T = C.TILE;
    for (let v = 0; v < 5; v++) {
      const c = document.createElement('canvas');
      c.width = c.height = BUSH_SS;
      const g = c.getContext('2d');
      g.translate(BUSH_SS / 2, BUSH_SS / 2);
      const seed = v / 5 + 0.11;
      g.fillStyle = 'rgba(0,0,0,.32)';
      g.beginPath(); g.ellipse(3, 5, T * 0.55, T * 0.42, 0, 0, 7); g.fill();
      const grd = g.createRadialGradient(-6, -8, 2, 0, 0, T * 0.62);
      grd.addColorStop(0, '#4c8f56');
      grd.addColorStop(.6, '#2f6a3c');
      grd.addColorStop(1, '#1a4327');
      g.fillStyle = grd;
      for (let k = 0; k < 5; k++) {
        const a = (k / 5) * Math.PI * 2 + seed * 6;
        const rr = T * (0.28 + ((seed * 13 + k) % 3) * 0.045);
        g.beginPath();
        g.ellipse(Math.cos(a) * T * .2, Math.sin(a) * T * .18, rr, rr * .86, a, 0, 7);
        g.fill();
      }
      g.globalAlpha = .38;
      g.fillStyle = '#7fe89a';
      for (let k = 0; k < 4; k++) {
        const a = seed * 20 + k * 1.7;
        g.beginPath();
        g.ellipse(Math.cos(a) * 9, Math.sin(a) * 8 - 4, 4.5, 2.6, a, 0, 7);
        g.fill();
      }
      g.globalAlpha = 1;
      bushSprites.push(c);
    }
  }

  function drawBushes(g, view) {
    const T = C.TILE, n = curMap.n;
    const x0 = Math.max(0, Math.floor(view.x0 / T)), x1 = Math.min(n - 1, Math.ceil(view.x1 / T));
    const y0 = Math.max(0, Math.floor(view.y0 / T)), y1 = Math.min(n - 1, Math.ceil(view.y1 / T));
    const half = BUSH_SS / 2;
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (curMap.tiles[ty * n + tx] !== C.T_BUSH) continue;
        const cx = tx * T + T / 2, cy = ty * T + T / 2;
        const h = (tx * 7 + ty * 13) % 5;
        const ph = (tx * 0.7 + ty * 1.3);
        const sway = Math.sin(time * 1.6 + ph) * 2.4;
        const s = 1 + Math.sin(time * 2.1 + ph) * 0.035;
        g.drawImage(bushSprites[h], cx - half * s + sway, cy - half * s, BUSH_SS * s, BUSH_SS * s);
      }
    }
  }

  function shade(hex, amt) {
    const c = hex.replace('#', '');
    let r = parseInt(c.slice(0, 2), 16), gg = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
    r = Math.max(0, Math.min(255, r + amt)); gg = Math.max(0, Math.min(255, gg + amt)); b = Math.max(0, Math.min(255, b + amt));
    return `rgb(${r},${gg},${b})`;
  }

  /* =============== Cartoon-Soldat (Top-Down) ===============
     Zeichnet in lokalen Koordinaten: +x zeigt in Blickrichtung.
     Uniform, Helm, Arme und Beine uebernehmen die Skin-Farbe. */
  const INK = '#1c1408';        // Cartoon-Outline
  const FLESH = '#ffc24a';      // Gesicht/Haende wie in der Vorlage
  const FLESH_SH = '#e09a2c';
  const BOOT = '#5b4426';
  const SPIN_WIND = 0.45;       // Ausholwinkel vor dem Rundumschlag
  const STOCK = '#8a5124';
  const STOCK_D = '#5f3517';
  const STEEL = '#3b332a';

  function ink(g, w) { g.strokeStyle = INK; g.lineWidth = w; g.lineJoin = 'round'; g.stroke(); }

  /** Gliedmasse als Strich mit Cartoon-Kontur */
  function limb(g, x0, y0, x1, y1, w, col, lw) {
    g.lineCap = 'round';
    g.strokeStyle = INK; g.lineWidth = w + lw * 2;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
    g.strokeStyle = col; g.lineWidth = w;
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
  }

  function torsoPath(g, r) {
    // Breiter als tief -> Schultern dominieren die Silhouette
    g.beginPath();
    g.ellipse(-r * .1, 0, r * .92, r * 1.0, 0, 0, 7);
  }

  /** Tarnmuster auf der Uniform - auf die Torsoform geclippt. */
  function uniformPattern(g, p, r) {
    if (!p.pattern || p.pattern === 'solid') return;
    const dark = shade(p.color, -46), light = shade(p.color, 42);
    const u = r / 14;
    g.save();
    torsoPath(g, r); g.clip();
    g.globalAlpha = .62;
    switch (p.pattern) {
      case 'stripe':
        g.fillStyle = dark;
        for (let i = -r; i < r; i += 6 * u) g.fillRect(i, -r, 2.8 * u, r * 2);
        break;
      case 'dots':
        g.fillStyle = dark;
        for (let y = -r; y < r; y += 6.5 * u) {
          for (let x = -r; x < r; x += 6.5 * u) {
            const o = ((((x * 7 + y * 13) % 5) + 5) % 5) / 5;
            g.beginPath();
            g.ellipse(x + o * 4 * u, y + (1 - o) * 3 * u, 2.7 * u, 1.9 * u, o * 3, 0, 7);
            g.fill();
          }
        }
        break;
      case 'ring':
        g.fillStyle = light;
        g.fillRect(-r, -r * .66, r * 2, 2.8 * u);
        g.fillRect(-r, r * .48, r * 2, 2.8 * u);
        break;
      case 'shard':
        g.fillStyle = dark;
        g.beginPath();
        g.moveTo(-r, -r); g.lineTo(r * .35, -r * .35); g.lineTo(-r * .2, r * .45); g.lineTo(-r, r * .25);
        g.closePath(); g.fill();
        g.fillStyle = light;
        g.beginPath();
        g.moveTo(r, -r * .15); g.lineTo(r * .1, r * .25); g.lineTo(r, r);
        g.closePath(); g.fill();
        break;
    }
    g.globalAlpha = 1;
    g.restore();
  }

  /**
   * Waffe in lokalen Koordinaten (+x = Laufrichtung, Ursprung am Griff).
   * Gibt die Griffpunkte fuer die Haende zurueck.
   */
  function drawWeapon(g, r, LW, key, o) {
    const spin = (o && o.spin) || 0;
    switch (key) {
      case 'ak47': {
        g.fillStyle = STOCK;
        roundRect(g, -r * 1.0, -r * .14, r * .95, r * .28, r * .08); g.fill(); ink(g, LW);
        g.fillStyle = STEEL;
        roundRect(g, -r * .2, -r * .13, r * 1.15, r * .26, r * .07); g.fill(); ink(g, LW * .85);
        roundRect(g, r * .9, -r * .08, r * .85, r * .16, r * .06); g.fill(); ink(g, LW * .8);
        // Bananenmagazin
        g.fillStyle = shade(STEEL, 18);
        g.save(); g.translate(r * .05, r * .16); g.rotate(0.35);
        roundRect(g, -r * .1, 0, r * .22, r * .5, r * .06); g.fill(); ink(g, LW * .8);
        g.restore();
        g.fillStyle = STOCK_D;
        roundRect(g, r * .45, -r * .2, r * .3, r * .1, r * .04); g.fill();
        return { front: r * 1.0, back: r * .1 };
      }
      case 'sniper': {
        g.fillStyle = STOCK_D;
        roundRect(g, -r * 1.15, -r * .15, r * 1.0, r * .3, r * .08); g.fill(); ink(g, LW);
        g.fillStyle = STEEL;
        roundRect(g, -r * .3, -r * .1, r * 2.35, r * .2, r * .06); g.fill(); ink(g, LW * .85);
        // Zielfernrohr
        g.fillStyle = '#20242e';
        roundRect(g, r * .05, -r * .3, r * .7, r * .2, r * .07); g.fill(); ink(g, LW * .8);
        g.fillStyle = '#6fd8ff';
        g.beginPath(); g.arc(r * .7, -r * .2, r * .07, 0, 7); g.fill();
        // Zweibein
        g.strokeStyle = STEEL; g.lineWidth = LW * 1.1;
        g.beginPath();
        g.moveTo(r * 1.3, 0); g.lineTo(r * 1.5, r * .32);
        g.moveTo(r * 1.3, 0); g.lineTo(r * 1.1, r * .32);
        g.stroke();
        return { front: r * 1.25, back: r * .0 };
      }
      case 'shotgun': {
        g.fillStyle = STOCK;
        roundRect(g, -r * 1.0, -r * .17, r * 1.0, r * .34, r * .1); g.fill(); ink(g, LW);
        g.fillStyle = STEEL;
        roundRect(g, -r * .1, -r * .16, r * 1.55, r * .14, r * .05); g.fill(); ink(g, LW * .8);
        roundRect(g, -r * .1, r * .02, r * 1.55, r * .14, r * .05); g.fill(); ink(g, LW * .8);
        g.fillStyle = STOCK_D;
        roundRect(g, r * .35, -r * .05, r * .45, r * .12, r * .05); g.fill();
        return { front: r * .95, back: r * .05 };
      }
      case 'minigun': {
        // Rotierender Laufblock
        g.fillStyle = '#2b303c';
        roundRect(g, -r * .55, -r * .28, r * .95, r * .56, r * .12); g.fill(); ink(g, LW);
        // Munitionstrommel
        g.fillStyle = shade(STEEL, 10);
        g.beginPath(); g.ellipse(-r * .55, r * .3, r * .34, r * .28, 0, 0, 7); g.fill(); ink(g, LW);
        g.fillStyle = '#e8bb3d';
        g.beginPath(); g.arc(-r * .55, r * .3, r * .1, 0, 7); g.fill();
        // sechs Laeufe, drehen beim Anlauf
        for (let i = 0; i < 6; i++) {
          const a = (i / 6) * Math.PI * 2 + spin;
          const off = Math.sin(a) * r * .17;
          const dim = 0.5 + 0.5 * Math.cos(a);
          g.fillStyle = i % 2 ? shade(STEEL, 22 * dim) : shade(STEEL, -10);
          roundRect(g, r * .35, off - r * .055, r * 1.35, r * .11, r * .045); g.fill();
        }
        g.strokeStyle = INK; g.lineWidth = LW * .8;
        g.strokeRect(r * .35, -r * .22, r * 1.35, r * .44);
        return { front: r * .5, back: -r * .3 };
      }
      case 'bazooka': {
        // Rohr
        g.fillStyle = '#3f4a3a';
        roundRect(g, -r * 1.1, -r * .26, r * 3.0, r * .52, r * .16); g.fill(); ink(g, LW * 1.1);
        // Muendungstrichter
        g.fillStyle = '#2c3429';
        g.beginPath();
        g.moveTo(r * 1.6, -r * .26); g.lineTo(r * 1.9, -r * .4);
        g.lineTo(r * 1.9, r * .4); g.lineTo(r * 1.6, r * .26);
        g.closePath(); g.fill(); ink(g, LW);
        // Heckabgas
        g.fillStyle = '#22281f';
        g.beginPath();
        g.moveTo(-r * 1.1, -r * .26); g.lineTo(-r * 1.35, -r * .34);
        g.lineTo(-r * 1.35, r * .34); g.lineTo(-r * 1.1, r * .26);
        g.closePath(); g.fill(); ink(g, LW);
        // Visier + Warnring
        g.fillStyle = '#c8442f';
        g.fillRect(r * .5, -r * .26, r * .18, r * .52);
        g.fillStyle = STEEL;
        roundRect(g, r * .1, -r * .42, r * .12, r * .2, r * .04); g.fill();
        return { front: r * 1.15, back: -r * .35 };
      }
      case 'sword': {
        // Klinge nach vorn, Griff am Koerper
        g.fillStyle = '#5a3a1e';
        roundRect(g, -r * .3, -r * .1, r * .42, r * .2, r * .07); g.fill(); ink(g, LW);
        // Parierstange
        g.fillStyle = '#c9a227';
        roundRect(g, r * .1, -r * .34, r * .12, r * .68, r * .05); g.fill(); ink(g, LW * .9);
        // Klinge
        const bl = g.createLinearGradient(r * .2, -r * .1, r * 1.7, r * .1);
        bl.addColorStop(0, '#e8eef8');
        bl.addColorStop(.5, '#ffffff');
        bl.addColorStop(1, '#b9c6d8');
        g.fillStyle = bl;
        g.beginPath();
        g.moveTo(r * .22, -r * .13);
        g.lineTo(r * 1.5, -r * .09);
        g.lineTo(r * 1.78, 0);
        g.lineTo(r * 1.5, r * .09);
        g.lineTo(r * .22, r * .13);
        g.closePath(); g.fill(); ink(g, LW);
        // Blutrille
        g.strokeStyle = 'rgba(120,140,170,.7)'; g.lineWidth = LW * .8;
        g.beginPath(); g.moveTo(r * .3, 0); g.lineTo(r * 1.45, 0); g.stroke();
        g.fillStyle = '#c9a227';
        g.beginPath(); g.arc(-r * .32, 0, r * .1, 0, 7); g.fill(); ink(g, LW * .8);
        return { front: r * .55, back: -r * .2 };
      }
      case 'mine': {
        // Wurfrohr mit Minenmagazin
        g.fillStyle = '#3a4232';
        roundRect(g, -r * .5, -r * .18, r * 1.5, r * .36, r * .12); g.fill(); ink(g, LW);
        g.fillStyle = '#2b3126';
        roundRect(g, r * .8, -r * .24, r * .3, r * .48, r * .1); g.fill(); ink(g, LW * .9);
        // Minen im Gurt
        g.fillStyle = '#4a5540';
        for (let i = 0; i < 2; i++) {
          g.beginPath(); g.ellipse(-r * .18 + i * r * .3, r * .34, r * .13, r * .1, 0, 0, 7); g.fill();
          ink(g, LW * .75);
        }
        g.fillStyle = '#c8442f';
        g.beginPath(); g.arc(r * .3, -r * .26, r * .07, 0, 7); g.fill();
        return { front: r * .75, back: -r * .35 };
      }
      case 'smg': {
        g.fillStyle = '#23272f';
        roundRect(g, -r * .55, -r * .15, r * 1.5, r * .3, r * .09); g.fill(); ink(g, LW);
        g.fillStyle = shade(STEEL, 24);
        roundRect(g, r * .55, -r * .09, r * .75, r * .18, r * .06); g.fill();
        // langes Stangenmagazin nach unten
        g.fillStyle = '#20242e';
        roundRect(g, -r * .05, r * .12, r * .2, r * .62, r * .06); g.fill(); ink(g, LW * .8);
        g.fillStyle = '#3a4150';
        roundRect(g, -r * .58, -r * .1, r * .22, r * .2, r * .06); g.fill();
        return { front: r * .8, back: -r * .05 };
      }
      case 'revolver': {
        g.fillStyle = shade(STEEL, 16);
        roundRect(g, -r * .2, -r * .13, r * 1.15, r * .26, r * .08); g.fill(); ink(g, LW);
        // Trommel
        g.fillStyle = '#4a515f';
        g.beginPath(); g.arc(r * .12, 0, r * .21, 0, 7); g.fill(); ink(g, LW * .9);
        g.fillStyle = '#20242e';
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          g.beginPath(); g.arc(r * .12 + Math.cos(a) * r * .11, Math.sin(a) * r * .11, r * .04, 0, 7); g.fill();
        }
        g.fillStyle = '#6b4a2a';
        g.save(); g.translate(-r * .18, r * .08); g.rotate(0.3);
        roundRect(g, -r * .12, 0, r * .26, r * .46, r * .09); g.fill(); ink(g, LW * .85);
        g.restore();
        return { front: r * .8, back: -r * .1 };
      }
      case 'flamer': {
        // Tank auf dem Ruecken
        g.fillStyle = '#7a2f24';
        g.beginPath(); g.ellipse(-r * .75, r * .1, r * .3, r * .38, 0, 0, 7); g.fill(); ink(g, LW);
        g.fillStyle = '#a8463a';
        g.beginPath(); g.ellipse(-r * .75, r * .0, r * .16, r * .14, 0, 0, 7); g.fill();
        // Schlauch
        g.strokeStyle = '#2b2b30'; g.lineWidth = LW * 2.2; g.lineCap = 'round';
        g.beginPath();
        g.moveTo(-r * .55, r * .05); g.quadraticCurveTo(-r * .1, r * .4, r * .3, r * .05);
        g.stroke();
        // Duese
        g.fillStyle = '#3a3a42';
        roundRect(g, r * .1, -r * .11, r * 1.15, r * .22, r * .07); g.fill(); ink(g, LW);
        g.fillStyle = '#ff9d3c';
        g.beginPath(); g.arc(r * 1.28, 0, r * .1, 0, 7); g.fill();
        g.fillStyle = '#ffd166';
        g.beginPath(); g.arc(r * 1.3, 0, r * .05, 0, 7); g.fill();
        return { front: r * .95, back: -r * .05 };
      }
      case 'crossbow': {
        // Schaft
        g.fillStyle = '#6b4a2a';
        roundRect(g, -r * .7, -r * .11, r * 1.9, r * .22, r * .07); g.fill(); ink(g, LW);
        // Bogenarme quer
        g.strokeStyle = '#3a3f36'; g.lineWidth = LW * 1.8; g.lineCap = 'round';
        g.beginPath();
        g.moveTo(r * .85, -r * .62); g.quadraticCurveTo(r * 1.15, 0, r * .85, r * .62);
        g.stroke();
        // Sehne
        g.strokeStyle = '#d8d2c0'; g.lineWidth = LW * .8;
        g.beginPath(); g.moveTo(r * .85, -r * .6); g.lineTo(r * .3, 0); g.lineTo(r * .85, r * .6); g.stroke();
        // Bolzen
        g.fillStyle = '#c8c2b0';
        roundRect(g, r * .3, -r * .045, r * 1.0, r * .09, r * .03); g.fill();
        g.fillStyle = '#8d949f';
        g.beginPath(); g.moveTo(r * 1.3, -r * .1); g.lineTo(r * 1.5, 0); g.lineTo(r * 1.3, r * .1); g.closePath(); g.fill();
        return { front: r * .75, back: -r * .4 };
      }
      case 'sergio': {
        const puls = 0.5 + 0.5 * Math.sin(time * 9);
        // Gehaeuse
        g.fillStyle = '#23252e';
        roundRect(g, -r * .5, -r * .62, r * 1.5, r * 1.24, r * .16); g.fill(); ink(g, LW);
        g.fillStyle = '#2e313c';
        roundRect(g, -r * .42, -r * .54, r * 1.34, r * 1.08, r * .12); g.fill();
        // Zwei Plattenteller
        [-1, 1].forEach(s => {
          const cx = r * .18, cy = s * r * .32;
          g.fillStyle = '#14151a';
          g.beginPath(); g.arc(cx, cy, r * .26, 0, 7); g.fill(); ink(g, LW * .8);
          g.strokeStyle = 'rgba(255,255,255,.16)'; g.lineWidth = LW * .5;
          g.beginPath(); g.arc(cx, cy, r * .16, 0, 7); g.stroke();
          g.fillStyle = DISC_COL[(s > 0 ? 0 : 2)];
          g.beginPath(); g.arc(cx, cy, r * .08, 0, 7); g.fill();
        });
        // Mischpult mit blinkenden Reglern
        g.fillStyle = '#1a1c23';
        roundRect(g, r * .52, -r * .34, r * .42, r * .68, r * .08); g.fill();
        for (let i = 0; i < 3; i++) {
          g.fillStyle = DISC_COL[(i + Math.floor(time * 6)) % DISC_COL.length];
          g.globalAlpha = .45 + .55 * puls;
          g.fillRect(r * .58, -r * .26 + i * r * .2, r * .3, r * .09);
        }
        g.globalAlpha = 1;
        // Lautsprecher vorn
        g.fillStyle = '#15161b';
        g.beginPath(); g.arc(r * 1.12, 0, r * .22, 0, 7); g.fill(); ink(g, LW * .8);
        g.strokeStyle = `rgba(255,255,255,${.12 + .2 * puls})`; g.lineWidth = LW * .7;
        g.beginPath(); g.arc(r * 1.12, 0, r * .12, 0, 7); g.stroke();
        return { front: r * .55, back: -r * .3 };
      }
      case 'grenadier': {
        g.fillStyle = '#4a5540';
        roundRect(g, -r * .8, -r * .2, r * 2.0, r * .4, r * .13); g.fill(); ink(g, LW);
        // dickes Rohrende
        g.fillStyle = '#39412f';
        g.beginPath(); g.ellipse(r * 1.2, 0, r * .16, r * .26, 0, 0, 7); g.fill(); ink(g, LW * .9);
        // Trommelmagazin
        g.fillStyle = '#5c6a4f';
        g.beginPath(); g.arc(-r * .1, r * .34, r * .28, 0, 7); g.fill(); ink(g, LW * .9);
        g.fillStyle = '#39412f';
        g.beginPath(); g.arc(-r * .1, r * .34, r * .1, 0, 7); g.fill();
        g.fillStyle = '#2b3126';
        roundRect(g, -r * .82, -r * .12, r * .22, r * .24, r * .07); g.fill();
        return { front: r * .95, back: -r * .2 };
      }
      default: { // Pistole
        g.fillStyle = STEEL;
        roundRect(g, -r * .25, -r * .16, r * .95, r * .32, r * .1); g.fill(); ink(g, LW);
        g.fillStyle = shade(STEEL, 30);
        roundRect(g, r * .1, -r * .1, r * .75, r * .2, r * .07); g.fill();
        g.fillStyle = '#20242e';
        g.save(); g.translate(-r * .12, r * .1); g.rotate(0.25);
        roundRect(g, -r * .12, 0, r * .26, r * .5, r * .07); g.fill(); ink(g, LW * .85);
        g.restore();
        return { front: r * .7, back: -r * .05 };
      }
    }
  }

  /**
   * Cartoon-Soldat von oben. +x = Blickrichtung.
   * @param opts {walk: -1..1 Schrittphase, dead: bool, spin: Minigun-Drehwinkel}
   */
  function drawSoldier(g, p, radius, opts) {
    const o = opts || {};
    const r = radius * 1.45;
    const LW = Math.max(0.9, r * 0.032);
    const uni = p.color;
    const uniD = shade(uni, -26);      // Helm
    const uniDD = shade(uni, -52);     // Arme/Beine
    const uniL = shade(uni, 22);       // Schulterpolster
    const walk = o.walk || 0;

    /* ---------- Rundumschlag ----------
       Das Schwert trifft in alle Richtungen, also dreht sich der ganze Soldat
       einmal um sich selbst: kurz gegenanhalten, dann eine schnelle volle
       Umdrehung, die exakt in der Ausgangslage endet. Klinge und Arme bleiben
       dabei in Grundhaltung - die Drehung des Koerpers ist die Bewegung. */
    const sw = C.WEAPONS.sword;
    let spin = 0, lunge = 0;
    if (o.swing > 0 && p.weapon === 'sword') {
      const k = 1 - Math.min(1, o.swing / sw.swingTime);   // 0 Beginn -> 1 Ende
      if (k < 0.2) {
        const a = k / 0.2;                                  // Ausholen gegen die Drehrichtung
        spin = -SPIN_WIND * a;
        lunge = -r * .08 * a;
      } else {
        const a = (k - 0.2) / 0.8;
        const eased = 1 - Math.pow(1 - a, 2.2);
        spin = -SPIN_WIND + (Math.PI * 2 + SPIN_WIND) * eased;   // endet bei 2 PI = Ausgangslage
        lunge = r * .2 * Math.sin(a * Math.PI);
      }
    }

    /* Hiebspur: der Ring, den die Klinge bisher gezogen hat. Ohne ihn ist die
       Drehung bei 0,26 s kaum zu erkennen. */
    if (spin > 0.05) {
      const prog = spin / (Math.PI * 2);
      g.save();
      g.lineCap = 'round';
      g.globalAlpha = 0.3 * (1 - prog * 0.55);
      g.strokeStyle = '#dceaff';
      g.lineWidth = r * .4;
      g.beginPath(); g.arc(0, 0, r * 1.08, -SPIN_WIND, spin); g.stroke();
      g.globalAlpha = 0.7 * (1 - prog * 0.6);
      g.strokeStyle = '#ffffff';
      g.lineWidth = r * .11;
      g.beginPath(); g.arc(0, 0, r * 1.34, -SPIN_WIND, spin); g.stroke();
      g.globalAlpha = 1;
      g.restore();
    }

    // Ab hier dreht sich der Koerper mit. Immer setzen, damit die Zeichen-
    // reihenfolge unabhaengig vom Hieb gleich bleibt.
    g.save();
    g.rotate(spin);

    // ---------- Rucksack (hinter allem) ----------
    g.fillStyle = shade(uni, -44);
    roundRect(g, -r * 1.02, -r * .44, r * .46, r * .88, r * .18); g.fill(); ink(g, LW);
    g.fillStyle = shade(uni, -60);
    roundRect(g, -r * .95, -r * .3, r * .3, r * .6, r * .12); g.fill();
    // Rollmatte oben drauf
    g.fillStyle = BOOT;
    roundRect(g, -r * 1.06, -r * .5, r * .5, r * .16, r * .08); g.fill(); ink(g, LW * .8);

    // ---------- Beine + Stiefel ----------
    [-1, 1].forEach(side => {
      const off = side * walk * r * .34;
      const hipX = -r * .26, hipY = side * r * .38;
      const kneeX = -r * .52 + off * .6, kneeY = side * r * .46;
      const footX = -r * .8 + off, footY = side * r * .5;
      limb(g, hipX, hipY, kneeX, kneeY, r * .22, uniDD, LW);   // Oberschenkel
      limb(g, kneeX, kneeY, footX, footY, r * .18, uniDD, LW); // Unterschenkel
      // Stiefel mit Sohle
      g.save();
      g.translate(footX - r * .05, footY);
      g.rotate(side * 0.12);
      g.fillStyle = BOOT;
      roundRect(g, -r * .2, -r * .16, r * .44, r * .32, r * .12); g.fill(); ink(g, LW);
      g.fillStyle = shade(BOOT, -34);
      roundRect(g, -r * .2, r * .04, r * .44, r * .12, r * .06); g.fill();
      g.restore();
    });

    // ---------- Torso ----------
    g.fillStyle = uni;
    torsoPath(g, r); g.fill();
    uniformPattern(g, p, r);
    // Weste mit Taschen
    g.save();
    torsoPath(g, r); g.clip();
    g.fillStyle = shade(uni, -30);
    roundRect(g, -r * .5, -r * .58, r * .78, r * 1.16, r * .16); g.fill();
    g.fillStyle = shade(uni, -46);
    [-1, 1].forEach(side => {
      roundRect(g, -r * .34, side * r * .16 - r * .14, r * .3, r * .28, r * .07); g.fill();
    });
    // Guertel + Schnalle
    g.fillStyle = STOCK_D;
    g.fillRect(-r * .46, -r, r * .18, r * 2);
    g.fillStyle = '#e8bb3d';
    g.fillRect(-r * .44, -r * .14, r * .14, r * .28);
    g.restore();
    torsoPath(g, r); ink(g, LW * 1.25);

    // ---------- Schultern ----------
    [-1, 1].forEach(side => {
      g.fillStyle = uniL;
      g.beginPath();
      g.ellipse(r * .04, side * r * .62, r * .3, r * .22, side * 0.25, 0, 7);
      g.fill(); ink(g, LW);
      g.fillStyle = 'rgba(255,255,255,.14)';
      g.beginPath();
      g.ellipse(r * .1, side * r * .6, r * .16, r * .1, side * 0.25, 0, 7);
      g.fill();
    });

    // ---------- Arme mit Ellbogen ----------
    const gunY = r * .3;
    const handX = r * .98 + lunge;
    const handY = gunY - r * .04;
    // vorderer Arm: Schulter -> Ellbogen -> Hand an der Waffe
    limb(g, r * .04, -r * .58, r * .42, -r * .3, r * .19, uniDD, LW);
    limb(g, r * .42, -r * .3, handX, handY, r * .17, FLESH_SH, LW);
    // hinterer Arm: Schulter -> Ellbogen -> Hand am Abzug
    limb(g, -r * .1, r * .6, r * .06, r * .5, r * .19, uniDD, LW);
    limb(g, r * .06, r * .5, r * .26, gunY + r * .12, r * .17, FLESH_SH, LW);

    // ---------- Waffe ----------
    g.save();
    g.translate(r * .24 + lunge, gunY);
    g.rotate(-0.08);
    const grip = drawWeapon(g, r, LW, p.weapon || 'pistol', o);
    g.restore();

    // ---------- Haende ----------
    g.fillStyle = FLESH;
    const hg1 = [r * .24 + lunge + grip.front, gunY - r * .06];
    [hg1, [r * .24 + lunge + grip.back, gunY + r * .13]].forEach(h => {
      g.beginPath(); g.arc(h[0], h[1], r * .16, 0, 7); g.fill(); ink(g, LW * .9);
    });

    // ---------- Hals ----------
    const hx = -r * .3;
    g.fillStyle = FLESH_SH;
    roundRect(g, r * .05, -r * .22, r * .34, r * .44, r * .14); g.fill(); ink(g, LW * .9);

    // ---------- Kinnriemen ----------
    g.fillStyle = uniD;
    [-1, 1].forEach(side => {
      g.beginPath();
      g.ellipse(hx + r * .18, side * r * .5, r * .13, r * .23, side * 0.35, 0, 7);
      g.fill(); ink(g, LW);
    });

    // ---------- Helm (unter dem Gesicht -> Gesicht schaut vorn heraus) ----------
    const hcx = r * .16;
    const hrx = r * .5, hry = r * .54;
    const hg = g.createRadialGradient(hcx - r * .18, -r * .22, r * .04, hcx, 0, hrx);
    hg.addColorStop(0, shade(uni, 24));
    hg.addColorStop(1, uniD);
    g.fillStyle = hg;
    g.beginPath(); g.ellipse(hcx, 0, hrx, hry, 0, 0, 7); g.fill();
    ink(g, LW * 1.25);
    g.strokeStyle = shade(uni, -46); g.lineWidth = LW * 1.3;
    g.beginPath(); g.ellipse(hcx, 0, hrx * .72, hry * .72, 0, 0, 7); g.stroke();
    g.strokeStyle = 'rgba(20,14,6,.45)'; g.lineWidth = LW * .7; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(hcx - r * .26, -r * .18); g.lineTo(hcx + r * .08, -r * .02);
    g.moveTo(hcx - r * .02, -r * .26); g.lineTo(hcx - r * .3, r * .02);
    g.stroke();
    g.fillStyle = 'rgba(255,255,255,.3)';
    g.beginPath(); g.ellipse(hcx - r * .16, -r * .22, r * .2, r * .1, -0.5, 0, 7); g.fill();

    // ---------- Kopf ----------
    const fx = r * .5;
    g.fillStyle = FLESH;
    g.beginPath(); g.ellipse(fx, 0, r * .42, r * .46, 0, 0, 7); g.fill();
    ink(g, LW * 1.1);
    // Wangenrundung
    g.save();
    g.beginPath(); g.ellipse(fx, 0, r * .42, r * .46, 0, 0, 7); g.clip();
    g.fillStyle = 'rgba(0,0,0,.2)';
    g.fillRect(fx - r * .42, -r, r * .3, r * 2);
    g.fillStyle = 'rgba(255,255,255,.16)';
    g.beginPath(); g.ellipse(fx + r * .2, -r * .16, r * .18, r * .12, 0, 0, 7); g.fill();
    g.restore();
    g.fillStyle = FLESH_SH;
    [-1, 1].forEach(side => {
      g.beginPath(); g.ellipse(fx + r * .12, side * r * .3, r * .1, r * .07, 0, 0, 7); g.fill();
    });

    if (o.dead) {
      g.strokeStyle = INK; g.lineWidth = LW * 1.3; g.lineCap = 'round';
      [-1, 1].forEach(side => {
        const ex = fx + r * .12, ey = side * r * .2, s = r * .1;
        g.beginPath();
        g.moveTo(ex - s, ey - s); g.lineTo(ex + s, ey + s);
        g.moveTo(ex + s, ey - s); g.lineTo(ex - s, ey + s);
        g.stroke();
      });
      g.beginPath(); g.arc(fx + r * .3, 0, r * .1, -0.9, 0.9); g.stroke();
    } else {
      [-1, 1].forEach(side => {
        g.fillStyle = '#fff';
        g.beginPath(); g.ellipse(fx + r * .1, side * r * .21, r * .16, r * .13, 0, 0, 7); g.fill();
        ink(g, LW * .85);
        g.fillStyle = '#4a3520';
        g.beginPath(); g.arc(fx + r * .18, side * r * .21, r * .075, 0, 7); g.fill();
        g.fillStyle = 'rgba(255,255,255,.9)';
        g.beginPath(); g.arc(fx + r * .21, side * r * .19, r * .026, 0, 7); g.fill();
      });
      g.strokeStyle = INK; g.lineWidth = LW * 1.15; g.lineCap = 'round';
      g.beginPath();
      g.moveTo(fx - r * .1, -r * .38); g.lineTo(fx + r * .2, -r * .12);
      g.moveTo(fx - r * .1, r * .38); g.lineTo(fx + r * .2, r * .12);
      g.stroke();
      g.lineWidth = LW;
      g.beginPath(); g.moveTo(fx + r * .34, -r * .09); g.lineTo(fx + r * .34, r * .09); g.stroke();
    }

    void hx;
    g.restore();          // Koerperdrehung des Rundumschlags
  }


  function drawPlayer(g, p, isMe, g_) {
    const r = C.PLAYER_R;
    const x = p.rx, y = p.ry, a = p.ra;
    const moving = (p.mv || 0) > 30;
    const phase = p.walkPhase || 0;

    g.save();
    g.translate(x, y);

    /* Getarnt nach einem Schwert-Kill. Gegner bekommen diesen Spieler gar
       nicht erst geschickt - sichtbar ist er nur fuer sich selbst und das
       eigene Team, und dort als Schemen. */
    if (p.cloaked) g.globalAlpha *= 0.34;

    // Schatten
    g.fillStyle = 'rgba(0,0,0,.4)';
    g.beginPath(); g.ellipse(2, 4, r * 1.02, r * .82, 0, 0, 7); g.fill();

    // Dash-Nachzieher
    if (p.dash) {
      g.globalAlpha = .3;
      g.fillStyle = p.trail || '#fff';
      for (let i = 1; i <= 3; i++) {
        g.beginPath(); g.arc(-Math.cos(a) * i * 7, -Math.sin(a) * i * 7, r * (1 - i * .18), 0, 7); g.fill();
      }
      g.globalAlpha = 1;
    }

    // Team-/Eigenmarkierung als Bodenring (Cartoon-Figur bleibt frei von Umrissen)
    g.lineWidth = 2.6;
    g.strokeStyle = isMe ? '#ffffff' : (p.teamColor || 'rgba(255,255,255,.75)');
    g.beginPath(); g.ellipse(0, r * .5, r * 1.45, r * .72, 0, 0, 7); g.stroke();
    if (isMe) {
      g.strokeStyle = 'rgba(255,255,255,.28)';
      g.lineWidth = 1.2;
      g.beginPath(); g.ellipse(0, r * .5, r * 1.68, r * .88, 0, 0, 7); g.stroke();
    }

    /* Gekaufter Shop-Skin: seine Bewegung liegt unter der Figur, damit sie
       nicht das Gesicht verdeckt. Der Versatz aus der Spielerkennung sorgt
       dafuer, dass zwei Traeger desselben Skins nicht im Gleichtakt laufen. */
    if (p.fx) {
      const s = C.SHOP_SKINS.find(x => x.id === p.fx);
      if (s) skinEffekt(g, s.anim, r, time + (p.id || 0) * 0.37, s.color, s.trail);
    }

    g.rotate(a);
    drawSoldier(g, p, r, {
      walk: moving ? Math.sin(phase) : 0,
      spin: p.spinAngle || 0,
      swing: p.swingT || 0
    });
    g.restore();

    // Unverwundbarkeits-Schild
    if (p.invul) {
      g.save();
      g.translate(x, y);
      const pulse = .5 + .5 * Math.sin(time * 9);
      g.strokeStyle = `rgba(120,220,255,${.35 + pulse * .45})`;
      g.lineWidth = 2;
      g.beginPath(); g.arc(0, 0, r + 6 + pulse * 2, 0, 7); g.stroke();
      g.restore();
    }

    // Namensschild + HP
    if (!isMe) {
      const nameY = y - r - 16;
      g.font = '600 12px Rajdhani, Segoe UI, sans-serif';
      g.textAlign = 'center';
      g.lineWidth = 3;
      g.strokeStyle = 'rgba(0,0,0,.75)';
      g.strokeText(p.name, x, nameY);
      g.fillStyle = p.teamColor || '#dbe7f7';
      g.fillText(p.name, x, nameY);

      const bw = 34, bh = 4;
      g.fillStyle = 'rgba(0,0,0,.6)';
      roundRect(g, x - bw / 2, nameY + 4, bw, bh, 2); g.fill();
      const hp = Math.max(0, Math.min(1, (p.hp || 0) / C.HP_MAX));
      g.fillStyle = hp > .5 ? '#4ade80' : hp > .25 ? '#ffd166' : '#ff5c7a';
      roundRect(g, x - bw / 2, nameY + 4, bw * hp, bh, 2); g.fill();
      g.textAlign = 'left';
    }
    void g_;
  }

  function drawCorpse(g, c) {
    const k = c.life / c.max;
    g.save();
    g.globalAlpha = Math.min(1, k * 1.6);
    g.translate(c.x, c.y);
    g.rotate(c.ang + c.rot);
    const scale = 1 + (1 - k) * 0.22;
    g.scale(scale, scale * (0.62 + 0.38 * k));
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.ellipse(2, 3, C.PLAYER_R, C.PLAYER_R * .8, 0, 0, 7); g.fill();
    drawSoldier(g, c, C.PLAYER_R, { walk: 0, dead: true });
    g.restore();
  }

  function drawPickup(g, pk) {
    if (!pk.a) return;
    const bob = Math.sin(time * 2.6 + pk.i) * 3;
    const col = pk.ty === 'health' ? '#4ade80' : '#ffd166';
    g.save();
    g.translate(pk.x, pk.y + bob);
    const glow = g.createRadialGradient(0, 0, 8, 0, 0, 30);
    glow.addColorStop(0, col + '55');
    glow.addColorStop(1, col + '00');
    g.fillStyle = glow;
    g.beginPath(); g.arc(0, 0, 30, 0, 7); g.fill();
    g.rotate(Math.sin(time * 1.2 + pk.i) * .12);
    g.fillStyle = 'rgba(10,16,26,.9)';
    roundRect(g, -11, -11, 22, 22, 6); g.fill();
    g.strokeStyle = col; g.lineWidth = 2;
    roundRect(g, -11, -11, 22, 22, 6); g.stroke();
    g.shadowBlur = 0;
    g.fillStyle = col;
    if (pk.ty === 'health') {
      g.fillRect(-2.5, -7, 5, 14);
      g.fillRect(-7, -2.5, 14, 5);
    } else {
      for (let i = -1; i <= 1; i++) { roundRect(g, i * 5 - 1.6, -6, 3.2, 12, 1.4); g.fill(); }
    }
    g.restore();
    // Bodenring
    g.strokeStyle = col;
    g.globalAlpha = .18 + .12 * Math.sin(time * 3 + pk.i);
    g.lineWidth = 2;
    g.beginPath(); g.arc(pk.x, pk.y + 10, 15, 0, 7); g.stroke();
    g.globalAlpha = 1;
  }

  /** Mine: flach am Boden, blinkt wenn scharf. Nur der Besitzer sieht sie. */
  function drawMine(g, mi) {
    const armed = mi.s === 1;
    const ready = mi.rd === 1;
    g.save();
    g.translate(mi.x, mi.y);
    if (!armed) {
      // noch im Flug
      g.globalAlpha = .8;
      g.fillStyle = '#3a3f36';
      g.beginPath(); g.arc(0, 0, 6, 0, 7); g.fill();
      g.restore();
      return;
    }
    const blink = (Math.sin(time * 6) + 1) / 2;
    // Reichweitenring, damit man den Wirkungsbereich einschaetzen kann
    g.globalAlpha = .12 + blink * .08;
    g.strokeStyle = ready ? '#ff5c7a' : '#8fa4c4';
    g.lineWidth = 2;
    g.setLineDash([6, 8]);
    g.beginPath(); g.arc(0, 0, C.WEAPONS.mine.blastRadius, 0, 7); g.stroke();
    g.setLineDash([]);
    // Koerper
    g.globalAlpha = .9;
    g.fillStyle = '#2f3a2a';
    g.beginPath(); g.ellipse(0, 0, 9, 7, 0, 0, 7); g.fill();
    g.strokeStyle = '#1c1408'; g.lineWidth = 1.6; g.stroke();
    g.fillStyle = '#4a5540';
    g.beginPath(); g.arc(0, 0, 4.5, 0, 7); g.fill();
    // Zuendlampe
    g.globalAlpha = 1;
    g.fillStyle = ready
      ? `rgba(255,${70 + blink * 90},80,${.6 + blink * .4})`
      : 'rgba(140,164,196,.7)';
    g.beginPath(); g.arc(0, 0, 2.4 + blink * 1.2, 0, 7); g.fill();
    g.restore();
  }

  function drawParticles(g) {
    for (const p of FX.parts) {
      const k = Math.max(0, p.life / p.max);
      g.globalAlpha = k * (p.fade === undefined ? 1 : p.fade);
      g.fillStyle = p.color;
      if (p.shape === 'smoke') {
        g.beginPath(); g.arc(p.x, p.y, p.r * (2 - k), 0, 7); g.fill();
      } else if (p.shape === 'shell') {
        g.save(); g.translate(p.x, p.y); g.rotate(p.ang);
        g.fillRect(-2.4, -1.1, 4.8, 2.2);
        g.restore();
      } else {
        g.beginPath(); g.arc(p.x, p.y, p.r * (0.4 + k * 0.6), 0, 7); g.fill();
      }
    }
    g.globalAlpha = 1;
    // Klingenbogen des Schwerthiebs
    for (const a of FX.arcs) {
      const k = a.t / a.life;
      const sweep = C.WEAPONS.sword.arc;
      const from = a.ang - sweep / 2 + sweep * (1 - k);
      g.save();
      g.globalAlpha = k * .85;
      g.strokeStyle = a.color;
      g.lineWidth = 3 + k * 4;
      g.lineCap = 'round';
      g.beginPath();
      g.arc(a.x, a.y, C.WEAPONS.sword.range + C.PLAYER_R * .4, from - .35, from + .35);
      g.stroke();
      g.globalAlpha = k * .35;
      g.lineWidth = 1.5;
      g.beginPath();
      g.arc(a.x, a.y, C.WEAPONS.sword.range * .72, a.ang - sweep / 2, a.ang + sweep / 2);
      g.stroke();
      g.restore();
    }
    g.globalAlpha = 1;
    for (const r of FX.rings) {
      const k = r.t / r.life;
      g.globalAlpha = k * .8;
      g.strokeStyle = r.color; g.lineWidth = r.w * k + .4;
      g.beginPath(); g.arc(r.x, r.y, r.r, 0, 7); g.stroke();
    }
    g.globalAlpha = 1;
  }

  function drawTexts(g) {
    g.textAlign = 'center';
    for (const t of FX.texts) {
      const k = t.life / t.max;
      g.globalAlpha = Math.min(1, k * 2);
      g.font = `800 ${t.size * (0.7 + k * 0.4)}px Rajdhani, Segoe UI, sans-serif`;
      g.lineWidth = 3.5; g.strokeStyle = 'rgba(0,0,0,.8)';
      g.strokeText(t.str, t.x, t.y);
      g.fillStyle = t.color;
      g.fillText(t.str, t.x, t.y);
    }
    g.globalAlpha = 1; g.textAlign = 'left';
  }

  /** Zunge einer Flamme: vorn breit, hinten spitz, mit zuckendem Rand. */
  function flamePath(g, len, wid, seed) {
    g.beginPath();
    g.moveTo(-len, 0);                       // Spitze hinten
    const steps = 7;
    for (let s = 1; s <= steps; s++) {       // obere Kante nach vorn
      const t = s / steps;
      const x = -len + (len + wid * .5) * t;
      const w = wid * Math.sin(t * Math.PI * 0.92) * (1 + Math.sin(seed + t * 9 + time * 22) * 0.22);
      g.lineTo(x, -w);
    }
    for (let s = steps; s >= 1; s--) {       // untere Kante zurueck
      const t = s / steps;
      const x = -len + (len + wid * .5) * t;
      const w = wid * Math.sin(t * Math.PI * 0.92) * (1 + Math.sin(seed + 3 + t * 9 + time * 19) * 0.22);
      g.lineTo(x, w);
    }
    g.closePath();
  }

  /** Echte Flammenzunge statt runder Blob - orientiert sich an der Flugrichtung. */
  function drawFlame(g, b) {
    const k = b.l === undefined ? 1 : Math.max(0, Math.min(1, b.l));   // 1 frisch -> 0 verglueht
    const age = 1 - k;
    const seed = (b.i % 100) * 1.7;
    // Waechst nach vorn und verbreitert sich beim Verwehen
    const len = 18 + age * 40;
    const wid = 5 + age * 18;

    g.save();
    g.translate(b.x, b.y);
    g.rotate(b.a);
    g.globalCompositeOperation = 'lighter';

    if (age < 0.72) {
      const glow = 1 - age / 0.72;
      // aeussere, dunklere Zunge
      g.globalAlpha = 0.5 * glow;
      g.fillStyle = '#c8340a';
      flamePath(g, len, wid, seed); g.fill();
      // mittlere Zunge
      g.globalAlpha = 0.75 * glow;
      g.fillStyle = '#ff8a1e';
      flamePath(g, len * 0.74, wid * 0.72, seed + 1.3); g.fill();
      // heisser Kern
      g.globalAlpha = 0.95 * glow;
      g.fillStyle = '#ffe9a8';
      flamePath(g, len * 0.42, wid * 0.4, seed + 2.6); g.fill();
    }
    g.restore();

    // Rauch, wenn die Flamme ausgeht
    if (age > 0.45) {
      const s = (age - 0.45) / 0.55;
      g.globalAlpha = s * 0.35;
      g.fillStyle = '#4a443f';
      g.beginPath();
      g.ellipse(b.x, b.y, (wid + 4) * (0.6 + s), (wid + 3) * (0.6 + s), b.a, 0, 7);
      g.fill();
      g.globalAlpha = 1;
    }
  }

  /* Schallplatte mit Partyschweif. Die Farben laufen durch den Regenbogen,
     damit die Spur nach Discolicht aussieht statt nach Rauch. */
  const DISC_COL = ['#ff3b8d', '#ffd166', '#3fd0ff', '#b16bff', '#4ade80'];

  function drawDisc(g, b) {
    const t = time * 12 + (b.i || 0);
    // Schweif: bunte Ringe hinter der Platte
    for (let i = 6; i >= 1; i--) {
      const f = i / 6;
      const px = b.x - Math.cos(b.a) * i * 9;
      const py = b.y - Math.sin(b.a) * i * 9;
      g.globalAlpha = 0.42 * (1 - f) + 0.06;
      g.fillStyle = DISC_COL[(i + Math.floor(t * 0.6)) % DISC_COL.length];
      g.beginPath();
      g.arc(px, py, 9 * (1 - f * 0.55), 0, 7);
      g.fill();
    }
    g.globalAlpha = 1;

    g.save();
    g.translate(b.x, b.y);
    g.rotate(t * 0.9);
    // Vinyl
    const scheibe = g.createRadialGradient(-3, -3, 1, 0, 0, 11);
    scheibe.addColorStop(0, '#4a4a55');
    scheibe.addColorStop(.7, '#16161c');
    scheibe.addColorStop(1, '#0a0a0e');
    g.fillStyle = scheibe;
    g.beginPath(); g.arc(0, 0, 11, 0, 7); g.fill();
    // Rillen
    g.strokeStyle = 'rgba(255,255,255,.14)'; g.lineWidth = 1;
    for (let rr = 4; rr <= 9; rr += 2.5) { g.beginPath(); g.arc(0, 0, rr, 0, 7); g.stroke(); }
    // Etikett in Discofarbe
    g.fillStyle = DISC_COL[Math.floor(t * 0.5) % DISC_COL.length];
    g.beginPath(); g.arc(0, 0, 4.2, 0, 7); g.fill();
    g.fillStyle = '#0a0a0e';
    g.beginPath(); g.arc(0, 0, 1.1, 0, 7); g.fill();
    // Glanzstreifen
    g.strokeStyle = 'rgba(255,255,255,.35)'; g.lineWidth = 1.6;
    g.beginPath(); g.arc(0, 0, 8, -0.9, -0.2); g.stroke();
    g.restore();
  }

  function drawBullet(g, b) {
    if (b.ty === 1) return drawRocket(g, b);
    if (b.ty === 2) return drawGrenade(g, b);
    if (b.ty === 3) return drawFlame(g, b);
    if (b.ty === 4) return drawDisc(g, b);
    // Am Reichweitenende ausblenden statt hart verschwinden
    const fade = b.l === undefined ? 1 : Math.min(1, b.l / 0.28);
    if (fade <= 0.02) return;
    g.globalAlpha = fade;
    // Schnelle Geschosse ziehen einen laengeren Strich
    const len = Math.max(14, Math.min(52, (b.s || 900) / 40));
    const dx = Math.cos(b.a), dy = Math.sin(b.a);
    const x0 = b.x - dx * len, y0 = b.y - dy * len;
    const grd = g.createLinearGradient(x0, y0, b.x, b.y);
    grd.addColorStop(0, 'rgba(255,209,102,0)');
    grd.addColorStop(1, b.color || '#ffe9a8');
    g.strokeStyle = grd; g.lineWidth = 3.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(b.x, b.y); g.stroke();
    const halo = g.createRadialGradient(b.x, b.y, 1, b.x, b.y, 9);
    halo.addColorStop(0, '#fff8dc');
    halo.addColorStop(.35, (b.color || '#ffd166') + 'aa');
    halo.addColorStop(1, (b.color || '#ffd166') + '00');
    g.fillStyle = halo;
    g.beginPath(); g.arc(b.x, b.y, 9, 0, 7); g.fill();
    g.globalAlpha = 1;
  }

  function drawRocket(g, b) {
    g.save();
    g.translate(b.x, b.y);
    // Abgasfahne
    const fl = 16 + Math.sin(time * 40 + b.i) * 6;
    const grd = g.createLinearGradient(-fl - 22, 0, -6, 0);
    grd.addColorStop(0, 'rgba(255,120,30,0)');
    grd.addColorStop(.5, 'rgba(255,150,40,.6)');
    grd.addColorStop(1, 'rgba(255,240,180,.95)');
    g.rotate(b.a);
    g.fillStyle = grd;
    g.beginPath();
    g.moveTo(-9, -5); g.lineTo(-9 - fl - 16, 0); g.lineTo(-9, 5);
    g.closePath(); g.fill();
    // Koerper
    g.fillStyle = '#4a5540';
    roundRect(g, -10, -4.5, 20, 9, 3); g.fill();
    g.strokeStyle = '#1c1408'; g.lineWidth = 1.4; g.stroke();
    g.fillStyle = '#c8442f';
    g.beginPath(); g.moveTo(10, -4.5); g.lineTo(17, 0); g.lineTo(10, 4.5); g.closePath(); g.fill();
    g.strokeStyle = '#1c1408'; g.lineWidth = 1.2; g.stroke();
    g.fillStyle = '#2f3a2a';
    g.beginPath(); g.moveTo(-8, -4.5); g.lineTo(-13, -8); g.lineTo(-6, -4.5); g.closePath(); g.fill();
    g.beginPath(); g.moveTo(-8, 4.5); g.lineTo(-13, 8); g.lineTo(-6, 4.5); g.closePath(); g.fill();
    g.restore();
  }

  function drawGrenade(g, b) {
    g.save();
    g.translate(b.x, b.y);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.ellipse(2, 4, 7, 5, 0, 0, 7); g.fill();
    g.rotate(time * 7 + b.i);
    g.fillStyle = '#3f5540';
    g.beginPath(); g.ellipse(0, 0, 7, 6, 0, 0, 7); g.fill();
    g.strokeStyle = '#1c1408'; g.lineWidth = 1.5; g.stroke();
    g.strokeStyle = 'rgba(20,14,8,.7)'; g.lineWidth = 1;
    g.beginPath();
    g.moveTo(-6, -2); g.lineTo(6, -2); g.moveTo(-6, 2); g.lineTo(6, 2);
    g.moveTo(-2, -5.5); g.lineTo(-2, 5.5); g.moveTo(2, -5.5); g.lineTo(2, 5.5);
    g.stroke();
    g.fillStyle = '#8a5124';
    g.fillRect(-1.5, -9, 3, 4);
    g.restore();
    // Zuender blinkt schneller, je naeher die Explosion
    const blink = (Math.sin(time * 26) + 1) / 2;
    g.fillStyle = `rgba(255,${80 + blink * 120},40,${.5 + blink * .5})`;
    g.beginPath(); g.arc(b.x, b.y - 8, 2.6 + blink * 1.6, 0, 7); g.fill();
  }

  /* ---------- Hauptzeichnung ---------- */
  function draw(G, dt) {
    const t0 = performance.now();
    drawInner(G, dt);
    tuneQuality(performance.now() - t0, dt);
  }

  function drawInner(G, dt) {
    if (!W || !H) resize();
    time += dt;
    FX.update(dt);
    updateCamera(G, dt);
    const so = FX.shakeOffset;
    cam.shakeX = so.x; cam.shakeY = so.y;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#04060c';
    ctx.fillRect(0, 0, W, H);
    if (!curMap) return;

    const s = cam.scale;
    ctx.save();
    ctx.translate(W / 2 + cam.shakeX, H / 2 + cam.shakeY);
    ctx.scale(s, s);
    ctx.translate(-cam.x, -cam.y);

    const view = {
      x0: cam.x - W / 2 / s - 60, x1: cam.x + W / 2 / s + 60,
      y0: cam.y - H / 2 / s - 60, y1: cam.y + H / 2 / s + 60
    };

    // Map - nur den sichtbaren Ausschnitt kopieren
    const worldSize = curMap.n * C.TILE;
    const sx = Math.max(0, Math.floor(view.x0)), sy = Math.max(0, Math.floor(view.y0));
    const sw = Math.min(worldSize, Math.ceil(view.x1)) - sx;
    const sh = Math.min(worldSize, Math.ceil(view.y1)) - sy;
    if (sw > 0 && sh > 0) {
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(mapCv, sx, sy, sw, sh, sx, sy, sw, sh);
      ctx.imageSmoothingEnabled = true;
    }

    // Decals
    for (const d of FX.decals) {
      ctx.globalAlpha = d.a;
      if (d.kind === 'blood') {
        ctx.fillStyle = d.color || '#7d0f20';
        ctx.beginPath(); ctx.ellipse(d.x, d.y, d.r, d.r * .74, d.x % 3, 0, 7); ctx.fill();
      } else if (d.kind === 'scorch') {
        const sg = ctx.createRadialGradient(d.x, d.y, d.r * .15, d.x, d.y, d.r);
        sg.addColorStop(0, 'rgba(12,10,8,.95)');
        sg.addColorStop(.6, 'rgba(28,22,16,.6)');
        sg.addColorStop(1, 'rgba(28,22,16,0)');
        ctx.fillStyle = sg;
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fill();
      } else {
        ctx.fillStyle = '#0a0c12';
        ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, 7); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;

    // Pickups
    for (const pk of G.pickups) drawPickup(ctx, pk);

    // Eigene Minen - Gegner bekommen sie gar nicht erst gesendet
    for (const mi of (G.mines || [])) drawMine(ctx, mi);

    // Leichen
    for (const c of FX.corpses) drawCorpse(ctx, c);

    // Spuren
    for (const t of FX.trails) {
      ctx.globalAlpha = (t.life / t.max) * .5;
      ctx.strokeStyle = t.color; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(t.x0, t.y0); ctx.lineTo(t.x1, t.y1); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    // Spieler
    const me = G.mePlayer();
    for (const p of G.playerList()) {
      if (!p.alive || p.id === G.myId) continue;
      if (p.rx < view.x0 || p.rx > view.x1 || p.ry < view.y0 || p.ry > view.y1) continue;
      if (p.bush) ctx.globalAlpha = 0.85;
      drawPlayer(ctx, p, false, G);
      ctx.globalAlpha = 1;
    }

    // Geschosse
    for (const b of G.bulletList()) drawBullet(ctx, b);

    // Partikel
    drawParticles(ctx);

    // Buesche ueber Spielern -> echte Deckung
    drawBushes(ctx, view);

    // Eigener Spieler bleibt immer sichtbar (im Busch leicht transparent)
    if (me && me.alive) {
      ctx.globalAlpha = me.bush ? 0.9 : 1;
      drawPlayer(ctx, me, true, G);
      ctx.globalAlpha = 1;
      if (me.bush) {
        ctx.strokeStyle = 'rgba(140,255,180,.55)';
        ctx.lineWidth = 1.6;
        ctx.setLineDash([5, 5]);
        ctx.beginPath(); ctx.arc(me.rx, me.ry, C.PLAYER_R * 1.45 + 5, 0, 7); ctx.stroke();
        ctx.setLineDash([]);
      }
    }

    // Sichtbarkeit
    if (me) {
      computeVisibility(me.rx, me.ry, smoothAim(me.ra, dt));
      if (me.alive) markSeen(me.rx, me.ry);
      drawFog(me, view);
    }

    // Schwebetexte immer sichtbar
    drawTexts(ctx);

    ctx.restore();

    // Fadenkreuz
    if (G.mouse && me && me.alive) drawCrosshair(ctx, G);

    // Blitz
    if (FX.flashAlpha > 0) {
      ctx.globalAlpha = Math.min(1, FX.flashAlpha);
      ctx.fillStyle = FX.flashCol;
      ctx.fillRect(0, 0, W, H);
      ctx.globalAlpha = 1;
    }

    drawMinimap(G);
  }

  function drawCrosshair(g, G) {
    const x = G.mouse.x, y = G.mouse.y;
    const spread = 8 + (G.recoil || 0) * 26;
    // Ausserhalb der Waffenreichweite wird das Fadenkreuz rot und offen -
    // sonst schiesst man ins Leere, ohne zu wissen warum.
    const w = G.myWeapon;
    const me = G.mePlayer();
    let inRange = true;
    if (w && w.range && me && G.mouseWorld) {
      inRange = Math.hypot(G.mouseWorld.x - me.rx, G.mouseWorld.y - me.ry) <= w.range;
    }
    g.save();
    g.strokeStyle = inRange ? 'rgba(255,255,255,.9)' : 'rgba(255,110,130,.85)';
    g.lineWidth = 2; g.lineCap = 'round';
    g.shadowColor = 'rgba(0,0,0,.8)'; g.shadowBlur = 4;
    const gap = inRange ? spread : spread + 5;
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      const dx = Math.cos(a), dy = Math.sin(a);
      g.beginPath();
      g.moveTo(x + dx * gap, y + dy * gap);
      g.lineTo(x + dx * (gap + 7), y + dy * (gap + 7));
      g.stroke();
    }
    if (inRange) {
      g.fillStyle = 'rgba(255,255,255,.95)';
      g.beginPath(); g.arc(x, y, 1.6, 0, 7); g.fill();
    }
    g.restore();
  }

  /* ---------- Minimap ---------- */
  function drawMinimap(G) {
    if (!curMap) return;
    const size = mm.width;
    const n = curMap.n;
    const sc = size / (n * C.TILE);
    mctx.clearRect(0, 0, size, size);
    mctx.fillStyle = 'rgba(6,10,20,.85)';
    mctx.fillRect(0, 0, size, size);

    const T = C.TILE * sc;
    for (let ty = 0; ty < n; ty++) {
      for (let tx = 0; tx < n; tx++) {
        const v = curMap.tiles[ty * n + tx];
        if (v === C.T_WALL) mctx.fillStyle = 'rgba(150,180,225,.34)';
        else if (v === C.T_BUSH) mctx.fillStyle = 'rgba(74,222,128,.26)';
        else continue;
        mctx.fillRect(tx * T, ty * T, Math.ceil(T), Math.ceil(T));
      }
    }
    for (const pk of G.pickups) {
      if (!pk.a) continue;
      mctx.fillStyle = pk.ty === 'health' ? '#4ade80' : '#ffd166';
      mctx.fillRect(pk.x * sc - 1.5, pk.y * sc - 1.5, 3, 3);
    }
    for (const p of G.playerList()) {
      if (!p.alive) continue;
      const isMe = p.id === G.myId;
      mctx.fillStyle = isMe ? '#ffffff' : (p.teamColor || p.color);
      mctx.beginPath();
      mctx.arc(p.rx * sc, p.ry * sc, isMe ? 3.4 : 2.8, 0, 7);
      mctx.fill();
      if (isMe) {
        mctx.strokeStyle = 'rgba(255,255,255,.6)';
        mctx.lineWidth = 1.4;
        mctx.beginPath();
        mctx.moveTo(p.rx * sc, p.ry * sc);
        mctx.lineTo(p.rx * sc + Math.cos(p.ra) * 8, p.ry * sc + Math.sin(p.ra) * 8);
        mctx.stroke();
      }
    }
  }

  /* =============== Soldat von vorn ===============
     Fuer den Skinlocker: dort will man sehen, wie die Figur aussieht, und
     nicht auf einen Helm von oben schauen. Gezeichnet wird in lokalen
     Koordinaten, der Boden liegt bei y = 0, die Figur waechst nach oben.

     Alle Masse in u = 1 % der Gesamthoehe. Licht faellt von links oben ein -
     jede Rundung bekommt denselben hellen Rand und dieselbe dunkle
     Gegenseite, sonst wirkt nichts plastisch. */

  /** Form mit Lichtverlauf fuellen: hell nach links oben, dunkel nach rechts unten. */
  function shaded(g, path, x0, y0, x1, y1, hell, mitte, dunkel, lw) {
    path();
    const grad = g.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, hell);
    grad.addColorStop(0.45, mitte);
    grad.addColorStop(1, dunkel);
    g.fillStyle = grad;
    g.fill();
    if (lw) ink(g, lw);
  }

  /* Glied als durchgehender Strich: Umriss als breiterer Strich darunter,
     Fuellung darueber. Aus einzelnen Kapseln zusammengesetzt gab es an jedem
     Gelenk einen dunklen Ring, wo sich zwei Umrisse ueberlagerten. */
  function limbF(g, punkte, w, hell, mitte, dunkel, lw) {
    const zeichne = () => {
      g.beginPath();
      g.moveTo(punkte[0], punkte[1]);
      for (let i = 2; i < punkte.length; i += 2) g.lineTo(punkte[i], punkte[i + 1]);
    };
    g.save();
    g.lineCap = 'round'; g.lineJoin = 'round';
    g.strokeStyle = INK;
    g.lineWidth = w * 2 + lw * 1.8;
    zeichne(); g.stroke();

    const links = Math.min(punkte[0], punkte[punkte.length - 2]) - w;
    const grad = g.createLinearGradient(links, 0, links + w * 2.6, 0);
    grad.addColorStop(0, hell);
    grad.addColorStop(.45, mitte);
    grad.addColorStop(1, dunkel);
    g.strokeStyle = grad;
    g.lineWidth = w * 2;
    zeichne(); g.stroke();

    // Lichtkante an der linken Seite
    g.globalAlpha = .32;
    g.strokeStyle = hell;
    g.lineWidth = w * .5;
    g.save();
    g.translate(-w * .55, 0);
    zeichne(); g.stroke();
    g.restore();
    g.globalAlpha = 1;
    g.restore();
  }

  function drawSoldierFront(g, skin, hoehe, t) {
    const u = hoehe / 100;
    const LW = Math.max(1, u * 0.85);
    const uni = skin.color || '#4ade80';
    const uniL = shade(uni, 34);
    const uniD = shade(uni, -34);
    const uniDD = shade(uni, -60);
    const helm = shade(uni, -8);

    /* Ruhige Leerlaufbewegung: Atmen, Gewichtsverlagerung, Wippen. Drei
       verschiedene Takte, damit es nicht mechanisch wirkt. */
    const atem = Math.sin(t * 1.9);
    const wiegen = Math.sin(t * 0.85);
    const bob = (atem * 0.5 + 0.5) * u * 0.9;
    const hueft = wiegen * u * 1.4;

    g.save();

    // ---------- Bodenschatten ----------
    g.fillStyle = 'rgba(0,0,0,.40)';
    g.beginPath(); g.ellipse(u * 1, 0, u * 17, u * 4.6, 0, 0, 7); g.fill();
    g.fillStyle = 'rgba(0,0,0,.20)';
    g.beginPath(); g.ellipse(u * 2, 0, u * 27, u * 7, 0, 0, 7); g.fill();

    g.translate(0, -bob);

    /* ---------- Beine ----------
       Standbein und Spielbein wechseln mit der Gewichtsverlagerung. */
    [-1, 1].forEach(seite => {
      const entlastet = wiegen * seite < 0;
      const hx = seite * u * 5.5 + hueft * .3;
      const kx = seite * u * 6.6 + hueft * .15;
      const fx = seite * u * 7.2;
      const knie = -u * 24 + (entlastet ? u * 1.4 : 0);

      limbF(g, [hx, -u * 45, kx, knie, fx, -u * 9], u * 5.2, uniD, uniDD, shade(uni, -74), LW);

      // Stiefel
      g.save();
      g.translate(fx, -u * 7.5);
      const stiefel = () => { roundRect(g, -u * 5.2, -u * 4, u * 10.4, u * 8, u * 2.2); };
      shaded(g, stiefel, -u * 5, -u * 4, u * 5, u * 4,
        shade(BOOT, 26), BOOT, shade(BOOT, -34), LW);
      g.fillStyle = shade(BOOT, -46);
      roundRect(g, -u * 5.6, u * 2.2, u * 11.2, u * 2.4, u * 1.1); g.fill();
      g.strokeStyle = 'rgba(20,14,8,.45)'; g.lineWidth = LW * .7;
      g.beginPath();
      for (let i = 0; i < 3; i++) { g.moveTo(-u * 3, -u * 3 + i * u * 1.9); g.lineTo(u * 3, -u * 2.4 + i * u * 1.9); }
      g.stroke();
      g.fillStyle = 'rgba(255,255,255,.16)';
      roundRect(g, -u * 4.2, -u * 3.4, u * 7, u * 1.6, u * .8); g.fill();
      g.restore();
    });

    // ---------- Arme (hinter den Schulterpolstern) ----------
    const schwung = wiegen * u * 1.1;
    [-1, 1].forEach(seite => {
      const sx = seite * u * 11 + hueft * .5;
      const ex = seite * u * 14.5 + schwung * seite * .4;
      const hx = seite * u * 14 + schwung * seite;
      limbF(g, [sx, -u * 68, ex, -u * 56, hx, -u * 46], u * 4.3, uniD, uniDD, shade(uni, -74), LW);
      // Handschuh
      const hand = () => { g.beginPath(); g.ellipse(hx, -u * 44, u * 3.4, u * 3.9, seite * .12, 0, 7); g.closePath(); };
      shaded(g, hand, hx - u * 3.4, -u * 47, hx + u * 3.4, -u * 41,
        shade(FLESH, 18), FLESH_SH, shade(FLESH_SH, -34), LW * .9);
      g.strokeStyle = 'rgba(40,25,10,.35)'; g.lineWidth = LW * .7;
      g.beginPath(); g.moveTo(hx - u * 2.2, -u * 44); g.lineTo(hx + u * 2.2, -u * 44.5); g.stroke();
    });

    // ---------- Rumpf ----------
    g.save();
    g.translate(hueft * .5, 0);
    g.scale(1 + atem * 0.018, 1);

    const torso = () => {
      g.beginPath();
      g.moveTo(-u * 12.5, -u * 70);
      g.quadraticCurveTo(-u * 14.5, -u * 60, -u * 10.5, -u * 47);
      g.quadraticCurveTo(0, -u * 44.5, u * 10.5, -u * 47);
      g.quadraticCurveTo(u * 14.5, -u * 60, u * 12.5, -u * 70);
      g.quadraticCurveTo(0, -u * 73.5, -u * 12.5, -u * 70);
      g.closePath();
    };
    shaded(g, torso, -u * 13, -u * 72, u * 13, -u * 46, uniL, uni, uniDD, LW * 1.2);

    // Muster
    if (skin.pattern && skin.pattern !== 'solid') {
      g.save();
      torso(); g.clip();
      g.globalAlpha = .45;
      const dark = shade(uni, -50), light = shade(uni, 46);
      switch (skin.pattern) {
        case 'stripe':
          g.fillStyle = dark;
          for (let x = -u * 16; x < u * 16; x += u * 5) g.fillRect(x, -u * 75, u * 2.2, u * 34);
          break;
        case 'dots':
          g.fillStyle = dark;
          for (let y = -u * 72; y < -u * 44; y += u * 5) {
            for (let x = -u * 16; x < u * 16; x += u * 5) {
              const o = ((((x * 7 + y * 13) % 5) + 5) % 5) / 5;
              g.beginPath(); g.ellipse(x + o * u * 2.6, y, u * 2, u * 1.4, o * 3, 0, 7); g.fill();
            }
          }
          break;
        case 'ring':
          g.fillStyle = light;
          g.fillRect(-u * 16, -u * 64, u * 32, u * 2.2);
          g.fillRect(-u * 16, -u * 53, u * 32, u * 2.2);
          break;
        case 'shard':
          g.fillStyle = dark;
          g.beginPath();
          g.moveTo(-u * 16, -u * 72); g.lineTo(u * 3, -u * 58); g.lineTo(-u * 16, -u * 44);
          g.closePath(); g.fill();
          break;
      }
      g.globalAlpha = 1;
      g.restore();
    }

    // Schutzweste mit Taschen
    g.save();
    torso(); g.clip();
    // Etwas schmaler als der Rumpf, damit das Muster an den Seiten sichtbar bleibt
    const weste = () => { roundRect(g, -u * 8.6, -u * 69, u * 17.2, u * 22, u * 2.6); };
    shaded(g, weste, -u * 8.6, -u * 69, u * 8.6, -u * 47,
      shade(uni, -20), shade(uni, -38), shade(uni, -56), 0);
    g.fillStyle = shade(uni, -58);
    [-1, 1].forEach(s => { roundRect(g, s * u * 5 - u * 3.4, -u * 65, u * 6.8, u * 6, u * 1.2); g.fill(); });
    [-1, 0, 1].forEach(s => { roundRect(g, s * u * 5.6 - u * 2.2, -u * 56, u * 4.4, u * 6, u * .9); g.fill(); });
    // Reissverschluss
    g.strokeStyle = 'rgba(255,255,255,.12)'; g.lineWidth = LW * .9;
    g.beginPath(); g.moveTo(0, -u * 69); g.lineTo(0, -u * 47); g.stroke();
    // Stofffalten
    g.strokeStyle = 'rgba(0,0,0,.16)'; g.lineWidth = LW;
    g.beginPath();
    g.moveTo(-u * 9, -u * 50); g.quadraticCurveTo(-u * 5, -u * 47.5, -u * 2, -u * 49);
    g.moveTo(u * 9, -u * 50); g.quadraticCurveTo(u * 5, -u * 47.5, u * 2, -u * 49);
    g.stroke();
    g.restore();

    // Guertel
    const guertel = () => { roundRect(g, -u * 11.5, -u * 48, u * 23, u * 4.6, u * 1.1); };
    shaded(g, guertel, -u * 11, -u * 48, u * 11, -u * 43.4,
      shade(STOCK_D, 26), STOCK_D, shade(STOCK_D, -30), LW * .9);
    g.fillStyle = '#e8bb3d';
    roundRect(g, -u * 2.6, -u * 47.6, u * 5.2, u * 3.8, u * .9); g.fill();
    g.fillStyle = 'rgba(255,255,255,.35)';
    roundRect(g, -u * 2.2, -u * 47.2, u * 4.4, u * 1.2, u * .5); g.fill();

    // Schulterpolster ueber dem Armansatz
    [-1, 1].forEach(s => {
      const pad = () => { g.beginPath(); g.ellipse(s * u * 11.5, -u * 68, u * 6, u * 4.6, s * .28, 0, 7); g.closePath(); };
      shaded(g, pad, s * u * 11.5 - u * 5, -u * 71, s * u * 11.5 + u * 5, -u * 64,
        shade(uni, 52), uniL, uniD, LW);
    });
    g.restore();

    // ---------- Hals ----------
    g.save();
    g.translate(hueft * .6, 0);
    const hals = () => { roundRect(g, -u * 3.6, -u * 76, u * 7.2, u * 7, u * 1.8); };
    shaded(g, hals, -u * 3.6, -u * 76, u * 3.6, -u * 69, shade(FLESH, 10), FLESH_SH, shade(FLESH_SH, -40), 0);
    g.fillStyle = 'rgba(0,0,0,.30)';
    roundRect(g, -u * 3.6, -u * 76, u * 7.2, u * 2.6, u * 1.3); g.fill();

    // ---------- Kopf ----------
    const kopfN = Math.sin(t * 1.25) * u * .45;
    g.translate(kopfN, 0);

    const gesicht = () => { g.beginPath(); g.ellipse(0, -u * 82.5, u * 7.2, u * 8.2, 0, 0, 7); g.closePath(); };
    shaded(g, gesicht, -u * 6, -u * 89, u * 6, -u * 76, shade(FLESH, 22), FLESH, shade(FLESH, -34), LW);

    // Ohren
    [-1, 1].forEach(s => {
      g.fillStyle = shade(FLESH, -16);
      g.beginPath(); g.ellipse(s * u * 7, -u * 82, u * 1.5, u * 2.2, 0, 0, 7); g.fill();
      ink(g, LW * .7);
    });

    // Augen
    [-1, 1].forEach(s => {
      g.fillStyle = '#fdfdfd';
      g.beginPath(); g.ellipse(s * u * 2.9, -u * 83.5, u * 2.0, u * 1.6, 0, 0, 7); g.fill();
      g.strokeStyle = 'rgba(40,26,10,.55)'; g.lineWidth = LW * .6; g.stroke();
      const blick = Math.sin(t * .6) * u * .45;
      g.fillStyle = '#3d2b15';
      g.beginPath(); g.arc(s * u * 2.9 + blick, -u * 83.5, u * .95, 0, 7); g.fill();
      g.fillStyle = 'rgba(255,255,255,.85)';
      g.beginPath(); g.arc(s * u * 2.9 + blick - u * .35, -u * 84, u * .35, 0, 7); g.fill();
    });
    // Brauen
    g.strokeStyle = shade(FLESH, -74); g.lineWidth = LW * 1.15; g.lineCap = 'round';
    g.beginPath();
    g.moveTo(-u * 4.8, -u * 86.4); g.lineTo(-u * 1.4, -u * 85.8);
    g.moveTo(u * 1.4, -u * 85.8); g.lineTo(u * 4.8, -u * 86.4);
    g.stroke();
    // Nase
    g.strokeStyle = 'rgba(120,72,26,.45)'; g.lineWidth = LW * .9;
    g.beginPath(); g.moveTo(0, -u * 83); g.lineTo(u * .7, -u * 80.4); g.stroke();
    // Mund
    g.strokeStyle = 'rgba(92,44,26,.65)'; g.lineWidth = LW;
    g.beginPath(); g.arc(0, -u * 79.8, u * 2.1, .3, Math.PI - .3); g.stroke();

    // ---------- Helm ----------
    const helmPfad = () => {
      g.beginPath();
      g.moveTo(-u * 9, -u * 86);
      g.quadraticCurveTo(-u * 9.6, -u * 95.5, 0, -u * 96);
      g.quadraticCurveTo(u * 9.6, -u * 95.5, u * 9, -u * 86);
      g.quadraticCurveTo(u * 4, -u * 88.2, 0, -u * 88);
      g.quadraticCurveTo(-u * 4, -u * 88.2, -u * 9, -u * 86);
      g.closePath();
    };
    shaded(g, helmPfad, -u * 8, -u * 95, u * 8, -u * 86,
      shade(uni, 40), helm, shade(uni, -52), LW * 1.15);
    g.save();
    helmPfad(); g.clip();
    g.fillStyle = 'rgba(0,0,0,.18)';
    g.fillRect(-u * 11, -u * 89.5, u * 22, u * 1.8);
    g.fillStyle = 'rgba(255,255,255,.24)';
    g.beginPath(); g.ellipse(-u * 3.2, -u * 93, u * 4, u * 1.9, -.35, 0, 7); g.fill();
    g.restore();

    // Kinnriemen
    g.strokeStyle = shade(uni, -52); g.lineWidth = LW * 1.5;
    g.beginPath();
    g.moveTo(-u * 8.4, -u * 86.5); g.quadraticCurveTo(-u * 8.2, -u * 77.5, -u * 2.6, -u * 76.5);
    g.moveTo(u * 8.4, -u * 86.5); g.quadraticCurveTo(u * 8.2, -u * 77.5, u * 2.6, -u * 76.5);
    g.stroke();
    g.fillStyle = shade(uni, -62);
    roundRect(g, -u * 3, -u * 77.6, u * 6, u * 2.2, u * .9); g.fill();

    g.restore();
    g.restore();
  }

  /** Avatar fuer Skinlocker / Lobby-Vorschau */
  function drawAvatar(g, x, y, r, skin, ang, t, weapon) {
    const p = { color: skin.color, pattern: skin.pattern, trail: skin.trail, weapon: weapon || 'pistol' };
    g.save();
    g.translate(x, y);
    g.fillStyle = 'rgba(0,0,0,.35)';
    g.beginPath(); g.ellipse(3, r * .4, r * 1.12, r * .6, 0, 0, 7); g.fill();
    g.rotate(ang);
    drawSoldier(g, p, r, { walk: Math.sin(t * 5), spin: t * 6 });
    g.restore();
  }


  /** Ganzkoerper-Vorschau von vorn. y ist der Boden, unter dem die Figur steht. */
  function drawAvatarFront(g, x, y, hoehe, skin, t) {
    g.save();
    g.translate(x, y);
    drawSoldierFront(g, skin, hoehe, t);
    g.restore();
  }

  /* =============== Shop-Skins ===============
     Jeder gekaufte Skin hat eine eigene Bewegung. Gezeichnet wird sie um die
     Figur herum, damit sie im Spiel auch dann zu sehen ist, wenn die Figur
     selbst klein ist. Die Bewegung haengt nur an der Zeit und an der
     Spielerkennung - so laufen zwei Spieler mit demselben Skin nicht im
     Gleichschritt. */
  function skinEffekt(g, art, r, t, farbe, spur) {
    switch (art) {
      case 'pulse': {
        for (let i = 0; i < 3; i++) {
          const k = ((t * 0.9 + i / 3) % 1);
          g.globalAlpha = (1 - k) * .5;
          g.strokeStyle = farbe;
          g.lineWidth = 2.4;
          g.beginPath(); g.arc(0, 0, r * (0.9 + k * 1.5), 0, 7); g.stroke();
        }
        break;
      }
      case 'flame': {
        for (let i = 0; i < 7; i++) {
          const a = t * 2.2 + i * 0.9;
          const h = ((t * 1.6 + i / 7) % 1);
          const x = Math.sin(a) * r * .5;
          const y = -h * r * 2.1 + r * .4;
          g.globalAlpha = (1 - h) * .8;
          g.fillStyle = h < .45 ? spur : farbe;
          g.beginPath();
          g.ellipse(x, y, r * .3 * (1 - h * .55), r * .5 * (1 - h * .4), 0, 0, 7);
          g.fill();
        }
        break;
      }
      case 'bubble': {
        for (let i = 0; i < 8; i++) {
          const h = ((t * 0.8 + i / 8) % 1);
          const x = Math.sin(t * 1.3 + i * 2.1) * r * .8;
          g.globalAlpha = (1 - h) * .65;
          g.fillStyle = i % 2 ? farbe : spur;
          g.beginPath(); g.arc(x, -h * r * 2, r * .13 * (1 - h * .4), 0, 7); g.fill();
        }
        break;
      }
      case 'frost': {
        for (let i = 0; i < 6; i++) {
          const a = t * 1.1 + i * (Math.PI * 2 / 6);
          const rr = r * (1.1 + Math.sin(t * 2 + i) * .16);
          const x = Math.cos(a) * rr, y = Math.sin(a) * rr * .6;
          g.globalAlpha = .7;
          g.strokeStyle = i % 2 ? spur : farbe;
          g.lineWidth = 1.8; g.lineCap = 'round';
          for (let k = 0; k < 3; k++) {
            const b = a * 2 + k * (Math.PI / 3);
            g.beginPath();
            g.moveTo(x - Math.cos(b) * r * .13, y - Math.sin(b) * r * .13);
            g.lineTo(x + Math.cos(b) * r * .13, y + Math.sin(b) * r * .13);
            g.stroke();
          }
        }
        break;
      }
      case 'void': {
        for (let i = 0; i < 5; i++) {
          const k = ((t * 0.7 + i / 5) % 1);
          g.globalAlpha = (1 - k) * .55;
          const grd = g.createRadialGradient(0, 0, r * .2, 0, 0, r * (0.8 + k * 1.4));
          grd.addColorStop(0, farbe + '00');
          grd.addColorStop(.6, farbe + 'aa');
          grd.addColorStop(1, farbe + '00');
          g.fillStyle = grd;
          g.beginPath(); g.arc(0, 0, r * (0.8 + k * 1.4), 0, 7); g.fill();
        }
        break;
      }
      case 'sparkle': {
        for (let i = 0; i < 10; i++) {
          const a = t * 1.7 + i * (Math.PI * 2 / 10);
          const k = ((t * 1.1 + i / 10) % 1);
          const rr = r * (0.6 + k * 1.1);
          const x = Math.cos(a) * rr, y = Math.sin(a) * rr * .55 - k * r * .5;
          g.globalAlpha = (1 - k) * .9;
          g.fillStyle = i % 3 ? farbe : spur;
          const s = r * .1 * (1 - k * .5);
          g.beginPath();
          g.moveTo(x, y - s); g.lineTo(x + s * .5, y); g.lineTo(x, y + s); g.lineTo(x - s * .5, y);
          g.closePath(); g.fill();
        }
        break;
      }
    }
    g.globalAlpha = 1;
  }

  /** Vorschau im Shop: Figur von vorn mit ihrer Bewegung. */
  function drawShopPreview(g, x, y, hoehe, skin, t) {
    g.save();
    g.translate(x, y);
    g.save();
    g.translate(0, -hoehe * 0.45);
    skinEffekt(g, skin.anim, hoehe * 0.34, t, skin.color, skin.trail);
    g.restore();
    drawSoldierFront(g, { color: skin.color, pattern: 'solid', trail: skin.trail }, hoehe, t);
    g.restore();
  }

  return {
    resize, buildMap, updateTiles, draw, worldToScreen, screenToWorld,
    drawAvatar, drawAvatarFront, drawShopPreview, shade,
    setQuality,
    get quality() {
      return { level: qLevel, name: q().name, avgMs: Math.round(drawAvg * 100) / 100, pinned: qPinned >= 0 };
    },
    get cam() { return cam; },
    get canvas() { return cv; },
    get width() { return W; },
    get height() { return H; }
  };
})();
