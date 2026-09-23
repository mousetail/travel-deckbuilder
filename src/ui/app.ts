import { MapView } from "./map-view";
import { HandView } from "./hand-view";
import { Hud } from "./hud";
import { FeatureView } from "./feature-view";
import { setChildren } from "./dom";
import { hexKey } from "../game/hex";
import type { HexCoord } from "../game/hex";
import type { Card } from "../game/cards";
import type { GameState } from "../game/state";
import { visibleMap } from "../game/fog";
import { applyFeatureAction, useFeature } from "../game/economy";
import type { FeatureAction } from "../game/economy";
import { beginPlay, cancelPending, discardCard, resolveMoveTo } from "../game/turn";

export class App {
  private readonly root: HTMLElement;
  private readonly shell: HTMLDivElement;
  private readonly mapView: MapView;
  private readonly handView: HandView;
  private readonly hud: Hud;
  private readonly featureView: FeatureView;
  private state: GameState;

  constructor(root: HTMLElement, state: GameState) {
    this.root = root;
    this.state = state;

    const mapLayer = document.createElement("div");
    mapLayer.classList.add("map-layer");

    const hudLayer = document.createElement("div");
    hudLayer.classList.add("hud-layer");

    const hudBar = document.createElement("div");
    hudBar.classList.add("hud-bar");

    const handLayer = document.createElement("div");
    handLayer.classList.add("hand-layer");

    const featureLayer = document.createElement("div");
    featureLayer.classList.add("feature-layer");

    setChildren(hudLayer, [hudBar, handLayer, featureLayer]);

    this.shell = document.createElement("div");
    this.shell.classList.add("app");
    setChildren(this.shell, [mapLayer, hudLayer]);

    this.mapView = new MapView(
      mapLayer,
      (coord) => this.handleHexClick(coord),
      () => this.handleCancel(),
    );
    this.handView = new HandView(
      handLayer,
      (card) => this.handlePlay(card),
      (card) => this.handleDiscard(card),
    );
    this.hud = new Hud(hudBar, () => this.handleAction());
    this.featureView = new FeatureView(featureLayer, (action) => this.handleFeatureAction(action));
  }

  mount(): void {
    setChildren(this.root, [this.shell]);
    this.render();
  }

  private render(): void {
    const visible = visibleMap(this.state);
    this.mapView.render(visible.tiles, visible.fog, this.state.map.player, this.reachableKeys());
    this.handView.render(this.state.deck.hand, this.selectedCardId());
    this.hud.render(this.state);
    this.featureView.render(this.state);
  }

  private reachableKeys(): ReadonlySet<string> {
    if (this.state.phase.kind !== "pending-move") {
      return new Set();
    }
    return new Set(this.state.phase.reachable.map(hexKey));
  }

  private selectedCardId(): string | null {
    if (this.state.phase.kind !== "pending-move") {
      return null;
    }
    return this.state.phase.card.id;
  }

  private handlePlay(card: Card): void {
    this.state = beginPlay(this.state, card);
    this.render();
  }

  private handleDiscard(card: Card): void {
    this.state = discardCard(this.state, card);
    this.render();
  }

  private handleHexClick(coord: HexCoord): void {
    if (this.state.phase.kind !== "pending-move") {
      return;
    }
    if (!this.reachableKeys().has(hexKey(coord))) {
      return;
    }
    this.state = resolveMoveTo(this.state, coord);
    this.render();
  }

  private handleCancel(): void {
    this.state = cancelPending(this.state);
    this.render();
  }

  private handleAction(): void {
    this.state = useFeature(this.state);
    this.render();
  }

  private handleFeatureAction(action: FeatureAction): void {
    this.state = applyFeatureAction(this.state, action);
    this.render();
  }
}