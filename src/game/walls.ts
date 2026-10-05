import { AXIAL_DIRECTIONS, addHex, hexKey, hexLine, hexToPixel } from "./hex";
import type { HexCoord } from "./hex";
import { hexSideEdges } from "./hexagon";
import type { MapIndex } from "./state";

/** A directed hex edge: crossing from `from` to its neighbour `to` is blocked. */
export type WallEdge = { from: HexCoord; to: HexCoord };

/** Canonical key for a directed edge, for set membership. */
export function wallEdgeKey(edge: WallEdge): string {
  return `${hexKey(edge.from)}>${hexKey(edge.to)}`;
}

/** Whether crossing `from → to` is blocked by any wall. */
export function wallBlocks(
  walls: readonly WallEdge[],
  from: HexCoord,
  to: HexCoord,
): boolean {
  const key = wallEdgeKey({ from, to });
  return walls.some((edge) => wallEdgeKey(edge) === key);
}

/** Whether a straight line from `from` to `to` crosses any walled edge. */
export function lineOfSightBlocked(
  walls: readonly WallEdge[],
  from: HexCoord,
  to: HexCoord,
): boolean {
  if (walls.length === 0) {
    return false;
  }
  const line = hexLine(from, to);
  for (let i = 0; i + 1 < line.length; i += 1) {
    const step = line[i];
    const next = line[i + 1];
    if (
      step !== undefined &&
      next !== undefined &&
      wallBlocks(walls, step, next)
    ) {
      return true;
    }
  }
  return false;
}

/** Every boundary edge of `sectionId`, directed inward. */
export function sectionWallEdges(
  index: MapIndex,
  sectionId: string,
): WallEdge[] {
  const section = index.sections.find((record) => record.id === sectionId);
  if (section === undefined) {
    return [];
  }
  const edges: WallEdge[] = [];
  for (let side = 0; side < 6; side += 1) {
    edges.push(...hexagonSideWallEdges(section.origin, side, section.radius));
  }
  return edges;
}

/**
 * The directed edges of one side of a radius-`radius` hexagon centred on
 * `centre`, each directed inward: crossing from outside the hexagon to inside is
 * blocked, crossing outward is allowed. This is the same geometry
 * `sectionWallEdges` uses, for a single side.
 */
export function hexagonSideWallEdges(
  centre: HexCoord,
  side: number,
  radius: number,
): WallEdge[] {
  return hexSideEdges(side, radius).map(({ hex, dir }) => ({
    from: addHex(centre, addHex(hex, AXIAL_DIRECTIONS[dir])),
    to: addHex(centre, hex),
  }));
}

/**
 * The side of a radius-`radius` hexagon centred on `centre` whose facing
 * direction is nearest the direction from `centre` to `coord`. Used to turn a
 * map click into a wall placement.
 */
export function sideToward(centre: HexCoord, coord: HexCoord): number {
  const origin = hexToPixel(centre);
  const target = hexToPixel(coord);
  const angle = Math.atan2(target.y - origin.y, target.x - origin.x);
  let best = 0;
  let bestDiff = Infinity;
  for (let direction = 0; direction < 6; direction += 1) {
    const pixel = hexToPixel(AXIAL_DIRECTIONS[direction]);
    const facing = Math.atan2(pixel.y, pixel.x);
    const raw = Math.abs(angle - facing);
    const diff = Math.min(raw, Math.PI * 2 - raw);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = direction;
    }
  }
  return (1 - best + 6) % 6;
}
