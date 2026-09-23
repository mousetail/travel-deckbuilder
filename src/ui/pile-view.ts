import type { Card } from "../game/cards";
import { cardFace } from "./card-view";
import { setChildren } from "./dom";

export function pileButton(
  label: string,
  count: number,
  which: "draw" | "discard",
  onClick: () => void,
): HTMLElement {
  const button = document.createElement("button");
  button.classList.add("pile", `pile-${which}`);
  button.textContent = `${label} ${count}`;
  button.addEventListener("click", onClick);
  return button;
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
    cards.map((card, index) => cardFace(card, { index, count: cards.length, viewOnly: true }, [])),
  );

  const close = document.createElement("button");
  close.textContent = "Close";
  close.addEventListener("click", onClose);

  setChildren(overlay, [heading, list, close]);
  return overlay;
}
