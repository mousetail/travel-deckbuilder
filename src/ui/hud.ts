import type { GameState } from "../game/state";
import { endTurnAction, playerFeature } from "../game/economy";
import { setChildren } from "./dom";

export class Hud {
  private readonly layer: HTMLElement;
  private readonly onAction: () => void;

  constructor(layer: HTMLElement, onAction: () => void) {
    this.layer = layer;
    this.onAction = onAction;
  }

  render(state: GameState): void {
    const stats = document.createElement("div");
    stats.classList.add("hud-stats");
    stats.textContent =
      `Turn ${state.turn} · ${state.currency} currency · ` +
      `draw ${state.deck.draw.length} · discard ${state.deck.discard.length}`;

    const action = endTurnAction(playerFeature(state));
    const button = document.createElement("button");
    button.classList.add("hud-button");
    button.textContent = action.kind === "end-turn" ? "End turn" : "Use feature";
    button.addEventListener("click", () => this.onAction());

    setChildren(this.layer, [stats, button]);
  }
}
