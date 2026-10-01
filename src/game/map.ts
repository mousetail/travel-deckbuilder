import { hexDistance, hexKey, neighbours, parseHexKey } from "./hex";
import type { HexCoord } from "./hex";
import { hexesInHexagon, hexSide, rotateTimes } from "./hexagon";
import type { EnemyKind, Terrain, Tile, TileFeature } from "./terrain";
import type { IdFactory } from "./cards";
import { SHOP_CATALOGUE, instantiate } from "./cards";
import { instantEnemies } from "./enemies";
import type { Enemy } from "./enemies";
import type { Rng } from "./rng";
import { pick, shuffle } from "./rng";
import { SHOP_STOCK_SIZE, rollGift, rollShopStock } from "./shop";
import type { MapIndex } from "./state";
import tiles from "./tiles.json";
import finishTile from "./finish.json";

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
  /** Enemy layer: one char per hex — '.' none, 'a' assassin, 's' sniper, 'w' watchtower. */
  enemies: readonly string[];
  /** Enemy timer layer: one char per hex — '.' none, else the spawn delay in turns. */
  enemyTimers: readonly string[];
  entryEdges: readonly number[];
  exitEdges: readonly number[];
};

/** Terrain layer: one char per hex. */
export const TERRAIN_BY_CHAR: Record<string, Terrain> = {
  ".": "grass",
  f: "forest",
  w: "water",
  m: "mountain",
  d: "dirt",
  "#": "impassible",
  'e': 'finish',
};

/** Overlay layer: what sits on top of the terrain. "." is nothing. */
export const FEATURE_BY_CHAR: Record<string, TileFeature> = {
  ".": { kind: "none" },
  S: { kind: "shop", stock: [], rerollCost: 2 },
  T: { kind: "smith" },
  R: { kind: "remove-card" },
  G: { kind: "gain-card", card: null },
  c: { kind: "coin", value: 3 },
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
    options: [{ kind: "smith" }, { kind: "gain-card", card: null }],
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

/** Enemy layer: which enemy spawns on a hex. "." is nothing. */
export const ENEMY_BY_CHAR: Record<string, EnemyKind | null> = {
  ".": null,
  a: "assassin",
  s: "sniper",
  w: "watchtower",
};

export function validateTemplate(template: SectionTemplate): void {
  validateRows(template.id, "terrain", template.terrain, template.radius);
  validateRows(template.id, "cost", template.cost, template.radius);
  validateRows(template.id, "overlays", template.overlays, template.radius);
  validateRows(template.id, "enemies", template.enemies, template.radius);
  validateRows(
    template.id,
    "enemyTimers",
    template.enemyTimers,
    template.radius,
  );
  for (const row of template.cost) {
    for (const char of row) {
      if (COST_BY_CHAR[char] === undefined) {
        throw new Error(`template ${template.id}: bad cost char '${char}'`);
      }
    }
  }
  for (const row of template.enemies) {
    for (const char of row) {
      if (!(char in ENEMY_BY_CHAR)) {
        throw new Error(`template ${template.id}: bad enemy char '${char}'`);
      }
    }
  }
  for (const row of template.enemyTimers) {
    for (const char of row) {
      if (char !== "." && !/^[0-9]$/.test(char)) {
        throw new Error(
          `template ${template.id}: bad enemy timer char '${char}'`,
        );
      }
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
 * `frontier`, and return that centre. Enemy spawns are written straight onto
 * the tiles from the enemy and enemy-timer layers.
 */
export function stampSection(
  tiles: Map<string, Tile>,
  template: SectionTemplate,
  frontier: MapFrontier,
  rotationSteps: number,
  shift: number,
): { origin: HexCoord } {
  const origin = sectionOrigin(frontier, template.radius, shift);
  template.terrain.forEach((row, index) => {
    const r = index - template.radius;
    const overlayRow = template.overlays[index];
    const costRow = template.cost[index];
    const enemyRow = template.enemies[index];
    const timerRow = template.enemyTimers[index];
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
      const spawnKind = ENEMY_BY_CHAR[enemyRow[column]] ?? null;
      const timerChar = timerRow[column];
      const spawnDelay =
        spawnKind === null || timerChar === "." ? -1 : Number(timerChar);
      tiles.set(hexKey(world), {
        terrain,
        cost: COST_BY_CHAR[costRow[column]],
        feature: FEATURE_BY_CHAR[overlay],
        spawnKind,
        spawnDelay: spawnKind === null ? -1 : Math.max(0, spawnDelay),
        spawnTurn: -1,
      });
    }
  });
  return { origin };
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
    enemies: template.enemies.toReversed(),
    enemyTimers: template.enemyTimers.toReversed(),
    entryEdges: template.entryEdges.map(mirrorEdge),
    exitEdges: template.exitEdges.map(mirrorEdge),
  };
}

/**
 * The finish section, kept out of the random pool: it is placed deliberately
 * once the map reaches its final difficulty, and nothing is generated after it.
 */
export const FINISH_TEMPLATE: SectionTemplate = finishTile;

/** The difficulty at which the finish section is attempted. */
export const FINISH_DIFFICULTY = 5;

export const SECTION_TEMPLATES: readonly SectionTemplate[] = [
  ...tiles,
  ...tiles.map(mirrorTemplate),
];

for (const template of [...SECTION_TEMPLATES, FINISH_TEMPLATE]) {
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
  /** Once the finish section is placed, no further sections are generated. */
  finished: boolean;
};

export type GeneratedMap = {
  tiles: Map<string, Tile>;
  records: SectionRecord[];
  player: HexCoord;
  cursor: MapCursor;
  enemies: Enemy[];
};

export type AdvanceResult = {
  tiles: Map<string, Tile>;
  records: SectionRecord[];
  cursor: MapCursor;
  enemies: Enemy[];
};

const MAX_ATTEMPTS = 40;
const MAX_BAND = 3;
const SECTIONS_PER_BAND = 5;

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
  enemies: Enemy[];
  /** Whether this placement was the finish section. */
  finished: boolean;
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
  turn: number,
  rng: Rng,
  ids: IdFactory,
  queue: readonly string[],
  finish: SectionTemplate,
): Placement | null {
  // The opening section is the gentle introduction: always difficulty 0. After
  // that the map may show sections one above the current band, but never one
  // below it, so difficulty only ever steps up as the player pushes on.
  const band = difficultyBand(distance);
  const minDifficulty = distance === 0 ? 0 : band;
  const maxDifficulty = distance === 0 ? 0 : band + 1;
  const withinBand = (t: SectionTemplate): boolean =>
    t.difficulty >= minDifficulty && t.difficulty <= maxDifficulty;
  const pool = SECTION_TEMPLATES.filter(withinBand);
  // The panic pool is chosen for its small radius (to squeeze into tight
  // gaps), but it must still respect the difficulty ceiling.
  const emergencyPool = SECTION_TEMPLATES.filter(
    (t) => t.radius <= 2 && t.difficulty <= maxDifficulty,
  );
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
  // Once the map reaches the finish difficulty, the first attempt of every
  // section is the finish itself; if it cannot fit, a normal section is placed
  // and the finish is tried again at the next frontier.
  const finishMode = maxDifficulty >= FINISH_DIFFICULTY;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    const panicMode = attempt > (MAX_ATTEMPTS * 3) / 4;
    const useFinish = finishMode && attempt === 0;

    let template: SectionTemplate;
    if (useFinish) {
      template = finish;
    } else {
      const drawn = drawTemplate(
        panicMode ? emergencyPool : pool,
        bag,
        currentRng,
      );
      currentRng = drawn.rng;
      bag = drawn.bag;
      template = drawn.template;
    }

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

    // The finish ends the map, so its exit edge is never used to grow further
    // and none of the winding guards apply to it.
    if (!useFinish) {
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
    }

    let chosen: {
      tiles: Map<string, Tile>;
      origin: HexCoord;
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
      } else if (feature.kind === "gain-card") {
        // The gift is part of the tile, so a skipped card is still there later.
        const rolled = rollGift(SHOP_CATALOGUE, currentRng);
        currentRng = rolled.rng;
        tiles.set(key, {
          ...tile,
          feature: { kind: "gain-card", card: instantiate(rolled.spec, ids()) },
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

    const rawTurn = normalize(worldExit - frontier.entryEdge - 3);
    const lastTurn = rawTurn > 3 ? rawTurn - 6 : rawTurn;

    // Delay-0 spawns appear the moment the section is stamped, so the player can
    // see them (and their danger zone) before they can fire.
    const enemies = instantEnemies(sectionTiles, turn, ids);

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
      enemies,
      finished: useFinish,
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
  turn: number,
  ids: IdFactory,
): AdvanceResult | null {
  if (cursor.finished) {
    return null;
  }
  const nextTiles = new Map(tiles);
  const placed = placeSection(
    nextTiles,
    records,
    cursor.frontier,
    cursor.distance,
    turn,
    cursor.rng,
    ids,
    cursor.queue,
    FINISH_TEMPLATE,
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
      finished: placed.finished,
    },
    enemies: placed.enemies,
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
  let enemies: Enemy[] = [];

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
    finished: false,
  };

  for (let i = 0; i < sectionCount; i += 1) {
    const advanced = advanceMap(tiles, records, cursor, startTurn, ids);
    if (advanced === null) {
      break;
    }
    tiles = advanced.tiles;
    records = advanced.records;
    cursor = advanced.cursor;
    enemies = [...enemies, ...advanced.enemies];
  }

  let player: HexCoord = { q: 0, r: 0 };
  const first = records[0];
  if (first !== undefined) {
    // The player starts inside the first section, so its timers start now.
    tiles = armSection(tiles, first, startTurn);
    const start = startingHex(tiles, first, cursor.rng);
    player = start.coord;
    cursor = { ...cursor, rng: start.rng };
  }

  return { tiles, records, player, cursor, enemies };
}

/**
 * Start a section's enemy timers: the player has just entered it, so every
 * armed tile gets an absolute `spawnTurn` — the turn the enemy appears —
 * counted from `turn`. Tiles keep their relative `spawnDelay`, and the
 * `spawnTurn` guard means a section is armed only once. Delay-0 spawns are
 * skipped: they were already placed when the section was stamped.
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
    if (tile === undefined || tile.spawnTurn !== -1 || tile.spawnDelay <= 0) {
      continue;
    }
    next.set(key, { ...tile, spawnTurn: turn + tile.spawnDelay });
  }
  return next;
}

/**
 * The player enters through the first section's entry edge. Prefer an edge hex
 * with no feature, so the opening turn is not forced onto a shop or a coin; the
 * exact landing spot among those is rolled at random so runs do not always
 * begin on the same hex. Falls back to the section centre if the whole edge is
 * built up.
 */
function startingHex(
  tiles: ReadonlyMap<string, Tile>,
  section: SectionRecord,
  rng: Rng,
): { coord: HexCoord; rng: Rng } {
  const radius = radiusOf(section);
  const candidates: HexCoord[] = [];
  for (const local of hexSide(section.entryEdge, radius)) {
    const coord: HexCoord = {
      q: section.origin.q + local.q,
      r: section.origin.r + local.r,
    };
    const tile = tiles.get(hexKey(coord));
    if (tile !== undefined && tile.feature.kind === "none") {
      candidates.push(coord);
    }
  }
  if (candidates.length === 0) {
    return { coord: section.origin, rng };
  }
  const rolled = pick(rng, candidates);
  return { coord: rolled.item, rng: rolled.rng };
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
