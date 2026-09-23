import type { CardMode } from "../game/cards";

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
