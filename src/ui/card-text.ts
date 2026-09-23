import type { Card, CardMode } from "../game/cards";
import type { Terrain } from "../game/terrain";

const TERRAIN_GLYPH: Record<Terrain, string> = {
  grass: "G",
  forest: "F",
  water: "W",
  mountain: "M",
  dirt: "D",
  impassible: "#",
};

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
export function symbolText(card: Card): string {
  const mode = card.modes[0];
  return mode === undefined ? "?" : modeSymbol(mode);
}

function modeSymbol(mode: CardMode): string {
  switch (mode.kind) {
    case "move":
      return `${TERRAIN_GLYPH[mode.terrain]}${mode.distance}`;
    case "attack":
      return `*${mode.range}`;
    case "draw":
      return `+${mode.count}`;
    case "draw-discard":
      return `${mode.draw}/${mode.discard}`;
    case "discard-hand":
      return `${mode.threshold}>${mode.draw}`;
    case "recover":
      return `^${mode.count}`;
    case "currency":
      return `$${mode.amount}`;
  }
}
