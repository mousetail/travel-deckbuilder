import type { Card, CardMode } from "../game/cards";
import { describeMode, symbolText } from "./card-text";
import { setChildren } from "./dom";

export type CardFace = {
  /** Position in the fan (0-based) and the fan size, for the fan angle. */
  index: number;
  count: number;
  /** Dimmed and non-interactive, as in the pile viewer. */
  viewOnly: boolean;
};

/**
 * How a card's mode buttons behave in this context. The buttons are always
 * drawn — a card reads the same wherever it appears — and are simply disabled
 * when the card is not in the player's hand.
 */
export type CardButtons = {
  /** Whether the card is in the player's hand; buttons are disabled otherwise. */
  inHand: boolean;
  /** Whether a specific mode is playable right now. */
  modeAvailable: (modeIndex: number) => boolean;
  /** Play the given mode. */
  onPlay: (modeIndex: number) => void;
};

/** Buttons for a card shown outside the hand: visible but disabled. */
export const NOT_IN_HAND: CardButtons = {
  inHand: false,
  modeAvailable: () => false,
  onPlay: () => {},
};

/**
 * A playing-card face: a symbol in the top-left, the name, the art placeholder,
 * and one button per mode. The buttons are always present so the card looks the
 * same wherever it is shown; they are disabled when the card is not in hand.
 *
 * A `div`, not a `button`, so the mode buttons can nest inside it.
 */
export function cardFace(
  card: Card,
  face: CardFace,
  buttons: CardButtons,
): HTMLElement {
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

  const modes = card.modes.map((mode, modeIndex) =>
    modeButton(mode, modeIndex, buttons),
  );

  setChildren(root, [symbol, name, art, ...modes]);
  return root;
}

function modeButton(
  mode: CardMode,
  index: number,
  buttons: CardButtons,
): HTMLElement {
  const button = document.createElement("button");
  button.classList.add("card-mode");
  button.textContent = describeMode(mode);
  button.disabled = !buttons.inHand || !buttons.modeAvailable(index);
  button.addEventListener("click", () => buttons.onPlay(index));
  return button;
}

/**
 * A card with a context-specific line below it (cost in the shop, usage in the
 * stats): the card itself is unchanged, the extra info sits underneath.
 */
export function cardWithCaption(
  card: Card,
  face: CardFace,
  buttons: CardButtons,
  caption: string | null,
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.classList.add("card-caption");
  const nodes: Node[] = [cardFace(card, face, buttons)];
  if (caption !== null) {
    const captionEl = document.createElement("div");
    captionEl.classList.add("card-caption-text");
    captionEl.textContent = caption;
    nodes.push(captionEl);
  }
  setChildren(wrapper, nodes);
  return wrapper;
}