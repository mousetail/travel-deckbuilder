import type { GameState } from "../game/state";
import { endTurnAction } from "../game/economy";
import type { EndTurnAction } from "../game/economy";
import { playerOnFinish } from "../game/terrain";
import { coinIcon } from "./card-icons";
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
    const currency = document.createElement("div");
    currency.classList.add("hud-currency");
    setChildren(currency, [coinIcon(), text(`${state.currency}`)]);

    const hint = document.createElement("div");
    hint.classList.add("hud-hint");
    hint.textContent = hintFor(state);

    const progress = document.createElement("div");
    progress.classList.add("hud-progress");
    setChildren(progress, [
      text(`Turn ${state.turn}`),
      text(` · depth ${state.playerSectionOrder}`),
    ]);

    setChildren(this.layer, [currency, hint, progress]);
  }

  /** The end-turn / use-feature button, which sits mid-height on the right. */
  renderAction(slot: HTMLElement, state: GameState, busy: boolean): void {
    const button = document.createElement("button");
    button.classList.add("hud-button");

    const phase = state.phase;
    if (phase.kind === "pending-card") {
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
    const label = endTurnLabel(action);
    if (playerOnFinish(state)) {
      label.push(text(" — win if you survive"));
    }
    setChildren(button, label);
    button.disabled = busy || phase.kind !== "playing";
    button.addEventListener("click", () => this.onAction());
    setChildren(slot, [button]);
  }
}

/** The label spells out the whole action, including the skip-turn coin. */
function endTurnLabel(action: EndTurnAction): Node[] {
  switch (action.kind) {
    case "end-turn":
      return endTurnPrefix(action.bonus);
    case "use-feature":
      switch (action.feature.kind) {
        case "shop":
          return [...endTurnPrefix(action.bonus), text(" & Enter Shop")];
        case "smith":
          return [...endTurnPrefix(action.bonus), text(" & Use Smith")];
        case "remove-card":
          return [...endTurnPrefix(action.bonus), text(" & Remove a card")];
        case "gain-card":
          return [
            ...endTurnPrefix(action.bonus),
            text(action.feature.card === null ? " & Enter" : " & Take a card"),
          ];
        case "coin":
          return [...endTurnPrefix(action.bonus), text(" & Collect coin")];
        case "none":
          return endTurnPrefix(action.bonus);
        case "random":
          throw new Error("unresolved random feature");
      }
  }
}

/** Ending a turn without playing a card pays 1 currency. */
function endTurnPrefix(bonus: number): Node[] {
  if (bonus <= 0) {
    return [text("End turn")];
  }
  return [text(`Skip turn (+${bonus} `), coinIcon(), text(")")];
}

function text(content: string): Text {
  return document.createTextNode(content);
}

function hintFor(state: GameState): string {
  switch (state.phase.kind) {
    case "pending-card":
      return "Pick a destination or target (right-click to cancel)";
    case "pending-discard":
      return `Discard ${state.phase.count} card${state.phase.count === 1 ? "" : "s"}`;
    case "pending-sleep":
      return "Pick a card to put to sleep";
    case "pending-search":
      return "Pick a card from your draw pile";
    case "playing":
      return "Click a card or reachable tile · right-click to discard";
    case "pending-remove":
    case "pending-gain":
    case "shop":
    case "smith":
    case "game-over":
      return "";
  }
}
