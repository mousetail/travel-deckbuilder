import type { Card, CardSpec, ShopSlot } from "../game/cards";
import { allCards } from "../game/deck";
import { instantiate, isIndestructible, revertTemporary, upgradeTarget } from "../game/cards";
import { CONSUMABLE_CAPACITY } from "../game/consumables";
import type { Consumable } from "../game/consumables";
import type { FeatureAction } from "../game/economy";
import type { GameState } from "../game/state";
import { COIN_ICON } from "./card-icons";
import { cardFace, cardWithCaption } from "./card-view";
import { setChildren } from "./dom";
import {
  cardStatsPanel,
  financeStatsPanel,
  gameOverPanel,
} from "./game-over-view";
import type { History } from "./stats-store";

/** Modal UI for the shop, smith, removal, gain and game-over phases. */
export class FeatureView {
  private readonly layer: HTMLElement;
  private readonly onAction: (action: FeatureAction) => void;
  private readonly onRestart: () => void;
  private smithPreviewCardId: string | null = null;
  private removePreviewCardId: string | null = null;
  private openStatsModal: "cards" | "finance" | null = null;
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
    setChildren(this.layer, this.panels(state, history));
  }

  /**
   * The panels to show, bottom first. A confirmation (smith upgrade, card
   * removal) is a second panel stacked over the selection it belongs to.
   */
  private panels(state: GameState, history: History): HTMLElement[] {
    const phase = state.phase;
    switch (phase.kind) {
      case "shop":
        return [this.shopPanel(state, phase.stock, phase.rerollCost)];
      case "smith": {
        const preview = this.smithPreview(state);
        if (preview === null) {
          return [this.smithSelectionPanel(state)];
        }
        return [
          this.behindPanel(this.smithSelectionPanel(state)),
          this.smithPreviewPanel(state, preview.card, preview.upgradedForm),
        ];
      }
      case "pending-remove": {
        const card = this.removePreviewCard(state);
        if (card === null) {
          return [this.removePanel(state)];
        }
        return [
          this.behindPanel(this.removePanel(state)),
          this.removeConfirmPanel(state, card),
        ];
      }
      case "pending-gain":
        return [this.giftPanel(phase.card)];
      case "pending-consumable":
        return [this.consumablePanel(state, phase.options)];
      case "game-over": {
        const main = gameOverPanel(
          phase.reason,
          state,
          history,
          this.onRestart,
          () => this.toggleStatsModal("cards", state, history),
          () => this.toggleStatsModal("finance", state, history),
        );
        const modal = this.openStatsModal;
        if (modal === null) {
          return [main];
        }
        main.classList.add("overlay-behind");
        const panel =
          modal === "cards"
            ? cardStatsPanel(
                allCards(state.deck),
                state.stats,
                state.turn,
                () => this.toggleStatsModal("cards", state, history),
              )
            : financeStatsPanel(state.stats.currency, () =>
                this.toggleStatsModal("finance", state, history),
              );
        return [main, panel];
      }
      case "playing":
      case "pending-card":
      case "pending-discard":
      case "pending-sleep":
      case "pending-search":
      case "pending-store":
      case "pending-wall":
        return [];
    }
  }

  private toggleStatsModal(
    kind: "cards" | "finance",
    state: GameState,
    history: History,
  ): void {
    this.openStatsModal = this.openStatsModal === kind ? null : kind;
    this.render(state, history);
  }

  /** The card the smith preview is showing, with its upgraded form. */
  private smithPreview(
    state: GameState,
  ): { card: Card; upgradedForm: CardSpec } | null {
    if (this.smithPreviewCardId === null) {
      return null;
    }
    const card = allCards(state.deck).find(
      (c) => c.id === this.smithPreviewCardId,
    );
    const upgradedForm = card === undefined ? null : upgradeTarget(card);
    if (card === undefined || upgradedForm === null) {
      this.smithPreviewCardId = null;
      return null;
    }
    return { card, upgradedForm };
  }

  /** The card the removal confirmation is showing. */
  private removePreviewCard(state: GameState): Card | null {
    if (this.removePreviewCardId === null) {
      return null;
    }
    const card = allCards(state.deck).find(
      (c) => c.id === this.removePreviewCardId,
    );
    if (card === undefined) {
      this.removePreviewCardId = null;
      return null;
    }
    return card;
  }

  private cardsContainer(nodes: readonly Node[]): HTMLElement {
    const container = document.createElement("div");
    container.classList.add("overlay-cards");
    setChildren(container, nodes);
    return container;
  }

  /**
   * A card offered as a choice: the card itself is the button, with an optional
   * caption underneath (cost in the shop, upgrade target at the smith). A
   * disabled card is greyed out and ignores clicks.
   */
  private cardChoice(
    card: Card,
    caption: Node | null,
    disabled: boolean,
    onChoose: () => void,
  ): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.classList.add("card-choice");
    const cardEl = cardFace(card, { index: 0, count: 1, viewOnly: false });
    if (disabled) {
      cardEl.classList.add("card-disabled");
    } else {
      cardEl.addEventListener("click", onChoose);
    }
    const nodes: Node[] = [cardEl];
    if (caption !== null) {
      nodes.push(caption);
    }
    setChildren(wrapper, nodes);
    return wrapper;
  }

  /** The price line under a shop card: a coin icon and the cost. */
  private costCaption(cost: number): HTMLElement {
    const caption = document.createElement("div");
    caption.classList.add("card-choice-caption");
    const icon = document.createElement("img");
    icon.classList.add("card-symbol-icon");
    icon.src = COIN_ICON;
    icon.alt = "";
    caption.append(icon, document.createTextNode(`${cost}`));
    return caption;
  }

  private textCaption(text: string): HTMLElement {
    const caption = document.createElement("div");
    caption.classList.add("card-choice-caption");
    caption.textContent = text;
    return caption;
  }

  private shopPanel(
    state: GameState,
    stock: readonly (ShopSlot | null)[],
    rerollCost: number,
  ): HTMLElement {
    const nodes: Node[] = [this.title("Shop")];
    const cardNodes: HTMLElement[] = [];
    for (const slot of stock) {
      if (slot === null) {
        cardNodes.push(this.emptySlot());
        continue;
      }
      cardNodes.push(
        this.cardChoice(
          slot.card,
          this.costCaption(slot.cost),
          slot.cost > state.currency,
          () =>
            this.onAction({ kind: "buy", card: slot.card, cost: slot.cost }),
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
      const target = upgradeTarget(card);
      if (target === null) continue;
      // Show the base card, so a temporary upgrade reads as the smith's target.
      const base = revertTemporary(card);
      cardNodes.push(
        this.cardChoice(
          base,
          this.textCaption(`Upgrade — ${target.name}`),
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

  private smithPreviewPanel(
    state: GameState,
    originalCard: Card,
    upgradedForm: CardSpec,
  ): HTMLElement {
    // Preview from the base form, so the temporary upgrade reads as permanent.
    const currentCard = revertTemporary(originalCard);
    const upgradedCard = instantiate(upgradedForm, originalCard.id);
    const face = { index: 0, count: 1, viewOnly: false };
    const nodes: Node[] = [
      this.title("Upgrade preview"),
      this.cardsContainer([
        cardWithCaption(currentCard, face, "Current"),
        cardWithCaption(upgradedCard, face, "Upgraded"),
      ]),
      this.button("Confirm upgrade", false, () => {
        const cardId = this.smithPreviewCardId;
        this.smithPreviewCardId = null;
        if (cardId !== null) this.onAction({ kind: "upgrade", cardId });
      }),
      this.button("Cancel", false, () => {
        this.smithPreviewCardId = null;
        this.render(state, this.lastHistory);
      }),
    ];
    return this.confirmElement(nodes);
  }

  private removePanel(state: GameState): HTMLElement {
    const nodes: Node[] = [this.title("Remove a card")];
    const cardNodes: HTMLElement[] = [];
    for (const card of allCards(state.deck)) {
      if (isIndestructible(card)) continue;
      cardNodes.push(
        this.cardChoice(card, null, false, () => {
          this.removePreviewCardId = card.id;
          this.render(state, this.lastHistory);
        }),
      );
    }
    nodes.push(this.cardsContainer(cardNodes));
    nodes.push(
      this.button("Do nothing", false, () => this.onAction({ kind: "leave" })),
    );
    return this.panelElement(nodes);
  }

  private removeConfirmPanel(state: GameState, card: Card): HTMLElement {
    const nodes: Node[] = [
      this.title("Remove this card?"),
      this.cardsContainer([
        cardFace(card, { index: 0, count: 1, viewOnly: false }),
      ]),
      this.button("Confirm removal", false, () => {
        const cardId = this.removePreviewCardId;
        this.removePreviewCardId = null;
        if (cardId !== null) this.onAction({ kind: "remove", cardId });
      }),
      this.button("Cancel", false, () => {
        this.removePreviewCardId = null;
        this.render(state, this.lastHistory);
      }),
    ];
    return this.confirmElement(nodes);
  }

  /** The pickup space: two rolled consumables, or a skip. Taking is disabled
   * while the player already holds three, but the offer is still shown. */
  private consumablePanel(
    state: GameState,
    options: readonly Consumable[],
  ): HTMLElement {
    const full = state.consumables.length >= CONSUMABLE_CAPACITY;
    const nodes: Node[] = [this.title("Take a consumable")];
    nodes.push(
      this.cardsContainer(
        options.map((consumable) =>
          this.consumableChoice(consumable, full, () =>
            this.onAction({ kind: "take-consumable", consumable }),
          ),
        ),
      ),
    );
    nodes.push(
      this.button("Skip", false, () => this.onAction({ kind: "leave" })),
    );
    return this.panelElement(nodes);
  }

  private consumableChoice(
    consumable: Consumable,
    disabled: boolean,
    onChoose: () => void,
  ): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.classList.add("consumable-choice");
    const button = document.createElement("button");
    button.classList.add("consumable-choice-button");
    const icon = document.createElement("img");
    icon.classList.add("consumable-icon");
    icon.src = consumable.spec.icon;
    icon.alt = "";
    const name = document.createElement("div");
    name.classList.add("consumable-choice-name");
    name.textContent = consumable.spec.name;
    const description = document.createElement("div");
    description.classList.add("consumable-choice-text");
    description.textContent = consumable.spec.description;
    setChildren(button, [icon, name, description]);
    button.disabled = disabled;
    if (!disabled) {
      button.addEventListener("click", onChoose);
    }
    setChildren(wrapper, [button]);
    return wrapper;
  }

  private giftPanel(card: Card | null): HTMLElement {
    const nodes: Node[] = [this.title("Gain a card")];
    if (card === null) {
      nodes.push(this.cardsContainer([this.emptySlot()]));
      nodes.push(
        this.button("Leave", false, () => this.onAction({ kind: "leave" })),
      );
      return this.panelElement(nodes);
    }
    nodes.push(
      this.cardsContainer([
        this.cardChoice(card, null, false, () =>
          this.onAction({ kind: "take-gift" }),
        ),
      ]),
    );
    nodes.push(
      this.button("Skip", false, () => this.onAction({ kind: "leave" })),
    );
    return this.panelElement(nodes);
  }

  /** A gap left by a card that has already been taken. */
  private emptySlot(): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.classList.add("card-choice");
    const slot = document.createElement("div");
    slot.classList.add("card-slot-empty");
    setChildren(wrapper, [slot]);
    return wrapper;
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

  /** A panel with a confirmation stacked over it: it stops taking clicks. */
  private behindPanel(panel: HTMLElement): HTMLElement {
    panel.classList.add("overlay-behind");
    return panel;
  }

  private confirmElement(nodes: readonly Node[]): HTMLElement {
    const panel = this.panelElement(nodes);
    panel.classList.add("overlay-confirm");
    return panel;
  }
}
