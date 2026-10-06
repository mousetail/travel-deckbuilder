import type { Card } from "../game/cards";
import { isIndestructible, mustPlayFirst } from "../game/cards";
import { cardFace } from "./card-view";
import { setChildren } from "./dom";

/** What clicking a hand card does right now. */
export type HandMode =
  | { kind: "play" }
  | { kind: "discard" }
  | { kind: "sleep" }
  | { kind: "store"; selected: ReadonlySet<string>; binId: string }
  | { kind: "none" };

/** The fanned hand: one card per held card; the card itself is the button. */
export class HandView {
  private readonly layer: HTMLElement;
  private readonly onPlay: (card: Card) => void;
  private readonly onDiscard: (card: Card) => void;
  private readonly onSleep: (card: Card) => void;
  private readonly onStore: (card: Card) => void;
  private readonly playable: (card: Card) => boolean;
  private readonly onHover: (card: Card | null) => void;

  constructor(
    layer: HTMLElement,
    onPlay: (card: Card) => void,
    onDiscard: (card: Card) => void,
    onSleep: (card: Card) => void,
    onStore: (card: Card) => void,
    playable: (card: Card) => boolean,
    onHover: (card: Card | null) => void,
  ) {
    this.layer = layer;
    this.onPlay = onPlay;
    this.onDiscard = onDiscard;
    this.onSleep = onSleep;
    this.onStore = onStore;
    this.playable = playable;
    this.onHover = onHover;
  }

  render(
    cards: readonly Card[],
    selectedId: string | null,
    hoveredId: string | null,
    mode: HandMode,
  ): void {
    const nodes = cards.map((card, index) =>
      this.cardElement(card, index, cards.length, selectedId, hoveredId, mode),
    );
    setChildren(this.layer, nodes);
  }

  private cardElement(
    card: Card,
    index: number,
    count: number,
    selectedId: string | null,
    hoveredId: string | null,
    mode: HandMode,
  ): HTMLElement {
    const element = cardFace(card, { index, count, viewOnly: false });

    // A phase that owns the choice (a draw-pile search) leaves the hand inert.
    if (mode.kind === "none") {
      element.classList.add("card-inert");
      // A wall placement still highlights the card being placed.
      if (card.id === selectedId) {
        element.classList.add("selected");
      }
      return element;
    }

    // Storing: the bin itself is inert, every other card toggles in and out.
    if (mode.kind === "store") {
      if (card.id === mode.binId || mustPlayFirst(card)) {
        element.classList.add("card-inert");
        return element;
      }
      if (mode.selected.has(card.id)) {
        element.classList.add("selected");
      }
      element.addEventListener("click", () => this.onStore(card));
      return element;
    }

    // A must-play-first card can never be discarded...
    if (mode.kind === "discard" && mustPlayFirst(card)) {
      element.classList.add("card-unplayable");
      return element;
    }
    // ...and an indestructible card can never be put to sleep.
    if (mode.kind === "sleep" && isIndestructible(card)) {
      element.classList.add("card-unplayable");
      return element;
    }

    // While choosing a card the whole card is the button, not its modes.
    if (mode.kind === "discard") {
      element.classList.add("discarding");
      element.addEventListener("click", () => this.onDiscard(card));
      element.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.onDiscard(card);
      });
      return element;
    }
    if (mode.kind === "sleep") {
      element.classList.add("sleeping");
      element.addEventListener("click", () => this.onSleep(card));
      return element;
    }

    if (card.id === selectedId) {
      element.classList.add("selected");
    } else if (card.id === hoveredId) {
      element.classList.add("card-hovered");
      element.addEventListener("click", () => this.onPlay(card));
    } else if (this.playable(card)) {
      element.addEventListener("click", () => this.onPlay(card));
    } else {
      element.classList.add("card-unplayable");
    }

    element.addEventListener("mouseenter", () => this.onHover(card));
    element.addEventListener("mouseleave", () => this.onHover(null));
    if (!mustPlayFirst(card)) {
      element.addEventListener("contextmenu", (event) => {
        event.preventDefault();
        this.onDiscard(card);
      });
    }
    return element;
  }
}
