# 01 — Hex grid fundamentals

**Goal:** a reusable, DOM-free `game/hex.ts` that converts between axial
coordinates and screen pixels, enumerates neighbours, measures distance, and finds
the shortest path between two hexes. Everything spatial in the game is built on
this file, so get it right and unit-test it (chapter 10).

## 1. Coordinate system

Use **pointy-top hexes** with **axial coordinates** `(q, r)`. Points to understand:

- Axial coords describe a hex with two numbers. A third, implied number
  `s = -q - r` exists but is never stored; it is only used inside distance math.
- Pointy-top means a hex has a vertex at the top and flat left/right sides. The six
  neighbours are always:

  ```
  (+1, 0)  (+1, -1)  (0, -1)  (-1, 0)  (-1, +1)  (0, +1)
  ```

- Why axial and not offset ("row, column")? Because distance and neighbour
  enumeration are trivial and branch-free in axial, while offset coordinates need
  parity corrections on every operation. You can still *serialise* to offset for
  debugging if you want, but do the math in axial.

`src/game/hex.ts`:

```ts
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
```

`hexKey`/`parseHexKey` are how you put hexes in a `Map`/`Set`, since object identity
does not work for `{ q, r }`. Use them consistently (the map store in chapter 05 is a
`Map<string, Tile>`).

## 2. Pixel conversion and picking

Pointy-top axial → pixels:

```ts
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
```

Pixels → a *fractional* axial coordinate, then rounded to the nearest hex. Rounding
raw axial values independently gives wrong answers near the boundaries; convert to
cube coordinates, round all three, then fix the largest error. This is the standard
"cube rounding" step:

```ts
function cubeRound(q: number, r: number): HexCoord {
  const s = -q - r;
  let rq = Math.round(q);
  let rr = Math.round(r);
  let rs = Math.round(s);

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
```

`pixelToHex` is what you call on a mouse/pointer position (converted to world
space) to know which hex the player clicked.

## 3. Ranges, rings, and lines

You will need these for combat range (chapter 07), upgrade placement, and hover
highlights:

```ts
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
```

`hexLine` is used later for line-of-effect checks and for animating a move along a
path.

## 4. Pathfinding scaffolding

Movement (chapter 04) and the assassins (chapter 07) both need shortest paths under
"can I stand here?" constraints. Put the generic search in this file; pass the
passability rule in as a function so the file stays free of terrain knowledge:

```ts
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
```

This is breadth-first search, which is correct because every hex step costs 1. If
you later add terrain *costs* (mountains slower, say) swap in Dijkstra/A* — but the
design has no per-step costs, only passability, so BFS is exact and fast.

## 5. Milestone

- `game/hex.ts` compiles and exports the functions above.
- `hexDistance` satisfies: distance to self is 0; each neighbour is distance 1; the
  distance from `{q:0,r:0}` to `{q:3,r:-3}` is 3.
- `pixelToHex(hexToPixel(c))` returns `c` for a set of sample coordinates. (This is
  a good first unit test; see chapter 10.)

Next: [Terrain & the tile model](02-terrain-and-tiles.md).
