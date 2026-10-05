import type { Card, CardEffect, CardTrait } from "../game/cards";
import {
  describeEffect,
  describeTrait,
  effectNodes,
  sleepNodes,
  symbolNodes,
  traitSymbolNodes,
} from "./card-text";
import { attachCardTooltip } from "./card-tooltip";
import { EPHEMERAL_ICON, TEMPORARY_ICON } from "./card-icons";
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
  const badges = cardBadges(card);
  if (badges !== null) {
    nodes.push(badges);
  }
  setChildren(root, nodes);
  attachCardTooltip(root, card);
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

/**
 * The badges pinned to a card's top-right corner, stacked so they never overlap:
 * one per trait, then the sleep counter and the temporary-upgrade sigil.
 */
function cardBadges(card: Card): HTMLElement | null {
  const badges: HTMLElement[] = card.traits.map((trait) => traitBadge(trait));
  if (card.sleeping > 0) {
    badges.push(sleepBadge(card.sleeping));
  }
  if (card.temporaryUpgrade) {
    badges.push(temporaryBadge());
  }
  if (card.temporary) {
    badges.push(ephemeralBadge());
  }
  if (badges.length === 0) {
    return null;
  }
  const container = document.createElement("div");
  container.classList.add("card-badges");
  setChildren(container, badges);
  return container;
}

const TRAIT_CLASS: Record<CardTrait, string> = {
  "must-play-first": "card-plays-first",
  indestructible: "card-indestructible",
  shy: "card-shy",
};

/** The badge for a rule-bending trait, with a title spelling the rule out. */
function traitBadge(trait: CardTrait): HTMLElement {
  const badge = document.createElement("div");
  badge.classList.add("card-badge", TRAIT_CLASS[trait]);
  badge.title = describeTrait(trait);
  badge.append(...traitSymbolNodes(trait));
  return badge;
}

/** How many reshuffles a sleeping card still has to sit out. */
function sleepBadge(reshuffles: number): HTMLElement {
  const badge = document.createElement("div");
  badge.classList.add("card-badge", "card-sleeping");
  badge.append(...sleepNodes(reshuffles));
  return badge;
}

/** The sigil marking an upgrade that only lasts while the card stays in hand. */
function temporaryBadge(): HTMLElement {
  const badge = document.createElement("div");
  badge.classList.add("card-badge", "card-temporary");
  const icon = document.createElement("img");
  icon.classList.add("card-symbol-icon");
  icon.src = TEMPORARY_ICON;
  icon.alt = "temporary upgrade";
  badge.append(icon);
  return badge;
}

/** The sigil marking a card conjured by Invention, removed when it leaves the hand. */
function ephemeralBadge(): HTMLElement {
  const badge = document.createElement("div");
  badge.classList.add("card-badge", "card-ephemeral");
  badge.title = "Temporary: removed when played or discarded";
  const icon = document.createElement("img");
  icon.classList.add("card-symbol-icon");
  icon.src = EPHEMERAL_ICON;
  icon.alt = "temporary card";
  badge.append(icon);
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
