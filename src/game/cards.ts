import { DIFFICULTY_SCALING } from "./config";
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
  | { kind: "upgrade-hand" }
  | { kind: "escalate"; thisTurn: number; permanentReciprocal: number };

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
  | { kind: "halve-cost" }
  | { kind: "draw"; count: number };

export type Rarity = "starting" | "common" | "uncommon" | "rare";

/**
 * A rule-bending property a card carries. Traits are shown as badges on the
 * card face and enforced by the game rules, and any card may carry any of them.
 *
 * - `must-play-first`: no other card may be played while this one is in hand,
 *   and this card can never be discarded.
 * - `indestructible`: the card can never be destroyed (removed from the deck)
 *   or put to sleep.
 * - `shy`: whenever the deck is shuffled, this card sinks to the bottom, so it
 *   is the last card drawn. This covers the opening deal as well as every
 *   reshuffle.
 */
export type CardTrait = "must-play-first" | "indestructible" | "shy";

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
  traits: readonly CardTrait[];
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
  traits: readonly CardTrait[];
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
    traits: spec.traits,
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

/** Whether `card` carries `trait`. */
export function hasTrait(card: Card, trait: CardTrait): boolean {
  return card.traits.includes(trait);
}

/**
 * A card that must be played before any other card in the hand and can never be
 * discarded. While one is in hand it gates every other play, so the player pays
 * its cost before acting.
 */
export function mustPlayFirst(card: Card): boolean {
  return hasTrait(card, "must-play-first");
}

/** A card that can never be destroyed (removed) or put to sleep. */
export function isIndestructible(card: Card): boolean {
  return hasTrait(card, "indestructible");
}

/** A card that always sinks to the bottom of the draw pile when reshuffled. */
export function isShy(card: Card): boolean {
  return hasTrait(card, "shy");
}

/** Whether a must-play-first card in `hand` blocks playing `card` right now. */
export function blockedByPriority(hand: readonly Card[], card: Card): boolean {
  return !mustPlayFirst(card) && hand.some(mustPlayFirst);
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
    // Traits belong to the card's identity, so an upgrade keeps them.
    traits: card.traits,
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

const drawEffect = (count: number): CardEffect => ({ kind: "draw", count });

const doubleCost: CardEffect = { kind: "double-cost" };

const halveCost: CardEffect = { kind: "halve-cost" };

const search = (count: number): CardMode => ({ kind: "search", count });

const trivialTerrain = (turns: number): CardMode => ({
  kind: "trivial-terrain",
  turns,
});

const upgradeHand: CardMode = { kind: "upgrade-hand" };

const teleport = (range: number): CardMode => ({ kind: "teleport", range });

// Escalation replaces the old turn-number enemy-speed ramp: it cannot be
// discarded or removed, and while it is in hand no other card may be played, so
// each time it is drawn the player must pay the enemy-speed tax first.
const ESCALATION_SPEC: CardSpec = withTraits(
  spec(
    "Escalation",
    "starting",
    0,
    [{ kind: "escalate", thisTurn: 1, permanentReciprocal: 7 }],
    [],
    [],
    null,
  ),
  ["must-play-first", "indestructible", "shy"],
);

export const STARTING_DECK: readonly CardSpec[] = [
  // In turn-scaling mode the ramp is the turn number itself, so the card would
  // have nothing to do and is left out of the deck.
  ...(DIFFICULTY_SCALING === "card" ? [ESCALATION_SPEC] : []),
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
    [{ kind: "sleep", reshuffles: 2 }],
    [{ kind: "sleep", reshuffles: 2 }],
    spec(
      "Stab+",
      "starting",
      0,
      [{ kind: "attack", range: 2 }],
      [{ kind: "sleep", reshuffles: 2 }],
      [{ kind: "sleep", reshuffles: 2 }],
      null,
    ),
  ),
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
  spec("Recall", "uncommon", 3, [{ kind: "recover", count: 1 }], [], [], null),
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
    [drawEffect(1)],
    spec(
      "Scout+",
      "uncommon",
      3,
      [trivialTerrain(2)],
      [sleep(1)],
      [drawEffect(1)],
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
  spec("Upgrader", "uncommon", 3, [upgradeHand], [], [drawEffect(1)], null),

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
  spec(
    "Volley",
    "common",
    3,
    [{ kind: "attack", range: 3 }],
    [sleep(1)],
    [],
    null,
  ),
  spec(
    "Silver",
    "uncommon",
    6,
    [{ kind: "attack", range: 8 }],
    [pay(7)],
    [],
    null,
  ),
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
    spec(
      "Trade+",
      "common",
      2,
      [{ kind: "currency", amount: 3 }],
      [],
      [],
      null,
    ),
  ),
  spec(
    "Mine",
    "common",
    2,
    [move("mountain", 1)],
    [],
    [currency(1)],
    spec("Mine+", "common", 2, [move("mountain", 2)], [], [currency(2)], null),
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
    traits: [],
    modes,
    onPlay,
    onDiscard,
    upgradedForm,
  };
}

/** Attach traits to a spec built by `spec`, which starts with none. */
function withTraits(spec: CardSpec, traits: readonly CardTrait[]): CardSpec {
  return { ...spec, traits };
}
