const C = require('../shared/constants.js');

function findPath(map, sx, sy, gx, gy) {
  const stx = Math.floor(sx / C.TILE);
  const sty = Math.floor(sy / C.TILE);
  const gtx = Math.floor(gx / C.TILE);
  const gty = Math.floor(gy / C.TILE);

  if (stx === gtx && sty === gty) return null;
  if (stx < 0 || sty < 0 || gtx < 0 || gty < 0) return null;
  if (stx >= map.n || sty >= map.n || gtx >= map.n || gty >= map.n) return null;
  if (map.tiles[sty * map.n + stx] === C.T_WALL) return null;
  if (map.tiles[gty * map.n + gtx] === C.T_WALL) return null;

  const key = (x, y) => y * map.n + x;
  const start = key(stx, sty);
  const goal = key(gtx, gty);

  const cameFrom = new Map();
  const frontier = [start];
  const visited = new Set([start]);

  for (let i = 0; i < frontier.length; i++) {
    const cur = frontier[i];
    const cx = cur % map.n, cy = Math.floor(cur / map.n);

    if (cur === goal) {
      const path = [];
      let c = cur;
      while (cameFrom.has(c)) {
        const p = cameFrom.get(c);
        path.push({ x: (c % map.n) * C.TILE + C.TILE / 2, y: Math.floor(c / map.n) * C.TILE + C.TILE / 2 });
        c = p;
      }
      path.reverse();
      return path;
    }

    const dirs = [[0, -1], [1, 0], [0, 1], [-1, 0]];
    for (const [dx, dy] of dirs) {
      const nx = cx + dx, ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= map.n || ny >= map.n) continue;
      if (map.tiles[ny * map.n + nx] === C.T_WALL) continue;
      const nk = key(nx, ny);
      if (visited.has(nk)) continue;
      visited.add(nk);
      cameFrom.set(nk, cur);
      frontier.push(nk);
    }
  }

  return null;
}

module.exports = { findPath };
