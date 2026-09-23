# 08 — Economy & upgrades

**Goal:** currency, shops, the smith, card removal, card gain, and the coin tile —
all driven by the "end your turn on a feature to use it" rule, with the end-turn
button becoming a "use upgrade" button.

## 1. Currency

Every source of currency, in one place:

| Source | Rule |
| ------ | ---- |
| Currency card | `{ kind: "currency", amount }` mode pays immediately. |
| Passing a turn | Ending a turn without playing a card gives 1 (anti-softlock; applied in chapter 04). |
| Killing an enemy | `bountyFor(enemy)` from chapter 07. |
| Coin tile | A `{ kind: "coin", value }` feature collected when used. |

Currency is a plain number on `GameState`. Mutate it only through small helpers so
the sources stay auditable:

```ts
export function gainCurrency(state: GameState, amount: number): GameState {
  if (amount < 0) {
    throw new Error("negative currency gain");
  }
  return { ...state, currency: state.currency + amount };
}

export function spendCurrency(state: GameState, amount: number): GameState {
  if (amount > state.currency) {
    throw new Error("cannot afford purchase");
  }
  return { ...state, currency: state.currency - amount };
}
```

## 2. "End your turn on a feature to use it"

A feature is only usable when the player's hex has one. The HUD asks the game which
button to show:

```ts
import type { TileFeature } from "./terrain";

export type EndTurnAction =
  | { kind: "end-turn" }
  | { kind: "use-feature"; feature: TileFeature };

export function endTurnAction(feature: TileFeature): EndTurnAction {
  if (feature.kind === "none") {
    return { kind: "end-turn" };
  }
  return { kind: "use-feature", feature };
}
```

So the design's "The end turn button will be replaced by a 'use upgrade' button" is
literally `endTurnAction(tile.feature)`. Note that `coin` is a feature too, so a coin
tile also replaces the button (collecting is the "use"). If you would rather coins be
auto-collected on arrival, handle `coin` before this function — but then the tile is
never really "used". **Confirm which you prefer.**

## 3. Weighted rarity

Shops and gain-card spaces are "biassed by rarity". Keep the weights next to the
rarity type:

```ts
import type { Rarity } from "./cards";

export const RARITY_WEIGHT: Record<Rarity, number> = {
  starting: 0,
  common: 6,
  uncommon: 3,
  rare: 1,
};
```

`starting` is 0 so it can never be drawn even if a `starting` spec leaked into a
pool — belt-and-braces on top of keeping `STARTING_DECK` out of `SHOP_CATALOGUE`.

```ts
import type { CardSpec } from "./cards";
import type { Rng } from "./rng";
import { nextRng } from "./rng";

export function pickWeightedCard(
  pool: readonly CardSpec[],
  rng: Rng,
): { spec: CardSpec; rng: Rng } {
  const total = pool.reduce((sum, spec) => sum + RARITY_WEIGHT[spec.rarity], 0);
  if (total <= 0) {
    throw new Error("empty card pool");
  }
  const roll = nextRng(rng);
  let remaining = roll.value * total;
  for (const spec of pool) {
    remaining -= RARITY_WEIGHT[spec.rarity];
    if (remaining <= 0) {
      return { spec, rng: roll.rng };
    }
  }
  return { spec: pool[pool.length - 1], rng: roll.rng };
}
```

## 4. Shops

"Shops stock 3 cards ... and you can also spend money to reroll what the shop
sells." Roll a stock of 3 (allowing duplicates is fine, or de-duplicate if you
prefer). Entering the shop phase generates the stock; rerolling pays `rerollCost` and
generates a new one.

```ts
export function rollShopStock(
  pool: readonly CardSpec[],
  count: number,
  rng: Rng,
): { stock: CardSpec[]; rng: Rng } {
  let current = rng;
  const stock: CardSpec[] = [];
  for (let i = 0; i < count; i += 1) {
    const rolled = pickWeightedCard(pool, current);
    stock.push(rolled.spec);
    current = rolled.rng;
  }
  return { stock, rng: current };
}
```

Buying instantiates the spec, pays its `cost`, and — crucially — adds it to the
**discard** pile (chapter 03), not the hand:

```ts
export function buyCard(state: GameState, spec: CardSpec): GameState {
  const paid = spendCurrency(state, spec.cost);
  const card = instantiate(spec, paid.ids());
  return { ...paid, deck: addPurchase(paid.deck, card) };
}
```

When a shop section is stamped during generation (chapter 05), fill its
`{ kind: "shop", stock, rerollCost }` from `rollShopStock`. Because stock is part of
the tile, leaving and returning to a shop shows the same cards.

## 5. The smith

"Upgrade a card, generally adding +1 to movement. The range of combat cards can not
be upgraded." So the upgrade targets only `move` modes, never `attack`:

```ts
import type { Card, CardMode } from "./cards";

export function upgradeCard(card: Card): Card {
  const modes = card.modes.map((mode): CardMode => {
    if (mode.kind === "move") {
      return { kind: "move", terrain: mode.terrain, distance: mode.distance + 1 };
    }
    return mode;
  });
  return { ...card, modes };
}
```

For a *combination* card (several move modes), the loop above would bump all of
them, which is probably too strong. Two options:

1. Bump only the first/highest-distance move mode (deterministic, no extra UI).
2. Let the player choose which mode to upgrade.

Pick one; option 1 is the smaller change and matches "generally adding +1 to
movement". **Confirm.**

A combat card whose only mode is `attack` is unaffected by `upgradeCard`, which is
exactly the design's "the range of combat cards cannot be upgraded" — enforced by
construction rather than by a guard.

## 6. Removing a card

Removing is rare and removes a card from the deck **entirely** — from hand, draw, or
discard:

```ts
import type { Deck } from "./deck";

export function removeCardFromDeck(deck: Deck, cardId: string): Deck {
  const strip = (cards: readonly Card[]): Card[] => cards.filter((c) => c.id !== cardId);
  return { draw: strip(deck.draw), hand: strip(deck.hand), discard: strip(deck.discard) };
}
```

`remove-card` features are placed only on high-difficulty sections (chapter 05).

## 7. Gaining a card

"Gives you a random card (uncommon and up). Player can choose to take it and leave
it." Roll from the shop pool restricted to `uncommon`/`rare`:

```ts
export function rollGift(pool: readonly CardSpec[], rng: Rng): { spec: CardSpec; rng: Rng } {
  const eligible = pool.filter((spec) => spec.rarity === "uncommon" || spec.rarity === "rare");
  if (eligible.length === 0) {
    throw new Error("no eligible gift cards");
  }
  return pickWeightedCard(eligible, rng);
}
```

Taking it uses `addPurchase` (it goes to discard, like a shop buy) and costs nothing;
leaving it is a no-op. Either way the feature is consumed for that visit — decide
whether a gain-card tile can be used again after being left (the design is silent;
re-rolling each visit is friendlier). **Confirm.**

## 8. Coin tiles

A `{ kind: "coin", value }` feature pays `value` and is consumed. Represent
consumption by switching the tile's feature to `{ kind: "none" }`:

```ts
export function collectCoin(state: GameState, coord: HexCoord): GameState {
  const key = hexKey(coord);
  const tile = state.map.tiles.get(key);
  if (tile === undefined || tile.feature.kind !== "coin") {
    throw new Error("no coin here");
  }
  const tiles = new Map(state.map.tiles);
  tiles.set(key, { ...tile, feature: { kind: "none" } });
  return gainCurrency({ ...state, map: { ...state.map, tiles } }, tile.feature.value);
}
```

Shops and smiths are *not* consumed (you can revisit while you are standing there);
coins and one-shot gains are.

## 9. Phases and the UI seam

Each feature maps to a `Phase` from chapter 00:

| Feature | `Phase` |
| ------- | ------- |
| `shop` | `{ kind: "shop", stock, rerollCost }` |
| `smith` | `{ kind: "smith" }` — the UI lists the deck's cards and clicking one upgrades it |
| `remove-card` | a `pending-remove` phase listing the deck |
| `gain-card` | a `pending-gain` phase with the rolled spec |
| `coin` | resolves immediately (no phase) |

The rule again: the UI may only *display* the phase and forward a choice; every
transition above lives in `game/economy.ts`.

## 10. Milestone

- Ending on a coin tile pays out and consumes the coin; the tile becomes plain.
- A shop offers 3 rarity-weighted cards, charges for rerolls, and buys into the
  discard pile.
- The smith adds +1 to a movement mode and never touches attack range.
- Removal deletes a card from every zone; gain adds an uncommon/rare to discard.
- The end-turn button becomes "use upgrade" exactly when standing on a feature.

Next: [UI & graphics](09-ui-and-graphics.md).
