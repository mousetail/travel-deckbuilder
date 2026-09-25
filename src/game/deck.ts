import type { Card, IdFactory } from "./cards";
import { instantiate, sleepOnPlay } from "./cards";
import type { CardSpec } from "./cards";
import type { Rng } from "./rng";
import { nextRng } from "./rng";

export type Deck = {
  draw: Card[];
  hand: Card[];
  discard: Card[];
};

export function buildDeck(
  specs: readonly CardSpec[],
  ids: IdFactory,
  rng: Rng,
): Deck {
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

  for (let i = 0; i < count; i += 1) {
    if (draw.length === 0) {
      const recycled = recycle(discard, rng);
      draw = recycled.draw;
      discard = recycled.discard;
      if (draw.length === 0) {
        break; // every remaining card is still asleep; draw fewer cards
      }
    }
    const card = draw.pop();
    if (card === undefined) {
      break;
    }
    hand.push(card);
    drawn.push(card);
  }

  return { deck: { draw, hand, discard }, rng, drawn };
}

/**
 * Recycle the discard pile into a fresh draw pile. A sleeping card is held
 * back and its counter ticks down; a card whose counter reaches 0 wakes up and
 * joins the shuffle. Awake cards always join. The pile is aged even when
 * nothing wakes, so a pile of sleeping cards still counts down over reshuffles.
 */
function recycle(
  discard: readonly Card[],
  rng: Rng,
): { draw: Card[]; discard: Card[] } {
  const awake: Card[] = [];
  const stillAsleep: Card[] = [];
  for (const card of discard) {
    if (card.sleeping <= 0) {
      awake.push(card);
    } else if (card.sleeping === 1) {
      awake.push({ ...card, sleeping: 0 });
    } else {
      stillAsleep.push({ ...card, sleeping: card.sleeping - 1 });
    }
  }
  return { draw: shuffle(awake, rng), discard: stillAsleep };
}

export function toDiscard(deck: Deck, cards: readonly Card[]): Deck {
  return {
    draw: deck.draw,
    hand: deck.hand,
    discard: [...deck.discard, ...cards],
  };
}

export function removeFromHand(deck: Deck, card: Card): Deck {
  return { ...deck, hand: deck.hand.filter((c) => c.id !== card.id) };
}

/** Move a played card to the discard pile, asleep if its own rules say so. */
export function discardPlayed(deck: Deck, card: Card): Deck {
  const sleep = sleepOnPlay(card);
  if (deck.hand.some((c) => c.id === card.id)) {
    const without = removeFromHand(deck, card);
    return toDiscard(without, [sleep > 0 ? { ...card, sleeping: sleep } : card]);
  }
  // A `discard-hand` play clears the hand first, so the card is already in the
  // discard pile by the time it is marked as played.
  return sleep > 0 ? sleepInDiscard(deck, card.id, sleep) : deck;
}

/** Move a card from the hand to the discard pile, asleep for `reshuffles`. */
export function sleepFromHand(deck: Deck, card: Card, reshuffles: number): Deck {
  const without = removeFromHand(deck, card);
  return toDiscard(without, [{ ...card, sleeping: reshuffles }]);
}

/** Set the sleep counter of a card already sitting in the discard pile. */
export function sleepInDiscard(
  deck: Deck,
  cardId: string,
  reshuffles: number,
): Deck {
  return {
    ...deck,
    discard: deck.discard.map((card) =>
      card.id === cardId ? { ...card, sleeping: reshuffles } : card,
    ),
  };
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
