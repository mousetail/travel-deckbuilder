import { hexKey, hexLine, neighbours } from "./hex";
import type { HexCoord } from "./hex";
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
  const footprint = new Set(section.footprint.map(hexKey));
  const edges: WallEdge[] = [];
  for (const coord of section.footprint) {
    for (const neighbour of neighbours(coord)) {
      if (!footprint.has(hexKey(neighbour))) {
        edges.push({ from: neighbour, to: coord });
      }
    }
  }
  return edges;
}
