import type { Consumable } from "../game/consumables";
import { canUseConsumable } from "../game/consumables";
import type { GameState } from "../game/state";
import { setChildren } from "./dom";

/**
 * The left-edge strip of held consumables. Each is a square button; hovering
 * shows its name and effect. The strip stays live while a shop or pickup window
 * is open, so a consumable can be used to make room; it is inert only while a
 * card is being aimed or the run is over.
 */
export class ConsumablesView {
  private readonly layer: HTMLElement;
  private readonly onUse: (id: string) => void;

  constructor(layer: HTMLElement, onUse: (id: string) => void) {
    this.layer = layer;
    this.onUse = onUse;
  }

  render(state: GameState, busy: boolean): void {
    const interactive =
      !busy &&
      state.phase.kind !== "pending-card" &&
      state.phase.kind !== "game-over";
    const nodes = state.consumables.map((consumable) =>
      this.slot(state, consumable, interactive),
    );
    setChildren(this.layer, [this.header(), ...nodes]);
  }

  private header(): HTMLElement {
    const header = document.createElement("div");
    header.classList.add("consumables-header");
    header.textContent = "Consumables";
    return header;
  }

  private slot(
    state: GameState,
    consumable: Consumable,
    interactive: boolean,
  ): HTMLElement {
    const wrapper = document.createElement("div");
    wrapper.classList.add("consumable-slot");

    const button = document.createElement("button");
    button.classList.add("consumable-button");
    const icon = document.createElement("img");
    icon.classList.add("consumable-icon");
    icon.src = consumable.spec.icon;
    icon.alt = "";
    setChildren(button, [icon]);

    const usable = interactive && canUseConsumable(state, consumable);
    button.disabled = !usable;
    if (usable) {
      button.addEventListener("click", () => this.onUse(consumable.id));
    }

    setChildren(wrapper, [button, this.tooltip(consumable)]);
    return wrapper;
  }

  private tooltip(consumable: Consumable): HTMLElement {
    const tooltip = document.createElement("div");
    tooltip.classList.add("consumable-tooltip");
    const name = document.createElement("div");
    name.classList.add("consumable-tooltip-name");
    name.textContent = consumable.spec.name;
    const description = document.createElement("div");
    description.classList.add("consumable-tooltip-text");
    description.textContent = consumable.spec.description;
    setChildren(tooltip, [name, description]);
    return tooltip;
  }
}
