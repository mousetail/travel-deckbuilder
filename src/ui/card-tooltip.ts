import type { Card } from "../game/cards";
import { cardTooltipRows } from "./card-text";
import { setChildren } from "./dom";

/** Gap between the card's top edge and the tooltip above it. */
const GAP = 8;
/** Keep the tooltip at least this far from the viewport edges. */
const MARGIN = 8;

let layer: HTMLElement | null = null;
/** The card the tooltip is currently anchored to. */
let active: HTMLElement | null = null;
/** Last pointer position, for finding the card under it after a re-render. */
let pointer = { x: 0, y: 0 };
const cards = new WeakMap<HTMLElement, Card>();
let watching = false;

/**
 * The single tooltip element, on `document.body` so it is never clipped by a
 * scrolling overlay or rotated by the hand fan.
 */
function tooltipLayer(): HTMLElement {
  if (layer === null) {
    layer = document.createElement("div");
    layer.classList.add("card-tooltip", "hidden");
    document.body.append(layer);
  }
  return layer;
}

/**
 * Show a card's symbol legend above it while the pointer is over `element`.
 * The legend is read from the card's modes, so it stays correct as a card is
 * upgraded or otherwise changes.
 */
export function attachCardTooltip(element: HTMLElement, card: Card): void {
  cards.set(element, card);
  element.addEventListener("mouseenter", () => show(element, card));
  element.addEventListener("mouseleave", (event) => {
    // Moving straight onto another card fires this card's `mouseleave` after
    // the next card's `mouseenter`, so hiding here would wipe out the tooltip
    // the new card just showed. Leave it to the card being entered.
    const next = event.relatedTarget;
    if (next instanceof Element && next.closest(".card") !== null) {
      return;
    }
    hide();
  });
  watch();
}

/**
 * A card can leave the DOM without a `mouseleave` (playing it re-renders the
 * hand), which would strand the tooltip. Watch for the anchored card being
 * removed and follow the pointer to whatever card is under it now.
 */
function watch(): void {
  if (watching) {
    return;
  }
  watching = true;
  document.addEventListener("mousemove", (event) => {
    pointer = { x: event.clientX, y: event.clientY };
  });
  new MutationObserver(() => {
    if (active === null || active.isConnected) {
      return;
    }
    const under = document.elementFromPoint(pointer.x, pointer.y);
    const element = under instanceof Element ? under.closest(".card") : null;
    const card = element instanceof HTMLElement ? cards.get(element) : undefined;
    if (element instanceof HTMLElement && card !== undefined) {
      show(element, card);
    } else {
      hide();
    }
  }).observe(document.body, { childList: true, subtree: true });
}

function show(element: HTMLElement, card: Card): void {
  active = element;
  const tooltip = tooltipLayer();
  setChildren(tooltip, cardTooltipRows(card));
  tooltip.classList.remove("hidden");

  const rect = element.getBoundingClientRect();
  const half = tooltip.offsetWidth / 2;
  const center = Math.min(
    Math.max(rect.left + rect.width / 2, half + MARGIN),
    window.innerWidth - half - MARGIN,
  );
  tooltip.style.left = `${center}px`;
  tooltip.style.top = `${rect.top - GAP}px`;
}

function hide(): void {
  active = null;
  if (layer !== null) {
    layer.classList.add("hidden");
  }
}
