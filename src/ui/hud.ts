import type { GameState } from "../game/state";
import { endTurnAction } from "../game/economy";
import type { EndTurnAction } from "../game/economy";
import {
  permanentEnemyMovement,
  playerInDanger,
  temporaryEnemyMovement,
} from "../game/enemies";
import { playerOnFinish } from "../game/terrain";
import { coinIcon } from "./card-icons";
import { setChildren } from "./dom";

/** The top bar (run stats and a contextual hint). */
export class Hud {
  private readonly layer: HTMLElement;
  private readonly onAction: () => void;
  private readonly onCancel: () => void;
  private readonly onConfirm: () => void;
  private readonly onHelp: () => void;

  constructor(
    layer: HTMLElement,
    onAction: () => void,
    onCancel: () => void,
    onConfirm: () => void,
    onHelp: () => void,
  ) {
    this.layer = layer;
    this.onAction = onAction;
    this.onCancel = onCancel;
    this.onConfirm = onConfirm;
    this.onHelp = onHelp;
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
      text(` · enemy speed ${formatEnemySpeed(state)}`),
    ]);

    const help = document.createElement("button");
    help.classList.add("hud-help");
    help.textContent = "?";
    help.title = "How to play";
    help.addEventListener("click", () => this.onHelp());

    const right = document.createElement("div");
    right.classList.add("hud-top-right");
    setChildren(right, [progress, help]);

    setChildren(this.layer, [currency, hint, right]);
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
    if (phase.kind === "pending-store") {
      const count = phase.selected.length;
      button.textContent = `Store ${count} card${count === 1 ? "" : "s"}`;
      button.disabled = busy;
      button.addEventListener("click", () => this.onConfirm());
      setChildren(slot, [button]);
      return;
    }

    const action = endTurnAction(state);
    if (action.kind === "use-feature") {
      button.classList.add("use-feature");
    }
    if (playerInDanger(state)) {
      button.classList.add("danger");
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
        case "consumable":
          return [...endTurnPrefix(action.bonus), text(" & Take a consumable")];
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

/** Enemy speed is a multiple of 0.1; drop a trailing `.0` for whole numbers. */
function formatSpeed(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return rounded.toFixed(1).replace(/\.0$/, "");
}

/**
 * The standing enemy speed, with a signed parenthesised aside only while a
 * temporary modifier is active: `1`, `1.2 (+1)`, `2.4 (-0.5)`.
 */
function formatEnemySpeed(state: GameState): string {
  const permanent = formatSpeed(permanentEnemyMovement(state));
  const temporary = temporaryEnemyMovement(state);
  if (temporary === 0) {
    return permanent;
  }
  const sign = temporary > 0 ? "+" : "-";
  return `${permanent} (${sign}${formatSpeed(Math.abs(temporary))})`;
}

function hintFor(state: GameState): string {
  switch (state.phase.kind) {
    case "pending-card":
      return "Pick a destination or target (right-click to cancel)";
    case "pending-discard":
      return `Pick ${state.phase.count} card${
        state.phase.count === 1 ? "" : "s"
      } to discard`;
    case "pending-sleep":
      return "Pick a card to put to sleep";
    case "pending-search":
      return "Pick a card from your draw pile";
    case "pending-store":
      return "Pick any number of cards to store";
    case "pending-wall":
      return "Pick a direction for the wall";
    case "playing":
      return "Click a card or reachable tile · right-click to discard";
    case "pending-remove":
    case "pending-gain":
    case "pending-consumable":
    case "shop":
    case "smith":
    case "game-over":
      return "";
  }
}
