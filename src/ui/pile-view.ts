import type { Card } from "../game/cards";
import { NOT_IN_HAND, cardFace } from "./card-view";
import { setChildren } from "./dom";

/**
 * A pile, drawn as a stack of cards rather than a button: two cards peeking out
 * behind the top one, which carries the count. An empty pile is a single flat,
 * greyed card, so "nothing left here" reads at a glance.
 */
export function pileButton(
  label: string,
  count: number,
  which: "draw" | "discard",
  onClick: () => void,
): HTMLElement {
  const button = document.createElement("button");
  button.classList.add("pile", `pile-${which}`);
  if (count === 0) {
    button.classList.add("pile-empty");
  }

  const stack = document.createElement("div");
  stack.classList.add("pile-stack");
  const layers: Node[] = [];
  if (count > 0) {
    layers.push(pileCard("pile-card-back"));
    layers.push(pileCard("pile-card-middle"));
  }
  const top = pileCard("pile-card-top");
  const number = document.createElement("span");
  number.classList.add("pile-count");
  number.textContent = `${count}`;
  setChildren(top, [number]);
  layers.push(top);
  setChildren(stack, layers);

  const caption = document.createElement("div");
  caption.classList.add("pile-label");
  caption.textContent = label;

  setChildren(button, [stack, caption]);
  button.addEventListener("click", onClick);
  return button;
}

function pileCard(className: string): HTMLElement {
  const card = document.createElement("div");
  card.classList.add("pile-card", className);
  return card;
}

/** Read-only list of a pile's contents. These cards cannot be played. */
export function pileOverlay(
  title: string,
  cards: readonly Card[],
  onClose: () => void,
): HTMLElement {
  const overlay = document.createElement("div");
  overlay.classList.add("overlay");

  const heading = document.createElement("div");
  heading.classList.add("overlay-title");
  heading.textContent = `${title} (${cards.length})`;

  const list = document.createElement("div");
  list.classList.add("overlay-cards");
  setChildren(
    list,
    cards.map((card, index) =>
      cardFace(card, { index, count: cards.length, viewOnly: true }, NOT_IN_HAND),
    ),
  );

  const close = document.createElement("button");
  close.textContent = "Close";
  close.addEventListener("click", onClose);

  setChildren(overlay, [heading, list, close]);
  return overlay;
}
