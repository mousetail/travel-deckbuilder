import type { Card, CardEffect, CardMode } from "../game/cards";
import { ATTACK_ICON, SLEEP_ICON, TERRAIN_ICON } from "../game/terrain";

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
    case "sleep-card":
      return sleepNodes(mode.reshuffles);
  }
}

/** The visual for a card effect, without its trigger. */
export function effectNodes(effect: CardEffect): Node[] {
  switch (effect.kind) {
    case "currency":
      return [text(`+${effect.amount}$`)];
    case "sleep":
      return sleepNodes(effect.reshuffles);
  }
}

/** A moon and a reshuffle count, used wherever a sleep amount is shown. */
export function sleepNodes(reshuffles: number): Node[] {
  return symbolIcon(SLEEP_ICON, `${reshuffles}`);
}

/** The description of a card effect, without its trigger. */
export function describeEffect(effect: CardEffect): string {
  switch (effect.kind) {
    case "currency":
      return `+${effect.amount}$`;
    case "sleep":
      return `sleep for ${effect.reshuffles} reshuffles`;
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
