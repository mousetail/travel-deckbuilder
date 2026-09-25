import type { Card, CardMode, OnDiscard } from "../game/cards";
import { ATTACK_ICON, TERRAIN_ICON } from "../game/terrain";

/**
 * Compact "headline" for a card's modes, shown in the top-left corner: one
 * symbol per mode, so a combination card reads as its whole set of options.
 */
export function symbolNodes(card: Card): Node[] {
  const nodes: Node[] = [];
  for (const mode of card.modes) {
    nodes.push(...modeSymbolNodes(mode));
  }
  return nodes;
}

function modeSymbolNodes(mode: CardMode): Node[] {
  switch (mode.kind) {
    case "move": {
      const url = TERRAIN_ICON[mode.terrain];
      if (url === null) {
        return [text(`${mode.terrain[0].toUpperCase()}${mode.distance}`)];
      }
      return symbolIcon(url, `${mode.distance}`);
    }
    case "attack":
      return symbolIcon(ATTACK_ICON, `${mode.range}`);
    case "draw":
      return [text(`+${mode.count}`)];
    case "draw-discard":
      return [text(`${mode.draw}/${mode.discard}`)];
    case "discard-hand":
      return [text(`${mode.threshold}>${mode.draw}`)];
    case "recover":
      return [text(`^${mode.count}`)];
    case "currency":
      return [text(`$${mode.amount}`)];
  }
}

/** The footer line of a card with an on-discard effect. */
export function describeOnDiscard(onDiscard: OnDiscard): string {
  switch (onDiscard.kind) {
    case "currency":
      return `discard: +${onDiscard.amount}$`;
  }
}

/** An icon followed by its number, drawn as one inline unit. */
function symbolIcon(url: string, label: string): Node[] {
  const icon = document.createElement("img");
  icon.classList.add("card-symbol-icon");
  icon.src = url;
  icon.alt = "";
  return [icon, text(label)];
}

function text(content: string): Text {
  return document.createTextNode(content);
}