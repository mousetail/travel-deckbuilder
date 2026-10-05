import type { IdFactory } from "./cards";
import { DIFFICULTY_SCALING } from "./config";
import { shuffleAll } from "./deck";
import { dangerZone } from "./enemies";
import type { Enemy } from "./enemies";
import { sectionAt, onPlayerMoved } from "./fog";
import { hexDistance, hexKey } from "./hex";
import type { HexCoord } from "./hex";
import { shuffle } from "./rng";
import type { Rng } from "./rng";
import type { GameState } from "./state";
import { countDrawn } from "./stats";
import { still } from "./transition";
import type { Transition } from "./transition";
import { sectionWallEdges } from "./walls";
import reshuffleUrl from "../images/consumable-icons/reshuffle.svg";
import retreatUrl from "../images/consumable-icons/retreat.svg";
import freezeUrl from "../images/consumable-icons/freeze.svg";
import slowUrl from "../images/consumable-icons/slow.svg";
import mimicUrl from "../images/consumable-icons/mimic.svg";
import trailblazeUrl from "../images/consumable-icons/trailblaze.svg";
import barricadeUrl from "../images/consumable-icons/barricade.svg";

export type ConsumableKind =
  | "reshuffle"
  | "retreat"
  | "freeze"
  | "slow"
  | "mimic"
  | "trailblaze"
  | "barricade";

export type ConsumableSpec = {
  kind: ConsumableKind;
  name: string;
  description: string;
  icon: string;
};

export type Consumable = { id: string; spec: ConsumableSpec };

/** How many consumables the player can hold at once. */
export const CONSUMABLE_CAPACITY = 3;

/** How many hexes Freeze reaches. */
export const FREEZE_RANGE = 8;

const ALL_CONSUMABLES: readonly ConsumableSpec[] = [
  {
    kind: "reshuffle",
    name: "Reshuffle",
    description:
      "Shuffle all your cards, including sleeping ones, then draw 4 cards",
    icon: reshuffleUrl,
  },
  {
    kind: "retreat",
    name: "Retreat",
    description: "Jump backwards to nearest safe space",
    icon: retreatUrl,
  },
  {
    kind: "freeze",
    name: "Freeze",
    description: "Freezes all enemies within 8 tiles",
    icon: freezeUrl,
  },
  {
    kind: "slow",
    name: "Slow",
    description: "Reduce enemy speed by 2 this turn",
    icon: slowUrl,
  },
  {
    kind: "mimic",
    name: "Mimic",
    description: "Place a mimic that can disctract enemies",
    icon: mimicUrl,
  },
  {
    kind: "trailblaze",
    name: "Trailblaze",
    description: "All cards can cross all terrain this turn.",
    icon: trailblazeUrl,
  },
  {
    kind: "barricade",
    name: "Barricade",
    description: "Create a one-way wall around your section.",
    icon: barricadeUrl,
  },
];

/** Excludes `slow` when `DIFFICULTY_SCALING === "turn"`. */
export const CONSUMABLE_CATALOGUE: readonly ConsumableSpec[] =
  DIFFICULTY_SCALING === "turn"
    ? ALL_CONSUMABLES.filter((spec) => spec.kind !== "slow")
    : ALL_CONSUMABLES;

/** Roll `count` distinct consumables for the pickup space. */
export function rollConsumableOptions(
  count: number,
  rng: Rng,
  ids: IdFactory,
): { options: Consumable[]; rng: Rng } {
  const rolled = shuffle(CONSUMABLE_CATALOGUE, rng);
  const options = rolled.items
    .slice(0, count)
    .map((spec) => ({ id: ids(), spec }));
  return { options, rng: rolled.rng };
}

/** Every enemy within Freeze's range of the player. */
function enemiesWithinFreeze(state: GameState): Enemy[] {
  return state.enemies.filter(
    (enemy) => hexDistance(enemy.position, state.map.player) <= FREEZE_RANGE,
  );
}

/**
 * The closest safe grass tile in the section behind the player, or null. Safe
 * means no enemy could strike it at the end of this turn and no enemy stands on
 * it. Ties break on the lowest hex key so replays are stable.
 */
export function retreatTarget(state: GameState): HexCoord | null {
  const behind = state.map.index.sections[state.playerSectionOrder - 1];
  if (behind === undefined) {
    return null;
  }
  const danger = dangerZone(state);
  const occupied = new Set(
    state.enemies.map((enemy) => hexKey(enemy.position)),
  );
  let best: HexCoord | null = null;
  let bestDistance = Infinity;
  let bestKey = "";
  for (const coord of behind.footprint) {
    const key = hexKey(coord);
    const tile = state.map.tiles.get(key);
    if (tile === undefined || tile.terrain !== "grass") {
      continue;
    }
    if (danger.has(key) || occupied.has(key)) {
      continue;
    }
    const distance = hexDistance(coord, state.map.player);
    if (
      distance < bestDistance ||
      (distance === bestDistance && key < bestKey)
    ) {
      best = coord;
      bestDistance = distance;
      bestKey = key;
    }
  }
  return best;
}

/** Whether using `consumable` right now would do anything. */
export function canUseConsumable(
  state: GameState,
  consumable: Consumable,
): boolean {
  switch (consumable.spec.kind) {
    case "reshuffle":
      return true;
    case "retreat":
      return retreatTarget(state) !== null;
    case "freeze":
      return enemiesWithinFreeze(state).length > 0;
    case "slow":
      return DIFFICULTY_SCALING !== "turn";
    case "mimic":
      return state.mimic.kind === "none";
    case "trailblaze":
      return true;
    case "barricade":
      return sectionAt(state.map.index, state.map.player) !== null;
  }
}

/**
 * Use a held consumable. Preserves the current phase, so it can be used with a
 * shop or pickup window open; returns the new state and any movement to animate.
 */
export function useConsumable(state: GameState, id: string): Transition {
  const consumable = state.consumables.find((item) => item.id === id);
  if (consumable === undefined || !canUseConsumable(state, consumable)) {
    return still(state);
  }
  const without: GameState = {
    ...state,
    consumables: state.consumables.filter((item) => item.id !== id),
  };
  return applyConsumable(without, consumable.spec.kind);
}

function applyConsumable(state: GameState, kind: ConsumableKind): Transition {
  switch (kind) {
    case "reshuffle": {
      const applied = shuffleAll(state.deck, state.rng);
      return still({
        ...state,
        deck: applied.deck,
        rng: applied.rng,
        stats: countDrawn(state.stats, applied.drawn),
      });
    }
    case "retreat": {
      const target = retreatTarget(state);
      if (target === null) {
        return still(state);
      }
      const moved: GameState = {
        ...state,
        map: { ...state.map, player: target, previous: state.map.player },
      };
      return still(onPlayerMoved(moved));
    }
    case "freeze":
      return still({
        ...state,
        frozenEnemyIds: enemiesWithinFreeze(state).map((enemy) => enemy.id),
      });
    case "slow":
      return still({
        ...state,
        enemySpeedThisTurn: state.enemySpeedThisTurn - 2,
      });
    case "mimic":
      return still({
        ...state,
        mimic: { kind: "placed", position: state.map.player },
      });
    case "trailblaze":
      return still({ ...state, anyTerrainTurns: 1 });
    case "barricade": {
      const sectionId = sectionAt(state.map.index, state.map.player);
      if (sectionId === null) {
        return still(state);
      }
      return still({
        ...state,
        walls: [
          ...state.walls,
          ...sectionWallEdges(state.map.index, sectionId),
        ],
      });
    }
  }
}

/** The mimic's tile, or null while none is placed. */
export function mimicPosition(state: GameState): HexCoord | null {
  return state.mimic.kind === "placed" ? state.mimic.position : null;
}
