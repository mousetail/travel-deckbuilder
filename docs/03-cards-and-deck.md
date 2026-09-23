# 03 — Cards, deck, and rarities

**Goal:** a complete, type-safe card model that expresses *every* card in the design
doc with the same tagged-union style, a card catalogue, and the draw/hand/discard
zones with correct reshuffle-on-empty behaviour.

## 1. One mode type to rule them all

The design doc's cards look different (movement, hand management, combat, economy),
but they all reduce to the same idea: **a card offers one or more modes, you pick
exactly one mode when you play it.**

- "Grass 6/Water 2/Mountain 1" — three move modes; play as one of them.
- "2 Grass/0 attack" — a move mode and an attack mode.
- "1 mountain/1 currency" — a move mode and a currency mode.

So model `CardMode` as a single union and store an array on the card. This is both
simpler and more faithful than four separate card classes.

`src/game/cards.ts`:

```ts
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

export type Card = {
  id: string;
  name: string;
  image: string;   // placeholder until real art exists
  cost: number;    // shop price in currency
  rarity: Rarity;
  modes: readonly CardMode[];
};
```

Each mode's meaning:

| `kind` | Effect |
| ------ | ------ |
| `move` | Move up to `distance` steps across `terrain` (and dirt). |
| `attack` | Kill one enemy within `range` hexes (`0` = same hex). |
| `draw-discard` | Draw `draw` cards, then discard `discard` of them. |
| `discard-hand` | If your hand has ≥ `threshold` cards, discard the whole hand and draw `draw`. |
| `draw` | Draw `count` cards. |
| `recover` | Take `count` card(s) from the discard pile into your hand. |
| `currency` | Gain `amount` currency. |

## 2. Card specs vs. card instances

Cards need stable ids so the UI can track individual DOM nodes and so an upgrade
(chapter 08) can apply to *one* physical card. Keep templates (specs) separate from
instances:

```ts
export type CardSpec = {
  name: string;
  image: string;
  cost: number;
  rarity: Rarity;
  modes: readonly CardMode[];
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
  };
}
```

## 3. The catalogue

Transcribe the design doc's card list into specs. Movement costs are the guide's
proposal (tune later); what matters is the structure.

```ts
const move = (terrain: Terrain, distance: number): CardMode => ({ kind: "move", terrain, distance });

export const STARTING_DECK: readonly CardSpec[] = [
  spec("Tredge", "starting", 0, [move("grass", 1)]),
  spec("Tredge", "starting", 0, [move("grass", 1)]),
  spec("Walk",   "starting", 0, [move("grass", 3)]),
  spec("Blaze",  "starting", 0, [move("forest", 1)]),
];

export const SHOP_CATALOGUE: readonly CardSpec[] = [
  // basic movement
  spec("Stride",  "common",   2, [move("grass", 4)]),
  spec("Marathon","uncommon", 3, [move("grass", 6)]),
  spec("Sprint",  "uncommon", 4, [move("grass", 8)]),
  spec("Wade",    "common",   2, [move("water", 1)]),
  spec("Swim",    "uncommon", 3, [move("water", 2)]),
  spec("Climb",   "uncommon", 3, [move("mountain", 1)]),

  // combination movement
  spec("Thicket", "common",   2, [move("grass", 1), move("forest", 1)]),
  spec("Ford",    "common",   2, [move("grass", 1), move("water", 1)]),
  spec("Ridge",   "uncommon", 3, [move("forest", 1), move("mountain", 1)]),
  spec("Trail",   "uncommon", 3, [move("grass", 3), move("forest", 1)]),
  spec("Ravine",  "uncommon", 4, [move("forest", 1), move("water", 1), move("mountain", 1)]),
  spec("Moor",    "uncommon", 4, [move("grass", 5), move("forest", 3)]),
  spec("Delta",   "rare",     6, [move("grass", 6), move("water", 2), move("mountain", 1)]),

  // hand management
  spec("Forage",  "common",   2, [{ kind: "draw-discard", draw: 3, discard: 2 }]),
  spec("Gamble",  "common",   2, [{ kind: "discard-hand", threshold: 3, draw: 4 }]),
  spec("Scout",   "uncommon", 3, [{ kind: "draw", count: 2 }]),
  spec("Insight", "rare",     4, [{ kind: "draw-discard", draw: 3, discard: 1 }]),
  spec("Recall",  "uncommon", 3, [{ kind: "recover", count: 1 }]),

  // combat
  spec("Ambush",  "common",   3, [move("grass", 2), { kind: "attack", range: 0 }]),
  spec("Volley",  "common",   3, [{ kind: "attack", range: 3 }]),
  spec("Charge",  "uncommon", 4, [move("grass", 5), { kind: "attack", range: 3 }]),

  // economy
  spec("Trade",   "common",   2, [{ kind: "currency", amount: 2 }]),
  spec("Mine",    "common",   2, [move("mountain", 1), { kind: "currency", amount: 1 }]),
];

function spec(
  name: string,
  rarity: Rarity,
  cost: number,
  modes: readonly CardMode[],
): CardSpec {
  return { name, image: "", cost, rarity, modes };
}
```

Rules encoded here, straight from the design:

- **Starting cards never appear in shops.** They live in `STARTING_DECK`, not
  `SHOP_CATALOGUE`, so the shop code (chapter 08) can only ever draw from the shop
  list. That is the type-safe way to enforce "starting cards never appear in shops
  or on the map": there is no code path that can put them there.
- **Rarity** drives shop weighting (chapter 08) and map feature placement
  (chapter 05). `starting` is deliberately in the same enum so nothing can be
  offered by rarity-agnostic code.

`image: ""` is the placeholder the design asks for; the UI draws a coloured block
when `image` is empty.

## 4. Deck zones

`src/game/deck.ts`. The only tricky rule is: **bought/gained cards enter the discard
pile, and the discard is reshuffled only when the draw pile is empty.**

```ts
import type { Card, IdFactory } from "./cards";
import { instantiate } from "./cards";
import type { CardSpec } from "./cards";
import type { Rng } from "./rng";
import { nextRng } from "./rng";

export type Deck = {
  draw: Card[];
  hand: Card[];
  discard: Card[];
};

export function buildDeck(specs: readonly CardSpec[], ids: IdFactory, rng: Rng): Deck {
  const cards = specs.map((s) => instantiate(s, ids()));
  return { draw: shuffle(cards, rng), hand: [], discard: [] };
}

export function shuffle(cards: readonly Card[], rng: Rng): Card[] {
  const result = [...cards];
  let current = rng;
  for (let i = result.length - 1; i > 0; i -= 1) {
    const roll = nextRng(current);
    current = roll.rng;
    const j = Math.floor(roll.value * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return result;
}
```

Drawing moves cards, reshuffling the discard in when needed:

```ts
export type DeckMutation = { deck: Deck; rng: Rng };

export function drawCards(deck: Deck, count: number, rng: Rng): DeckMutation {
  let draw = [...deck.draw];
  let discard = [...deck.discard];
  let hand = [...deck.hand];
  let current = rng;

  for (let i = 0; i < count; i += 1) {
    if (draw.length === 0) {
      if (discard.length === 0) {
        break; // nothing left anywhere; draw fewer cards
      }
      const reshuffled = shuffle(discard, current);
      draw = reshuffled;
      discard = [];
    }
    const card = draw.pop();
    if (card === undefined) {
      break;
    }
    hand.push(card);
  }

  return { deck: { draw, hand, discard }, rng: current };
}
```

Two helper mutations you will reuse everywhere:

```ts
export function toDiscard(deck: Deck, cards: readonly Card[]): Deck {
  return { draw: deck.draw, hand: deck.hand, discard: [...deck.discard, ...cards] };
}

export function removeFromHand(deck: Deck, card: Card): Deck {
  return { ...deck, hand: deck.hand.filter((c) => c.id !== card.id) };
}

/** Buying adds to the discard pile; it is NOT drawn until the draw pile empties. */
export function addPurchase(deck: Deck, card: Card): Deck {
  return { ...deck, discard: [...deck.discard, card] };
}
```

## 5. Drawing up to a hand size

"At the start of your turn, you draw up to 4 cards." So the helper takes the target
size and the current hand:

```ts
export function drawUpTo(deck: Deck, handSize: number, rng: Rng): DeckMutation {
  const missing = Math.max(0, handSize - deck.hand.length);
  return drawCards(deck, missing, rng);
}
```

## 6. Milestone

- Playing the same seed builds the same starting deck order (use the seeded RNG from
  chapter 00).
- Drawing 4 from a 4-card deck empties `draw`; drawing once more triggers exactly one
  reshuffle and leaves `discard` empty.
- `addPurchase` puts the card in `discard`, and it never appears before a reshuffle.
- Render the 4 starting cards as plain blocks in the HUD (real fan arrives in
  chapter 09) to confirm ids and ordering.

Next: [Turns, drawing, and movement](04-turns-and-movement.md).
