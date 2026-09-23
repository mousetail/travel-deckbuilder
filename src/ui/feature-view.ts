import type { Card, CardSpec } from "../game/cards";
import { allCards } from "../game/deck";
import type { FeatureAction } from "../game/economy";
import type { GameOverReason, GameState } from "../game/state";
import { describeModes } from "./card-text";
import { setChildren } from "./dom";

/** Modal UI for the shop, smith, removal, gain and game-over phases. */
export class FeatureView {
  private readonly layer: HTMLElement;
  private readonly onAction: (action: FeatureAction) => void;

  constructor(layer: HTMLElement, onAction: (action: FeatureAction) => void) {
    this.layer = layer;
    this.onAction = onAction;
  }

  render(state: GameState): void {
    const panel = this.panel(state);
    if (panel === null) {
      this.layer.classList.remove("active");
      setChildren(this.layer, []);
      return;
    }
    this.layer.classList.add("active");
    setChildren(this.layer, [panel]);
  }

  private panel(state: GameState): HTMLElement | null {
    const phase = state.phase;
    switch (phase.kind) {
      case "shop":
        return this.shopPanel(state, phase.stock, phase.rerollCost);
      case "smith":
        return this.choicePanel("Smith — upgrade a card", state, (cardId) => ({
          kind: "upgrade",
          cardId,
        }));
      case "pending-remove":
        return this.choicePanel("Remove a card", state, (cardId) => ({
          kind: "remove",
          cardId,
        }));
      case "pending-gain":
        return this.giftPanel(phase.spec);
      case "game-over":
        return this.gameOverPanel(phase.reason);
      case "playing":
      case "pending-move":
      case "pending-attack":
      case "pending-discard":
        return null;
    }
  }

  private gameOverPanel(reason: GameOverReason): HTMLElement {
    const message = document.createElement("div");
    message.classList.add("feature-text");
    message.textContent = gameOverText(reason);
    return this.panelElement([this.title("Game over"), message]);
  }

  private shopPanel(
    state: GameState,
    stock: readonly Card[],
    rerollCost: number,
  ): HTMLElement {
    const nodes: Node[] = [this.title("Shop")];
    for (const card of stock) {
      nodes.push(this.row(
        `${card.name} — ${describeModes(card.modes)} (${card.cost})`,
        "Buy",
        card.cost > state.currency,
        () => this.onAction({ kind: "buy", card }),
      ));
    }
    nodes.push(this.row(
      `Reroll the stock (${rerollCost})`,
      "Reroll",
      rerollCost > state.currency,
      () => this.onAction({ kind: "reroll" }),
    ));
    nodes.push(this.row("Leave the shop", "Leave", false, () => this.onAction({ kind: "leave" })));
    return this.panelElement(nodes);
  }

  private choicePanel(
    heading: string,
    state: GameState,
    build: (cardId: string) => FeatureAction,
  ): HTMLElement {
    const nodes: Node[] = [this.title(heading)];
    for (const card of allCards(state.deck)) {
      nodes.push(this.row(
        `${card.name} — ${describeModes(card.modes)}`,
        "Choose",
        false,
        () => this.onAction(build(card.id)),
      ));
    }
    nodes.push(this.row("Do nothing", "Leave", false, () => this.onAction({ kind: "leave" })));
    return this.panelElement(nodes);
  }

  private giftPanel(spec: CardSpec): HTMLElement {
    const nodes: Node[] = [
      this.title("Gain a card"),
      this.row(
        `${spec.name} — ${describeModes(spec.modes)}`,
        "Take",
        false,
        () => this.onAction({ kind: "take-gift" }),
      ),
      this.row("Leave it", "Leave", false, () => this.onAction({ kind: "leave" })),
    ];
    return this.panelElement(nodes);
  }

  private title(text: string): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("feature-title");
    element.textContent = text;
    return element;
  }

  private row(
    label: string,
    buttonText: string,
    disabled: boolean,
    onClick: () => void,
  ): HTMLElement {
    const row = document.createElement("div");
    row.classList.add("feature-row");

    const text = document.createElement("span");
    text.textContent = label;

    const button = document.createElement("button");
    button.classList.add("hud-button");
    button.textContent = buttonText;
    button.disabled = disabled;
    button.addEventListener("click", onClick);

    setChildren(row, [text, button]);
    return row;
  }

  private panelElement(nodes: readonly Node[]): HTMLElement {
    const panel = document.createElement("div");
    panel.classList.add("feature-panel");
    setChildren(panel, nodes);
    return panel;
  }
}

function gameOverText(reason: GameOverReason): string {
  switch (reason.kind) {
    case "assassin":
      return "An assassin caught you. Reload the page to try again.";
    case "sniper":
      return "A sniper shot you down. Reload the page to try again.";
    case "caught":
      return "You were caught. Reload the page to try again.";
  }
}
