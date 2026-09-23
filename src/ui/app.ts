import { MapView } from "./map-view";
import { HandView } from "./hand-view";
import { Hud } from "./hud";
import { FeatureView } from "./feature-view";
import { setChildren } from "./dom";
import { hexKey } from "../game/hex";
import type { HexCoord } from "../game/hex";
import type { Card, CardMode } from "../game/cards";
import type { GameState } from "../game/state";
import { visibleMap } from "../game/fog";
import { dangerZone, enemiesInRange } from "../game/enemies";
import { applyFeatureAction, useFeature } from "../game/economy";
import type { FeatureAction } from "../game/economy";
import {
  beginPlay,
  cancelPending,
  discardCard,
  discardForChoice,
  modeIsAvailable,
  resolveAttack,
  resolveMoveTo,
} from "../game/turn";

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
      (card, modeIndex) => this.handlePlay(card, modeIndex),
      (card) => this.handleDiscard(card),
      (card, modeIndex) => this.modeAvailable(card, modeIndex),
    );
    this.hud = new Hud(
      hudBar,
      () => this.handleAction(),
      () => this.handleCancel(),
    );
    this.featureView = new FeatureView(featureLayer, (action) => this.handleFeatureAction(action));
  }

  mount(): void {
    setChildren(this.root, [this.shell]);
    this.render();
  }

  private render(): void {
    const visible = visibleMap(this.state);
    this.mapView.render({
      tiles: visible.tiles,
      fog: visible.fog,
      player: this.state.map.player,
      reachable: this.reachableKeys(),
      enemies: this.state.enemies,
      targets: this.targets(),
      danger: dangerZone(this.state),
      turn: this.state.turn,
    });
    this.handView.render(
      this.state.deck.hand,
      this.selectedCardId(),
      this.state.phase.kind === "pending-discard",
    );
    this.hud.render(this.state);
    this.featureView.render(this.state);
  }

  private reachableKeys(): ReadonlySet<string> {
    if (this.state.phase.kind !== "pending-move") {
      return new Set();
    }
    return new Set(this.state.phase.reachable.map(hexKey));
  }

  /** Enemies the player may currently attack. */
  private targets(): ReadonlySet<string> {
    const phase = this.state.phase;
    if (phase.kind !== "pending-attack") {
      return new Set();
    }
    return new Set(
      enemiesInRange(this.state.enemies, this.state.map.player, phase.range).map((e) => e.id),
    );
  }

  private selectedCardId(): string | null {
    if (this.state.phase.kind !== "pending-move") {
      return null;
    }
    return this.state.phase.card.id;
  }

  private modeAvailable(card: Card, modeIndex: number): boolean {
    if (this.state.phase.kind !== "playing") {
      return false;
    }
    const mode: CardMode | undefined = card.modes[modeIndex];
    return mode !== undefined && modeIsAvailable(this.state, mode);
  }

  private handlePlay(card: Card, modeIndex: number): void {
    this.state = beginPlay(this.state, card, modeIndex);
    this.render();
  }

  private handleDiscard(card: Card): void {
    this.state =
      this.state.phase.kind === "pending-discard"
        ? discardForChoice(this.state, card)
        : discardCard(this.state, card);
    this.render();
  }

  private handleHexClick(coord: HexCoord): void {
    const phase = this.state.phase;
    if (phase.kind === "pending-attack") {
      const target = this.state.enemies.find(
        (enemy) => this.targets().has(enemy.id) && hexKey(enemy.position) === hexKey(coord),
      );
      if (target !== undefined) {
        this.state = resolveAttack(this.state, target.id);
        this.render();
      }
      return;
    }
    if (phase.kind !== "pending-move") {
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
