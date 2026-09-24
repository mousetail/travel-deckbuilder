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

export type DeckMutation = { deck: Deck; rng: Rng; drawn: readonly Card[] };

export function drawCards(deck: Deck, count: number, rng: Rng): DeckMutation {
  let draw = [...deck.draw];
  let discard = [...deck.discard];
  const hand = [...deck.hand];
  const drawn: Card[] = [];
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
    drawn.push(card);
  }

  return { deck: { draw, hand, discard }, rng: current, drawn };
}

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

export function drawUpTo(deck: Deck, handSize: number, rng: Rng): DeckMutation {
  const missing = Math.max(0, handSize - deck.hand.length);
  return drawCards(deck, missing, rng);
}

/** Every card in the deck, in draw → hand → discard order. */
export function allCards(deck: Deck): Card[] {
  return [...deck.draw, ...deck.hand, ...deck.discard];
}