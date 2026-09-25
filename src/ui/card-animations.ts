import type { Card } from "../game/cards";
import type { Deck } from "../game/deck";
import { cardFace } from "./card-view";
import { cardBack } from "./pile-view";

const FLY_MS = 300;
const RESHUFFLE_MS = 400;
const RESHUFFLE_STAGGER_MS = 60;
const MAX_RESHUFFLE_GHOSTS = 6;
/** How long a draw waits after a reshuffle, so the shuffle reads first. */
export const RESHUFFLE_DRAW_DELAY_MS = 180;

/** What changed between two deck states, for the flying-card animations. */
export type DeckDiff = {
  /** Cards that entered the hand, and where they flew from. */
  drawn: readonly { card: Card; from: "draw" | "discard" }[];
  /** Cards that left the hand for the discard pile. */
  discarded: readonly Card[];
  /** How many cards the discard pile contributed to the draw pile. */
  reshuffled: number;
};

export function deckDiff(prev: Deck, next: Deck): DeckDiff {
  const prevHand = new Set(prev.hand.map((c) => c.id));
  const nextHand = new Set(next.hand.map((c) => c.id));
  const prevDraw = new Set(prev.draw.map((c) => c.id));
  const nextDiscard = new Set(next.discard.map((c) => c.id));
  // The draw pile emptied and was refilled from the discard pile. This is the
  // visible case (start of turn); a mid-draw reshuffle still flies the drawn
  // cards from the discard pile, which reads correctly on its own.
  const reshuffled =
    prev.draw.length === 0 && prev.discard.length > 0 && next.draw.length > 0;

  const drawn = next.hand
    .filter((c) => !prevHand.has(c.id))
    .map((card) => {
      const from: "draw" | "discard" =
        reshuffled || prevDraw.has(card.id) ? "draw" : "discard";
      return { card, from };
    });

  // A card that left the hand but is not in the discard pile was removed from
  // the deck, not discarded; it gets no animation.
  const discarded = prev.hand.filter(
    (c) => !nextHand.has(c.id) && nextDiscard.has(c.id),
  );

  return {
    drawn,
    discarded,
    reshuffled: reshuffled ? prev.discard.length : 0,
  };
}

/**
 * Flies ghost cards between the piles and the hand, above the whole UI. The
 * real cards are already in place; each ghost is a temporary copy that flies
 * from the source to the destination and fades out on landing.
 */
export class CardAnimator {
  private readonly layer: HTMLElement;

  constructor(layer: HTMLElement) {
    this.layer = layer;
  }

  /** A card-back ghost flies from the draw pile to a hand slot. */
  drawCard(from: DOMRect, to: DOMRect, delayMs: number): void {
    this.fly(cardBack(), from, to, delayMs, FLY_MS, -24);
  }

  /** A copy of the card flies from its hand slot to the discard pile. */
  discardCard(card: Card, from: DOMRect, to: DOMRect): void {
    this.fly(
      cardFace(card, { index: 0, count: 1, viewOnly: true }),
      from,
      to,
      0,
      FLY_MS,
      -12,
    );
  }

  /** A stream of card backs flies from the discard pile to the draw pile. */
  reshuffle(from: DOMRect, to: DOMRect, count: number): void {
    const ghosts = Math.min(count, MAX_RESHUFFLE_GHOSTS);
    for (let i = 0; i < ghosts; i += 1) {
      this.fly(cardBack(), from, to, i * RESHUFFLE_STAGGER_MS, RESHUFFLE_MS, -30);
    }
  }

  private fly(
    ghost: HTMLElement,
    from: DOMRect,
    to: DOMRect,
    delayMs: number,
    durationMs: number,
    arc: number,
  ): void {
    ghost.classList.add("card-ghost");
    const start = centre(from);
    ghost.style.left = `${start.x}px`;
    ghost.style.top = `${start.y}px`;
    ghost.style.transform = "translate(-50%, -50%)";
    this.layer.append(ghost);

    const dx = centre(to).x - start.x;
    const dy = centre(to).y - start.y;
    const animation = ghost.animate(
      [
        { transform: "translate(-50%, -50%)", opacity: 1 },
        {
          transform: `translate(calc(${dx / 2}px - 50%), calc(${dy / 2 + arc}px - 50%))`,
          opacity: 1,
          offset: 0.55,
        },
        {
          transform: `translate(calc(${dx}px - 50%), calc(${dy}px - 50%))`,
          opacity: 0,
        },
      ],
      {
        duration: durationMs,
        delay: delayMs,
        easing: "ease-in-out",
        fill: "both",
      },
    );
    animation.onfinish = () => ghost.remove();
  }
}

function centre(rect: DOMRect): { x: number; y: number } {
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}