import { describe, expect, it } from "vitest";
import { SHOP_CATALOGUE, counterIds, instantiate } from "./cards";
import type { Card } from "./cards";
import { dangerZone } from "./enemies";
import type { Enemy } from "./enemies";
import { hexKey, hexesInRange, parseHexKey } from "./hex";
import type { HexCoord } from "./hex";
import type { MapCursor, SectionRecord } from "./map";
import { emptyStats } from "./stats";
import type { GameState, MapIndex } from "./state";
import type { Tile } from "./terrain";
import { endTurn } from "./turn";

/** A one-section, all-grass map big enough for the reach in these tests. */
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
  draw: readonly Card[];
  hand: readonly Card[];
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
    deck: { draw: [...opts.draw], hand: [...opts.hand], discard: [] },
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
    mimic: { kind: "none" },
    frozenEnemyIds: [],
    anyTerrainTurns: 0,
    walls: [],
    anomalies: [],
  };
}

function cardFrom(name: string, id: string): Card {
  const spec = SHOP_CATALOGUE.find((candidate) => candidate.name === name);
  if (spec === undefined) {
    throw new Error(`no spec named ${name}`);
  }
  return instantiate(spec, id);
}

function sorted(zone: ReadonlySet<string>): string[] {
  return [...zone].sort();
}

describe("endTurn and the enemy phase", () => {
  it("holds the hand and danger zone until the enemies have moved", () => {
    const assassin: Enemy = {
      kind: "assassin",
      id: "a",
      position: { q: 0, r: 0 },
      movement: 1,
    };
    const state = makeState({
      player: { q: 4, r: 0 },
      enemies: [assassin],
      draw: [cardFrom("Trade", "d1"), cardFrom("Trade", "d2")],
      hand: [cardFrom("Trade", "h1")],
    });
    const before = dangerZone(state);

    const transition = endTurn(state);

    // While the enemies walk, the map keeps the hand and danger zone the player
    // committed to, and the enemies are still where they started.
    expect(transition.state.phase.kind).toBe("enemy-phase");
    expect(transition.state.deck.hand.map((card) => card.id)).toEqual(["h1"]);
    expect(transition.state.enemies).toEqual([assassin]);
    expect(sorted(dangerZone(transition.state))).toEqual(sorted(before));

    // The next turn — its drawn hand and updated danger zone — waits until the
    // moves finish.
    const after = transition.afterMoves;
    expect(after).toBeDefined();
    expect(after?.phase.kind).toBe("playing");
    expect(after?.deck.hand.map((card) => card.id).sort()).toEqual([
      "d1",
      "d2",
      "h1",
    ]);
    expect(after?.enemies).not.toEqual([assassin]);
    expect(sorted(dangerZone(after as GameState))).not.toEqual(sorted(before));
  });
});
