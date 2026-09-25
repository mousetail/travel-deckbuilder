import type { Card, CardEffect } from "../game/cards";
import { describeEffect, effectNodes, sleepNodes, symbolNodes } from "./card-text";
import { setChildren } from "./dom";

export type CardFace = {
  /** Position in the fan (0-based) and the fan size, for the fan angle. */
  index: number;
  count: number;
  /** Dimmed and non-interactive, as in the pile viewer. */
  viewOnly: boolean;
};

/**
 * A playing-card face: a symbol for every mode in the top-left, the name, the
 * art placeholder, and a footer line for every play and discard effect. The
 * card itself is the button: the hand view wires up the clicks.
 *
 * A `div`, not a `button`, so the hand view can add its own handlers.
 */
export function cardFace(card: Card, face: CardFace): HTMLElement {
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
  setChildren(symbol, symbolNodes(card));

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

  const nodes: Node[] = [symbol, name, art];
  nodes.push(...effectLines("play", card.onPlay, "card-on-play"));
  nodes.push(...effectLines("discard", card.onDiscard, "card-on-discard"));
  if (card.sleeping > 0) {
    nodes.push(sleepBadge(card.sleeping));
  }
  setChildren(root, nodes);
  return root;
}

/** One footer line per effect, labelled with the action that triggers it. */
function effectLines(
  trigger: string,
  effects: readonly CardEffect[],
  className: string,
): HTMLElement[] {
  return effects.map((effect) => {
    const line = document.createElement("div");
    line.classList.add(className);
    const label = document.createElement("span");
    label.classList.add("card-effect-trigger");
    label.textContent = trigger;
    line.append(label, document.createTextNode(" "), ...effectNodes(effect));
    line.title = `When ${trigger}ed: ${describeEffect(effect)}`;
    return line;
  });
}

/** How many reshuffles a sleeping card still has to sit out. */
function sleepBadge(reshuffles: number): HTMLElement {
  const badge = document.createElement("div");
  badge.classList.add("card-sleeping");
  badge.append(...sleepNodes(reshuffles));
  return badge;
}

/**
 * A card with a context-specific line below it (cost in the shop, usage in the
 * stats): the card itself is unchanged, the extra info sits underneath.
 */
export function cardWithCaption(
  card: Card,
  face: CardFace,
  caption: string | null,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.classList.add("card-caption");
  const nodes: Node[] = [cardFace(card, face)];
  if (caption !== null) {
    const captionEl = document.createElement("div");
    captionEl.classList.add("card-caption-text");
    captionEl.textContent = caption;
    nodes.push(captionEl);
  }
  setChildren(wrapper, nodes);
  return wrapper;
}
