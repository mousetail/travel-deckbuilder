import type { HexCoord } from "./hex";

export function hexesInHexagon(radius: number): HexCoord[] {
  const results: HexCoord[] = [];
  for (let q = -radius; q <= radius; q += 1) {
    for (let r = Math.max(-radius, -q - radius); r <= Math.min(radius, -q + radius); r += 1) {
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