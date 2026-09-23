import type { Card, CardMode } from "../game/cards";
import { describeMode } from "./card-text";
import { setChildren } from "./dom";

/** Placeholder hand renderer: plain blocks with one button per card mode. */
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

  render(cards: readonly Card[], selectedId: string | null, discarding: boolean): void {
    const nodes = cards.map((card) => this.cardElement(card, card.id === selectedId, discarding));
    setChildren(this.layer, nodes);
  }

  private cardElement(card: Card, selected: boolean, discarding: boolean): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("card");
    if (selected) {
      element.classList.add("selected");
    }
    element.dataset["cardId"] = card.id;

    const name = document.createElement("span");
    name.classList.add("card-name");
    name.textContent = card.name;

    const id = document.createElement("span");
    id.classList.add("card-id");
    id.textContent = card.id;

    // While choosing discards the whole card is the button, not its modes.
    if (discarding) {
      element.classList.add("discarding");
      setChildren(element, [name, id]);
      element.addEventListener("click", () => this.onDiscard(card));
      return element;
    }

    const modes = card.modes.map((mode, index) => this.modeButton(card, mode, index));

    setChildren(element, [name, ...modes, id]);
    element.addEventListener("contextmenu", (event) => {
      event.preventDefault();
      this.onDiscard(card);
    });
    return element;
  }

  private modeButton(card: Card, mode: CardMode, index: number): HTMLElement {
    const button = document.createElement("button");
    button.classList.add("card-mode");
    button.textContent = describeMode(mode);
    button.disabled = !this.modeAvailable(card, index);
    button.addEventListener("click", () => this.onPlay(card, index));
    return button;
  }
}
