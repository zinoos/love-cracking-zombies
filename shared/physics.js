/* Geteilte Physik: identischer Code auf Server und Client -> Client-Prediction
   erzeugt exakt dieselben Ergebnisse wie die autoritative Simulation. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./constants.js'));
  else root.PHYS = factory(root.C);
})(typeof self !== 'undefined' ? self : this, function (C) {
  const T = C.TILE;

  function tileAt(map, tx, ty) {
    if (tx < 0 || ty < 0 || tx >= map.n || ty >= map.n) return C.T_WALL;
    return map.tiles[ty * map.n + tx];
  }

  function tileAtWorld(map, x, y) {
    return tileAt(map, Math.floor(x / T), Math.floor(y / T));
  }

  function inBush(map, x, y) {
    return tileAtWorld(map, x, y) === C.T_BUSH;
  }

  /** Kreis gegen Wandkacheln */
  function collides(map, x, y, r) {
    const minTx = Math.floor((x - r) / T), maxTx = Math.floor((x + r) / T);
    const minTy = Math.floor((y - r) / T), maxTy = Math.floor((y + r) / T);
    for (let ty = minTy; ty <= maxTy; ty++) {
      for (let tx = minTx; tx <= maxTx; tx++) {
        if (tileAt(map, tx, ty) !== C.T_WALL) continue;
        const cx = Math.max(tx * T, Math.min(x, tx * T + T));
        const cy = Math.max(ty * T, Math.min(y, ty * T + T));
        const dx = x - cx, dy = y - cy;
        if (dx * dx + dy * dy < r * r) return true;
      }
    }
    return false;
  }

  /** Achsenweise Aufloesung -> sauberes Gleiten an Waenden */
  function moveCircle(map, x, y, r, dx, dy) {
    let nx = x, ny = y;
    if (dx !== 0) {
      if (!collides(map, nx + dx, ny, r)) nx += dx;
      else {
        // Feinschritte fuer buendiges Anlegen
        const step = Math.sign(dx);
        for (let i = 0; i < Math.abs(dx); i++) {
          if (collides(map, nx + step, ny, r)) break;
          nx += step;
        }
      }
    }
    if (dy !== 0) {
      if (!collides(map, nx, ny + dy, r)) ny += dy;
      else {
        const step = Math.sign(dy);
        for (let i = 0; i < Math.abs(dy); i++) {
          if (collides(map, nx, ny + step, r)) break;
          ny += step;
        }
      }
    }
    const w = map.n * T;
    nx = Math.max(r, Math.min(w - r, nx));
    ny = Math.max(r, Math.min(w - r, ny));
    return { x: nx, y: ny };
  }

  /** Bewegungsschritt eines Spielers. dt in Sekunden. */
  function stepPlayer(map, p, input, dt) {
    let ix = input.dx !== undefined ? input.dx : ((input.right ? 1 : 0) - (input.left ? 1 : 0));
    let iy = input.dy !== undefined ? input.dy : ((input.down ? 1 : 0) - (input.up ? 1 : 0));
    const len = Math.hypot(ix, iy);
    if (len > 0) { ix /= len; iy /= len; }

    const mult = p.speedMult === undefined ? 1 : p.speedMult;

    if (p.dashT > 0) {
      p.dashT = Math.max(0, p.dashT - dt);
      const sp = C.DASH_SPEED * (0.6 + 0.4 * mult) * (0.55 + 0.45 * (p.dashT / C.DASH_TIME));
      p.vx = p.dashX * sp;
      p.vy = p.dashY * sp;
    } else if (input.snap) {
      p.vx = ix * C.SPEED * mult;
      p.vy = iy * C.SPEED * mult;
    } else {
      const targetVx = ix * C.SPEED * mult, targetVy = iy * C.SPEED * mult;
      const ax = targetVx - p.vx, ay = targetVy - p.vy;
      const rate = (len > 0 ? C.ACCEL : C.FRICTION) * dt;
      const am = Math.hypot(ax, ay);
      if (am > 0) {
        const k = Math.min(1, rate / am);
        p.vx += ax * k; p.vy += ay * k;
      }
    }

    const res = moveCircle(map, p.x, p.y, C.PLAYER_R, p.vx * dt, p.vy * dt);
    // Blockiert? Geschwindigkeit auf der Achse killen
    if (Math.abs(res.x - p.x) < 1e-6 && Math.abs(p.vx) > 1) p.vx *= 0.2;
    if (Math.abs(res.y - p.y) < 1e-6 && Math.abs(p.vy) > 1) p.vy *= 0.2;
    p.x = res.x; p.y = res.y;
  }

  /** Sichtlinie ueber DDA - Waende blockieren, Buesche nicht. */
  function los(map, x0, y0, x1, y1) {
    let tx = Math.floor(x0 / T), ty = Math.floor(y0 / T);
    const etx = Math.floor(x1 / T), ety = Math.floor(y1 / T);
    const dx = x1 - x0, dy = y1 - y0;
    const stepX = dx > 0 ? 1 : -1, stepY = dy > 0 ? 1 : -1;
    const tDeltaX = dx !== 0 ? Math.abs(T / dx) : Infinity;
    const tDeltaY = dy !== 0 ? Math.abs(T / dy) : Infinity;
    let tMaxX = dx !== 0 ? ((dx > 0 ? (tx + 1) * T - x0 : x0 - tx * T) / Math.abs(dx)) : Infinity;
    let tMaxY = dy !== 0 ? ((dy > 0 ? (ty + 1) * T - y0 : y0 - ty * T) / Math.abs(dy)) : Infinity;

    let guard = 0;
    while (guard++ < 4 * map.n) {
      if (tx === etx && ty === ety) return true;
      if (tMaxX < tMaxY) { tMaxX += tDeltaX; tx += stepX; }
      else { tMaxY += tDeltaY; ty += stepY; }
      if (tMaxX > 1 && tMaxY > 1) return true;
      if (tileAt(map, tx, ty) === C.T_WALL) return false;
    }
    return true;
  }

  /** Erste Wandtreffer-Distanz entlang eines Strahls (fuer Sichtpolygon / Bots). */
  function raycast(map, x0, y0, dirX, dirY, maxDist) {
    let tx = Math.floor(x0 / T), ty = Math.floor(y0 / T);
    const stepX = dirX > 0 ? 1 : -1, stepY = dirY > 0 ? 1 : -1;
    const tDeltaX = dirX !== 0 ? Math.abs(T / dirX) : Infinity;
    const tDeltaY = dirY !== 0 ? Math.abs(T / dirY) : Infinity;
    let tMaxX = dirX !== 0 ? ((dirX > 0 ? (tx + 1) * T - x0 : x0 - tx * T) / Math.abs(dirX)) : Infinity;
    let tMaxY = dirY !== 0 ? ((dirY > 0 ? (ty + 1) * T - y0 : y0 - ty * T) / Math.abs(dirY)) : Infinity;
    let dist = 0, guard = 0;
    while (dist < maxDist && guard++ < 4 * map.n) {
      if (tMaxX < tMaxY) { dist = tMaxX; tMaxX += tDeltaX; tx += stepX; }
      else { dist = tMaxY; tMaxY += tDeltaY; ty += stepY; }
      if (tileAt(map, tx, ty) === C.T_WALL) return Math.min(dist, maxDist);
    }
    return maxDist;
  }

  /** Kuerzester Abstand Punkt<->Strecke, fuer Geschoss-Trefferpruefung. */
  function segPointDist2(ax, ay, bx, by, px, py) {
    const dx = bx - ax, dy = by - ay;
    const l2 = dx * dx + dy * dy;
    let t = l2 > 0 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = Math.max(0, Math.min(1, t));
    const cx = ax + dx * t, cy = ay + dy * t;
    return { d2: (px - cx) * (px - cx) + (py - cy) * (py - cy), t };
  }

  /** Wand-Kollision entlang eines Geschossschritts. Gibt Trefferpunkt oder null. */
  function bulletWallHit(map, x0, y0, x1, y1) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const steps = Math.max(1, Math.ceil(dist / 6));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      if (tileAtWorld(map, x, y) === C.T_WALL) {
        const pt = (i - 1) / steps;
        return { x: x0 + (x1 - x0) * pt, y: y0 + (y1 - y0) * pt };
      }
    }
    return null;
  }

  return { tileAt, tileAtWorld, inBush, collides, moveCircle, stepPlayer, los, raycast, segPointDist2, bulletWallHit };
});
