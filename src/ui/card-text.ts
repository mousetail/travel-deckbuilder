import type { Card, CardMode } from "../game/cards";
import { ATTACK_ICON, TERRAIN_ICON } from "../game/terrain";

export function describeMode(mode: CardMode): string {
  switch (mode.kind) {
    case "move":
      return `${mode.terrain} ${mode.distance}`;
    case "attack":
      return `attack ${mode.range}`;
    case "draw-discard":
      return `draw ${mode.draw}, discard ${mode.discard}`;
    case "discard-hand":
      return `discard hand, draw ${mode.draw}`;
    case "draw":
      return `draw ${mode.count}`;
    case "recover":
      return `recover ${mode.count}`;
    case "currency":
      return `+${mode.amount} currency`;
  }
}

export function describeModes(modes: readonly CardMode[]): string {
  return modes.map(describeMode).join(" / ");
}

/** Compact "headline" for a card's first mode, shown in the top-left corner. */
export function symbolNodes(card: Card): Node[] {
  const mode = card.modes[0];
  return mode === undefined ? [text("?")] : modeSymbolNodes(mode);
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
