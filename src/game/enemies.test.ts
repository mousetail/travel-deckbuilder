import { describe, expect, it } from "vitest";
import { dangerZone, enemyDangerZones, playerInDanger } from "./enemies";
import type { Enemy } from "./enemies";
import { counterIds } from "./cards";
import { hexKey, hexesInRange, parseHexKey } from "./hex";
import type { HexCoord } from "./hex";
import type { MapCursor, SectionRecord } from "./map";
import { emptyStats } from "./stats";
import type { GameState, MapIndex } from "./state";
import type { Tile } from "./terrain";
import type { WallEdge } from "./walls";

/** A one-section, all-grass map big enough for every reach in these tests. */
const RADIUS = 4;

function grassTile(): Tile {
  return {
    terrain: "grass",
    cost: 1,
    feature: { kind: "none" },
    spawnKind: null,
    spawnDelay: -1,
    spawnTurn: -1,
  };
}

function makeState(opts: {
  player: HexCoord;
  enemies: readonly Enemy[];
  mimic: HexCoord | null;
  walls: readonly WallEdge[];
}): GameState {
  const tiles = new Map<string, Tile>();
  for (const coord of hexesInRange({ q: 0, r: 0 }, RADIUS)) {
    tiles.set(hexKey(coord), grassTile());
  }
  const section: SectionRecord = {
    id: "s0",
    difficulty: 0,
    origin: { q: 0, r: 0 },
    footprint: [...tiles.keys()].map(parseHexKey),
    entryEdge: 0,
    exitEdge: 0,
    radius: RADIUS,
  };
  const hexToSection = new Map<string, string>();
  for (const key of tiles.keys()) {
    hexToSection.set(key, "s0");
  }
  const index: MapIndex = { hexToSection, sections: [section] };
  const cursor: MapCursor = {
    frontier: {
      origin: { q: 0, r: 0 },
      radius: RADIUS,
      entryEdge: 0,
      lastTurn: 0,
      bannedEdges: [0, 1],
    },
    distance: 0,
    rng: { seed: 1 },
    queue: [],
    finished: false,
  };
  return {
    turn: 1,
    currency: 0,
    deck: { draw: [], hand: [], discard: [] },
    map: { tiles, index, player: opts.player, previous: opts.player, cursor },
    playerSectionOrder: 0,
    enemies: [...opts.enemies],
    phase: { kind: "playing" },
    rng: { seed: 1 },
    ids: counterIds("t"),
    turnState: {
      cardsPlayedThisTurn: 0,
      distanceThisTurn: 0,
      enemiesKilledThisTurn: 0,
      currencyEarnedThisTurn: 0,
      currencySpentThisTurn: 0,
      skipBonusTaken: false,
    },
    stats: emptyStats(),
    terrainTrivialTurns: 0,
    enemySpeedBonus: 0,
    enemySpeedThisTurn: 0,
    consumables: [],
    mimic:
      opts.mimic === null
        ? { kind: "none" }
        : { kind: "placed", position: opts.mimic },
    frozenEnemyIds: [],
    anyTerrainTurns: 0,
    walls: opts.walls,
    anomalies: [],
  };
}

function assassin(position: HexCoord, id: string): Enemy {
  return { kind: "assassin", id, position, movement: 1 };
}

function sniper(position: HexCoord, aim: number, id: string): Enemy {
  return { kind: "sniper", id, position, movement: 1, aim };
}

function watchtower(position: HexCoord, radius: number, id: string): Enemy {
  return { kind: "watchtower", id, position, radius };
}

function zoneOf(zones: Map<string, Set<string>>, id: string): Set<string> {
  const zone = zones.get(id);
  if (zone === undefined) {
    throw new Error(`no danger zone for enemy ${id}`);
  }
  return zone;
}

function sorted(zone: ReadonlySet<string>): string[] {
  return [...zone].sort();
}

/**
 * An assassin with movement 1 reaches two hexes out: the first step out of its
 * own hex is free, then it pays 1 per step. So the un-mimicked reach is every
 * hex within distance 2.
 */
describe("assassin danger zone", () => {
  it("marks the whole reach with no mimic", () => {
    const state = makeState({
      player: { q: 3, r: 0 },
      enemies: [assassin({ q: 0, r: 0 }, "a")],
      mimic: null,
      walls: [],
    });
    const zone = dangerZone(state);
    expect(zone.has(hexKey({ q: 0, r: 0 }))).toBe(true);
    expect(zone.has(hexKey({ q: 2, r: 0 }))).toBe(true);
    expect(zone.has(hexKey({ q: 2, r: -2 }))).toBe(true);
    expect(zone.has(hexKey({ q: 3, r: 0 }))).toBe(false);
  });
});

describe("assassin danger zone with a mimic", () => {
  it("keeps only hexes at least as close to the assassin as the mimic", () => {
    const state = makeState({
      player: { q: 3, r: 0 },
      enemies: [assassin({ q: 0, r: 0 }, "a")],
      mimic: { q: 1, r: 0 },
      walls: [],
    });
    const zone = dangerZone(state);
    // Distance 0 and 1 are kept; distance 2 is drawn away by the mimic.
    expect(zone.has(hexKey({ q: 0, r: 0 }))).toBe(true);
    expect(zone.has(hexKey({ q: 1, r: 0 }))).toBe(true);
    expect(zone.has(hexKey({ q: 0, r: 1 }))).toBe(true);
    expect(zone.has(hexKey({ q: 1, r: -1 }))).toBe(true);
    expect(zone.has(hexKey({ q: 2, r: 0 }))).toBe(false);
    expect(zone.has(hexKey({ q: 1, r: 1 }))).toBe(false);
    expect(zone.has(hexKey({ q: 0, r: 2 }))).toBe(false);
  });

  it("treats a hex exactly as close as the mimic as dangerous", () => {
    // The assassin targets the player on a tie, so the tie hex stays red.
    const state = makeState({
      player: { q: 3, r: 0 },
      enemies: [assassin({ q: 0, r: 0 }, "a")],
      mimic: { q: 1, r: 0 },
      walls: [],
    });
    expect(dangerZone(state).has(hexKey({ q: 1, r: 0 }))).toBe(true);
  });

  it("does not protect when the mimic is farther than the whole reach", () => {
    const without = makeState({
      player: { q: 3, r: 0 },
      enemies: [assassin({ q: 0, r: 0 }, "a")],
      mimic: null,
      walls: [],
    });
    const withMimic = makeState({
      player: { q: 3, r: 0 },
      enemies: [assassin({ q: 0, r: 0 }, "a")],
      mimic: { q: 4, r: 0 },
      walls: [],
    });
    expect(sorted(dangerZone(withMimic))).toEqual(sorted(dangerZone(without)));
  });

  it("leaves only the assassin's own hex when the mimic shares it", () => {
    const state = makeState({
      player: { q: 3, r: 0 },
      enemies: [assassin({ q: 0, r: 0 }, "a")],
      mimic: { q: 0, r: 0 },
      walls: [],
    });
    expect(sorted(dangerZone(state))).toEqual([hexKey({ q: 0, r: 0 })]);
  });

  it("keeps the player safe when the mimic is nearer the assassin", () => {
    const state = makeState({
      player: { q: 2, r: 0 },
      enemies: [assassin({ q: 0, r: 0 }, "a")],
      mimic: { q: 1, r: 0 },
      walls: [],
    });
    expect(playerInDanger(state)).toBe(false);
  });

  it("still warns when the player is at least as close as the mimic", () => {
    const state = makeState({
      player: { q: 1, r: 0 },
      enemies: [assassin({ q: 0, r: 0 }, "a")],
      mimic: { q: 1, r: 0 },
      walls: [],
    });
    expect(playerInDanger(state)).toBe(true);
  });

  it("keeps the near half of a long reach red and drops the far half", () => {
    const state = makeState({
      player: { q: 4, r: 0 },
      enemies: [
        { kind: "assassin", id: "a", position: { q: 0, r: 0 }, movement: 3 },
      ],
      mimic: { q: 2, r: 0 },
      walls: [],
    });
    const zone = dangerZone(state);
    expect(zone.has(hexKey({ q: 1, r: 0 }))).toBe(true); // closer than the mimic
    expect(zone.has(hexKey({ q: 2, r: 0 }))).toBe(true); // tie with the mimic
    expect(zone.has(hexKey({ q: 3, r: 0 }))).toBe(false); // farther than the mimic
    expect(zone.has(hexKey({ q: 4, r: 0 }))).toBe(false);
  });

  it("filters each assassin independently", () => {
    const state = makeState({
      player: { q: 3, r: 0 },
      enemies: [
        assassin({ q: 0, r: 0 }, "a"),
        assassin({ q: 0, r: 2 }, "b"),
      ],
      mimic: { q: 1, r: 0 },
      walls: [],
    });
    const zones = enemyDangerZones(state);
    // "a" is drawn to the mimic, so its far reach is dropped.
    expect(zoneOf(zones, "a").has(hexKey({ q: 2, r: 0 }))).toBe(false);
    // "b" is two hexes from the mimic, so its whole reach survives.
    expect(zoneOf(zones, "b").has(hexKey({ q: 0, r: 4 }))).toBe(true);
  });
});

describe("mimic does not affect enemies that do not chase", () => {
  it("leaves a sniper's line unchanged", () => {
    const without = makeState({
      player: { q: 3, r: 0 },
      enemies: [sniper({ q: 0, r: 0 }, 0, "s")],
      mimic: null,
      walls: [],
    });
    const withMimic = makeState({
      player: { q: 3, r: 0 },
      enemies: [sniper({ q: 0, r: 0 }, 0, "s")],
      mimic: { q: 1, r: 0 },
      walls: [],
    });
    expect(sorted(dangerZone(withMimic))).toEqual(sorted(dangerZone(without)));
    expect(dangerZone(withMimic).has(hexKey({ q: 4, r: 0 }))).toBe(true);
  });

  it("leaves a watchtower's radius unchanged", () => {
    const without = makeState({
      player: { q: 3, r: 0 },
      enemies: [watchtower({ q: 0, r: 0 }, 2, "w")],
      mimic: null,
      walls: [],
    });
    const withMimic = makeState({
      player: { q: 3, r: 0 },
      enemies: [watchtower({ q: 0, r: 0 }, 2, "w")],
      mimic: { q: 1, r: 0 },
      walls: [],
    });
    expect(sorted(dangerZone(withMimic))).toEqual(sorted(dangerZone(without)));
    expect(dangerZone(withMimic).has(hexKey({ q: 2, r: 0 }))).toBe(true);
  });
});

describe("walls still bound the danger zone", () => {
  it("blocks a watchtower's line of sight", () => {
    const state = makeState({
      player: { q: 3, r: 0 },
      enemies: [watchtower({ q: 0, r: 0 }, 2, "w")],
      mimic: null,
      walls: [{ from: { q: 1, r: 0 }, to: { q: 2, r: 0 } }],
    });
    const zone = dangerZone(state);
    expect(zone.has(hexKey({ q: 1, r: 0 }))).toBe(true);
    expect(zone.has(hexKey({ q: 2, r: 0 }))).toBe(false);
  });
});
