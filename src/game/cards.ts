import type { Terrain } from "./terrain";

export type MoveMode = { kind: "move"; terrain: Terrain; distance: number };
export type AttackMode = { kind: "attack"; range: number };

/**
 * A card's playable modes. A card's modes are either all map-targeted
 * (`move`/`attack`, played by clicking the card then a tile or enemy) or a
 * single instant effect (played by clicking the card); never both — a card with
 * an active ability alongside movement carries it as `onDiscard` instead.
 */
export type CardMode =
  | MoveMode
  | AttackMode
  | { kind: "draw-discard"; draw: number; discard: number }
  | { kind: "discard-hand"; threshold: number; draw: number }
  | { kind: "draw"; count: number }
  | { kind: "recover"; count: number }
  | { kind: "currency"; amount: number }
  | { kind: "sleep-card"; reshuffles: number };

/** Effect applied when the card is discarded (right-click). */
export type OnDiscard =
  | { kind: "currency"; amount: number }
  | { kind: "sleep-self"; reshuffles: number };

export type Rarity = "starting" | "common" | "uncommon" | "rare";

/**
 * Shop/gift draw weights, kept next to `Rarity`. `starting` is 0 so a starting
 * spec can never be drawn even if one leaked into a pool.
 */
export const RARITY_WEIGHT: Record<Rarity, number> = {
  starting: 0,
  common: 6,
  uncommon: 3,
  rare: 1,
};

export type Card = {
  id: string;
  name: string;
  image: string;
  cost: number;
  rarity: Rarity;
  modes: readonly CardMode[];
  onDiscard: OnDiscard | null;
  upgradedForm: CardSpec | null;
  /**
   * Reshuffles left before this card returns to the draw pile. A sleeping card
   * sits in the discard pile and is skipped by every reshuffle until the count
   * runs out. 0 means awake.
   */
  sleeping: number;
};

export type CardSpec = {
  name: string;
  image: string;
  cost: number;
  rarity: Rarity;
  modes: readonly CardMode[];
  onDiscard: OnDiscard | null;
  upgradedForm: CardSpec | null;
};

export type IdFactory = () => string;

export function counterIds(prefix: string): IdFactory {
  let n = 0;
  return () => {
    n += 1;
    return `${prefix}-${n}`;
  };
}

export function instantiate(spec: CardSpec, id: string): Card {
  return {
    id,
    name: spec.name,
    image: spec.image,
    cost: spec.cost,
    rarity: spec.rarity,
    modes: spec.modes,
    onDiscard: spec.onDiscard,
    upgradedForm: spec.upgradedForm,
    sleeping: 0,
  };
}

/**
 * How many reshuffles a card sleeps for when played, from its own modes: a card
 * that can draw two or more cards sleeps 2, and a combat card with a range above
 * 0 sleeps 1. A card that qualifies for both sleeps for the longer of the two.
 */
export function sleepOnPlay(card: Card): number {
  let sleep = 0;
  for (const mode of card.modes) {
    if (mode.kind === "attack" && mode.range > 0) {
      sleep = Math.max(sleep, 1);
    }
    if (drawCount(mode) >= 2) {
      sleep = Math.max(sleep, 2);
    }
  }
  return sleep;
}

/** How many cards a mode draws, for the sleep-on-play rule. */
function drawCount(mode: CardMode): number {
  switch (mode.kind) {
    case "draw":
      return mode.count;
    case "draw-discard":
      return mode.draw;
    case "discard-hand":
      return mode.draw;
    case "move":
    case "attack":
    case "recover":
    case "currency":
    case "sleep-card":
      return 0;
  }
}

const move = (terrain: Terrain, distance: number): CardMode => ({
  kind: "move",
  terrain,
  distance,
});

export const STARTING_DECK: readonly CardSpec[] = [
  spec(
    "Tredge",
    "starting",
    0,
    [move("grass", 1)],
    null,
    spec("Tredge+", "starting", 0, [move("grass", 2)], null, null),
  ),
  spec(
    "Tredge",
    "starting",
    0,
    [move("grass", 1)],
    null,
    spec("Tredge+", "starting", 0, [move("grass", 2)], null, null),
  ),
  spec(
    "Walk",
    "starting",
    0,
    [move("grass", 3)],
    null,
    spec("Walk+", "starting", 0, [move("grass", 4)], null, null),
  ),
  spec(
    "Blaze",
    "starting",
    0,
    [move("forest", 1)],
    null,
    spec("Blaze+", "starting", 0, [move("forest", 2)], null, null),
  ),
];

export const SHOP_CATALOGUE: readonly CardSpec[] = [
  // basic movement
  spec(
    "Stride",
    "common",
    2,
    [move("grass", 4)],
    null,
    spec("Stride+", "common", 2, [move("grass", 5)], null, null),
  ),
  spec(
    "Marathon",
    "uncommon",
    3,
    [move("grass", 6)],
    null,
    spec("Marathon+", "uncommon", 3, [move("grass", 7)], null, null),
  ),
  spec(
    "Sprint",
    "uncommon",
    4,
    [move("grass", 8)],
    null,
    spec("Sprint+", "uncommon", 4, [move("grass", 9)], null, null),
  ),
  spec(
    "Wade",
    "common",
    2,
    [move("water", 1)],
    null,
    spec("Wade+", "common", 2, [move("water", 2)], null, null),
  ),
  spec(
    "Swim",
    "uncommon",
    3,
    [move("water", 2)],
    null,
    spec("Swim+", "uncommon", 3, [move("water", 3)], null, null),
  ),
  spec(
    "Climb",
    "uncommon",
    3,
    [move("mountain", 1)],
    null,
    spec("Climb+", "uncommon", 3, [move("mountain", 2)], null, null),
  ),

  // combination movement
  spec(
    "Thicket",
    "common",
    2,
    [move("grass", 1), move("forest", 1)],
    null,
    spec(
      "Thicket+",
      "common",
      2,
      [move("grass", 2), move("forest", 2)],
      null,
      null,
    ),
  ),
  spec(
    "Ford",
    "common",
    2,
    [move("grass", 1), move("water", 1)],
    null,
    spec("Ford+", "common", 2, [move("grass", 2), move("water", 2)], null, null),
  ),
  spec(
    "Ridge",
    "uncommon",
    3,
    [move("forest", 1), move("mountain", 1)],
    null,
    spec(
      "Ridge+",
      "uncommon",
      3,
      [move("forest", 2), move("mountain", 2)],
      null,
      null,
    ),
  ),
  spec(
    "Trail",
    "uncommon",
    3,
    [move("grass", 3), move("forest", 1)],
    null,
    spec("Trail+", "uncommon", 3, [move("grass", 4), move("forest", 2)], null, null),
  ),
  spec(
    "Ravine",
    "uncommon",
    4,
    [move("forest", 1), move("water", 1), move("mountain", 1)],
    null,
    spec(
      "Ravine+",
      "uncommon",
      4,
      [move("forest", 2), move("water", 2), move("mountain", 2)],
      null,
      null,
    ),
  ),
  spec(
    "Moor",
    "uncommon",
    4,
    [move("grass", 5), move("forest", 3)],
    null,
    spec("Moor+", "uncommon", 4, [move("grass", 6), move("forest", 4)], null, null),
  ),
  spec(
    "Delta",
    "rare",
    6,
    [move("grass", 6), move("water", 2), move("mountain", 1)],
    null,
    spec(
      "Delta+",
      "rare",
      6,
      [move("grass", 7), move("water", 3), move("mountain", 2)],
      null,
      null,
    ),
  ),

  // hand management
  spec(
    "Forage",
    "common",
    2,
    [{ kind: "draw-discard", draw: 3, discard: 2 }],
    null,
    null,
  ),
  spec(
    "Gamble",
    "common",
    2,
    [{ kind: "discard-hand", threshold: 3, draw: 4 }],
    null,
    null,
  ),
  spec(
    "Scout",
    "uncommon",
    3,
    [{ kind: "draw", count: 2 }],
    null,
    null,
  ),
  spec(
    "Insight",
    "rare",
    4,
    [{ kind: "draw-discard", draw: 3, discard: 1 }],
    null,
    null,
  ),
  spec(
    "Recall",
    "uncommon",
    3,
    [{ kind: "recover", count: 1 }],
    null,
    null,
  ),
  spec(
    "Slumber",
    "rare",
    4,
    [{ kind: "sleep-card", reshuffles: 4 }],
    { kind: "sleep-self", reshuffles: 4 },
    null,
  ),

  // combat
  spec(
    "Ambush",
    "common",
    3,
    [move("grass", 2), { kind: "attack", range: 0 }],
    null,
    spec(
      "Ambush+",
      "common",
      3,
      [move("grass", 3), { kind: "attack", range: 0 }],
      null,
      null,
    ),
  ),
  spec("Volley", "common", 3, [{ kind: "attack", range: 3 }], null, null),
  spec(
    "Charge",
    "uncommon",
    4,
    [move("grass", 5), { kind: "attack", range: 3 }],
    null,
    spec(
      "Charge+",
      "uncommon",
      4,
      [move("grass", 6), { kind: "attack", range: 3 }],
      null,
      null,
    ),
  ),

  // economy
  spec(
    "Trade",
    "common",
    2,
    [{ kind: "currency", amount: 2 }],
    null,
    spec("Trade+", "common", 2, [{ kind: "currency", amount: 3 }], null, null),
  ),
  spec(
    "Mine",
    "common",
    2,
    [move("mountain", 1)],
    { kind: "currency", amount: 1 },
    spec(
      "Mine+",
      "common",
      2,
      [move("mountain", 2)],
      { kind: "currency", amount: 2 },
      null,
    ),
  ),
];

function spec(
  name: string,
  rarity: Rarity,
  cost: number,
  modes: readonly CardMode[],
  onDiscard: OnDiscard | null,
  upgradedForm: CardSpec | null,
): CardSpec {
  return { name, image: "", cost, rarity, modes, onDiscard, upgradedForm };
}
