import type { Card, CardSpec } from "../game/cards";
import { allCards } from "../game/deck";
import { instantiate } from "../game/cards";
import type { FeatureAction } from "../game/economy";
import type { GameState } from "../game/state";
import { NOT_IN_HAND, cardFace, cardWithCaption } from "./card-view";
import { setChildren } from "./dom";
import { gameOverPanel } from "./game-over-view";
import type { History } from "./stats-store";

/** Modal UI for the shop, smith, removal, gain and game-over phases. */
export class FeatureView {
  private readonly layer: HTMLElement;
  private readonly onAction: (action: FeatureAction) => void;
  private readonly onRestart: () => void;
  private smithPreviewCardId: string | null = null;
  private lastHistory: History = { kind: "none" };

  constructor(
    layer: HTMLElement,
    onAction: (action: FeatureAction) => void,
    onRestart: () => void,
  ) {
    this.layer = layer;
    this.onAction = onAction;
    this.onRestart = onRestart;
  }

  render(state: GameState, history: History): void {
    this.lastHistory = history;
    const panel = this.panel(state, history);
    setChildren(this.layer, panel === null ? [] : [panel]);
  }

  private panel(state: GameState, history: History): HTMLElement | null {
    const phase = state.phase;
    switch (phase.kind) {
      case "shop":
        return this.shopPanel(state, phase.stock, phase.rerollCost);
      case "smith": {
        if (this.smithPreviewCardId !== null) {
          return this.smithPreviewPanel(state);
        }
        return this.smithSelectionPanel(state);
      }
      case "pending-remove":
        return this.removePanel(state);
      case "pending-gain":
        return this.giftPanel(phase.spec);
      case "game-over":
        return gameOverPanel(phase.reason, state, history, this.onRestart);
      case "playing":
      case "pending-move":
      case "pending-attack":
      case "pending-discard":
        return null;
    }
  }

  private cardsContainer(nodes: readonly Node[]): HTMLElement {
    const container = document.createElement("div");
    container.classList.add("overlay-cards");
    setChildren(container, nodes);
    return container;
  }

  /**
   * A card offered as a choice: the card itself (with its mode buttons, disabled
   * outside the hand) and a full-width action button underneath. Any context
   * info (cost, upgrade target) lives in the button text.
   */
  private cardChoice(
    card: Card,
    buttonText: string,
    disabled: boolean,
    onChoose: () => void,
  ): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.classList.add("card-choice");
    const cardEl = cardFace(
      card,
      { index: 0, count: 1, viewOnly: false },
      NOT_IN_HAND,
    );
    setChildren(wrapper, [cardEl, this.button(buttonText, disabled, onChoose)]);
    return wrapper;
  }

  private shopPanel(
    state: GameState,
    stock: readonly Card[],
    rerollCost: number,
  ): HTMLElement {
    const nodes: Node[] = [this.title("Shop")];
    const cardNodes: HTMLElement[] = [];
    for (const card of stock) {
      cardNodes.push(
        this.cardChoice(
          card,
          `Buy — Cost: ${card.cost}`,
          card.cost > state.currency,
          () => this.onAction({ kind: "buy", card }),
        ),
      );
    }
    nodes.push(this.cardsContainer(cardNodes));
    nodes.push(
      this.button(
        `Reroll the stock (${rerollCost})`,
        rerollCost > state.currency,
        () => this.onAction({ kind: "reroll" }),
      ),
    );
    nodes.push(
      this.button("Leave the shop", false, () =>
        this.onAction({ kind: "leave" }),
      ),
    );
    return this.panelElement(nodes);
  }

  private smithSelectionPanel(state: GameState): HTMLElement {
    const nodes: Node[] = [this.title("Smith — upgrade a card")];
    const cardNodes: HTMLElement[] = [];
    for (const card of allCards(state.deck)) {
      if (card.upgradedForm === null) continue;
      cardNodes.push(
        this.cardChoice(
          card,
          `Upgrade — ${card.upgradedForm.name}`,
          false,
          () => {
            this.smithPreviewCardId = card.id;
            this.render(state, this.lastHistory);
          },
        ),
      );
    }
    nodes.push(this.cardsContainer(cardNodes));
    nodes.push(
      this.button("Do nothing", false, () => {
        this.smithPreviewCardId = null;
        this.onAction({ kind: "leave" });
      }),
    );
    return this.panelElement(nodes);
  }

  private smithPreviewPanel(state: GameState): HTMLElement {
    const originalCard = allCards(state.deck).find(
      (c) => c.id === this.smithPreviewCardId,
    );
    if (originalCard === undefined || originalCard.upgradedForm === null) {
      this.smithPreviewCardId = null;
      return this.smithSelectionPanel(state);
    }
    const upgradedCard = instantiate(
      originalCard.upgradedForm,
      originalCard.id,
    );
    const face = { index: 0, count: 1, viewOnly: false };
    const nodes: Node[] = [
      this.title("Upgrade preview"),
      this.cardsContainer([
        cardWithCaption(originalCard, face, NOT_IN_HAND, "Current"),
        cardWithCaption(upgradedCard, face, NOT_IN_HAND, "Upgraded"),
      ]),
      this.button("Confirm upgrade", false, () => {
        const cardId = this.smithPreviewCardId;
        this.smithPreviewCardId = null;
        if (cardId !== null) this.onAction({ kind: "upgrade", cardId });
      }),
      this.button("Select a different card", false, () => {
        this.smithPreviewCardId = null;
        this.render(state, this.lastHistory);
      }),
      this.button("Cancel", false, () => {
        this.smithPreviewCardId = null;
        this.onAction({ kind: "leave" });
      }),
    ];
    return this.panelElement(nodes);
  }

  private removePanel(state: GameState): HTMLElement {
    const nodes: Node[] = [this.title("Remove a card")];
    const cardNodes: HTMLElement[] = [];
    for (const card of allCards(state.deck)) {
      cardNodes.push(
        this.cardChoice(card, "Remove", false, () =>
          this.onAction({ kind: "remove", cardId: card.id }),
        ),
      );
    }
    nodes.push(this.cardsContainer(cardNodes));
    nodes.push(
      this.button("Do nothing", false, () => this.onAction({ kind: "leave" })),
    );
    return this.panelElement(nodes);
  }

  private giftPanel(spec: CardSpec): HTMLElement {
    const giftCard = instantiate(spec, "gift-preview");
    const nodes: Node[] = [
      this.title("Gain a card"),
      this.cardsContainer([
        cardFace(
          giftCard,
          { index: 0, count: 1, viewOnly: false },
          NOT_IN_HAND,
        ),
      ]),
      this.button("Take it", false, () => this.onAction({ kind: "take-gift" })),
      this.button("Skip", false, () => this.onAction({ kind: "leave" })),
    ];
    return this.panelElement(nodes);
  }

  private button(
    text: string,
    disabled: boolean,
    onClick: () => void,
  ): HTMLElement {
    const button = document.createElement("button");
    button.classList.add("hud-button", "feature-button");
    button.textContent = text;
    button.disabled = disabled;
    button.addEventListener("click", onClick);
    return button;
  }

  private title(text: string): HTMLElement {
    const element = document.createElement("div");
    element.classList.add("overlay-title");
    element.textContent = text;
    return element;
  }

  private panelElement(nodes: readonly Node[]): HTMLElement {
    const panel = document.createElement("div");
    panel.classList.add("overlay");
    setChildren(panel, nodes);
    return panel;
  }
}
