import { findPathByCost, hexesWithinCost } from "./hex";
import type { HexCoord, StepCost } from "./hex";
import { canEnter } from "./terrain";
import type { Terrain, Tile } from "./terrain";
import { wallBlocks } from "./walls";
import type { WallEdge } from "./walls";

/** The tile at a world coord, or undefined outside the visible window. */
export type TileLookup = (coord: HexCoord) => Tile | undefined;

/**
 * Cost of entering a hex for this card: its cost, or Infinity if not enterable.
 * A walled edge is never crossable. While `anyTerrain` is set (Trailblaze), any
 * non-impassible terrain can be entered regardless of the card's printed
 * terrain; impassible still blocks.
 */
export function cardCostAt(
  cardTerrain: Terrain,
  tileAt: TileLookup,
  walls: readonly WallEdge[],
  anyTerrain: boolean,
): StepCost {
  return (from, to) => {
    if (wallBlocks(walls, from, to)) {
      return Infinity;
    }
    const tile = tileAt(to);
    if (tile === undefined) {
      return Infinity;
    }
    const enterable = anyTerrain
      ? tile.terrain !== "impassible"
      : canEnter(tile.terrain, cardTerrain);
    if (!enterable) {
      return Infinity;
    }
    return tile.cost;
  };
}

/**
 * Every hex reachable from `start` within `distance` movement points. Each tile
 * costs its own cost to enter, so a 2-cost tile needs a card with at least 2
 * movement points — two separate 1-point cards cannot combine.
 */
export function reachableHexes(
  start: HexCoord,
  distance: number,
  cardTerrain: Terrain,
  tileAt: TileLookup,
  walls: readonly WallEdge[],
  anyTerrain: boolean,
): HexCoord[] {
  return hexesWithinCost(
    start,
    distance,
    cardCostAt(cardTerrain, tileAt, walls, anyTerrain),
  );
}

export function resolveMove(
  from: HexCoord,
  to: HexCoord,
  cardTerrain: Terrain,
  tileAt: TileLookup,
  distance: number,
  walls: readonly WallEdge[],
  anyTerrain: boolean,
): HexCoord[] {
  const path = findPathByCost(
    from,
    to,
    cardCostAt(cardTerrain, tileAt, walls, anyTerrain),
  );
  if (path === null || path.cost > distance) {
    throw new Error("unreachable destination");
  }
  return path.path;
}
