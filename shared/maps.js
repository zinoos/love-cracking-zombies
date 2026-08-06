/* 8 deterministisch generierte Maps. Server und Client erzeugen identische Daten
   aus der Map-ID -> es muss keine Geometrie uebers Netz. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./constants.js'));
  else root.MAPS = factory(root.C);
})(typeof self !== 'undefined' ? self : this, function (C) {

  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const N = C.GRID;
  const W = C.T_WALL, B = C.T_BUSH, F = C.T_FLOOR;

  function idx(x, y) { return y * N + x; }
  function inside(x, y) { return x >= 0 && y >= 0 && x < N && y < N; }

  function set(t, x, y, v) { if (inside(x, y)) t[idx(x, y)] = v; }
  function get(t, x, y) { return inside(x, y) ? t[idx(x, y)] : W; }

  function rect(t, x0, y0, w, h, v) {
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) set(t, x, y, v);
  }

  function blob(t, cx, cy, r, v, rnd) {
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d <= r - 0.2 + rnd() * 0.9) set(t, x, y, v);
      }
    }
  }

  /* ---------- Generatoren ---------- */

  // 1 Crossfire: Kreuzkorridore + Deckungsbloecke
  function genCrossfire(t, rnd) {
    rect(t, 0, 0, N, N, W);
    rect(t, 3, N / 2 - 3, N - 6, 6, F);
    rect(t, N / 2 - 3, 3, 6, N - 6, F);
    rect(t, 3, 3, 8, 8, F);
    rect(t, N - 11, 3, 8, 8, F);
    rect(t, 3, N - 11, 8, 8, F);
    rect(t, N - 11, N - 11, 8, 8, F);
    // Verbindungen
    rect(t, 6, 10, 3, N - 20, F);
    rect(t, 10, 6, N - 20, 3, F);
    for (let i = 0; i < 10; i++) {
      const x = 4 + ((rnd() * (N - 8)) | 0), y = 4 + ((rnd() * (N - 8)) | 0);
      if (get(t, x, y) === F) blob(t, x, y, 1 + ((rnd() * 2) | 0), rnd() > 0.45 ? B : W, rnd);
    }
    blob(t, N / 2, N / 2, 3, F, rnd);
  }

  // 2 Foundry: Saeulenraster
  function genFoundry(t, rnd) {
    rect(t, 0, 0, N, N, F);
    for (let y = 4; y < N - 4; y += 5) {
      for (let x = 4; x < N - 4; x += 5) {
        if (rnd() < 0.14) continue;
        const s = rnd() < 0.3 ? 3 : 2;
        rect(t, x, y, s, s, rnd() < 0.22 ? B : W);
      }
    }
    rect(t, N / 2 - 2, N / 2 - 2, 4, 4, F);
    for (let i = 0; i < 8; i++) blob(t, 3 + ((rnd() * (N - 6)) | 0), 3 + ((rnd() * (N - 6)) | 0), 2, B, rnd);
  }

  /* 3 Thicket: Buschwerk, aber mit Schneisen. Frueher war die Karte so dicht,
     dass sich Gegner mit dem Sichtkegel ein ganzes Match lang verfehlen konnten. */
  function genThicket(t, rnd) {
    rect(t, 0, 0, N, N, F);
    for (let i = 0; i < 17; i++) blob(t, 2 + ((rnd() * (N - 4)) | 0), 2 + ((rnd() * (N - 4)) | 0), 2 + ((rnd() * 2) | 0), B, rnd);
    for (let i = 0; i < 9; i++) {
      const x = 4 + ((rnd() * (N - 8)) | 0), y = 4 + ((rnd() * (N - 8)) | 0);
      rect(t, x, y, 2 + ((rnd() * 3) | 0), 2, W);
    }
    // Freie Sichtachsen quer ueber die Karte
    rect(t, 0, N / 2 - 2, N, 4, F);
    rect(t, N / 2 - 2, 0, 4, N, F);
    rect(t, 0, 7, N, 2, F);
    rect(t, 0, N - 9, N, 2, F);
    rect(t, N / 2 - 3, N / 2 - 3, 6, 6, F);
  }

  // 4 Bunker: Raeume mit Tueren
  function genBunker(t, rnd) {
    rect(t, 0, 0, N, N, F);
    const step = N / 4;
    for (let i = 1; i < 4; i++) {
      const p = i * step;
      for (let k = 0; k < N; k++) { set(t, p, k, W); set(t, k, p, W); }
    }
    // Tueren
    for (let i = 1; i < 4; i++) {
      const p = i * step;
      for (let s = 0; s < 4; s++) {
        const off = s * step + 2 + ((rnd() * (step - 5)) | 0);
        rect(t, p, off, 1, 3, F);
        rect(t, off, p, 3, 1, F);
      }
    }
    for (let i = 0; i < 14; i++) {
      const x = 2 + ((rnd() * (N - 4)) | 0), y = 2 + ((rnd() * (N - 4)) | 0);
      if (get(t, x, y) === F) blob(t, x, y, 1, rnd() < 0.55 ? B : W, rnd);
    }
  }

  // 5 Labyrinth: DFS-Maze mit breiten Gaengen
  function genMaze(t, rnd) {
    rect(t, 0, 0, N, N, W);
    const P = 4, cells = Math.floor(N / P); // 8 Zellen
    const vis = new Array(cells * cells).fill(false);
    const stack = [[0, 0]];
    vis[0] = true;
    const carveCell = (cx, cy) => rect(t, cx * P + 1, cy * P + 1, P - 1, P - 1, F);
    carveCell(0, 0);
    while (stack.length) {
      const [cx, cy] = stack[stack.length - 1];
      const nb = [];
      if (cx > 0 && !vis[cy * cells + cx - 1]) nb.push([-1, 0]);
      if (cx < cells - 1 && !vis[cy * cells + cx + 1]) nb.push([1, 0]);
      if (cy > 0 && !vis[(cy - 1) * cells + cx]) nb.push([0, -1]);
      if (cy < cells - 1 && !vis[(cy + 1) * cells + cx]) nb.push([0, 1]);
      if (!nb.length) { stack.pop(); continue; }
      const [dx, dy] = nb[(rnd() * nb.length) | 0];
      const nx = cx + dx, ny = cy + dy;
      // Wanddurchbruch
      const wx = cx * P + 1 + dx * P, wy = cy * P + 1 + dy * P;
      if (dx !== 0) rect(t, cx * P + 1 + (dx > 0 ? P - 1 : -1), cy * P + 1, 1, P - 1, F);
      else rect(t, cx * P + 1, cy * P + 1 + (dy > 0 ? P - 1 : -1), P - 1, 1, F);
      void wx; void wy;
      vis[ny * cells + nx] = true;
      carveCell(nx, ny);
      stack.push([nx, ny]);
    }
    // Schleifen aufbrechen (kein Sackgassen-Frust)
    for (let i = 0; i < 45; i++) {
      const x = 2 + ((rnd() * (N - 4)) | 0), y = 2 + ((rnd() * (N - 4)) | 0);
      if (get(t, x, y) === W) set(t, x, y, rnd() < 0.35 ? B : F);
    }
    for (let i = 0; i < 12; i++) blob(t, 2 + ((rnd() * (N - 4)) | 0), 2 + ((rnd() * (N - 4)) | 0), 1, B, rnd);
    rect(t, N / 2 - 2, N / 2 - 2, 4, 4, F);
  }

  // 6 Arena: offene Mitte, Deckungsring
  function genArena(t, rnd) {
    rect(t, 0, 0, N, N, W);
    const c = N / 2;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      if (Math.hypot(x - c + 0.5, y - c + 0.5) < c - 2.5) set(t, x, y, F);
    }
    // Ringdeckung
    for (let a = 0; a < 12; a++) {
      const ang = (a / 12) * Math.PI * 2;
      const r = c * 0.62;
      const x = Math.round(c + Math.cos(ang) * r), y = Math.round(c + Math.sin(ang) * r);
      blob(t, x, y, 1 + ((rnd() * 2) | 0), a % 3 === 0 ? B : W, rnd);
    }
    for (let a = 0; a < 8; a++) {
      const ang = (a / 8) * Math.PI * 2 + 0.4;
      const r = c * 0.32;
      const x = Math.round(c + Math.cos(ang) * r), y = Math.round(c + Math.sin(ang) * r);
      blob(t, x, y, 1, rnd() < 0.5 ? B : W, rnd);
    }
    blob(t, c, c, 2, F, rnd);
  }

  // 7 Canyon: diagonale Baender
  function genCanyon(t, rnd) {
    rect(t, 0, 0, N, N, F);
    for (let band = -2; band < 5; band++) {
      const off = band * 8;
      for (let i = 0; i < N; i++) {
        const x = i, y = i + off;
        const len = 3 + ((rnd() * 2) | 0);
        for (let k = 0; k < len; k++) set(t, x, y + k, rnd() < 0.25 ? B : W);
      }
      // Durchgaenge
      for (let g = 0; g < 3; g++) {
        const gx = 2 + ((rnd() * (N - 4)) | 0);
        rect(t, gx, gx + off - 1, 3, 6, F);
      }
    }
    for (let i = 0; i < 10; i++) blob(t, 2 + ((rnd() * (N - 4)) | 0), 2 + ((rnd() * (N - 4)) | 0), 2, B, rnd);
    rect(t, N / 2 - 3, N / 2 - 3, 6, 6, F);
  }

  // 8 Grove: Felsen + Buschcluster
  function genGrove(t, rnd) {
    rect(t, 0, 0, N, N, F);
    for (let i = 0; i < 11; i++) {
      const x = 3 + ((rnd() * (N - 6)) | 0), y = 3 + ((rnd() * (N - 6)) | 0);
      blob(t, x, y, 2 + ((rnd() * 2) | 0), W, rnd);
    }
    for (let i = 0; i < 20; i++) {
      const x = 2 + ((rnd() * (N - 4)) | 0), y = 2 + ((rnd() * (N - 4)) | 0);
      blob(t, x, y, 1 + ((rnd() * 3) | 0), B, rnd);
    }
    rect(t, 6, N / 2 - 1, N - 12, 3, F);
    rect(t, N / 2 - 1, 6, 3, N - 12, F);
  }

  // 9 Zitadelle: Festungsring mit Innenhof und vier Toren
  function genCitadel(t, rnd) {
    rect(t, 0, 0, N, N, F);
    const c = N / 2;
    // Aussenring
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const d = Math.max(Math.abs(x - c + .5), Math.abs(y - c + .5));
      if (d > c - 3.5 && d < c - 1.5) set(t, x, y, W);
    }
    // Innenring
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const d = Math.max(Math.abs(x - c + .5), Math.abs(y - c + .5));
      if (d > 5.5 && d < 7.5) set(t, x, y, W);
    }
    // Vier Tore in beiden Ringen
    rect(t, c - 2, 0, 4, N, F);
    rect(t, 0, c - 2, N, 4, F);
    // Innenhof mit Deckung
    blob(t, c, c, 2, B, rnd);
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      set(t, Math.round(c + Math.cos(a) * 4), Math.round(c + Math.sin(a) * 4), i % 2 ? W : B);
    }
    // Ecktuerme
    [[4, 4], [N - 5, 4], [4, N - 5], [N - 5, N - 5]].forEach(([x, y]) => blob(t, x, y, 2, W, rnd));
    for (let i = 0; i < 12; i++) blob(t, 3 + ((rnd() * (N - 6)) | 0), 3 + ((rnd() * (N - 6)) | 0), 1, B, rnd);
  }

  // 10 Sumpf: viele kleine Inseln aus Buschwerk, kaum feste Wand
  function genSwamp(t, rnd) {
    rect(t, 0, 0, N, N, F);
    for (let i = 0; i < 34; i++) {
      const x = 2 + ((rnd() * (N - 4)) | 0), y = 2 + ((rnd() * (N - 4)) | 0);
      blob(t, x, y, 1 + ((rnd() * 3) | 0), B, rnd);
    }
    // wenige feste Unterstaende
    for (let i = 0; i < 6; i++) {
      const x = 4 + ((rnd() * (N - 9)) | 0), y = 4 + ((rnd() * (N - 9)) | 0);
      rect(t, x, y, 3, 3, W);
      rect(t, x + 1, y + 1, 1, 1, F);
    }
    // Schneisen fuer Sichtlinien
    rect(t, 0, N / 2 - 1, N, 2, F);
    rect(t, N / 2 - 1, 0, 2, N, F);
  }

  // 11 Werft: lange Hallen mit parallelen Gaengen
  function genShipyard(t, rnd) {
    rect(t, 0, 0, N, N, F);
    for (let i = 0; i < 5; i++) {
      const y = 3 + i * 6;
      rect(t, 2, y, N - 4, 2, W);
      // Durchbrueche
      for (let k = 0; k < 3; k++) {
        const gx = 3 + ((rnd() * (N - 8)) | 0);
        rect(t, gx, y, 3, 2, F);
      }
    }
    // Querverbindung an den Raendern
    rect(t, 1, 1, 2, N - 2, F);
    rect(t, N - 3, 1, 2, N - 2, F);
    for (let i = 0; i < 16; i++) {
      const x = 3 + ((rnd() * (N - 6)) | 0), y = 3 + ((rnd() * (N - 6)) | 0);
      if (get(t, x, y) === F) blob(t, x, y, 1, rnd() < 0.6 ? B : W, rnd);
    }
    rect(t, N / 2 - 2, N / 2 - 2, 4, 4, F);
  }

  // 12 Krater: offene Mitte mit Ringwall und Trichtern
  function genCrater(t, rnd) {
    rect(t, 0, 0, N, N, F);
    const c = N / 2;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      const d = Math.hypot(x - c + .5, y - c + .5);
      if (d > 8.5 && d < 10.5) set(t, x, y, W);
    }
    // Vier Durchbrueche im Ringwall
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const x = Math.round(c + Math.cos(a) * 9.5), y = Math.round(c + Math.sin(a) * 9.5);
      blob(t, x, y, 2, F, rnd);
    }
    // Kleine Krater aussen
    for (let i = 0; i < 10; i++) {
      const a = rnd() * Math.PI * 2, r = 12 + rnd() * 3;
      const x = Math.round(c + Math.cos(a) * r), y = Math.round(c + Math.sin(a) * r);
      blob(t, x, y, 1 + ((rnd() * 2) | 0), rnd() < 0.5 ? W : B, rnd);
    }
    blob(t, c, c, 3, B, rnd);
    blob(t, c, c, 1, F, rnd);
  }

  /* 13 Kaserne: Raster aus Stuben mit breiten Fluren. Bei engem Raster
     verliefen sich zwei Spieler ein ganzes Match, ohne sich zu treffen -
     daher grosser Abstand plus durchgehende Hauptachsen. */
  function genBarracks(t, rnd) {
    rect(t, 0, 0, N, N, F);
    const pitch = 9;
    for (let by = 3; by + 5 < N - 2; by += pitch) {
      for (let bx = 3; bx + 5 < N - 2; bx += pitch) {
        // Stubenwaende
        rect(t, bx, by, 6, 1, W);
        rect(t, bx, by + 5, 6, 1, W);
        rect(t, bx, by, 1, 6, W);
        rect(t, bx + 5, by, 1, 6, W);
        // Zwei gegenueberliegende Tueren - mit nur einer verlaufen sich Spieler
        // im Raster, statt sich zu begegnen
        if (rnd() < 0.5) {
          rect(t, bx + 2, by, 2, 1, F);
          rect(t, bx + 2, by + 5, 2, 1, F);
        } else {
          rect(t, bx, by + 2, 1, 2, F);
          rect(t, bx + 5, by + 2, 1, 2, F);
        }
        // Einrichtung
        if (rnd() < 0.5) blob(t, bx + 2 + ((rnd() * 2) | 0), by + 2 + ((rnd() * 2) | 0), 1, rnd() < 0.5 ? B : W, rnd);
      }
    }
    // Durchgehende Hauptachsen quer ueber den Hof
    rect(t, 0, N / 2 - 2, N, 4, F);
    rect(t, N / 2 - 2, 0, 4, N, F);
    for (let i = 0; i < 10; i++) {
      const x = 2 + ((rnd() * (N - 4)) | 0), y = 2 + ((rnd() * (N - 4)) | 0);
      if (get(t, x, y) === F) blob(t, x, y, 1, B, rnd);
    }
  }

  /* 14 Schlucht: breite Querwege zwischen Felsbaendern. Zuerst war es eine
     einzige Serpentine mit nur einem Weg pro Etage - im 1v1 liefen zwei
     Spieler ein ganzes Match aneinander vorbei, ohne einen Schuss. Jetzt
     verbinden beide Flanken und eine Mittelachse jede Etage. */
  function genRavine(t, rnd) {
    rect(t, 0, 0, N, N, W);
    for (let y = 2; y < N - 2; y += 5) {
      rect(t, 2, y, N - 4, 3, F);                  // Querweg ueber die Breite
      rect(t, 4, y, 3, 8, F);                      // linke Flanke
      rect(t, N - 7, y, 3, 8, F);                  // rechte Flanke
    }
    rect(t, N / 2 - 1, 2, 3, N - 4, F);            // Mittelachse als Sichtlinie
    // Nischen zum Ausweichen
    for (let i = 0; i < 14; i++) {
      const nx = 3 + ((rnd() * (N - 6)) | 0), ny = 3 + ((rnd() * (N - 6)) | 0);
      if (get(t, nx, ny) === W) blob(t, nx, ny, 1, F, rnd);
    }
    for (let i = 0; i < 12; i++) {
      const nx = 3 + ((rnd() * (N - 6)) | 0), ny = 3 + ((rnd() * (N - 6)) | 0);
      if (get(t, nx, ny) === F) set(t, nx, ny, B);
    }
    rect(t, N / 2 - 2, N / 2 - 2, 4, 4, F);
  }

  /* 15 Turm: verschachtelte Ringe. Weniger und weiter auseinander als zuerst
     gebaut - mit engen Ringen verfehlten sich zwei Spieler ein ganzes Match. */
  function genTower(t, rnd) {
    rect(t, 0, 0, N, N, F);
    const c = N / 2;
    for (let ring = 1; ring <= 3; ring++) {
      const d = ring * 4.5;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const md = Math.max(Math.abs(x - c + .5), Math.abs(y - c + .5));
        if (md > d - .6 && md < d + .6) set(t, x, y, W);
      }
      // Vier Durchgaenge je Ring, je Ring um 45 Grad versetzt
      const off = Math.round(d);
      rect(t, c - 2, c - off - 1, 4, 3, F);
      rect(t, c - 2, c + off - 1, 4, 3, F);
      rect(t, c - off - 1, c - 2, 3, 4, F);
      rect(t, c + off - 1, c - 2, 3, 4, F);
      if (ring % 2 === 0) {                 // zusaetzlich diagonale Luecken
        rect(t, c - off - 1, c - off - 1, 3, 3, F);
        rect(t, c + off - 1, c + off - 1, 3, 3, F);
      }
    }
    blob(t, c, c, 3, F, rnd);
    for (let i = 0; i < 14; i++) {
      const x = 2 + ((rnd() * (N - 4)) | 0), y = 2 + ((rnd() * (N - 4)) | 0);
      if (get(t, x, y) === F) set(t, x, y, B);
    }
  }

  // 16 Dschungel: Buschlabyrinth mit Lichtungen
  function genJungle(t, rnd) {
    rect(t, 0, 0, N, N, B);
    // Lichtungen freischlagen
    for (let i = 0; i < 16; i++) {
      blob(t, 3 + ((rnd() * (N - 6)) | 0), 3 + ((rnd() * (N - 6)) | 0), 2 + ((rnd() * 3) | 0), F, rnd);
    }
    // Pfade zwischen den Lichtungen
    for (let i = 0; i < 7; i++) {
      const y = 3 + ((rnd() * (N - 6)) | 0);
      rect(t, 1, y, N - 2, 2, F);
      const x = 3 + ((rnd() * (N - 6)) | 0);
      rect(t, x, 1, 2, N - 2, F);
    }
    // Ein paar feste Deckungen
    for (let i = 0; i < 8; i++) {
      const x = 3 + ((rnd() * (N - 6)) | 0), y = 3 + ((rnd() * (N - 6)) | 0);
      rect(t, x, y, 2, 2, W);
    }
    rect(t, N / 2 - 2, N / 2 - 2, 4, 4, F);
  }

  // 17 Ruine: eingestuerzte Mauerzuege, viel Schutt-Optik
  function genRuins(t, rnd) {
    rect(t, 0, 0, N, N, F);
    // Abgebrochene Mauerzuege
    for (let i = 0; i < 13; i++) {
      const x = 2 + ((rnd() * (N - 8)) | 0), y = 2 + ((rnd() * (N - 8)) | 0);
      const len = 4 + ((rnd() * 7) | 0);
      const waag = rnd() < 0.5;
      for (let k = 0; k < len; k++) {
        if (rnd() < 0.25) continue;                // Lücken = eingestuerzt
        if (waag) set(t, x + k, y, W); else set(t, x, y + k, W);
      }
    }
    // Ueberwucherung
    for (let i = 0; i < 18; i++) {
      blob(t, 2 + ((rnd() * (N - 4)) | 0), 2 + ((rnd() * (N - 4)) | 0), 1 + ((rnd() * 2) | 0), B, rnd);
    }
    // Zentraler Innenhof
    rect(t, N / 2 - 4, N / 2 - 4, 8, 8, F);
    rect(t, N / 2 - 4, N / 2 - 4, 8, 1, W);
    rect(t, N / 2 - 4, N / 2 + 3, 8, 1, W);
    rect(t, N / 2 - 1, N / 2 - 4, 2, 1, F);
    rect(t, N / 2 - 1, N / 2 + 3, 2, 1, F);
  }

  const DEFS = [
    { name: 'Crossfire', biome: 'urban', seed: 91117, gen: genCrossfire },
    { name: 'Foundry', biome: 'industrial', seed: 20456, gen: genFoundry },
    { name: 'Thicket', biome: 'forest', seed: 77321, gen: genThicket },
    { name: 'Bunker', biome: 'concrete', seed: 40982, gen: genBunker },
    { name: 'Labyrinth', biome: 'neon', seed: 13337, gen: genMaze },
    { name: 'Arena', biome: 'sand', seed: 66123, gen: genArena },
    { name: 'Canyon', biome: 'canyon', seed: 51900, gen: genCanyon },
    { name: 'Grove', biome: 'forest', seed: 88240, gen: genGrove },
    { name: 'Citadel', biome: 'concrete', seed: 30277, gen: genCitadel },
    { name: 'Swamp', biome: 'forest', seed: 61844, gen: genSwamp },
    { name: 'Shipyard', biome: 'industrial', seed: 45019, gen: genShipyard },
    { name: 'Crater', biome: 'canyon', seed: 72633, gen: genCrater },
    { name: 'Barracks', biome: 'concrete', seed: 58471, gen: genBarracks },
    { name: 'Ravine', biome: 'canyon', seed: 90312, gen: genRavine },
    { name: 'Tower', biome: 'neon', seed: 24680, gen: genTower },
    { name: 'Jungle', biome: 'forest', seed: 13579, gen: genJungle },
    { name: 'Ruins', biome: 'sand', seed: 46802, gen: genRuins }
  ];

  /* ---------- Nachbearbeitung ---------- */

  function symmetrize(t) {
    const total = N * N;
    for (let i = 0; i < total / 2; i++) t[total - 1 - i] = t[i];
  }

  function border(t) {
    for (let i = 0; i < N; i++) { set(t, i, 0, W); set(t, i, N - 1, W); set(t, 0, i, W); set(t, N - 1, i, W); }
  }

  function walkable(v) { return v !== W; }

  function connect(t) {
    // Start: freie Mitte garantieren
    rect(t, N / 2 - 2, N / 2 - 2, 4, 4, F);
    const seen = new Uint8Array(N * N);
    const q = [idx(N / 2, N / 2)];
    seen[q[0]] = 1;
    while (q.length) {
      const i = q.pop();
      const x = i % N, y = (i / N) | 0;
      const nbs = [[x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]];
      for (const [nx, ny] of nbs) {
        if (!inside(nx, ny)) continue;
        const j = idx(nx, ny);
        if (seen[j] || !walkable(t[j])) continue;
        seen[j] = 1; q.push(j);
      }
    }
    for (let i = 0; i < N * N; i++) if (walkable(t[i]) && !seen[i]) t[i] = W;
    return seen;
  }

  function openTiles(t) {
    const out = [];
    for (let y = 1; y < N - 1; y++) for (let x = 1; x < N - 1; x++) {
      if (t[idx(x, y)] === F) out.push({ x, y });
    }
    return out;
  }

  // Freies Feld mit Mindestabstand zu Waenden bevorzugen
  function openness(t, x, y) {
    let c = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (get(t, x + dx, y + dy) !== W) c++;
    return c;
  }

  function pickSpawns(t, open, anchor, count) {
    const cands = open
      .filter(p => openness(t, p.x, p.y) >= 8)
      .map(p => ({ p, d: Math.hypot(p.x - anchor.x, p.y - anchor.y) }))
      .sort((a, b) => a.d - b.d);
    const out = [];
    for (const c of cands) {
      if (out.length >= count) break;
      if (out.every(o => Math.hypot(o.x - c.p.x, o.y - c.p.y) > 2.5)) out.push(c.p);
    }
    while (out.length < count && open.length) out.push(open[(open.length * 0.5) | 0]);
    return out;
  }

  function spreadSpawns(t, open, count) {
    const cands = open.filter(p => openness(t, p.x, p.y) >= 8);
    if (!cands.length) return open.slice(0, count);
    const out = [cands[0]];
    while (out.length < count) {
      let best = null, bestD = -1;
      for (const c of cands) {
        let d = Infinity;
        for (const o of out) d = Math.min(d, Math.hypot(o.x - c.x, o.y - c.y));
        if (d > bestD) { bestD = d; best = c; }
      }
      if (!best) break;
      out.push(best);
    }
    return out;
  }

  const cache = {};

  function generate(id) {
    id = ((id % DEFS.length) + DEFS.length) % DEFS.length;
    if (cache[id]) return cache[id];
    const def = DEFS[id];
    const rnd = mulberry32(def.seed);
    const t = new Uint8Array(N * N);
    def.gen(t, rnd);
    symmetrize(t);
    border(t);
    connect(t);

    const open = openTiles(t);
    const teamA = pickSpawns(t, open, { x: 4, y: 4 }, 3);
    const teamB = teamA.map(p => {
      const rx = N - 1 - p.x, ry = N - 1 - p.y;
      return get(t, rx, ry) === F ? { x: rx, y: ry } : p;
    });
    const ffa = spreadSpawns(t, open, 6);

    // Health-/Ammo-Packs symmetrisch
    const packAnchors = [{ x: N / 2, y: 5 }, { x: 5, y: N / 2 }, { x: N / 2, y: N / 2 }];
    const packs = [];
    packAnchors.forEach((a, i) => {
      const near = pickSpawns(t, open, a, 1)[0];
      if (!near) return;
      packs.push({ x: near.x, y: near.y, type: i === 2 ? 'ammo' : 'health' });
      if (i !== 2) {
        const rx = N - 1 - near.x, ry = N - 1 - near.y;
        if (get(t, rx, ry) === F) packs.push({ x: rx, y: ry, type: 'health' });
      }
    });

    const map = {
      id, n: N, name: def.name, biome: def.biome, tiles: t,
      spawns: { 0: teamA, 1: teamB, ffa }, packs
    };
    cache[id] = map;
    return map;
  }

  /** Frische, veraenderbare Kopie fuer ein Match - Zerstoerung darf den Cache nicht anfassen. */
  function instance(id) {
    const base = generate(id);
    return {
      id: base.id, n: base.n, name: base.name, biome: base.biome,
      tiles: new Uint8Array(base.tiles),
      base: base.tiles,
      spawns: base.spawns, packs: base.packs
    };
  }

  function all() { return DEFS.map((d, i) => ({ id: i, name: d.name, biome: d.biome })); }

  return { generate, instance, all, count: DEFS.length, DEFS };
});
