import { hexDistance, hexKey, parseHexKey } from "./hex";
import type { HexCoord } from "./hex";
import { hexSide } from "./hexagon";
import { advanceMap, armSection, buildMapIndex } from "./map";
import type { SectionRecord } from "./map";
import type { Enemy } from "./enemies";
import type { GameState, MapIndex } from "./state";
import type { Tile } from "./terrain";

/** How many sections beyond the player's own must always exist. */
const AHEAD = 3;

/** Id of the live section containing `coord`, or null. */
export function sectionAt(index: MapIndex, coord: HexCoord): string | null {
  return index.hexToSection.get(hexKey(coord)) ?? null;
}

/** Absolute order of the live section containing `coord`, or -1. */
export function liveSectionOrderId(index: MapIndex, coord: HexCoord): number {
  const id = sectionAt(index, coord);
  if (id === null) {
    return -1;
  }
  return index.sections.findIndex((section) => section.id === id);
}

/** Radius of a section, recovered from its footprint. */
function radiusOf(record: SectionRecord): number {
  let max = 0;
  for (const coord of record.footprint) {
    const d = hexDistance(record.origin, coord);
    if (d > max) {
      max = d;
    }
  }
  return max;
}

/**
 * The two rows of `record` nearest its entry edge — the sliver revealed while
 * the player is still in the previous section. The entry edge itself is `near`
 * (the player steps onto it next); the row behind it is `far`.
 */
export function forwardRows(record: SectionRecord): FogHex[] {
  const radius = radiusOf(record);
  const edge = hexSide(record.entryEdge, radius).map((local) => ({
    q: record.origin.q + local.q,
    r: record.origin.r + local.r,
  }));
  const results: FogHex[] = [];
  for (const coord of record.footprint) {
    let distance = -1;
    for (const edgeHex of edge) {
      const d = hexDistance(coord, edgeHex);
      if (d <= 1 && (distance === -1 || d < distance)) {
        distance = d;
      }
    }
    if (distance === 0) {
      results.push({ coord, level: "near" });
    } else if (distance === 1) {
      results.push({ coord, level: "far" });
    }
  }
  return results;
}

/** A section is live while its tiles are still on the map. */
function isLive(index: MapIndex, section: SectionRecord): boolean {
  const first = section.footprint[0];
  if (first === undefined) {
    return false;
  }
  return index.hexToSection.get(hexKey(first)) === section.id;
}

/** How dimmed a fog hex is: `near` is the entry edge, `far` the row behind it. */
export type FogLevel = "near" | "far";

export type FogHex = {
  coord: HexCoord;
  level: FogLevel;
};

export type Visibility = {
  /** Section ids fully visible. */
  full: readonly string[];
  /** Hexes visible in the not-yet-entered section (the fog-of-war sliver). */
  peek: readonly FogHex[];
};

/**
 * The visible window is a function of the player's section, not of individual
 * hex distances: the previous section, the current one, and the first two rows
 * of the next.
 */
export function computeVisibility(index: MapIndex, playerSectionOrder: number): Visibility {
  const full: string[] = [];
  const previous = index.sections[playerSectionOrder - 1];
  const current = index.sections[playerSectionOrder];
  const next = index.sections[playerSectionOrder + 1];

  if (previous !== undefined && isLive(index, previous)) {
    full.push(previous.id);
  }
  if (current !== undefined && isLive(index, current)) {
    full.push(current.id);
  }
  const peek = next !== undefined ? forwardRows(next) : [];
  return { full, peek };
}

export type VisibleMap = {
  tiles: Map<string, Tile>;
  fog: ReadonlyMap<string, FogLevel>;
};

/**
 * The tiles the player should see: every hex of the fully visible sections plus
 * the fog sliver of the next. Hexes outside the window are simply absent, so
 * they disappear from the render for free.
 */
export function visibleMap(state: GameState): VisibleMap {
  const visibility = computeVisibility(state.map.index, state.playerSectionOrder);
  const full = new Set(visibility.full);
  const fog = new Map<string, FogLevel>();
  for (const hex of visibility.peek) {
    fog.set(hexKey(hex.coord), hex.level);
  }
  const tiles = new Map<string, Tile>();
  for (const [key, tile] of state.map.tiles) {
    const sectionId = state.map.index.hexToSection.get(key);
    if (sectionId !== undefined && full.has(sectionId)) {
      tiles.set(key, tile);
    } else if (fog.has(key)) {
      tiles.set(key, tile);
    }
  }
  return { tiles, fog };
}

/**
 * How far ahead the player can see, in hex steps from their own tile: the far
 * row of the fog sliver in the section ahead. Assassins never advance past it,
 * so they can only ever lurk within the visible window.
 */
export function visibleReach(state: GameState): number {
  const visibility = computeVisibility(state.map.index, state.playerSectionOrder);
  const player = state.map.player;
  const ahead =
    visibility.peek.length > 0
      ? visibility.peek.map((hex) => hex.coord)
      : [...visibleMap(state).tiles.keys()].map(parseHexKey);
  let reach = 0;
  for (const coord of ahead) {
    const distance = hexDistance(player, coord);
    if (distance > reach) {
      reach = distance;
    }
  }
  return reach;
}

export type StreamResult = {
  tiles: Map<string, Tile>;
  index: MapIndex;
  enemies: Enemy[];
  removed: readonly SectionRecord[];
};

/**
 * Drop every section more than one behind the player: its tiles, its index
 * entries, and any enemies standing on it. The `SectionRecord` (and its
 * footprint) is kept forever so generation never winds back into it.
 */
export function streamToSection(
  tiles: ReadonlyMap<string, Tile>,
  index: MapIndex,
  enemies: readonly Enemy[],
  playerSectionOrder: number,
): StreamResult {
  const stale = index.sections.filter((_, order) => order <= playerSectionOrder - 2);
  if (stale.length === 0) {
    return { tiles: new Map(tiles), index, enemies: [...enemies], removed: [] };
  }

  const staleHexes = new Set<string>();
  for (const section of stale) {
    for (const coord of section.footprint) {
      staleHexes.add(hexKey(coord));
    }
  }

  const nextTiles = new Map(tiles);
  for (const key of staleHexes) {
    nextTiles.delete(key);
  }
  const survivors = enemies.filter((enemy) => !staleHexes.has(hexKey(enemy.position)));

  return {
    tiles: nextTiles,
    index: buildMapIndex(index.sections, nextTiles),
    enemies: survivors,
    removed: stale,
  };
}

/** Stamp sections until at least `AHEAD` exist beyond the player's section. */
export function ensureAhead(state: GameState): GameState {
  let tiles = state.map.tiles;
  let records = state.map.index.sections;
  let cursor = state.map.cursor;
  let enemies = state.enemies;
  let changed = false;

  while (records.length < state.playerSectionOrder + AHEAD) {
    const advanced = advanceMap(tiles, records, cursor, state.ids);
    if (advanced === null) {
      break;
    }
    tiles = advanced.tiles;
    records = advanced.records;
    cursor = advanced.cursor;
    enemies = [...enemies, ...advanced.snipers];
    changed = true;
  }

  if (!changed) {
    return state;
  }
  return {
    ...state,
    enemies,
    map: { ...state.map, tiles, cursor, index: buildMapIndex(records, tiles) },
  };
}

/**
 * The far end of the newest live section: where assassins head to cut the
 * player off. Falls back to the player's own hex if nothing is live.
 */
export function leadingEdge(state: GameState): HexCoord {
  const sections = state.map.index.sections;
  for (let i = sections.length - 1; i >= 0; i -= 1) {
    const section = sections[i];
    if (isLive(state.map.index, section)) {
      return section.origin;
    }
  }
  return state.map.player;
}

/**
 * React to a completed move: if the player crossed into a new section, reveal
 * it, drop the section now two behind, and keep the map generated ahead.
 * Reaching a new section never ends the turn.
 */
export function onPlayerMoved(state: GameState): GameState {
  const order = liveSectionOrderId(state.map.index, state.map.player);
  if (order <= state.playerSectionOrder) {
    return state;
  }
  const entered = state.map.index.sections[order];
  const tiles =
    entered === undefined ? state.map.tiles : armSection(state.map.tiles, entered, state.turn);
  const streamed = streamToSection(tiles, state.map.index, state.enemies, order);
  const advanced: GameState = {
    ...state,
    playerSectionOrder: order,
    map: { ...state.map, tiles: streamed.tiles, index: streamed.index },
    enemies: streamed.enemies,
  };
  return ensureAhead(advanced);
}
