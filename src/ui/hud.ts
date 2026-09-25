import type { GameState } from "../game/state";
import { endTurnAction } from "../game/economy";
import type { EndTurnAction } from "../game/economy";
import { setChildren } from "./dom";

/** The top bar (run stats and a contextual hint). */
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
      `depth ${state.playerSectionOrder} · enemies ${state.enemies.length}`;

    const hint = document.createElement("div");
    hint.classList.add("hud-hint");
    hint.textContent = hintFor(state);

    setChildren(this.layer, [stats, hint]);
  }

  /** The end-turn / use-feature button, which lives in the bottom bar. */
  renderAction(slot: HTMLElement, state: GameState, busy: boolean): void {
    const button = document.createElement("button");
    button.classList.add("hud-button");

    const phase = state.phase;
    if (phase.kind === "pending-move" || phase.kind === "pending-attack") {
      button.textContent = "Cancel";
      button.disabled = busy;
      button.addEventListener("click", () => this.onCancel());
      setChildren(slot, [button]);
      return;
    }

    const action = endTurnAction(state);
    if (action.kind === "use-feature") {
      button.classList.add("use-feature");
    }
    button.textContent = endTurnLabel(action);
    button.disabled = busy || phase.kind !== "playing";
    button.addEventListener("click", () => this.onAction());
    setChildren(slot, [button]);
  }
}

/** The label spells out the whole action, including the skip-turn coin. */
function endTurnLabel(action: EndTurnAction): string {
  switch (action.kind) {
    case "end-turn":
      return endTurnPrefix(action.bonus);
    case "use-feature":
      switch (action.feature.kind) {
        case "shop":
          return `${endTurnPrefix(action.bonus)} & Enter Shop`;
        case "smith":
          return `${endTurnPrefix(action.bonus)} & Use Smith`;
        case "remove-card":
          return `${endTurnPrefix(action.bonus)} & Remove a card`;
        case "gain-card":
          return `${endTurnPrefix(action.bonus)} & Take a card`;
        case "coin":
          return `${endTurnPrefix(action.bonus)} & Collect coin`;
        case "none":
          return endTurnPrefix(action.bonus);
        case "random":
          throw new Error("unresolved random feature");
      }
  }
}

/** Ending a turn without playing a card pays 1 currency. */
function endTurnPrefix(bonus: number): string {
  return bonus > 0 ? `Skip turn (+${bonus} currency)` : "End turn";
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
