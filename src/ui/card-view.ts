import type { Card } from "../game/cards";
import { symbolText } from "./card-text";
import { setChildren } from "./dom";

export type CardFace = {
  /** Position in the fan (0-based) and the fan size, for the fan angle. */
  index: number;
  count: number;
  /** Dimmed and non-interactive, as in the pile viewer. */
  viewOnly: boolean;
};

/**
 * A playing-card face: a symbol in the top-left, the name, and the art
 * placeholder. `footer` holds extra nodes (the hand's mode buttons).
 *
 * A `div`, not a `button`, so the hand's mode buttons can nest inside it.
 */
export function cardFace(card: Card, face: CardFace, footer: readonly Node[]): HTMLElement {
  const root = document.createElement("div");
  root.classList.add("card");
  if (face.viewOnly) {
    root.classList.add("card-view-only");
  }
  root.dataset["cardId"] = card.id;
  root.style.setProperty("--i", `${face.index}`);
  root.style.setProperty("--n", `${face.count}`);

  const symbol = document.createElement("div");
  symbol.classList.add("card-symbol");
  symbol.textContent = symbolText(card);

  const name = document.createElement("div");
  name.classList.add("card-name");
  name.textContent = card.name;

  const art = document.createElement("div");
  art.classList.add("card-art");
  if (card.image !== "") {
    const image = document.createElement("img");
    image.classList.add("pixel");
    image.src = card.image;
    image.alt = "";
    setChildren(art, [image]);
  }

  setChildren(root, [symbol, name, art, ...footer]);
  return root;
}
