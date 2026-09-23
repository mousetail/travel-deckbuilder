export type HexCoord = { q: number; r: number };

export const HEX_SIZE = 32; // centre → corner, in world pixels

const SQRT3 = Math.sqrt(3);

export const AXIAL_DIRECTIONS: readonly HexCoord[] = [
  { q: 1, r: 0 },
  { q: 1, r: -1 },
  { q: 0, r: -1 },
  { q: -1, r: 0 },
  { q: -1, r: 1 },
  { q: 0, r: 1 },
];

export function hexKey(coord: HexCoord): string {
  return `${coord.q},${coord.r}`;
}

export function parseHexKey(key: string): HexCoord {
  const parts = key.split(",");
  if (parts.length !== 2) {
    throw new Error(`bad hex key: ${key}`);
  }
  const q = Number(parts[0]);
  const r = Number(parts[1]);
  if (!Number.isInteger(q) || !Number.isInteger(r)) {
    throw new Error(`bad hex key: ${key}`);
  }
  return { q, r };
}

export function addHex(a: HexCoord, b: HexCoord): HexCoord {
  return { q: a.q + b.q, r: a.r + b.r };
}

export function equalsHex(a: HexCoord, b: HexCoord): boolean {
  return a.q === b.q && a.r === b.r;
}

export function neighbours(coord: HexCoord): HexCoord[] {
  return AXIAL_DIRECTIONS.map((dir) => addHex(coord, dir));
}

export function hexDistance(a: HexCoord, b: HexCoord): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}

export function hexToPixel(coord: HexCoord): { x: number; y: number } {
  return {
    x: HEX_SIZE * SQRT3 * (coord.q + coord.r / 2),
    y: HEX_SIZE * 1.5 * coord.r,
  };
}

/** Centre pixel of a hex relative to the top-left of its bounding box. */
export function hexPixelSize(): { width: number; height: number } {
  return { width: SQRT3 * HEX_SIZE, height: 2 * HEX_SIZE };
}

function cubeRound(q: number, r: number): HexCoord {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  const rs = Math.round(s);

  const dq = Math.abs(rq - q);
  const dr = Math.abs(rr - r);
  const ds = Math.abs(rs - s);

  if (dq > dr && dq > ds) {
    rq = -rr - rs;
  } else if (dr > ds) {
    rr = -rq - rs;
  }
  return { q: rq, r: rr };
}

export function pixelToHex(point: { x: number; y: number }): HexCoord {
  const q = (SQRT3 / 3 * point.x - point.y / 3) / HEX_SIZE;
  const r = (2 / 3 * point.y) / HEX_SIZE;
  return cubeRound(q, r);
}

/** All hexes within `radius` steps of `centre` (includes `centre`). */
export function hexesInRange(centre: HexCoord, radius: number): HexCoord[] {
  const results: HexCoord[] = [];
  for (let dq = -radius; dq <= radius; dq += 1) {
    for (let dr = Math.max(-radius, -dq - radius); dr <= Math.min(radius, -dq + radius); dr += 1) {
      results.push({ q: centre.q + dq, r: centre.r + dr });
    }
  }
  return results;
}

/** Walk a straight line of hexes from `a` to `b` inclusive. */
export function hexLine(a: HexCoord, b: HexCoord): HexCoord[] {
  const n = hexDistance(a, b);
  if (n === 0) {
    return [a];
  }
  const results: HexCoord[] = [];
  for (let i = 0; i <= n; i += 1) {
    const t = i / n;
    results.push(cubeRound(
      a.q + (b.q - a.q) * t,
      a.r + (b.r - a.r) * t,
    ));
  }
  return results;
}

export function findPath(
  start: HexCoord,
  goal: HexCoord,
  isPassable: (coord: HexCoord) => boolean,
): HexCoord[] {
  if (equalsHex(start, goal)) {
    return [start];
  }
  const frontier: HexCoord[] = [start];
  const cameFrom = new Map<string, HexCoord>();
  cameFrom.set(hexKey(start), start);

  while (frontier.length > 0) {
    const current = frontier.shift();
    if (current === undefined) {
      break;
    }
    for (const next of neighbours(current)) {
      const key = hexKey(next);
      if (cameFrom.has(key) || !isPassable(next)) {
        continue;
      }
      cameFrom.set(key, current);
      if (equalsHex(next, goal)) {
        return reconstructPath(cameFrom, start, goal);
      }
      frontier.push(next);
    }
  }
  return [];
}

function reconstructPath(
  cameFrom: Map<string, HexCoord>,
  start: HexCoord,
  goal: HexCoord,
): HexCoord[] {
  const path: HexCoord[] = [goal];
  let current = goal;
  while (!equalsHex(current, start)) {
    const previous = cameFrom.get(hexKey(current));
    if (previous === undefined) {
      return [];
    }
    current = previous;
    path.push(current);
  }
  return path.reverse();
}

/**
 * Every hex reachable from `start` for a total cost of at most `budget`
 * (including `start` itself). Used to show where an enemy can strike.
 */
export function hexesWithinCost(
  start: HexCoord,
  budget: number,
  costAt: CostLookup,
): HexCoord[] {
  const best = new Map<string, number>();
  best.set(hexKey(start), 0);
  const reached = new Map<string, HexCoord>();
  reached.set(hexKey(start), start);
  const open: HexCoord[] = [start];

  while (open.length > 0) {
    let cheapest = 0;
    for (let i = 1; i < open.length; i += 1) {
      const a = best.get(hexKey(open[i])) ?? Infinity;
      const b = best.get(hexKey(open[cheapest])) ?? Infinity;
      if (a < b) {
        cheapest = i;
      }
    }
    const [current] = open.splice(cheapest, 1);
    if (current === undefined) {
      break;
    }
    const currentCost = best.get(hexKey(current)) ?? Infinity;
    for (const next of neighbours(current)) {
      const step = costAt(next);
      if (!Number.isFinite(step)) {
        continue;
      }
      const candidate = currentCost + step;
      if (candidate > budget) {
        continue;
      }
      if (candidate < (best.get(hexKey(next)) ?? Infinity)) {
        best.set(hexKey(next), candidate);
        reached.set(hexKey(next), next);
        open.push(next);
      }
    }
  }
  return [...reached.values()];
}

export type CostLookup = (coord: HexCoord) => number;

export type CostPath = { path: HexCoord[]; cost: number };

/**
 * Dijkstra over a per-step cost function, for movers that pay different costs
 * for different terrain (chapter 07's assassins). `costAt` returning a
 * non-finite value means the hex cannot be entered. Returns null if `goal` is
 * unreachable.
 */
export function findPathByCost(
  start: HexCoord,
  goal: HexCoord,
  costAt: CostLookup,
): CostPath | null {
  const best = new Map<string, number>();
  best.set(hexKey(start), 0);
  const cameFrom = new Map<string, HexCoord>();
  const open: HexCoord[] = [start];

  while (open.length > 0) {
    let cheapest = 0;
    for (let i = 1; i < open.length; i += 1) {
      const a = best.get(hexKey(open[i])) ?? Infinity;
      const b = best.get(hexKey(open[cheapest])) ?? Infinity;
      if (a < b) {
        cheapest = i;
      }
    }
    const [current] = open.splice(cheapest, 1);
    if (current === undefined) {
      break;
    }
    const currentCost = best.get(hexKey(current)) ?? Infinity;
    if (equalsHex(current, goal)) {
      return { path: reconstructPath(cameFrom, start, goal), cost: currentCost };
    }
    for (const next of neighbours(current)) {
      const step = costAt(next);
      if (!Number.isFinite(step)) {
        continue;
      }
      const candidate = currentCost + step;
      if (candidate < (best.get(hexKey(next)) ?? Infinity)) {
        best.set(hexKey(next), candidate);
        cameFrom.set(hexKey(next), current);
        open.push(next);
      }
    }
  }
  return null;
}