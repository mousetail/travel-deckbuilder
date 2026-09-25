import { hexDistance, hexKey, neighbours, parseHexKey } from "./hex";
import type { HexCoord } from "./hex";
import { hexesInHexagon, hexSide, rotateTimes } from "./hexagon";
import type { Terrain, Tile, TileFeature } from "./terrain";
import type { IdFactory } from "./cards";
import { SHOP_CATALOGUE } from "./cards";
import type { Sniper } from "./enemies";
import type { Rng } from "./rng";
import { pick, shuffle } from "./rng";
import { SHOP_STOCK_SIZE, rollShopStock } from "./shop";
import type { MapIndex } from "./state";
import tiles from "./tiles.json";

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
  terrain: readonly string[];
  /** Movement cost of each hex, one char ('1'-'4') per hex. */
  cost: readonly string[];
  overlays: readonly string[];
  spawns: readonly SpawnPoint[];
  entryEdges: readonly number[];
  exitEdges: readonly number[];
};

/**
 * An assassin spawn point authored on a template. `q`/`r` are template-local hex
 * coords, rotated into the world when the section is stamped; `delay` is the
 * number of turns after the player enters the section that an assassin appears
 * here (chapter 07).
 */
export type SpawnPoint = {
  q: number;
  r: number;
  delay: number;
};

/** Terrain layer: one char per hex. */
export const TERRAIN_BY_CHAR: Record<string, Terrain> = {
  ".": "grass",
  f: "forest",
  w: "water",
  m: "mountain",
  d: "dirt",
  "#": "impassible",
};

/** Overlay layer: what sits on top of the terrain. "." is nothing. */
export const FEATURE_BY_CHAR: Record<string, TileFeature> = {
  ".": { kind: "none" },
  S: { kind: "shop", stock: [], rerollCost: 2 },
  T: { kind: "smith" },
  R: { kind: "remove-card" },
  G: { kind: "gain-card" },
  c: { kind: "coin", value: 3 },
  x: { kind: "none" },
  // Random upgrades roll one of their options when the section is placed.
  "1": {
    kind: "random",
    tier: "common",
    options: [
      { kind: "coin", value: 3 },
      { kind: "shop", stock: [], rerollCost: 2 },
    ],
  },
  "2": {
    kind: "random",
    tier: "uncommon",
    options: [{ kind: "smith" }, { kind: "gain-card" }],
  },
  "3": {
    kind: "random",
    tier: "rare",
    options: [{ kind: "remove-card" }],
  },
};

/** Cost layer: movement points to cross, one char per hex. */
export const COST_BY_CHAR: Record<string, number> = {
  "1": 1,
  "2": 2,
  "3": 3,
  "4": 4,
};

/** Overlay char marking a fixed sniper post. */
export const SNIPER_CHAR = "x";
export const SNIPER_RADIUS = 2;
/** Snipers only appear once the player is this deep, per the design. */
const SNIPER_MIN_DISTANCE = 5;

export function validateTemplate(template: SectionTemplate): void {
  validateRows(template.id, "terrain", template.terrain, template.radius);
  validateRows(template.id, "cost", template.cost, template.radius);
  validateRows(template.id, "overlays", template.overlays, template.radius);
  validateSpawns(template);
  for (const row of template.cost) {
    for (const char of row) {
      if (COST_BY_CHAR[char] === undefined) {
        throw new Error(`template ${template.id}: bad cost char '${char}'`);
      }
    }
  }
}

/** Every spawn point must sit on a hex of the template, with a sane delay. */
function validateSpawns(template: SectionTemplate): void {
  const hexes = new Set(hexesInHexagon(template.radius).map(hexKey));
  for (const spawn of template.spawns) {
    if (!hexes.has(hexKey({ q: spawn.q, r: spawn.r }))) {
      throw new Error(
        `template ${template.id}: spawn ${spawn.q},${spawn.r} is outside the hexagon`,
      );
    }
    if (!Number.isInteger(spawn.delay) || spawn.delay < 0) {
      throw new Error(
        `template ${template.id}: spawn ${spawn.q},${spawn.r} has a bad delay`,
      );
    }
  }
}

function validateRows(
  id: string,
  layer: string,
  rows: readonly string[],
  radius: number,
): void {
  const expected = hexesInHexagon(radius);
  const perRow = new Map<number, number>();
  for (const coord of expected) {
    perRow.set(coord.r, (perRow.get(coord.r) ?? 0) + 1);
  }
  if (rows.length !== radius * 2 + 1) {
    throw new Error(`template ${id}: wrong ${layer} row count`);
  }
  rows.forEach((row, index) => {
    const r = index - radius;
    if (row.length !== perRow.get(r)) {
      throw new Error(
        `template ${id}: ${layer} row ${r} has ${row.length}, expected ${perRow.get(r)}`,
      );
    }
  });
}

/** Column index → axial q for a shifted hexagon row. */
export function localCoord(
  radius: number,
  r: number,
  column: number,
): HexCoord {
  const q = column - radius - Math.min(0, r); // standard hexagon row shear
  return { q, r };
}

/**
 * Stamp `template` into `tiles`, centred on the section that follows
 * `frontier`, and return that centre plus the world coords of its sniper posts.
 */
export function stampSection(
  tiles: Map<string, Tile>,
  template: SectionTemplate,
  frontier: MapFrontier,
  rotationSteps: number,
  shift: number,
): { origin: HexCoord; snipers: HexCoord[] } {
  const origin = sectionOrigin(frontier, template.radius, shift);
  const snipers: HexCoord[] = [];
  template.terrain.forEach((row, index) => {
    const r = index - template.radius;
    const overlayRow = template.overlays[index];
    const costRow = template.cost[index];
    for (let column = 0; column < row.length; column += 1) {
      const rotated = rotateTimes(
        localCoord(template.radius, r, column),
        rotationSteps,
      );
      const world: HexCoord = {
        q: origin.q + rotated.q,
        r: origin.r + rotated.r,
      };
      const terrain = TERRAIN_BY_CHAR[row[column]];
      const overlay = overlayRow[column];
      tiles.set(hexKey(world), {
        terrain,
        cost: COST_BY_CHAR[costRow[column]],
        feature: FEATURE_BY_CHAR[overlay],
        spawnDelay: -1,
        spawnTurn: -1,
      });
      if (overlay === SNIPER_CHAR) {
        snipers.push(world);
      }
    }
  });

  // Authored spawn points, rotated like the terrain so they follow the section.
  for (const spawn of template.spawns) {
    const rotated = rotateTimes({ q: spawn.q, r: spawn.r }, rotationSteps);
    const world: HexCoord = {
      q: origin.q + rotated.q,
      r: origin.r + rotated.r,
    };
    const key = hexKey(world);
    const tile = tiles.get(key);
    if (tile !== undefined) {
      tiles.set(key, { ...tile, spawnDelay: spawn.delay });
    }
  }
  return { origin, snipers };
}

function mirrorTemplate(template: SectionTemplate): SectionTemplate {
  let mirrorEdge = (i: number) => [1, 0, 5, 4, 3, 2][i];

  return {
    id: template.id + " (mirrored)",
    difficulty: template.difficulty,
    radius: template.radius,
    terrain: template.terrain.toReversed(),
    cost: template.cost.toReversed(),
    overlays: template.overlays.toReversed(),
    spawns: template.spawns.toReversed(),
    entryEdges: template.entryEdges.map(mirrorEdge),
    exitEdges: template.exitEdges.map(mirrorEdge),
  };
}

export const SECTION_TEMPLATES: readonly SectionTemplate[] = [
  ...tiles,
  ...tiles.map(mirrorTemplate),
];

for (const template of SECTION_TEMPLATES) {
  validateTemplate(template);
}

export type MapFrontier = {
  /** Centre of the section already placed; the next one grows out from here. */
  origin: HexCoord;
  /** Radius of that placed section, or 0 before the first section. */
  radius: number;
  entryEdge: number;
  /**
   * Turn of that placed section, signed: 0 straight on, ±1 a 60° bend, ±2 a
   * 120° fold, ±3 a full reversal. A fold is what puts the next section in
   * danger of clipping the one before it, so placement watches this.
   */
  lastTurn: number;
  bannedEdges: [number, number];
};

/**
 * Everything needed to keep stamping sections: the advancing front plus the
 * seeded RNG and the winding state. Carried on `MapState` so generation can
 * continue as the player advances (chapter 06).
 */
export type MapCursor = {
  frontier: MapFrontier;
  distance: number;
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

/**
 * One step from a hexagon's side `s` out to the facing side of the neighbouring
 * section. `sideOffset(s, r)` is `OUTWARD[s] * (r + 1) + OUTWARD[s - 1] * r`,
 * which is what lets the two sections' halves of the crossing grow apart.
 */
const OUTWARD: readonly HexCoord[] = [
  { q: 1, r: 0 },
  { q: 0, r: 1 },
  { q: -1, r: 1 },
  { q: -1, r: 0 },
  { q: 0, r: -1 },
  { q: 1, r: -1 },
];

/**
 * Offset from the previous section's centre to the next one's, when the next is
 * entered through world edge `entryEdge`. `sideOffset` assumes both sections
 * share a radius; the second term slides the crossing by the radius difference
 * so differently sized sections still meet edge-to-edge instead of overlapping.
 */
function sectionOffset(
  entryEdge: number,
  fromRadius: number,
  toRadius: number,
): HexCoord {
  const base = sideOffset(normalize(entryEdge + 3), fromRadius);
  const along = OUTWARD[(entryEdge + 5) % 6];
  const grow = toRadius - fromRadius;
  return { q: base.q - along.q * grow, r: base.r - along.r * grow };
}

/**
 * The direction along the shared edge between the last section and the next,
 * i.e. the cross axis that a new section may slide along. `sectionOffset`
 * places the crossing flush with one end of the shared edge; sliding is always
 * applied relative to that.
 */
function slideAxis(entryEdge: number): HexCoord {
  return OUTWARD[(entryEdge + 4) % 6];
}

/** World centre of the next section, the one that follows `frontier`. */
function sectionOrigin(
  frontier: MapFrontier,
  radius: number,
  shift: number,
): HexCoord {
  if (frontier.radius === 0) {
    // The opening section has no predecessor; it just sits on the frontier.
    return frontier.origin;
  }
  const offset = sectionOffset(frontier.entryEdge, frontier.radius, radius);
  const axis = slideAxis(frontier.entryEdge);
  return {
    q: frontier.origin.q + offset.q + axis.q * shift,
    r: frontier.origin.r + offset.r + axis.r * shift,
  };
}

type Placement = {
  record: SectionRecord;
  frontier: MapFrontier;
  rng: Rng;
  queue: readonly string[];
  snipers: Sniper[];
};

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
    const refill = shuffle(
      pool.map((t) => t.id),
      current,
    );
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

/**
 * Slide positions to try for a section of `radius` after `frontier`, best first.
 * Sliding is free for `±1` hex past the flush crossing, plus the radius gap when
 * the two sections differ in size; beyond that they would part company. After a
 * 120° fold a *smaller* section is slid fully to the outside edge first, which is
 * where the gap from the section-before-last is largest and so leaves the most
 * room for the section that follows.
 */
function shiftOrder(frontier: MapFrontier, radius: number): number[] {
  if (frontier.radius === 0) {
    return [0];
  }
  const reach = 1 + Math.abs(radius - frontier.radius);
  const order: number[] = [];
  if (Math.abs(frontier.lastTurn) === 2 && radius < frontier.radius) {
    // A fold bends left (−) or right (+); slide the smaller follower to the
    // outside of the bend, i.e. away from the section the fold came from.
    const away = frontier.lastTurn > 0 ? -1 : 1;
    for (let s = reach; s > 0; s -= 1) {
      order.push(away * s);
    }
  }
  order.push(0);
  for (let s = 1; s <= reach; s += 1) {
    order.push(s, -s);
  }
  return order;
}

/** True if any stamped hex is already occupied by an earlier section. */
function collides(
  stamped: ReadonlyMap<string, Tile>,
  occupied: ReadonlySet<string>,
): boolean {
  for (const key of stamped.keys()) {
    if (occupied.has(key)) {
      return true;
    }
  }
  return false;
}

/**
 * True if the stamped section touches the one before it, so a slid placement
 * cannot silently detach from the map. The opening section has nothing to join.
 */
function connects(
  stamped: ReadonlyMap<string, Tile>,
  previous: ReadonlySet<string>,
): boolean {
  if (previous.size === 0) {
    return true;
  }
  for (const key of stamped.keys()) {
    for (const neighbour of neighbours(parseHexKey(key))) {
      if (previous.has(hexKey(neighbour))) {
        return true;
      }
    }
  }
  return false;
}

function placeSection(
  tiles: Map<string, Tile>,
  records: readonly SectionRecord[],
  frontier: MapFrontier,
  distance: number,
  rng: Rng,
  ids: IdFactory,
  queue: readonly string[],
): Placement | null {
  const band = difficultyBand(distance);
  const pool = SECTION_TEMPLATES.filter(
    (t) => Math.abs(t.difficulty - band) <= 1,
  );
  const emergencyPool = SECTION_TEMPLATES.filter((t) => t.radius <= 2);
  if (pool.length === 0) {
    return null;
  }

  const occupied = new Set<string>();
  for (const record of records) {
    for (const coord of record.footprint) {
      occupied.add(hexKey(coord));
    }
  }
  // The section before this one: the new section must reach one of its hexes.
  const previous = new Set<string>();
  const previousRecord = records[records.length - 1];
  if (previousRecord !== undefined) {
    for (const coord of previousRecord.footprint) {
      previous.add(hexKey(coord));
    }
  }

  let currentRng = rng;
  let bag = queue;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    let panicMode = attempt > (MAX_ATTEMPTS * 3) / 4;

    const drawn = drawTemplate(
      panicMode ? emergencyPool : pool,
      bag,
      currentRng,
    );
    currentRng = drawn.rng;
    bag = drawn.bag;
    const template = drawn.template;

    const { item: localEntry, rng: localEntryRng } = pick(
      currentRng,
      template.entryEdges,
    );
    currentRng = localEntryRng;
    const rotation = normalize(frontier.entryEdge - localEntry);
    const { item: localExit, rng: exitRollRng } = pick(
      currentRng,
      template.exitEdges,
    );
    currentRng = exitRollRng;
    const worldExit = normalize(rotation + localExit);
    if (
      worldExit === frontier.entryEdge ||
      frontier.bannedEdges.some((i) => i == worldExit)
    ) {
      continue;
    }

    // When we are already digging into the panic pool, only let the path run
    // straight on: a bend here is what folds the map back onto itself.
    if (panicMode && worldExit !== normalize(frontier.entryEdge + 3)) {
      continue;
    }

    if (
      (template.radius < frontier.radius || panicMode) &&
      (normalize(frontier.entryEdge + 1) === worldExit ||
        normalize(frontier.entryEdge - 1) === worldExit)
    ) {
      continue;
    }

    if (
      !panicMode &&
      frontier.radius !== 0 &&
      Math.abs(template.radius - frontier.radius) > 1
    ) {
      continue;
    }

    let chosen: {
      tiles: Map<string, Tile>;
      origin: HexCoord;
      snipers: HexCoord[];
    } | null = null;
    for (const shift of shiftOrder(frontier, template.radius)) {
      const sectionTiles = new Map<string, Tile>();
      const stamped = stampSection(
        sectionTiles,
        template,
        frontier,
        rotation,
        shift,
      );
      if (
        collides(sectionTiles, occupied) ||
        !connects(sectionTiles, previous)
      ) {
        continue;
      }
      chosen = {
        tiles: sectionTiles,
        origin: stamped.origin,
        snipers: stamped.snipers,
      };
      break;
    }
    if (chosen === null) {
      continue;
    }
    const sectionTiles = chosen.tiles;
    const origin = chosen.origin;

    for (const [key, tile] of sectionTiles) {
      let feature = tile.feature;
      if (feature.kind === "random") {
        const rolled = pick(currentRng, feature.options);
        currentRng = rolled.rng;
        feature = rolled.item;
      }
      if (feature.kind === "shop") {
        // Stock is part of the tile, so leaving and returning shows the same cards.
        const rolled = rollShopStock(
          SHOP_CATALOGUE,
          SHOP_STOCK_SIZE,
          currentRng,
          ids,
        );
        currentRng = rolled.rng;
        tiles.set(key, {
          ...tile,
          feature: {
            kind: "shop",
            stock: rolled.stock,
            rerollCost: feature.rerollCost,
          },
        });
      } else {
        tiles.set(key, { ...tile, feature });
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

    const snipers: Sniper[] =
      distance >= SNIPER_MIN_DISTANCE
        ? chosen.snipers.map((position) => ({
            kind: "sniper",
            id: ids(),
            position,
            radius: SNIPER_RADIUS,
          }))
        : [];

    const rawTurn = normalize(worldExit - frontier.entryEdge - 3);
    const lastTurn = rawTurn > 3 ? rawTurn - 6 : rawTurn;

    return {
      record,
      frontier: {
        origin,
        radius: template.radius,
        entryEdge: normalize(worldExit + 3),
        lastTurn,
        bannedEdges: frontier.bannedEdges,
      },
      rng: currentRng,
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
): AdvanceResult | null {
  const nextTiles = new Map(tiles);
  const placed = placeSection(
    nextTiles,
    records,
    cursor.frontier,
    cursor.distance,
    cursor.rng,
    ids,
    cursor.queue,
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

  let rng = { seed };

  let firstBannedEdge = pick(rng, [0, 1, 2, 3, 4, 5]);

  let cursor: MapCursor = {
    frontier: {
      origin: { q: 0, r: 0 },
      radius: 0,
      entryEdge: 3,
      lastTurn: 0,
      bannedEdges: [firstBannedEdge.item, normalize(firstBannedEdge.item + 1)],
    },
    distance: 0,
    rng: firstBannedEdge.rng,
    queue: [],
  };

  for (let i = 0; i < sectionCount; i += 1) {
    const advanced = advanceMap(tiles, records, cursor, ids);
    if (advanced === null) {
      break;
    }
    tiles = advanced.tiles;
    records = advanced.records;
    cursor = advanced.cursor;
    snipers = [...snipers, ...advanced.snipers];
  }

  let player: HexCoord = { q: 0, r: 0 };
  const first = records[0];
  if (first !== undefined) {
    // The player starts inside the first section, so its timers start now.
    tiles = armSection(tiles, first, startTurn);
    player = startingHex(tiles, first);
  }

  return { tiles, records, player, cursor, snipers };
}

/**
 * Start a section's assassin timers: the player has just entered it, so every
 * armed tile gets an absolute `spawnTurn` — the turn the assassin appears —
 * counted from `turn`. Tiles keep their relative `spawnDelay`, and the
 * `spawnTurn` guard means a section is armed only once.
 */
export function armSection(
  tiles: ReadonlyMap<string, Tile>,
  section: SectionRecord,
  turn: number,
): Map<string, Tile> {
  const next = new Map(tiles);
  for (const coord of section.footprint) {
    const key = hexKey(coord);
    const tile = next.get(key);
    if (tile === undefined || tile.spawnTurn !== -1 || tile.spawnDelay < 0) {
      continue;
    }
    next.set(key, { ...tile, spawnTurn: turn + tile.spawnDelay });
  }
  return next;
}

/**
 * The player enters through the first section's entry edge. Prefer an edge hex
 * with no feature, so the opening turn is not forced onto a shop or a coin.
 */
function startingHex(
  tiles: ReadonlyMap<string, Tile>,
  section: SectionRecord,
): HexCoord {
  const radius = radiusOf(section);
  for (const local of hexSide(section.entryEdge, radius)) {
    const coord: HexCoord = {
      q: section.origin.q + local.q,
      r: section.origin.r + local.r,
    };
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
