import { DIFFICULTY_SCALING } from "./config";
import type { Terrain } from "./terrain";

export type MoveMode =
  | { kind: "move"; terrain: Terrain; distance: number }
  | { kind: "move-current-terrain"; distance: number }
  | { kind: "hop"; maxCost: number }
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
  | { kind: "store" }
  | { kind: "unstore"; copies: boolean }
  | { kind: "wall"; radius: number }
  | { kind: "invention"; count: number; pool: InventionPool }
  | { kind: "escalate"; thisTurn: number; permanentReciprocal: number };

/** Which cards Invention may conjure. */
export type InventionPool = "all" | "uncommon-plus";

/**
 * Which form of the storage bin a spec is, and whether it is the upgraded form.
 * The two forms transform into each other, so the form is what `transformStorage`
 * reads to pick the target spec.
 */
export type StorageForm =
  "none" | "empty" | "empty-upgraded" | "full" | "full-upgraded";

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

/**
 * How often a shop offers a card. Only cards sold in shops carry a rarity, so
 * these are the only rarities: starting cards, upgraded forms and the storage
 * bins are never drawn.
 */
export type Rarity = "common" | "uncommon" | "rare";

/** Shop/gift draw weights, kept next to `Rarity`. */
export const RARITY_WEIGHT: Record<Rarity, number> = {
  common: 6,
  uncommon: 3,
  rare: 1,
};

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

export type Card = {
  id: string;
  name: string;
  image: string;
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
  /** Cards held inside a storage bin; empty for every other card. */
  stored: readonly Card[];
  /** True for a card conjured by Invention: it is removed when it leaves the hand. */
  temporary: boolean;
  /** Which storage-bin form this is, or `none` for every other card. */
  storage: StorageForm;
  /**
   * Reshuffles left before this card returns to the draw pile. A sleeping card
   * sits in the discard pile and is skipped by every reshuffle until the count
   * runs out. 0 means awake.
   */
  sleeping: number;
};

/**
 * A card definition. It holds everything needed to instantiate a `Card` except
 * shop pricing: a spec that is sold in a shop is a `ShopCardSpec`, which adds
 * the rarity and cost. Build one with `spec(...)`.
 */
export type CardSpec = {
  name: string;
  image: string;
  traits: readonly CardTrait[];
  modes: readonly CardMode[];
  onPlay: readonly CardEffect[];
  onDiscard: readonly CardEffect[];
  upgradedForm: CardSpec | null;
  /** Which storage-bin form this is, or `none` for every other card. */
  storage: StorageForm;
};

/** A `CardSpec` sold in shops, so it carries the rarity and price it sells for. */
export type ShopCardSpec = CardSpec & { rarity: Rarity; cost: number };

/** A card on offer in a shop, paired with the price it is sold for. */
export type ShopSlot = { card: Card; cost: number };

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
    traits: spec.traits,
    modes: spec.modes,
    onPlay: spec.onPlay,
    onDiscard: spec.onDiscard,
    upgradedForm: spec.upgradedForm,
    baseSpec: spec,
    temporaryUpgrade: false,
    stored: [],
    temporary: false,
    storage: spec.storage,
    sleeping: 0,
  };
}

/** A card conjured by Invention, removed from the deck when it leaves the hand. */
export function instantiateTemporary(spec: CardSpec, id: string): Card {
  return { ...instantiate(spec, id), temporary: true };
}

/** A temporary duplicate of `card` under a fresh id, removed when it leaves the hand. */
export function temporaryCopy(card: Card, id: string): Card {
  return { ...card, id, temporary: true };
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
  switch (mode.kind) {
    case "move":
    case "move-current-terrain":
      return mode.distance;
    case "hop":
      return 2;
    case "teleport":
      return mode.range;
  }
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

/**
 * The form the smith would turn `card` into, or `null` if it cannot be
 * upgraded. A card conjured by Invention is never upgradable, even if it has an
 * upgraded form. A card that is only temporarily upgraded upgrades into that
 * same form, permanently.
 */
export function upgradeTarget(card: Card): CardSpec | null {
  if (card.temporary) {
    return null;
  }
  if (card.temporaryUpgrade) {
    return card.baseSpec.upgradedForm;
  }
  return card.upgradedForm;
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

/**
 * Constructors for every playable `CardMode`. Grouped so that all the helpers
 * for a card's `modes` field sit together.
 */
const cardMoves = {
  move: (terrain: Terrain, distance: number): CardMode => ({
    kind: "move",
    terrain,
    distance,
  }),
  moveCurrentTerrain: (distance: number): CardMode => ({
    kind: "move-current-terrain",
    distance,
  }),
  hop: (maxCost: number): CardMode => ({ kind: "hop", maxCost }),
  teleport: (range: number): CardMode => ({ kind: "teleport", range }),
  attack: (range: number): CardMode => ({ kind: "attack", range }),
  drawDiscard: (draw: number, discard: number): CardMode => ({
    kind: "draw-discard",
    draw,
    discard,
  }),
  discardHand: (threshold: number, draw: number): CardMode => ({
    kind: "discard-hand",
    threshold,
    draw,
  }),
  draw: (count: number): CardMode => ({ kind: "draw", count }),
  recover: (count: number): CardMode => ({ kind: "recover", count }),
  currency: (amount: number): CardMode => ({ kind: "currency", amount }),
  sleepCard: (reshuffles: number): CardMode => ({
    kind: "sleep-card",
    reshuffles,
  }),
  search: (count: number): CardMode => ({ kind: "search", count }),
  trivialTerrain: (turns: number): CardMode => ({
    kind: "trivial-terrain",
    turns,
  }),
  upgradeHand: { kind: "upgrade-hand" } as const,
  store: { kind: "store" } as const,
  unstore: (copies: boolean): CardMode => ({ kind: "unstore", copies }),
  wall: (radius: number): CardMode => ({ kind: "wall", radius }),
  invention: (count: number, pool: InventionPool): CardMode => ({
    kind: "invention",
    count,
    pool,
  }),
  escalate: (thisTurn: number, permanentReciprocal: number): CardMode => ({
    kind: "escalate",
    thisTurn,
    permanentReciprocal,
  }),
};

/**
 * Constructors for every `CardEffect`. Grouped so that all the helpers for a
 * card's `onPlay` and `onDiscard` fields sit together.
 */
const cardEffects = {
  currency: (amount: number): CardEffect => ({ kind: "currency", amount }),
  sleep: (reshuffles: number): CardEffect => ({
    kind: "sleep",
    reshuffles,
  }),
  pay: (amount: number): CardEffect => ({ kind: "pay", amount }),
  doubleCost: { kind: "double-cost" } as const,
  halveCost: { kind: "halve-cost" } as const,
  draw: (count: number): CardEffect => ({ kind: "draw", count }),
};

/**
 * The mutable state a spec builder accumulates. Chainable methods edit it in
 * place and `build` snapshots it into a plain `CardSpec`.
 */
type SpecDraft = {
  name: string;
  modes: readonly CardMode[];
  image: string;
  traits: CardTrait[];
  onPlay: CardEffect[];
  onDiscard: CardEffect[];
  upgradedForm: CardSpec | null;
  storage: StorageForm;
};

function emptyDraft(name: string, modes: readonly CardMode[]): SpecDraft {
  return {
    name,
    modes,
    image: "",
    traits: [],
    onPlay: [],
    onDiscard: [],
    upgradedForm: null,
    storage: "none",
  };
}

/**
 * Fluent builder for a `CardSpec`. Only the name and the playable modes are
 * required; every other property is added by the method that applies to that
 * card, so each spec reads as just the lines it needs.
 *
 * A spec that is sold in a shop additionally calls `shopStatus`, which returns
 * a `ShopCardSpecBuilder` whose `build` carries the rarity and price.
 */
export class CardSpecBuilder {
  protected readonly draft: SpecDraft;

  constructor(draft: SpecDraft) {
    this.draft = draft;
  }

  /** Set the card art; unset specs render as a blank placeholder. */
  withImage(image: string): this {
    this.draft.image = image;
    return this;
  }

  /** Add effects that fire when the card is played, alongside its mode. */
  withPlayEffect(...effects: CardEffect[]): this {
    this.draft.onPlay.push(...effects);
    return this;
  }

  /** Add effects that fire when the card is discarded by hand. */
  withDiscardEffect(...effects: CardEffect[]): this {
    this.draft.onDiscard.push(...effects);
    return this;
  }

  /** Add rule-bending traits, shown as badges on the card face. */
  withTrait(...traits: CardTrait[]): this {
    this.draft.traits.push(...traits);
    return this;
  }

  /** Set the upgraded form the smith can turn this card into. */
  withUpgradedForm(form: CardSpec): this {
    this.draft.upgradedForm = form;
    return this;
  }

  /** Set which storage-bin form this is, for the two storage bins only. */
  withStorage(form: StorageForm): this {
    this.draft.storage = form;
    return this;
  }

  /** Mark the card as sold in shops, with a draw rarity and a price. */
  shopStatus(rarity: Rarity, cost: number): ShopCardSpecBuilder {
    return new ShopCardSpecBuilder(this.draft, rarity, cost);
  }

  /** Snapshot the accumulated properties into a plain spec object. */
  build(): CardSpec {
    return {
      name: this.draft.name,
      image: this.draft.image,
      traits: [...this.draft.traits],
      modes: this.draft.modes,
      onPlay: [...this.draft.onPlay],
      onDiscard: [...this.draft.onDiscard],
      upgradedForm: this.draft.upgradedForm,
      storage: this.draft.storage,
    };
  }
}

/** A `CardSpecBuilder` whose `build` adds the shop rarity and price. */
class ShopCardSpecBuilder extends CardSpecBuilder {
  private readonly rarity: Rarity;
  private readonly cost: number;

  constructor(draft: SpecDraft, rarity: Rarity, cost: number) {
    super(draft);
    this.rarity = rarity;
    this.cost = cost;
  }

  override build(): ShopCardSpec {
    return { ...super.build(), rarity: this.rarity, cost: this.cost };
  }
}

/** Start building a card spec from its name and playable modes. */
export function spec(
  name: string,
  modes: readonly CardMode[],
): CardSpecBuilder {
  return new CardSpecBuilder(emptyDraft(name, modes));
}

/**
 * The four forms of the storage bin. Empty and full transform into each other,
 * and the upgraded pair stays upgraded across the swap. Only the empty form is
 * sold; the full forms are never offered.
 */
const STORAGE_EMPTY_UPGRADED_SPEC: CardSpec = spec("Storage Bin (Empty)+", [
  cardMoves.store,
])
  .withStorage("empty-upgraded")
  .build();

export const STORAGE_EMPTY_SPEC: ShopCardSpec = spec("Storage Bin (Empty)", [
  cardMoves.store,
])
  .shopStatus("rare", 4)
  .withUpgradedForm(STORAGE_EMPTY_UPGRADED_SPEC)
  .withStorage("empty")
  .build();

const STORAGE_FULL_UPGRADED_SPEC: CardSpec = spec("Storage Bin (Full)+", [
  cardMoves.unstore(true),
])
  .withStorage("full-upgraded")
  .build();

export const STORAGE_FULL_SPEC: CardSpec = spec("Storage Bin (Full)", [
  cardMoves.unstore(false),
])
  .withUpgradedForm(STORAGE_FULL_UPGRADED_SPEC)
  .withStorage("full")
  .build();

const STORAGE_TRANSFORM: Record<StorageForm, CardSpec | null> = {
  none: null,
  empty: STORAGE_FULL_SPEC,
  "empty-upgraded": STORAGE_FULL_UPGRADED_SPEC,
  full: STORAGE_EMPTY_SPEC,
  "full-upgraded": STORAGE_EMPTY_UPGRADED_SPEC,
};

/** Swap a storage bin to its other form, keeping its id and setting `stored`. */
export function transformStorage(card: Card, stored: readonly Card[]): Card {
  const target = STORAGE_TRANSFORM[card.storage];
  if (target === null) {
    return card;
  }
  return { ...instantiate(target, card.id), stored };
}

// Escalation replaces the old turn-number enemy-speed ramp: it cannot be
// discarded or removed, and while it is in hand no other card may be played, so
// each time it is drawn the player must pay the enemy-speed tax first.
const ESCALATION_SPEC: CardSpec = spec("Escalation", [cardMoves.escalate(1, 7)])
  .withTrait("must-play-first", "indestructible", "shy")
  .build();

export const STARTING_DECK: readonly CardSpec[] = [
  // In turn-scaling mode the ramp is the turn number itself, so the card would
  // have nothing to do and is left out of the deck.
  ...(DIFFICULTY_SCALING === "card" ? [ESCALATION_SPEC] : []),
  spec("Tredge", [cardMoves.move("grass", 1)])
    .withUpgradedForm(spec("Tredge+", [cardMoves.move("grass", 2)]).build())
    .build(),
  spec("Tredge", [cardMoves.move("grass", 1)])
    .withUpgradedForm(spec("Tredge+", [cardMoves.move("grass", 2)]).build())
    .build(),
  spec("Walk", [cardMoves.move("grass", 3)])
    .withUpgradedForm(spec("Walk+", [cardMoves.move("grass", 4)]).build())
    .build(),
  spec("Blaze", [cardMoves.move("forest", 1)])
    .withUpgradedForm(spec("Blaze+", [cardMoves.move("forest", 2)]).build())
    .build(),
  spec("Stab", [cardMoves.attack(1)])
    .withPlayEffect(cardEffects.sleep(2))
    .withDiscardEffect(cardEffects.sleep(2))
    .withUpgradedForm(
      spec("Stab+", [cardMoves.attack(2)])
        .withPlayEffect(cardEffects.sleep(2))
        .withDiscardEffect(cardEffects.sleep(2))
        .build(),
    )
    .build(),
];

export const SHOP_CATALOGUE: readonly ShopCardSpec[] = [
  // basic movement
  spec("Stride", [cardMoves.move("grass", 4)])
    .shopStatus("common", 2)
    .withUpgradedForm(spec("Stride+", [cardMoves.move("grass", 5)]).build())
    .build(),
  spec("Sprint", [cardMoves.move("grass", 8)])
    .shopStatus("uncommon", 4)
    .withUpgradedForm(spec("Sprint+", [cardMoves.move("grass", 9)]).build())
    .build(),
  spec("Wade", [cardMoves.move("water", 1)])
    .shopStatus("common", 2)
    .withUpgradedForm(spec("Wade+", [cardMoves.move("water", 2)]).build())
    .build(),
  spec("Swim", [cardMoves.move("water", 2)])
    .shopStatus("uncommon", 3)
    .withUpgradedForm(spec("Swim+", [cardMoves.move("water", 3)]).build())
    .build(),
  spec("Climb", [cardMoves.move("mountain", 1)])
    .shopStatus("uncommon", 3)
    .withUpgradedForm(spec("Climb+", [cardMoves.move("mountain", 2)]).build())
    .build(),

  // combination movement
  spec("Thicket", [cardMoves.move("grass", 1), cardMoves.move("forest", 1)])
    .shopStatus("common", 2)
    .withUpgradedForm(
      spec("Thicket+", [
        cardMoves.move("grass", 2),
        cardMoves.move("forest", 2),
      ]).build(),
    )
    .build(),
  spec("Ford", [cardMoves.move("grass", 1), cardMoves.move("water", 1)])
    .shopStatus("common", 2)
    .withUpgradedForm(
      spec("Ford+", [
        cardMoves.move("grass", 2),
        cardMoves.move("water", 2),
      ]).build(),
    )
    .build(),
  spec("Ridge", [cardMoves.move("forest", 1), cardMoves.move("mountain", 1)])
    .shopStatus("uncommon", 3)
    .withUpgradedForm(
      spec("Ridge+", [
        cardMoves.move("forest", 2),
        cardMoves.move("mountain", 2),
      ]).build(),
    )
    .build(),
  spec("Trail", [cardMoves.move("grass", 3), cardMoves.move("forest", 2)])
    .shopStatus("uncommon", 3)
    .withUpgradedForm(
      spec("Trail+", [
        cardMoves.move("grass", 4),
        cardMoves.move("forest", 3),
      ]).build(),
    )
    .build(),
  spec("Ravine", [
    cardMoves.move("forest", 1),
    cardMoves.move("water", 1),
    cardMoves.move("mountain", 2),
  ])
    .shopStatus("uncommon", 4)
    .withUpgradedForm(
      spec("Ravine+", [
        cardMoves.move("forest", 2),
        cardMoves.move("water", 2),
        cardMoves.move("mountain", 3),
      ]).build(),
    )
    .build(),
  spec("Moor", [cardMoves.move("grass", 5), cardMoves.move("forest", 3)])
    .shopStatus("uncommon", 4)
    .withUpgradedForm(
      spec("Moor+", [
        cardMoves.move("grass", 6),
        cardMoves.move("forest", 4),
      ]).build(),
    )
    .build(),
  spec("Delta", [
    cardMoves.move("grass", 6),
    cardMoves.move("water", 2),
    cardMoves.move("mountain", 1),
  ])
    .shopStatus("rare", 6)
    .withUpgradedForm(
      spec("Delta+", [
        cardMoves.move("grass", 7),
        cardMoves.move("water", 3),
        cardMoves.move("mountain", 2),
      ]).build(),
    )
    .build(),

  // hand management
  spec("Forage", [cardMoves.drawDiscard(3, 2)])
    .shopStatus("common", 2)
    .withPlayEffect(cardEffects.sleep(2))
    .build(),
  spec("Gamble", [cardMoves.discardHand(3, 4)])
    .shopStatus("common", 2)
    .withPlayEffect(cardEffects.sleep(2))
    .build(),
  spec("Survey", [cardMoves.draw(2)])
    .shopStatus("uncommon", 3)
    .withPlayEffect(cardEffects.sleep(2))
    .build(),
  spec("Insight", [cardMoves.drawDiscard(3, 1)])
    .shopStatus("rare", 4)
    .withPlayEffect(cardEffects.sleep(2))
    .build(),
  spec("Recall", [cardMoves.recover(1)])
    .shopStatus("uncommon", 3)
    .build(),
  spec("Slumber", [cardMoves.sleepCard(4)])
    .shopStatus("rare", 4)
    .withDiscardEffect(cardEffects.sleep(4))
    .build(),
  spec("Millionaire", [cardMoves.draw(3)])
    .shopStatus("rare", 4)
    .withPlayEffect(cardEffects.pay(1), cardEffects.doubleCost)
    .withDiscardEffect(cardEffects.halveCost)
    .withUpgradedForm(
      spec("Millionaire+", [cardMoves.draw(4)])
        .withPlayEffect(cardEffects.pay(1), cardEffects.doubleCost)
        .withDiscardEffect(cardEffects.halveCost)
        .build(),
    )
    .build(),
  spec("Foresight", [cardMoves.search(1)])
    .shopStatus("uncommon", 3)
    .withPlayEffect(cardEffects.sleep(1))
    .withUpgradedForm(spec("Foresight+", [cardMoves.search(1)]).build())
    .build(),
  spec("Scout", [cardMoves.trivialTerrain(1)])
    .shopStatus("uncommon", 3)
    .withDiscardEffect(cardEffects.draw(1))
    .withUpgradedForm(
      spec("Scout+", [cardMoves.trivialTerrain(2)])
        .withPlayEffect(cardEffects.sleep(1))
        .withDiscardEffect(cardEffects.draw(1))
        .build(),
    )
    .build(),
  spec("Hookshot", [cardMoves.teleport(8)])
    .shopStatus("rare", 5)
    .withPlayEffect(cardEffects.sleep(2))
    .withUpgradedForm(
      spec("Hookshot+", [cardMoves.teleport(8)])
        .withPlayEffect(cardEffects.sleep(1))
        .build(),
    )
    .build(),
  spec("Upgrader", [cardMoves.upgradeHand])
    .shopStatus("uncommon", 3)
    .withDiscardEffect(cardEffects.draw(1))
    .build(),

  // storage & conjuring
  STORAGE_EMPTY_SPEC,
  spec("Invention", [cardMoves.invention(3, "all")])
    .shopStatus("rare", 4)
    .withUpgradedForm(
      spec("Invention+", [cardMoves.invention(2, "uncommon-plus")]).build(),
    )
    .build(),

  // special movement
  spec("Monotony", [cardMoves.moveCurrentTerrain(3)])
    .shopStatus("uncommon", 3)
    .withUpgradedForm(
      spec("Monotony+", [cardMoves.moveCurrentTerrain(4)]).build(),
    )
    .build(),
  spec("Hop", [cardMoves.hop(1)])
    .shopStatus("uncommon", 3)
    .withUpgradedForm(spec("Hop+", [cardMoves.hop(2)]).build())
    .build(),
  spec("Wall", [cardMoves.wall(2)])
    .shopStatus("rare", 5)
    .withPlayEffect(cardEffects.pay(4), cardEffects.sleep(1))
    .withUpgradedForm(
      spec("Wall+", [cardMoves.wall(2)])
        .withPlayEffect(cardEffects.pay(2), cardEffects.sleep(1))
        .build(),
    )
    .build(),

  // combat
  spec("Ambush", [cardMoves.move("grass", 2), cardMoves.attack(0)])
    .shopStatus("common", 3)
    .withUpgradedForm(
      spec("Ambush+", [
        cardMoves.move("grass", 3),
        cardMoves.attack(1),
      ]).build(),
    )
    .build(),
  spec("Volley", [cardMoves.attack(3)])
    .shopStatus("common", 3)
    .withPlayEffect(cardEffects.sleep(1))
    .build(),
  spec("Silver", [cardMoves.attack(8)])
    .shopStatus("uncommon", 6)
    .withPlayEffect(cardEffects.pay(7))
    .build(),
  spec("Charge", [cardMoves.attack(3)])
    .shopStatus("uncommon", 4)
    .withPlayEffect(cardEffects.sleep(1))
    .withDiscardEffect(cardEffects.draw(1))
    .withUpgradedForm(
      spec("Charge+", [cardMoves.move("grass", 6), cardMoves.attack(3)])
        .withPlayEffect(cardEffects.sleep(1))
        .build(),
    )
    .build(),

  // economy
  spec("Trade", [cardMoves.currency(2)])
    .shopStatus("common", 2)
    .withUpgradedForm(spec("Trade+", [cardMoves.currency(3)]).build())
    .build(),
  spec("Mine", [cardMoves.move("mountain", 1)])
    .shopStatus("common", 2)
    .withDiscardEffect(cardEffects.currency(1))
    .withUpgradedForm(
      spec("Mine+", [cardMoves.move("mountain", 2)])
        .withDiscardEffect(cardEffects.currency(2))
        .build(),
    )
    .build(),
];
