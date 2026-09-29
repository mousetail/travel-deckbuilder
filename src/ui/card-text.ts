import type { Card, CardEffect, CardMode } from "../game/cards";
import type { Terrain } from "../game/terrain";
import { ATTACK_ICON, SLEEP_ICON, TERRAIN_ICON } from "../game/terrain";
import { setChildren } from "./dom";
import {
  COIN_ICON,
  SCOUT_ICON,
  SEARCH_ICON,
  TELEPORT_ICON,
  UPGRADE_ICON,
  coinIcon,
} from "./card-icons";

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

/**
 * Every tooltip line for a card: one per mode, then one per play/discard
 * effect. Each line draws the same symbol the card shows, then spells it out.
 */
export function cardTooltipRows(card: Card): HTMLElement[] {
  const rows = card.modes.map((mode) =>
    tooltipRow(modeSymbolNodes(mode), describeMode(mode)),
  );
  for (const effect of card.onPlay) {
    rows.push(tooltipRow(effectNodes(effect), [text(describeEffect(effect))]));
  }
  for (const effect of card.onDiscard) {
    rows.push(
      tooltipRow(effectNodes(effect), [
        text(`When discarded: ${describeEffect(effect)}`),
      ]),
    );
  }
  return rows;
}

function tooltipRow(symbolContent: Node[], description: Node[]): HTMLElement {
  const row = document.createElement("div");
  row.classList.add("card-tooltip-row");
  const symbol = document.createElement("span");
  symbol.classList.add("card-tooltip-symbol");
  setChildren(symbol, symbolContent);
  const text = document.createElement("span");
  text.classList.add("card-tooltip-text");
  setChildren(text, description);
  setChildren(row, [symbol, text]);
  return row;
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
    case "search":
      return symbolIcon(SEARCH_ICON, `${mode.count}`);
    case "trivial-terrain":
      return symbolIcon(SCOUT_ICON, `${mode.turns}`);
    case "upgrade-hand":
      return symbolIcon(UPGRADE_ICON, "");
    case "teleport":
      return symbolIcon(TELEPORT_ICON, `${mode.range}`);
  }
}

/** The visual for a card effect, without its trigger. */
export function effectNodes(effect: CardEffect): Node[] {
  switch (effect.kind) {
    case "currency":
      return [text(`+${effect.amount}$`)];
    case "sleep":
      return sleepNodes(effect.reshuffles);
    case "pay":
      return symbolIcon(COIN_ICON, `${effect.amount}`);
    case "double-cost":
      return [text("×2")];
    case "halve-cost":
      return [text("½")];
    case "draw":
      return [text(`+${effect.count}`)];
  }
}

/** A moon and a reshuffle count, used wherever a sleep amount is shown. */
export function sleepNodes(reshuffles: number): Node[] {
  return symbolIcon(SLEEP_ICON, `${reshuffles}`);
}

const TERRAIN_NAME: Record<Terrain, string> = {
  grass: "Grass",
  forest: "Forest",
  water: "Water",
  mountain: "Mountain",
  dirt: "Dirt",
  impassible: "Impassible",
  finish: "Finish",
};

/** What a card's mode symbol means, spelled out for the hover tooltip. */
export function describeMode(mode: CardMode): Node[] {
  switch (mode.kind) {
    case "move":
      return [
        text(`Travel ${mode.distance} over ${TERRAIN_NAME[mode.terrain]}`),
      ];
    case "attack":
      return [
        text(
          mode.range === 0
            ? "Attack an enemy on your tile"
            : `Attack an enemy within ${mode.range} tiles`,
        ),
      ];
    case "draw":
      return [text(`Draw ${counted(mode.count, "card")}`)];
    case "draw-discard":
      return [text(`Draw ${mode.draw}, discard ${mode.discard}`)];
    case "discard-hand":
      return [
        text(
          `If your hand has ${mode.threshold} or more cards, discard it and draw ${mode.draw}`,
        ),
      ];
    case "recover":
      return [
        text(`Take ${counted(mode.count, "card")} from your discard pile`),
      ];
    case "currency":
      return [text(`Gain ${mode.amount} `), coinIcon()];
    case "sleep-card":
      return [
        text(
          `Put a card in your hand to sleep for ${counted(mode.reshuffles, "reshuffle")}`,
        ),
      ];
    case "search":
      return [text(`Take ${counted(mode.count, "card")} from your draw pile`)];
    case "trivial-terrain":
      return [
        text(`For ${counted(mode.turns, "turn")}, every terrain costs 1`),
      ];
    case "upgrade-hand":
      return [text("Upgrades all other cards in your hand")];
    case "teleport":
      return [text(`Teleport to an enemy within ${mode.range} tiles`)];
  }
}

function counted(n: number, noun: string): string {
  return n === 1 ? `1 ${noun}` : `${n} ${noun}s`;
}

/** The description of a card effect, without its trigger. */
export function describeEffect(effect: CardEffect): string {
  switch (effect.kind) {
    case "currency":
      return `+${effect.amount}$`;
    case "sleep":
      return `sleep for ${effect.reshuffles} reshuffles`;
    case "pay":
      return `pay ${effect.amount} coin`;
    case "double-cost":
      return "double this card's cost";
    case "halve-cost":
      return "halve this card's cost";
    case "draw":
      return `draw ${counted(effect.count, "card")}`;
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
