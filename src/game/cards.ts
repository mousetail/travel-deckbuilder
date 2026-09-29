import type { Terrain } from "./terrain";

export type MoveMode =
  | { kind: "move"; terrain: Terrain; distance: number }
  | { kind: "teleport"; range: number };
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
  | { kind: "sleep-card"; reshuffles: number }
  | { kind: "search"; count: number }
  | { kind: "trivial-terrain"; turns: number }
  | { kind: "upgrade-hand" };

/**
 * A side effect that fires as part of a card's action. Sleeping is an effect of
 * the action, not a property of the card: a card that cycles your hand sleeps
 * itself when played, and a card can sleep itself when discarded.
 */
export type CardEffect =
  | { kind: "currency"; amount: number }
  | { kind: "sleep"; reshuffles: number }
  | { kind: "pay"; amount: number }
  | { kind: "double-cost" }
  | { kind: "halve-cost" };

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
  /** Effects that fire when the card is played, alongside its mode. */
  onPlay: readonly CardEffect[];
  /** Effects that fire when the card is discarded by hand. */
  onDiscard: readonly CardEffect[];
  upgradedForm: CardSpec | null;
  /** The permanent form, used to undo a temporary upgrade. */
  baseSpec: CardSpec;
  /** True while an Upgrader upgrade is applied. */
  temporaryUpgrade: boolean;
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
  onPlay: readonly CardEffect[];
  onDiscard: readonly CardEffect[];
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
    onPlay: spec.onPlay,
    onDiscard: spec.onDiscard,
    upgradedForm: spec.upgradedForm,
    baseSpec: spec,
    temporaryUpgrade: false,
    sleeping: 0,
  };
}

/** The coin cost of playing `card`, from the `pay` effects in its play line. */
export function playCost(card: Card): number {
  let total = 0;
  for (const effect of card.onPlay) {
    if (effect.kind === "pay") {
      total += effect.amount;
    }
  }
  return total;
}

/** The movement value of a move mode: distance for a walk, range for a jump. */
export function moveModeValue(mode: MoveMode): number {
  return mode.kind === "move" ? mode.distance : mode.range;
}

/**
 * Swap in the upgraded form as a temporary upgrade, remembering the permanent
 * form so it can be reverted when the card leaves the hand. A card with no
 * upgraded form is returned unchanged.
 */
export function temporaryUpgradeCard(card: Card): Card {
  if (card.upgradedForm === null) {
    return card;
  }
  return {
    ...instantiate(card.upgradedForm, card.id),
    baseSpec: card.baseSpec,
    temporaryUpgrade: true,
    sleeping: card.sleeping,
  };
}

/** Rebuild a temporarily upgraded card from its permanent form. */
export function revertTemporary(card: Card): Card {
  if (!card.temporaryUpgrade) {
    return card;
  }
  return {
    ...instantiate(card.baseSpec, card.id),
    sleeping: card.sleeping,
  };
}

function scalePay(card: Card, scale: (amount: number) => number): Card {
  return {
    ...card,
    onPlay: card.onPlay.map((effect) =>
      effect.kind === "pay"
        ? { kind: "pay", amount: scale(effect.amount) }
        : effect,
    ),
  };
}

/** Double the play cost of a card whose play line says `double-cost`. */
export function applyPlayCostScaling(card: Card): Card {
  if (!card.onPlay.some((effect) => effect.kind === "double-cost")) {
    return card;
  }
  return scalePay(card, (amount) => amount * 2);
}

/** Halve the play cost of a card whose discard line says `halve-cost`, min 1. */
export function applyDiscardCostScaling(card: Card): Card {
  if (!card.onDiscard.some((effect) => effect.kind === "halve-cost")) {
    return card;
  }
  return scalePay(card, (amount) => Math.max(1, Math.floor(amount / 2)));
}

/** How many reshuffles a card sleeps for when played, from its play effects. */
export function sleepOnPlay(card: Card): number {
  return sleepTotal(card.onPlay);
}

function sleepTotal(effects: readonly CardEffect[]): number {
  let total = 0;
  for (const effect of effects) {
    if (effect.kind === "sleep") {
      total += effect.reshuffles;
    }
  }
  return total;
}

const move = (terrain: Terrain, distance: number): CardMode => ({
  kind: "move",
  terrain,
  distance,
});

const sleep = (reshuffles: number): CardEffect => ({
  kind: "sleep",
  reshuffles,
});

const currency = (amount: number): CardEffect => ({
  kind: "currency",
  amount,
});

const pay = (amount: number): CardEffect => ({ kind: "pay", amount });

const doubleCost: CardEffect = { kind: "double-cost" };

const halveCost: CardEffect = { kind: "halve-cost" };

const search = (count: number): CardMode => ({ kind: "search", count });

const trivialTerrain = (turns: number): CardMode => ({
  kind: "trivial-terrain",
  turns,
});

const upgradeHand: CardMode = { kind: "upgrade-hand" };

const teleport = (range: number): CardMode => ({ kind: "teleport", range });

export const STARTING_DECK: readonly CardSpec[] = [
  spec(
    "Tredge",
    "starting",
    0,
    [move("grass", 1)],
    [],
    [],
    spec("Tredge+", "starting", 0, [move("grass", 2)], [], [], null),
  ),
  spec(
    "Tredge",
    "starting",
    0,
    [move("grass", 1)],
    [],
    [],
    spec("Tredge+", "starting", 0, [move("grass", 2)], [], [], null),
  ),
  spec(
    "Walk",
    "starting",
    0,
    [move("grass", 3)],
    [],
    [],
    spec("Walk+", "starting", 0, [move("grass", 4)], [], [], null),
  ),
  spec(
    "Blaze",
    "starting",
    0,
    [move("forest", 1)],
    [],
    [],
    spec("Blaze+", "starting", 0, [move("forest", 2)], [], [], null),
  ),
  spec(
    "Stab",
    "starting",
    0,
    [{ kind: "attack", range: 1 }],
    [{kind: "sleep", reshuffles: 2}],
    [{kind: "sleep", reshuffles: 2}],
    spec("Stab+", "starting", 0, [{ kind: "attack", range: 2 }],
      [{kind: "sleep", reshuffles: 2}],
      [{kind: "sleep", reshuffles: 2}], null)
  )
];

export const SHOP_CATALOGUE: readonly CardSpec[] = [
  // basic movement
  spec(
    "Stride",
    "common",
    2,
    [move("grass", 4)],
    [],
    [],
    spec("Stride+", "common", 2, [move("grass", 5)], [], [], null),
  ),
  spec(
    "Marathon",
    "uncommon",
    3,
    [move("grass", 6)],
    [],
    [],
    spec("Marathon+", "uncommon", 3, [move("grass", 7)], [], [], null),
  ),
  spec(
    "Sprint",
    "uncommon",
    4,
    [move("grass", 8)],
    [],
    [],
    spec("Sprint+", "uncommon", 4, [move("grass", 9)], [], [], null),
  ),
  spec(
    "Wade",
    "common",
    2,
    [move("water", 1)],
    [],
    [],
    spec("Wade+", "common", 2, [move("water", 2)], [], [], null),
  ),
  spec(
    "Swim",
    "uncommon",
    3,
    [move("water", 2)],
    [],
    [],
    spec("Swim+", "uncommon", 3, [move("water", 3)], [], [], null),
  ),
  spec(
    "Climb",
    "uncommon",
    3,
    [move("mountain", 1)],
    [],
    [],
    spec("Climb+", "uncommon", 3, [move("mountain", 2)], [], [], null),
  ),

  // combination movement
  spec(
    "Thicket",
    "common",
    2,
    [move("grass", 1), move("forest", 1)],
    [],
    [],
    spec(
      "Thicket+",
      "common",
      2,
      [move("grass", 2), move("forest", 2)],
      [],
      [],
      null,
    ),
  ),
  spec(
    "Ford",
    "common",
    2,
    [move("grass", 1), move("water", 1)],
    [],
    [],
    spec(
      "Ford+",
      "common",
      2,
      [move("grass", 2), move("water", 2)],
      [],
      [],
      null,
    ),
  ),
  spec(
    "Ridge",
    "uncommon",
    3,
    [move("forest", 1), move("mountain", 1)],
    [],
    [],
    spec(
      "Ridge+",
      "uncommon",
      3,
      [move("forest", 2), move("mountain", 2)],
      [],
      [],
      null,
    ),
  ),
  spec(
    "Trail",
    "uncommon",
    3,
    [move("grass", 3), move("forest", 1)],
    [],
    [],
    spec(
      "Trail+",
      "uncommon",
      3,
      [move("grass", 4), move("forest", 2)],
      [],
      [],
      null,
    ),
  ),
  spec(
    "Ravine",
    "uncommon",
    4,
    [move("forest", 1), move("water", 1), move("mountain", 1)],
    [],
    [],
    spec(
      "Ravine+",
      "uncommon",
      4,
      [move("forest", 2), move("water", 2), move("mountain", 2)],
      [],
      [],
      null,
    ),
  ),
  spec(
    "Moor",
    "uncommon",
    4,
    [move("grass", 5), move("forest", 3)],
    [],
    [],
    spec(
      "Moor+",
      "uncommon",
      4,
      [move("grass", 6), move("forest", 4)],
      [],
      [],
      null,
    ),
  ),
  spec(
    "Delta",
    "rare",
    6,
    [move("grass", 6), move("water", 2), move("mountain", 1)],
    [],
    [],
    spec(
      "Delta+",
      "rare",
      6,
      [move("grass", 7), move("water", 3), move("mountain", 2)],
      [],
      [],
      null,
    ),
  ),

  // hand management
  spec(
    "Forage",
    "common",
    2,
    [{ kind: "draw-discard", draw: 3, discard: 2 }],
    [sleep(2)],
    [],
    null,
  ),
  spec(
    "Gamble",
    "common",
    2,
    [{ kind: "discard-hand", threshold: 3, draw: 4 }],
    [sleep(2)],
    [],
    null,
  ),
  spec(
    "Survey",
    "uncommon",
    3,
    [{ kind: "draw", count: 2 }],
    [sleep(2)],
    [],
    null,
  ),
  spec(
    "Insight",
    "rare",
    4,
    [{ kind: "draw-discard", draw: 3, discard: 1 }],
    [sleep(2)],
    [],
    null,
  ),
  spec(
    "Recall",
    "uncommon",
    3,
    [{ kind: "recover", count: 1 }],
    [],
    [],
    null,
  ),
  spec(
    "Slumber",
    "rare",
    4,
    [{ kind: "sleep-card", reshuffles: 4 }],
    [],
    [sleep(4)],
    null,
  ),
  spec(
    "Millionaire",
    "rare",
    4,
    [{ kind: "draw", count: 3 }],
    [pay(1), doubleCost],
    [halveCost],
    spec(
      "Millionaire+",
      "rare",
      4,
      [{ kind: "draw", count: 4 }],
      [pay(1), doubleCost],
      [halveCost],
      null,
    ),
  ),
  spec(
    "Foresight",
    "uncommon",
    3,
    [search(1)],
    [sleep(1)],
    [],
    spec("Foresight+", "uncommon", 3, [search(1)], [], [], null),
  ),
  spec(
    "Scout",
    "uncommon",
    3,
    [trivialTerrain(1)],
    [],
    [],
    spec(
      "Scout+",
      "uncommon",
      3,
      [trivialTerrain(2)],
      [sleep(1)],
      [],
      null,
    ),
  ),
  spec(
    "Hookshot",
    "rare",
    5,
    [teleport(8)],
    [sleep(2)],
    [],
    spec("Hookshot+", "rare", 5, [teleport(8)], [sleep(1)], [], null),
  ),
  spec("Upgrader", "uncommon", 3, [upgradeHand], [], [], null),

  // combat
  spec(
    "Ambush",
    "common",
    3,
    [move("grass", 2), { kind: "attack", range: 0 }],
    [],
    [],
    spec(
      "Ambush+",
      "common",
      3,
      [move("grass", 3), { kind: "attack", range: 1 }],
      [],
      [],
      null,
    ),
  ),
  spec("Volley", "common", 3, [{ kind: "attack", range: 3 }], [sleep(1)], [], null),
  spec("Silver", "uncommon", 6, [{ "kind": "attack", range: 8 },], [pay(10)], [], null),
  spec(
    "Charge",
    "uncommon",
    4,
    [move("grass", 5), { kind: "attack", range: 3 }],
    [sleep(1)],
    [],
    spec(
      "Charge+",
      "uncommon",
      4,
      [move("grass", 6), { kind: "attack", range: 3 }],
      [sleep(1)],
      [],
      null,
    ),
  ),

  // economy
  spec(
    "Trade",
    "common",
    2,
    [{ kind: "currency", amount: 2 }],
    [],
    [],
    spec("Trade+", "common", 2, [{ kind: "currency", amount: 3 }], [], [], null),
  ),
  spec(
    "Mine",
    "common",
    2,
    [move("mountain", 1)],
    [],
    [currency(1)],
    spec(
      "Mine+",
      "common",
      2,
      [move("mountain", 2)],
      [],
      [currency(2)],
      null,
    ),
  ),
];

function spec(
  name: string,
  rarity: Rarity,
  cost: number,
  modes: readonly CardMode[],
  onPlay: readonly CardEffect[],
  onDiscard: readonly CardEffect[],
  upgradedForm: CardSpec | null,
): CardSpec {
  return {
    name,
    image: "",
    cost,
    rarity,
    modes,
    onPlay,
    onDiscard,
    upgradedForm,
  };
}
