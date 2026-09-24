import type { HexCoord } from "./hex";

export function hexesInHexagon(radius: number): HexCoord[] {
  const results: HexCoord[] = [];
  for (let q = -radius; q <= radius; q += 1) {
    for (
      let r = Math.max(-radius, -q - radius);
      r <= Math.min(radius, -q + radius);
      r += 1
    ) {
      results.push({ q, r });
    }
  }
  return results;
}

/** Rotate a hex 60° clockwise about the origin. */
export function rotateRight(coord: HexCoord): HexCoord {
  return { q: -coord.r, r: coord.q + coord.r };
}

/** Rotate a hex 60° counter-clockwise about the origin. */
export function rotateLeft(coord: HexCoord): HexCoord {
  return { q: coord.q + coord.r, r: -coord.q };
}

/**
 * The hexes along side `side` of a radius-`radius` hexagon, relative to its
 * centre. Sides are numbered 0..5 clockwise, starting at the east-north-east
 * edge, so side `s` faces neighbour direction `(1 - s + 6) % 6`.
 */
const SIDE_HEX: readonly ((radius: number, i: number) => HexCoord)[] = [
  (radius, i) => ({ q: radius, r: -i }),
  (radius, i) => ({ q: radius - i, r: i }),
  (radius, i) => ({ q: -i, r: radius }),
  (radius, i) => ({ q: -radius, r: i }),
  (radius, i) => ({ q: -radius + i, r: -i }),
  (radius, i) => ({ q: i, r: -radius }),
];

export function hexSide(side: number, radius: number): HexCoord[] {
  const make = SIDE_HEX[side];
  const results: HexCoord[] = [];
  for (let i = 0; i <= radius; i += 1) {
    results.push(make(radius, i));
  }
  return results;
}

/** The middle hex of `hexSide(side, radius)`. */
export function hexSideCentre(side: number, radius: number): HexCoord {
  return hexSide(side, radius)[Math.floor(radius / 2)];
}

export function rotateTimes(coord: HexCoord, steps: number): HexCoord {
  const turns = ((steps % 6) + 6) % 6;
  if (turns === 0) {
    return coord;
  }
  if (turns <= 3) {
    let result = coord;
    for (let i = 0; i < turns; i += 1) {
      result = rotateRight(result);
    }
    return result;
  }
  let result = coord;
  for (let i = 0; i < 6 - turns; i += 1) {
    result = rotateLeft(result);
  }
  return result;
}
