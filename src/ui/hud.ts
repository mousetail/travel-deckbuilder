import type { GameState } from "../game/state";
import { endTurnAction, playerFeature } from "../game/economy";
import { setChildren } from "./dom";

export class Hud {
  private readonly layer: HTMLElement;
  private readonly onAction: () => void;
  private readonly onCancel: () => void;

  constructor(layer: HTMLElement, onAction: () => void, onCancel: () => void) {
    this.layer = layer;
    this.onAction = onAction;
    this.onCancel = onCancel;
  }

  render(state: GameState): void {
    const stats = document.createElement("div");
    stats.classList.add("hud-stats");
    stats.textContent =
      `Turn ${state.turn} · ${state.currency} currency · ` +
      `draw ${state.deck.draw.length} · discard ${state.deck.discard.length} · ` +
      `enemies ${state.enemies.length}`;

    const hint = document.createElement("div");
    hint.classList.add("hud-hint");
    hint.textContent = hintFor(state);

    const button = document.createElement("button");
    button.classList.add("hud-button");
    const phase = state.phase;
    if (phase.kind === "pending-move" || phase.kind === "pending-attack") {
      button.textContent = "Cancel";
      button.addEventListener("click", () => this.onCancel());
    } else {
      const action = endTurnAction(playerFeature(state));
      button.textContent = action.kind === "end-turn" ? "End turn" : "Use feature";
      button.disabled = phase.kind !== "playing";
      button.addEventListener("click", () => this.onAction());
    }

    setChildren(this.layer, [stats, hint, button]);
  }
}

function hintFor(state: GameState): string {
  switch (state.phase.kind) {
    case "pending-move":
      return "Pick a destination (right-click to cancel)";
    case "pending-attack":
      return "Pick a target (right-click to cancel)";
    case "pending-discard":
      return `Discard ${state.phase.count} card${state.phase.count === 1 ? "" : "s"}`;
    case "playing":
    case "pending-remove":
    case "pending-gain":
    case "shop":
    case "smith":
    case "game-over":
      return "";
  }
}
