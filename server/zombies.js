/* Zombie AI: clean path following with early waypoint advancement. */
const C = require('../shared/constants.js');
const PF = require('./pathfinder.js');
const PHYS = require('../shared/physics.js');

function zombieThink(match, z, dt) {
  const inp = z.input;
  inp.shoot = false; inp.reload = false; inp.dash = false; inp.grenade = false;
  inp.snap = true;

  if (!z.alive) { inp.dx = 0; inp.dy = 0; return; }

  const mem = z.zombieMem;
  mem.timer = (mem.timer || 0) - 1;

  let target = null, bestD = Infinity;
  for (const o of match.players.values()) {
    if (o.bot || o === z || !o.alive) continue;
    const d = Math.hypot(o.x - z.x, o.y - z.y);
    if (d < bestD) { bestD = d; target = o; }
  }

  if (!target) { inp.dx = 0; inp.dy = 0; return; }

  const dx = target.x - z.x;
  const dy = target.y - z.y;
  const d = bestD || 1;

  if (mem.timer <= 0) {
    mem.fullPath = PF.findPath(match.map, z.x, z.y, target.x, target.y);
    mem.wpIdx = 0;
    mem.timer = 8;
  }

  const path = mem.fullPath;
  let wx = target.x, wy = target.y;

  if (path && path.length > 0 && mem.wpIdx < path.length) {
    // Advance past waypoints that are behind us or very close
    for (let i = mem.wpIdx; i < path.length; i++) {
      const wp = path[i];
      const wd = Math.hypot(z.x - wp.x, z.y - wp.y);
      if (wd < C.TILE * 1.2) {
        mem.wpIdx = i + 1;
      } else {
        break;
      }
    }

    if (mem.wpIdx >= path.length) {
      wx = target.x; wy = target.y;
    } else {
      // Look ahead: skip the immediate waypoint if the next one is reachable
      let idx = mem.wpIdx;
      if (idx + 1 < path.length && PHYS.los(match.map, z.x, z.y, path[idx + 1].x, path[idx + 1].y)) {
        idx++;
      }
      wx = path[idx].x;
      wy = path[idx].y;
    }
  }

  const gdx = wx - z.x, gdy = wy - z.y;
  const gl = Math.hypot(gdx, gdy) || 1;

  inp.dx = gdx / gl;
  inp.dy = gdy / gl;
  inp.aim = Math.atan2(dy, dx);
  inp.shoot = bestD <= z.weapon.range + C.PLAYER_R * 2;
}

module.exports = { zombieThink };
