import { findPathByCost, hexesWithinCost } from "./hex";
import type { HexCoord } from "./hex";
import { canEnter } from "./terrain";
import type { Terrain, Tile } from "./terrain";

/** The tile at a world coord, or undefined outside the visible window. */
export type TileLookup = (coord: HexCoord) => Tile | undefined;

/** Cost of entering a hex for this card: its cost, or Infinity if not enterable. */
function cardCostAt(cardTerrain: Terrain, tileAt: TileLookup) {
  return (coord: HexCoord): number => {
    const tile = tileAt(coord);
    if (tile === undefined || !canEnter(tile.terrain, cardTerrain)) {
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
): HexCoord[] {
  return hexesWithinCost(start, distance, cardCostAt(cardTerrain, tileAt));
}

export function resolveMove(
  from: HexCoord,
  to: HexCoord,
  cardTerrain: Terrain,
  tileAt: TileLookup,
  distance: number,
): HexCoord[] {
  const path = findPathByCost(from, to, cardCostAt(cardTerrain, tileAt));
  if (path === null || path.cost > distance) {
    throw new Error("unreachable destination");
  }
  return path.path;
}
