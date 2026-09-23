import type { Card } from "../game/cards";
import { describeModes } from "./card-text";
import { setChildren } from "./dom";

/** Placeholder hand renderer: plain blocks. The fanned hand arrives in chapter 09. */
export class HandView {
  private readonly layer: HTMLElement;
  private readonly onPlay: (card: Card) => void;
  private readonly onDiscard: (card: Card) => void;

  constructor(
    layer: HTMLElement,
    onPlay: (card: Card) => void,
    onDiscard: (card: Card) => void,
  ) {
    this.layer = layer;
    this.onPlay = onPlay;
    this.onDiscard = onDiscard;
  }

  render(cards: readonly Card[], selectedId: string | null): void {
    const nodes = cards.map((card) => this.cardElement(card, card.id === selectedId));
    setChildren(this.layer, nodes);
  }

  private cardElement(card: Card, selected: boolean): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("card");
    if (selected) {
      element.classList.add("selected");
    }
    element.dataset["cardId"] = card.id;

    const name = document.createElement("span");
    name.classList.add("card-name");
    name.textContent = card.name;

    const modes = document.createElement("span");
    modes.classList.add("card-modes");
    modes.textContent = describeModes(card.modes);

    const id = document.createElement("span");
    id.classList.add("card-id");
    id.textContent = card.id;

    setChildren(element, [name, modes, id]);

    element.addEventListener("click", () => this.onPlay(card));
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.onDiscard(card);
    });
    return element;
  }
}