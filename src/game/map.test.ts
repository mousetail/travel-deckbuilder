import { describe, expect, it } from "vitest";
import {
  FINISH_TEMPLATE,
  MAX_BAND,
  buildMapIndex,
  generateMap,
  panicAnomaly,
} from "./map";
import { ensureAhead } from "./fog";
import { counterIds } from "./cards";
import type { GameState } from "./state";

/** A seed whose generation needs the panic fallback (verified by sweeping). */
const PANIC_SEED = 5154;
/** A seed whose `ensureAhead` generation needs the panic fallback. */
const AHEAD_PANIC_SEED = 674;

/** A minimal `GameState` positioned `order` sections in, ready for `ensureAhead`. */
function stateAt(seed: number, order: number): GameState {
  const ids = counterIds(`map${seed}`);
  const generated = generateMap(seed, 3, 1, ids);
  return {
    turn: 1,
    map: {
      tiles: generated.tiles,
      index: buildMapIndex(generated.records, generated.tiles),
      player: generated.player,
      previous: generated.player,
      cursor: generated.cursor,
    },
    playerSectionOrder: order,
    enemies: generated.enemies,
    anomalies: [],
    ids,
  } as unknown as GameState;
}

describe("generateMap", () => {
  it("always reaches the finish section", () => {
    // Regression: the finish trigger once exceeded `MAX_BAND + 1`, so
    // `finishMode` never turned on and the map grew forever without ever
    // placing the finish.
    for (let seed = 1; seed <= 200; seed += 1) {
      const map = generateMap(seed, 200, 1, counterIds(`map${seed}`));
      const hasFinish = [...map.tiles.values()].some(
        (tile) => tile.terrain === "finish",
      );
      expect(hasFinish, `seed ${seed} produced no finish tile`).toBe(true);
      expect(map.cursor.finished, `seed ${seed} cursor not finished`).toBe(
        true,
      );
    }
  });

  it("keeps the finish difficulty reachable", () => {
    // `placeSection` computes `maxDifficulty = band + 1` with `band` capped at
    // `MAX_BAND`, so a finish difficulty above `MAX_BAND + 1` can never trigger.
    expect(FINISH_TEMPLATE.difficulty).toBeLessThanOrEqual(MAX_BAND + 1);
  });

  it("reports sections placed from the panic fallback", () => {
    const map = generateMap(PANIC_SEED, 200, 1, counterIds("panic"));
    expect(map.panics.length).toBeGreaterThan(0);
    for (const panic of map.panics) {
      expect(panic.templateId).not.toBe("");
      expect(panic.radius).toBeGreaterThan(0);
      expect(panic.frontierRadius).toBeGreaterThan(0);
    }
  });
});

describe("ensureAhead", () => {
  it("records a map-panic anomaly when the generator panics", () => {
    const next = ensureAhead(stateAt(AHEAD_PANIC_SEED, 15));
    const panics = next.anomalies.filter((a) => a.kind === "map-panic");
    expect(panics.length).toBeGreaterThan(0);
    for (const anomaly of panics) {
      if (anomaly.kind !== "map-panic") {
        continue;
      }
      expect(anomaly.turn).toBe(1);
      expect(anomaly.templateId).not.toBe("");
    }
  });

  it("records nothing when every section places normally", () => {
    const next = ensureAhead(stateAt(1, 3));
    expect(next.anomalies).toEqual([]);
  });
});

describe("panicAnomaly", () => {
  it("maps a panic placement to a map-panic anomaly", () => {
    expect(
      panicAnomaly(
        {
          distance: 7,
          templateId: "meadow-1",
          radius: 2,
          frontierRadius: 1,
        },
        42,
      ),
    ).toEqual({
      kind: "map-panic",
      turn: 42,
      sectionOrder: 7,
      templateId: "meadow-1",
      radius: 2,
      frontierRadius: 1,
    });
  });
});
