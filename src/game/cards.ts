import type { Terrain } from "./terrain";

export type CardMode =
  | { kind: "move"; terrain: Terrain; distance: number }
  | { kind: "attack"; range: number }
  | { kind: "draw-discard"; draw: number; discard: number }
  | { kind: "discard-hand"; threshold: number; draw: number }
  | { kind: "draw"; count: number }
  | { kind: "recover"; count: number }
  | { kind: "currency"; amount: number };

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
  upgradedForm: CardSpec | null;
};

export type CardSpec = {
  name: string;
  image: string;
  cost: number;
  rarity: Rarity;
  modes: readonly CardMode[];
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
    upgradedForm: spec.upgradedForm,
  };
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
    spec("Tredge+", "starting", 0, [move("grass", 2)], null),
  ),
  spec(
    "Tredge",
    "starting",
    0,
    [move("grass", 1)],
    spec("Tredge+", "starting", 0, [move("grass", 2)], null),
  ),
  spec(
    "Walk",
    "starting",
    0,
    [move("grass", 3)],
    spec("Walk+", "starting", 0, [move("grass", 4)], null),
  ),
  spec(
    "Blaze",
    "starting",
    0,
    [move("forest", 1)],
    spec("Blaze+", "starting", 0, [move("forest", 2)], null),
  ),
];

export const SHOP_CATALOGUE: readonly CardSpec[] = [
  // basic movement
  spec(
    "Stride",
    "common",
    2,
    [move("grass", 4)],
    spec("Stride+", "common", 2, [move("grass", 5)], null),
  ),
  spec(
    "Marathon",
    "uncommon",
    3,
    [move("grass", 6)],
    spec("Marathon+", "uncommon", 3, [move("grass", 7)], null),
  ),
  spec(
    "Sprint",
    "uncommon",
    4,
    [move("grass", 8)],
    spec("Sprint+", "uncommon", 4, [move("grass", 9)], null),
  ),
  spec(
    "Wade",
    "common",
    2,
    [move("water", 1)],
    spec("Wade+", "common", 2, [move("water", 2)], null),
  ),
  spec(
    "Swim",
    "uncommon",
    3,
    [move("water", 2)],
    spec("Swim+", "uncommon", 3, [move("water", 3)], null),
  ),
  spec(
    "Climb",
    "uncommon",
    3,
    [move("mountain", 1)],
    spec("Climb+", "uncommon", 3, [move("mountain", 2)], null),
  ),

  // combination movement
  spec(
    "Thicket",
    "common",
    2,
    [move("grass", 1), move("forest", 1)],
    spec("Thicket+", "common", 2, [move("grass", 2), move("forest", 2)], null),
  ),
  spec(
    "Ford",
    "common",
    2,
    [move("grass", 1), move("water", 1)],
    spec("Ford+", "common", 2, [move("grass", 2), move("water", 2)], null),
  ),
  spec(
    "Ridge",
    "uncommon",
    3,
    [move("forest", 1), move("mountain", 1)],
    spec(
      "Ridge+",
      "uncommon",
      3,
      [move("forest", 2), move("mountain", 2)],
      null,
    ),
  ),
  spec(
    "Trail",
    "uncommon",
    3,
    [move("grass", 3), move("forest", 1)],
    spec("Trail+", "uncommon", 3, [move("grass", 4), move("forest", 2)], null),
  ),
  spec(
    "Ravine",
    "uncommon",
    4,
    [move("forest", 1), move("water", 1), move("mountain", 1)],
    spec(
      "Ravine+",
      "uncommon",
      4,
      [move("forest", 2), move("water", 2), move("mountain", 2)],
      null,
    ),
  ),
  spec(
    "Moor",
    "uncommon",
    4,
    [move("grass", 5), move("forest", 3)],
    spec("Moor+", "uncommon", 4, [move("grass", 6), move("forest", 4)], null),
  ),
  spec(
    "Delta",
    "rare",
    6,
    [move("grass", 6), move("water", 2), move("mountain", 1)],
    spec(
      "Delta+",
      "rare",
      6,
      [move("grass", 7), move("water", 3), move("mountain", 2)],
      null,
    ),
  ),

  // hand management
  spec(
    "Forage",
    "common",
    2,
    [{ kind: "draw-discard", draw: 3, discard: 2 }],
    spec(
      "Forage+",
      "common",
      2,
      [{ kind: "draw-discard", draw: 3, discard: 2 }],
      null,
    ),
  ),
  spec(
    "Gamble",
    "common",
    2,
    [{ kind: "discard-hand", threshold: 3, draw: 4 }],
    spec(
      "Gamble+",
      "common",
      2,
      [{ kind: "discard-hand", threshold: 3, draw: 4 }],
      null,
    ),
  ),
  spec(
    "Scout",
    "uncommon",
    3,
    [{ kind: "draw", count: 2 }],
    spec("Scout+", "uncommon", 3, [{ kind: "draw", count: 2 }], null),
  ),
  spec(
    "Insight",
    "rare",
    4,
    [{ kind: "draw-discard", draw: 3, discard: 1 }],
    spec(
      "Insight+",
      "rare",
      4,
      [{ kind: "draw-discard", draw: 3, discard: 1 }],
      null,
    ),
  ),
  spec(
    "Recall",
    "uncommon",
    3,
    [{ kind: "recover", count: 1 }],
    spec("Recall+", "uncommon", 3, [{ kind: "recover", count: 1 }], null),
  ),

  // combat
  spec(
    "Ambush",
    "common",
    3,
    [move("grass", 2), { kind: "attack", range: 0 }],
    spec(
      "Ambush+",
      "common",
      3,
      [move("grass", 3), { kind: "attack", range: 0 }],
      null,
    ),
  ),
  spec("Volley", "common", 3, [{ kind: "attack", range: 3 }], null),
  spec(
    "Charge",
    "uncommon",
    4,
    [move("grass", 5), { kind: "attack", range: 3 }],
    spec(
      "Charge+",
      "uncommon",
      4,
      [move("grass", 6), { kind: "attack", range: 3 }],
      null,
    ),
  ),

  // economy
  spec(
    "Trade",
    "common",
    2,
    [{ kind: "currency", amount: 2 }],
    spec("Trade+", "common", 2, [{ kind: "currency", amount: 3 }], null),
  ),
  spec(
    "Mine",
    "common",
    2,
    [move("mountain", 1), { kind: "currency", amount: 1 }],
    spec(
      "Mine+",
      "common",
      2,
      [move("mountain", 2), { kind: "currency", amount: 2 }],
      null,
    ),
  ),
];

function spec(
  name: string,
  rarity: Rarity,
  cost: number,
  modes: readonly CardMode[],
  upgradedForm: CardSpec | null,
): CardSpec {
  return { name, image: "", cost, rarity, modes, upgradedForm };
}
