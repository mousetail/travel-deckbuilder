import type { Card } from "../game/cards";
import { cardFace } from "./card-view";
import { setChildren } from "./dom";

/** The fanned hand: one card per held card, with a button per playable mode. */
export class HandView {
  private readonly layer: HTMLElement;
  private readonly onPlay: (card: Card, modeIndex: number) => void;
  private readonly onDiscard: (card: Card) => void;
  private readonly modeAvailable: (card: Card, modeIndex: number) => boolean;

  constructor(
    layer: HTMLElement,
    onPlay: (card: Card, modeIndex: number) => void,
    onDiscard: (card: Card) => void,
    modeAvailable: (card: Card, modeIndex: number) => boolean,
  ) {
    this.layer = layer;
    this.onPlay = onPlay;
    this.onDiscard = onDiscard;
    this.modeAvailable = modeAvailable;
  }

  render(
    cards: readonly Card[],
    selectedId: string | null,
    discarding: boolean,
  ): void {
    const nodes = cards.map((card, index) =>
      this.cardElement(card, index, cards.length, selectedId, discarding),
    );
    setChildren(this.layer, nodes);
  }

  private cardElement(
    card: Card,
    index: number,
    count: number,
    selectedId: string | null,
    discarding: boolean,
  ): HTMLElement {
    const element = cardFace(
      card,
      { index, count, viewOnly: false },
      {
        inHand: true,
        modeAvailable: (modeIndex) => this.modeAvailable(card, modeIndex),
        onPlay: (modeIndex) => this.onPlay(card, modeIndex),
      },
    );
    if (card.id === selectedId) {
      element.classList.add("selected");
    }

    // While choosing discards the whole card is the button, not its modes.
    if (discarding) {
      element.classList.add("discarding");
      element.addEventListener("click", () => this.onDiscard(card));
      return element;
    }

    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.onDiscard(card);
    });
    return element;
  }
}