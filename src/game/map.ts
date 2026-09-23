import { findPath, hexDistance, hexKey, parseHexKey } from "./hex";
import type { HexCoord } from "./hex";
import { hexesInHexagon, hexSide, hexSideCentre, rotateTimes } from "./hexagon";
import { canEnter } from "./terrain";
import type { Terrain, Tile, TileFeature } from "./terrain";
import type { IdFactory } from "./cards";
import { SHOP_CATALOGUE } from "./cards";
import type { Sniper } from "./enemies";
import type { Rng } from "./rng";
import { nextRng, pick, shuffle } from "./rng";
import { SHOP_STOCK_SIZE, rollShopStock } from "./shop";
import type { MapIndex } from "./state";

export type SectionRecord = {
  id: string;
  difficulty: number;
  /** World coord of the section's centre. */
  origin: HexCoord;
  /** Every hex the section covered, in world coords. Kept after removal. */
  footprint: readonly HexCoord[];
  /** Direction (edge index) the player entered from. */
  entryEdge: number;
  /** Direction the player is meant to leave through. */
  exitEdge: number;
};

export type SectionTemplate = {
  id: string;
  difficulty: number;
  radius: number;
  rows: readonly string[];       // rows[r + radius], lengths = hexagon row lengths
  /** Edge indices (0..5) the player may enter from / leave through. */
  entryEdges: readonly number[];
  exitEdges: readonly number[];
};

const TERRAIN_BY_CHAR: Record<string, Terrain> = {
  ".": "grass", f: "forest", w: "water", m: "mountain", d: "dirt", "#": "impassible",
  S: "grass", T: "grass", R: "grass", G: "grass", c: "grass", x: "mountain",
};

const FEATURE_BY_CHAR: Record<string, TileFeature> = {
  ".": { kind: "none" }, f: { kind: "none" }, w: { kind: "none" },
  m: { kind: "none" }, d: { kind: "none" }, "#": { kind: "none" },
  S: { kind: "shop", stock: [], rerollCost: 2 },
  T: { kind: "smith" },
  R: { kind: "remove-card" },
  G: { kind: "gain-card" },
  c: { kind: "coin", value: 3 },
  x: { kind: "none" },
};

/** Template char marking a fixed sniper post. */
const SNIPER_CHAR = "x";
const SNIPER_RADIUS = 2;
/** Snipers only appear once the player is this deep, per the design. */
const SNIPER_MIN_DISTANCE = 5;

export function validateTemplate(template: SectionTemplate): void {
  const expected = hexesInHexagon(template.radius);
  const perRow = new Map<number, number>();
  for (const coord of expected) {
    perRow.set(coord.r, (perRow.get(coord.r) ?? 0) + 1);
  }
  if (template.rows.length !== template.radius * 2 + 1) {
    throw new Error(`template ${template.id}: wrong row count`);
  }
  template.rows.forEach((row, index) => {
    const r = index - template.radius;
    if (row.length !== perRow.get(r)) {
      throw new Error(`template ${template.id}: row ${r} has ${row.length}, expected ${perRow.get(r)}`);
    }
  });
}

/**
 * Stamp `template` into `tiles` and return the world coords of its sniper posts.
 */
export function stampSection(
  tiles: Map<string, Tile>,
  template: SectionTemplate,
  origin: HexCoord,
  rotationSteps: number,
  spawnTurnBase: number,
): HexCoord[] {
  const snipers: HexCoord[] = [];
  template.rows.forEach((row, index) => {
    const r = index - template.radius;
    for (let column = 0; column < row.length; column += 1) {
      const local = localCoord(template.radius, r, column);
      const rotated = rotateTimes(local, rotationSteps);
      const world: HexCoord = { q: origin.q + rotated.q, r: origin.r + rotated.r };
      const char = row[column];
      const terrain = TERRAIN_BY_CHAR[char];
      const delay = spawnDelayFor(terrain);
      tiles.set(hexKey(world), {
        terrain,
        feature: FEATURE_BY_CHAR[char],
        spawnTurn: delay < 0 ? -1 : spawnTurnBase + delay,
      });
      if (char === SNIPER_CHAR) {
        snipers.push(world);
      }
    }
  });
  return snipers;
}

/** Column index → axial q for a shifted hexagon row. */
function localCoord(radius: number, r: number, column: number): HexCoord {
  const q = column - radius - Math.min(0, r); // standard hexagon row shear
  return { q, r };
}

/**
 * Turns after a tile enters the map at which an assassin spawns on it; -1 means
 * never. Harder ground spawns sooner, so the danger follows the terrain.
 */
function spawnDelayFor(terrain: Terrain): number {
  switch (terrain) {
    case "mountain":
      return 5;
    case "water":
      return 8;
    case "forest":
      return 11;
    case "grass":
    case "dirt":
    case "impassible":
      return -1;
  }
}

/** How many tiles in a section arm an assassin timer; ramps with depth. */
function spawnCountFor(distance: number): number {
  return 1 + Math.floor(distance / 5);
}

const ALL_EDGES: readonly number[] = [0, 1, 2, 3, 4, 5];

/**
 * Hand-authored radius-3 sections. Every template keeps a grass perimeter, so
 * any edge can be an entry or exit and the entry→exit path is always walkable
 * with the starting deck's terrains.
 *
 * Features sit on that grass path (the design's "grass path follows the outside"),
 * so they are reachable with the starting deck; the forest/water/mountain interior
 * is the shortcut that lets a better-equipped player skip them. `highlands` is the
 * exception: its upgrades are hidden behind the mountains, as the design asks.
 */
const SECTION_TEMPLATES: readonly SectionTemplate[] = [
  {
    id: "meadow",
    difficulty: 0,
    radius: 3,
    rows: ["..c.", ".fff.", ".ffff.", ".fffff.", ".ffff.", ".fff.", "...."],
    entryEdges: ALL_EDGES,
    exitEdges: ALL_EDGES,
  },
  {
    id: "village",
    difficulty: 1,
    radius: 3,
    // Dirt is passable by any movement card, so the smith is always reachable.
    rows: ["....", ".ddd.", ".dTdd.", ".ddddd.", ".dddd.", ".ddd.", "...."],
    entryEdges: ALL_EDGES,
    exitEdges: ALL_EDGES,
  },
  {
    id: "crossing",
    difficulty: 1,
    radius: 3,
    rows: ["..S.", ".www.", ".wwww.", ".wwwww.", ".wwww.", ".www.", "...."],
    entryEdges: ALL_EDGES,
    exitEdges: ALL_EDGES,
  },
  {
    id: "grove",
    difficulty: 1,
    radius: 3,
    rows: ["..G.", ".fff.", ".ffff.", ".fffff.", ".ffff.", ".fff.", "...."],
    entryEdges: ALL_EDGES,
    exitEdges: ALL_EDGES,
  },
  {
    id: "quarry",
    difficulty: 1,
    radius: 3,
    rows: ["..R.", ".mmm.", ".mmmm.", ".mmmmm.", ".mmmm.", ".mmm.", "...."],
    entryEdges: ALL_EDGES,
    exitEdges: ALL_EDGES,
  },
  {
    id: "highlands",
    difficulty: 2,
    radius: 3,
    // A grass corridor winds through the mountains to reach all three upgrades.
    rows: ["....", ".m.m.", ".mTmm.", ".mmGmm.", ".mRmm.", ".mmm.", "...."],
    entryEdges: ALL_EDGES,
    exitEdges: ALL_EDGES,
  },
  {
    id: "watchtower",
    difficulty: 2,
    radius: 3,
    // A sniper holds the centre; the grass rim is the safe way past. Nothing
    // else sits here, so the player is never forced into the kill zone.
    rows: ["....", ".mmm.", ".mmmm.", ".mmxmm.", ".mmmm.", ".mmm.", "...."],
    entryEdges: ALL_EDGES,
    exitEdges: ALL_EDGES,
  },
];

for (const template of SECTION_TEMPLATES) {
  validateTemplate(template);
}

export type MapFrontier = {
  /** Centre of the next section. */
  origin: HexCoord;
  /** World edge index the player enters the next section through. */
  entryEdge: number;
};

/**
 * Everything needed to keep stamping sections: the advancing front plus the
 * seeded RNG and the winding state. Carried on `MapState` so generation can
 * continue as the player advances (chapter 06).
 */
export type MapCursor = {
  frontier: MapFrontier;
  distance: number;
  lastTurn: number;
  rng: Rng;
  /** Shuffled bag of template ids; refilled once every template has been used. */
  queue: readonly string[];
};

export type GeneratedMap = {
  tiles: Map<string, Tile>;
  records: SectionRecord[];
  player: HexCoord;
  cursor: MapCursor;
  snipers: Sniper[];
};

export type AdvanceResult = {
  tiles: Map<string, Tile>;
  records: SectionRecord[];
  cursor: MapCursor;
  snipers: Sniper[];
};

const MAX_ATTEMPTS = 40;
const MAX_BAND = 2;
const SECTIONS_PER_BAND = 3;

function difficultyBand(distance: number): number {
  return Math.min(Math.floor(distance / SECTIONS_PER_BAND), MAX_BAND);
}

function normalize(edge: number): number {
  return ((edge % 6) + 6) % 6;
}

/**
 * Offset from a section's centre to the neighbouring section that shares `side`.
 * These are the six side-aligned offsets, NOT the six neighbour directions:
 * the union of hexes within radius R has its corners along the neighbour
 * directions, so placing a section along one of those only touches corners.
 */
function sideOffset(side: number, radius: number): HexCoord {
  const offsets: readonly HexCoord[] = [
    { q: 2 * radius + 1, r: -radius },
    { q: radius, r: radius + 1 },
    { q: -radius - 1, r: 2 * radius + 1 },
    { q: -2 * radius - 1, r: radius },
    { q: -radius, r: -radius - 1 },
    { q: radius + 1, r: -2 * radius - 1 },
  ];
  return offsets[side];
}

/** The hex on `side` of a section centred at `origin`. */
function edgeHex(origin: HexCoord, side: number, radius: number): HexCoord {
  const local = hexSideCentre(side, radius);
  return { q: origin.q + local.q, r: origin.r + local.r };
}

/** Can the starting deck (grass + forest, plus dirt) walk entry → exit inside this section? */
function connects(
  sectionTiles: ReadonlyMap<string, Tile>,
  entryHex: HexCoord,
  exitHex: HexCoord,
): boolean {
  const passable = (coord: HexCoord): boolean => {
    const tile = sectionTiles.get(hexKey(coord));
    if (tile === undefined) {
      return false;
    }
    return canEnter(tile.terrain, "grass") || canEnter(tile.terrain, "forest");
  };
  return findPath(entryHex, exitHex, passable).length > 0;
}

type Placement = {
  record: SectionRecord;
  frontier: MapFrontier;
  lastTurn: number;
  rng: Rng;
  queue: readonly string[];
  snipers: Sniper[];
};

/** Keep only `count` of a section's armed tiles, so assassins trickle in. */
function capSpawns(
  sectionTiles: Map<string, Tile>,
  count: number,
  rng: Rng,
): Rng {
  const armed = [...sectionTiles.entries()].filter(([, tile]) => tile.spawnTurn >= 0);
  if (armed.length <= count) {
    return rng;
  }
  const rolled = shuffle(armed, rng);
  const keep = new Set(rolled.items.slice(0, count).map(([key]) => key));
  for (const [key, tile] of sectionTiles) {
    if (tile.spawnTurn >= 0 && !keep.has(key)) {
      sectionTiles.set(key, { ...tile, spawnTurn: -1 });
    }
  }
  return rolled.rng;
}

/**
 * Draw the next template from the shuffled bag, refilling it when no id left in
 * the bag is still in the pool. This guarantees every template (and so every
 * feature) appears once per cycle instead of relying on luck.
 */
function drawTemplate(
  pool: readonly SectionTemplate[],
  bag: readonly string[],
  rng: Rng,
): { template: SectionTemplate; bag: string[]; rng: Rng } {
  let current = rng;
  let queue = bag;
  let index = queue.findIndex((id) => pool.some((t) => t.id === id));
  if (index < 0) {
    const refill = shuffle(pool.map((t) => t.id), current);
    current = refill.rng;
    queue = refill.items;
    index = 0;
  }
  const id = queue[index];
  const template = pool.find((t) => t.id === id);
  if (template === undefined) {
    throw new Error(`template ${id} missing from pool`);
  }
  return {
    template,
    bag: [...queue.slice(0, index), ...queue.slice(index + 1)],
    rng: current,
  };
}

function placeSection(
  tiles: Map<string, Tile>,
  records: readonly SectionRecord[],
  frontier: MapFrontier,
  distance: number,
  lastTurn: number,
  rng: Rng,
  ids: IdFactory,
  queue: readonly string[],
  spawnTurnBase: number,
): Placement | null {
  const band = difficultyBand(distance);
  const pool = SECTION_TEMPLATES.filter((t) => Math.abs(t.difficulty - band) <= 1);
  if (pool.length === 0) {
    return null;
  }

  const occupied = new Set<string>();
  for (const record of records) {
    for (const coord of record.footprint) {
      occupied.add(hexKey(coord));
    }
  }

  let current = rng;
  let bag = queue;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const drawn = drawTemplate(pool, bag, current);
    current = drawn.rng;
    bag = drawn.bag;
    const template = drawn.template;

    const entryRoll = pick(current, template.entryEdges);
    current = entryRoll.rng;
    const rotation = normalize(frontier.entryEdge - entryRoll.item);

    // Winding: turn 1 or 2 edges off straight, alternating direction each section.
    const magnitudeRoll = nextRng(current);
    current = magnitudeRoll.rng;
    const turn = lastTurn * (1 + Math.floor(magnitudeRoll.value * 2));
    const worldExit = normalize(frontier.entryEdge + 3 + turn);
    const localExit = normalize(worldExit - rotation);
    if (!template.exitEdges.includes(localExit)) {
      continue;
    }

    const origin = frontier.origin;
    const sectionTiles = new Map<string, Tile>();
    const sniperHexes = stampSection(
      sectionTiles,
      template,
      origin,
      rotation,
      spawnTurnBase,
    );

    let overlaps = false;
    for (const key of sectionTiles.keys()) {
      if (occupied.has(key)) {
        overlaps = true;
        break;
      }
    }
    if (overlaps) {
      continue;
    }

    const entryHex = edgeHex(origin, frontier.entryEdge, template.radius);
    const exitHex = edgeHex(origin, worldExit, template.radius);
    if (!connects(sectionTiles, entryHex, exitHex)) {
      continue;
    }

    current = capSpawns(sectionTiles, spawnCountFor(distance), current);

    for (const [key, tile] of sectionTiles) {
      if (tile.feature.kind === "shop") {
        // Stock is part of the tile, so leaving and returning shows the same cards.
        const rolled = rollShopStock(SHOP_CATALOGUE, SHOP_STOCK_SIZE, current, ids);
        current = rolled.rng;
        tiles.set(key, {
          ...tile,
          feature: { kind: "shop", stock: rolled.stock, rerollCost: tile.feature.rerollCost },
        });
      } else {
        tiles.set(key, tile);
      }
    }

    const record: SectionRecord = {
      id: ids(),
      difficulty: template.difficulty,
      origin,
      footprint: [...sectionTiles.keys()].map(parseHexKey),
      entryEdge: frontier.entryEdge,
      exitEdge: worldExit,
    };

    const offset = sideOffset(worldExit, template.radius);
    const nextOrigin: HexCoord = { q: origin.q + offset.q, r: origin.r + offset.r };
    const snipers: Sniper[] =
      distance >= SNIPER_MIN_DISTANCE
        ? sniperHexes.map((position) => ({
            kind: "sniper",
            id: ids(),
            position,
            radius: SNIPER_RADIUS,
          }))
        : [];

    return {
      record,
      frontier: { origin: nextOrigin, entryEdge: normalize(worldExit + 3) },
      lastTurn: -lastTurn,
      rng: current,
      queue: bag,
      snipers,
    };
  }

  return null;
}

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
 * Stamp one more section onto the map. Pure: returns fresh `tiles`/`records`
 * and the advanced cursor, or `null` if no template could be placed.
 */
export function advanceMap(
  tiles: ReadonlyMap<string, Tile>,
  records: readonly SectionRecord[],
  cursor: MapCursor,
  ids: IdFactory,
  spawnTurnBase: number,
): AdvanceResult | null {
  const nextTiles = new Map(tiles);
  const placed = placeSection(
    nextTiles,
    records,
    cursor.frontier,
    cursor.distance,
    cursor.lastTurn,
    cursor.rng,
    ids,
    cursor.queue,
    spawnTurnBase,
  );
  if (placed === null) {
    return null;
  }
  return {
    tiles: nextTiles,
    records: [...records, placed.record],
    cursor: {
      frontier: placed.frontier,
      distance: cursor.distance + 1,
      lastTurn: placed.lastTurn,
      rng: placed.rng,
      queue: placed.queue,
    },
    snipers: placed.snipers,
  };
}

export function generateMap(
  seed: number,
  sectionCount: number,
  startTurn: number,
  ids: IdFactory,
): GeneratedMap {
  let tiles = new Map<string, Tile>();
  let records: SectionRecord[] = [];
  let snipers: Sniper[] = [];
  let cursor: MapCursor = {
    frontier: { origin: { q: 0, r: 0 }, entryEdge: 3 },
    distance: 0,
    lastTurn: 1,
    rng: { seed },
    queue: [],
  };

  for (let i = 0; i < sectionCount; i += 1) {
    const advanced = advanceMap(tiles, records, cursor, ids, startTurn);
    if (advanced === null) {
      break;
    }
    tiles = advanced.tiles;
    records = advanced.records;
    cursor = advanced.cursor;
    snipers = [...snipers, ...advanced.snipers];
  }

  let player: HexCoord = { q: 0, r: 0 };
  if (records.length > 0) {
    player = startingHex(tiles, records[0]);
  }

  return { tiles, records, player, cursor, snipers };
}

/**
 * The player enters through the first section's entry edge. Prefer an edge hex
 * with no feature, so the opening turn is not forced onto a shop or a coin.
 */
function startingHex(tiles: ReadonlyMap<string, Tile>, section: SectionRecord): HexCoord {
  const radius = radiusOf(section);
  for (const local of hexSide(section.entryEdge, radius)) {
    const coord: HexCoord = { q: section.origin.q + local.q, r: section.origin.r + local.r };
    const tile = tiles.get(hexKey(coord));
    if (tile !== undefined && tile.feature.kind === "none") {
      return coord;
    }
  }
  return section.origin;
}

/**
 * Build the hex → section lookup from the sections whose tiles are still live.
 * Removed sections keep their `SectionRecord` (so the no-re-entry check still
 * sees their footprint) but contribute no entries here.
 */
export function buildMapIndex(
  records: readonly SectionRecord[],
  tiles: ReadonlyMap<string, Tile>,
): MapIndex {
  const hexToSection = new Map<string, string>();
  for (const record of records) {
    for (const coord of record.footprint) {
      const key = hexKey(coord);
      if (tiles.has(key)) {
        hexToSection.set(key, record.id);
      }
    }
  }
  return { hexToSection, sections: [...records] };
}