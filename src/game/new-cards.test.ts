import { describe, expect, it } from "vitest";
import type { Card, CardSpec } from "./cards";
import {
  SHOP_CATALOGUE,
  STORAGE_EMPTY_SPEC,
  counterIds,
  instantiate,
  revertTemporary,
  temporaryUpgradeCard,
  transformStorage,
  upgradeTarget,
} from "./cards";
import { hexKey, hexesInRange, parseHexKey } from "./hex";
import type { HexCoord } from "./hex";
import { upgradeCard } from "./economy";
import type { MapCursor, SectionRecord } from "./map";
import { cardReach, hopTargets } from "./reach";
import { emptyStats } from "./stats";
import type { GameState, MapIndex } from "./state";
import type { Terrain, Tile } from "./terrain";
import {
  beginPlay,
  cancelPending,
  chooseWall,
  confirmStore,
  discardCard,
  resolveMoveTo,
  toggleStoreChoice,
} from "./turn";
import { hexagonSideWallEdges, sideToward } from "./walls";

const RADIUS = 5;

function tile(terrain: Terrain, cost: number): Tile {
  return {
    terrain,
    cost,
    feature: { kind: "none" },
    spawnKind: null,
    spawnDelay: -1,
    spawnTurn: -1,
  };
}

/** A one-section map, grass everywhere except `overrides`. */
function makeState(
  player: HexCoord,
  overrides: ReadonlyMap<string, Tile>,
  hand: readonly Card[],
): GameState {
  const tiles = new Map<string, Tile>();
  for (const coord of hexesInRange({ q: 0, r: 0 }, RADIUS)) {
    const key = hexKey(coord);
    tiles.set(key, overrides.get(key) ?? tile("grass", 1));
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
    currency: 10,
    deck: { draw: [], hand: [...hand], discard: [] },
    map: { tiles, index, player, previous: player, cursor },
    playerSectionOrder: 0,
    enemies: [],
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

function specNamed(name: string): CardSpec {
  const spec = SHOP_CATALOGUE.find((candidate) => candidate.name === name);
  if (spec === undefined) {
    throw new Error(`no spec named ${name}`);
  }
  return spec;
}

function cardFrom(name: string, id: string): Card {
  return instantiate(specNamed(name), id);
}

const noOverrides: ReadonlyMap<string, Tile> = new Map();

describe("Storage Bin", () => {
  it("stores cards and transforms into the full bin", () => {
    const bin = instantiate(STORAGE_EMPTY_SPEC, "bin");
    const a = cardFrom("Trade", "a");
    const b = cardFrom("Trade", "b");
    const state = makeState({ q: 0, r: 0 }, noOverrides, [bin, a, b]);

    const opened = beginPlay(state, bin);
    expect(opened.state.phase.kind).toBe("pending-store");

    const selected = toggleStoreChoice(opened.state, a);
    const confirmed = confirmStore(selected.state);

    expect(confirmed.state.deck.hand.map((card) => card.id)).toEqual(["b"]);
    const stored = confirmed.state.deck.discard.find(
      (card) => card.id === "bin",
    );
    expect(stored?.name).toBe("Storage Bin (Full)");
    expect(stored?.stored.map((card) => card.id)).toEqual(["a"]);
  });

  it("returns stored cards to hand when the full bin is played", () => {
    const stored = cardFrom("Trade", "a");
    const full = transformStorage(instantiate(STORAGE_EMPTY_SPEC, "bin"), [
      stored,
    ]);
    expect(full.name).toBe("Storage Bin (Full)");
    const state = makeState({ q: 0, r: 0 }, noOverrides, [full]);

    const played = beginPlay(state, full);
    expect(played.state.deck.hand.map((card) => card.id)).toEqual(["a"]);
    // The basic bin releases the cards temporarily upgraded.
    expect(played.state.deck.hand[0]?.temporaryUpgrade).toBe(true);
    const discarded = played.state.deck.discard.find(
      (card) => card.id === "bin",
    );
    expect(discarded?.name).toBe("Storage Bin (Empty)");
    expect(discarded?.stored).toHaveLength(0);
  });

  it("gives a temporary copy of each card when upgraded", () => {
    const upgradedForm = STORAGE_EMPTY_SPEC.upgradedForm;
    if (upgradedForm === null) {
      throw new Error("storage bin has no upgraded form");
    }
    const stored = cardFrom("Trade", "a");
    const full = transformStorage(instantiate(upgradedForm, "bin"), [stored]);
    expect(full.name).toBe("Storage Bin (Full)+");
    const state = makeState({ q: 0, r: 0 }, noOverrides, [full]);

    const played = beginPlay(state, full);
    expect(played.state.deck.hand.map((card) => card.id)).toContain("a");
    expect(
      played.state.deck.hand.filter((card) => card.temporary),
    ).toHaveLength(1);
  });

  it("upgrades the cards stored inside a full bin at the smith", () => {
    const stored = cardFrom("Trade", "a");
    const full = transformStorage(instantiate(STORAGE_EMPTY_SPEC, "bin"), [
      stored,
    ]);
    const upgraded = upgradeCard(full);
    expect(upgraded.name).toBe("Storage Bin (Full)+");
    expect(upgraded.stored[0]?.name).toBe("Trade+");
  });
});

describe("Smith upgrades", () => {
  it("does not upgrade a temporary card", () => {
    const temporary = { ...cardFrom("Trade", "t"), temporary: true };
    expect(upgradeTarget(temporary)).toBeNull();
    expect(upgradeCard(temporary)).toBe(temporary);
  });

  it("makes a temporary upgrade permanent", () => {
    const base = cardFrom("Trade", "t");
    const temporary = temporaryUpgradeCard(base);
    expect(temporary.name).toBe("Trade+");
    expect(temporary.temporaryUpgrade).toBe(true);
    expect(upgradeTarget(temporary)?.name).toBe("Trade+");

    const permanent = upgradeCard(temporary);
    expect(permanent.name).toBe("Trade+");
    expect(permanent.temporaryUpgrade).toBe(false);
    // The permanent form no longer reverts when it leaves the hand.
    expect(revertTemporary(permanent)).toBe(permanent);
  });
});

describe("Invention", () => {
  it("conjures temporary cards that vanish when discarded", () => {
    const invention = cardFrom("Invention", "inv");
    const state = makeState({ q: 0, r: 0 }, noOverrides, [invention]);
    const played = beginPlay(state, invention);
    const conjured = played.state.deck.hand.filter((card) => card.temporary);
    expect(conjured).toHaveLength(3);
    expect(played.state.deck.hand.some((card) => card.id === "inv")).toBe(
      false,
    );

    // Discarding a conjured card removes it entirely: it never reaches discard.
    const target = conjured[0];
    if (target === undefined) {
      throw new Error("no conjured card");
    }
    const afterDiscard = discardCard(played.state, target);
    expect(
      afterDiscard.state.deck.discard.some((card) => card.id === target.id),
    ).toBe(false);
    expect(
      afterDiscard.state.deck.hand.some((card) => card.id === target.id),
    ).toBe(false);
  });
});

describe("Monotony", () => {
  it("moves over the terrain under the player", () => {
    const monotony = cardFrom("Monotony", "m");
    const overrides = new Map<string, Tile>([
      [hexKey({ q: 0, r: 0 }), tile("water", 1)],
      [hexKey({ q: 1, r: 0 }), tile("water", 1)],
    ]);
    const state = makeState({ q: 0, r: 0 }, overrides, [monotony]);
    const reach = cardReach(state, monotony);
    const move = reach.moves[0];
    expect(move?.reachable.map(hexKey)).toContain(hexKey({ q: 1, r: 0 }));
    // The adjacent grass is not reachable: the card travels over water only.
    expect(move?.reachable.map(hexKey)).not.toContain(hexKey({ q: 1, r: -1 }));
  });
});

describe("Hop", () => {
  it("lands on a cost-1 grass two steps away", () => {
    const state = makeState({ q: 0, r: 0 }, noOverrides, []);
    const targets = hopTargets(state, 1);
    expect(targets.map(hexKey)).toContain(hexKey({ q: 2, r: 0 }));
  });

  it("rejects an impassible tile in the middle", () => {
    const overrides = new Map<string, Tile>([
      [hexKey({ q: 1, r: 0 }), tile("impassible", 1)],
    ]);
    const state = makeState({ q: 0, r: 0 }, overrides, []);
    const targets = hopTargets(state, 1);
    expect(targets.map(hexKey)).not.toContain(hexKey({ q: 2, r: 0 }));
  });

  it("rejects a landing tile that is too expensive or not grass", () => {
    const expensive = new Map<string, Tile>([
      [hexKey({ q: 2, r: 0 }), tile("grass", 2)],
    ]);
    const state = makeState({ q: 0, r: 0 }, expensive, []);
    expect(hopTargets(state, 1).map(hexKey)).not.toContain(
      hexKey({ q: 2, r: 0 }),
    );

    const water = new Map<string, Tile>([
      [hexKey({ q: 2, r: 0 }), tile("water", 1)],
    ]);
    const waterState = makeState({ q: 0, r: 0 }, water, []);
    expect(hopTargets(waterState, 1).map(hexKey)).not.toContain(
      hexKey({ q: 2, r: 0 }),
    );
  });

  it("resolves as a direct jump", () => {
    const hop = cardFrom("Hop", "h");
    const state = makeState({ q: 0, r: 0 }, noOverrides, [hop]);
    const opened = beginPlay(state, hop);
    expect(opened.state.phase.kind).toBe("pending-card");
    const moved = resolveMoveTo(opened.state, { q: 2, r: 0 });
    expect(moved.moves).toHaveLength(0);
    expect(moved.state.map.player).toEqual({ q: 2, r: 0 });
  });
});

describe("Wall", () => {
  it("walls one side of a radius-3 hexagon, directed inward", () => {
    const centre = { q: 0, r: 0 };
    const edges = hexagonSideWallEdges(centre, 0, 3);
    expect(edges).toHaveLength(7);
    // Every edge crosses from outside the hexagon to inside it.
    for (const edge of edges) {
      expect(hexDistanceSafe(edge.from)).toBeGreaterThan(3);
      expect(hexDistanceSafe(edge.to)).toBeLessThanOrEqual(3);
    }
  });

  it("picks the side nearest a clicked direction", () => {
    // Side s faces neighbour direction (1 - s + 6) % 6.
    expect(sideToward({ q: 0, r: 0 }, { q: 1, r: -1 })).toBe(0);
    expect(sideToward({ q: 0, r: 0 }, { q: 1, r: 0 })).toBe(1);
  });

  it("opens the direction choice with the card still in hand", () => {
    const wall = cardFrom("Wall", "w");
    const state = makeState({ q: 0, r: 0 }, noOverrides, [wall]);
    const opened = beginPlay(state, wall);
    expect(opened.state.phase.kind).toBe("pending-wall");
    expect(opened.state.deck.hand.map((card) => card.id)).toEqual(["w"]);
    expect(opened.state.currency).toBe(state.currency);
    expect(opened.state.walls).toHaveLength(0);
  });

  it("cancels without spending or discarding the card", () => {
    const wall = cardFrom("Wall", "w");
    const state = makeState({ q: 0, r: 0 }, noOverrides, [wall]);
    const opened = beginPlay(state, wall);

    const cancelled = cancelPending(opened.state);
    expect(cancelled.state.phase.kind).toBe("playing");
    expect(cancelled.state.deck.hand.map((card) => card.id)).toEqual(["w"]);
    expect(cancelled.state.currency).toBe(state.currency);
    expect(cancelled.state.walls).toHaveLength(0);
  });

  it("commits the play only once a direction is chosen", () => {
    const wall = cardFrom("Wall", "w");
    const state = makeState({ q: 0, r: 0 }, noOverrides, [wall]);
    const opened = beginPlay(state, wall);

    const placed = chooseWall(opened.state, 0);
    expect(placed.state.phase.kind).toBe("playing");
    expect(placed.state.currency).toBe(state.currency - 4);
    expect(placed.state.deck.hand).toHaveLength(0);
    const discarded = placed.state.deck.discard.find(
      (card) => card.id === "w",
    );
    expect(discarded?.sleeping).toBe(1);
  });
});

function hexDistanceSafe(coord: HexCoord): number {
  const dq = coord.q;
  const dr = coord.r;
  const ds = -dq - dr;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2;
}
