import { findPath, hexKey, neighbours } from "./hex";
import type { HexCoord } from "./hex";
import { canEnter } from "./terrain";
import type { Terrain } from "./terrain";

export type TerrainLookup = (coord: HexCoord) => Terrain;

/** Map from hex key to the number of steps needed to reach it. */
export function reachableHexes(
  start: HexCoord,
  distance: number,
  cardTerrain: Terrain,
  terrainAt: TerrainLookup,
): Map<string, number> {
  const steps = new Map<string, number>();
  steps.set(hexKey(start), 0);

  let frontier: HexCoord[] = [start];
  for (let step = 1; step <= distance; step += 1) {
    const nextFrontier: HexCoord[] = [];
    for (const current of frontier) {
      for (const candidate of neighbours(current)) {
        const key = hexKey(candidate);
        if (steps.has(key)) {
          continue;
        }
        if (!canEnter(terrainAt(candidate), cardTerrain)) {
          continue;
        }
        steps.set(key, step);
        nextFrontier.push(candidate);
      }
    }
    frontier = nextFrontier;
  }

  return steps;
}

export function resolveMove(
  from: HexCoord,
  to: HexCoord,
  cardTerrain: Terrain,
  terrainAt: TerrainLookup,
): HexCoord[] {
  const passable = (coord: HexCoord): boolean => canEnter(terrainAt(coord), cardTerrain);
  const path = findPath(from, to, passable);
  if (path.length === 0) {
    throw new Error("unreachable destination");
  }
  return path;
}