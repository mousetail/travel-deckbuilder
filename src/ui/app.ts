import { MapView } from "./map-view";
import { Animator, prefersReducedMotion } from "./animator";
import { HandView } from "./hand-view";
import { Hud } from "./hud";
import { FeatureView } from "./feature-view";
import { pileButton, pileOverlay } from "./pile-view";
import { setChildren } from "./dom";
import { hexKey, hexToPixel } from "../game/hex";
import type { HexCoord } from "../game/hex";
import type { Card, CardMode } from "../game/cards";
import type { GameState, Phase } from "../game/state";
import type { MovePath, Transition } from "../game/transition";
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

type Pile = "draw" | "discard";

export class App {
  private readonly root: HTMLElement;
  private readonly shell: HTMLDivElement;
  private readonly mapView: MapView;
  private readonly animator: Animator;
  private readonly handView: HandView;
  private readonly hud: Hud;
  private readonly featureView: FeatureView;
  private readonly middle: HTMLElement;
  private readonly drawSlot: HTMLElement;
  private readonly discardSlot: HTMLElement;
  private readonly actionSlot: HTMLElement;
  private openPile: Pile | null = null;
  /** True while a movement animation plays; input is ignored until it ends. */
  private animating = false;
  private state: GameState;

  constructor(root: HTMLElement, state: GameState) {
    this.root = root;
    this.state = state;

    const mapLayer = element("div", "map-layer");
    const hudLayer = element("div", "hud-layer");
    const topBar = element("div", "hud-top");
    this.middle = element("div", "hud-middle");
    const bottomBar = element("div", "hud-bottom");
    const handLayer = element("div", "hand");
    this.drawSlot = element("div", "pile-slot");
    this.discardSlot = element("div", "pile-slot");
    this.actionSlot = element("div", "hud-action");

    setChildren(bottomBar, [this.drawSlot, handLayer, this.discardSlot, this.actionSlot]);
    setChildren(hudLayer, [topBar, this.middle, bottomBar]);

    this.shell = element("div", "app");
    setChildren(this.shell, [mapLayer, hudLayer]);

    this.mapView = new MapView(
      mapLayer,
      (coord) => this.handleHexClick(coord),
      () => this.handleCancel(),
    );
    this.animator = new Animator(this.mapView);
    this.handView = new HandView(
      handLayer,
      (card, modeIndex) => this.handlePlay(card, modeIndex),
      (card) => this.handleDiscard(card),
      (card, modeIndex) => this.modeAvailable(card, modeIndex),
    );
    this.hud = new Hud(
      topBar,
      () => this.handleAction(),
      () => this.handleCancel(),
    );
    this.featureView = new FeatureView(this.middle, (action) => this.handleFeatureAction(action));
  }

  mount(): void {
    setChildren(this.root, [this.shell]);
    this.render();
  }

  /**
   * Adopt a transition: store its state, then show the movements it reported.
   * The state is always the destination, so input is locked while the marker
   * catches up to it.
   */
  private apply(next: Transition): void {
    this.state = next.state;
    if (next.moves.length === 0 || prefersReducedMotion()) {
      this.render();
      return;
    }
    void this.animate(next.moves);
  }

  private async animate(moves: readonly MovePath[]): Promise<void> {
    this.animating = true;
    this.render();
    this.animator.prepare(moves);
    try {
      for (const move of moves) {
        // An enemy moves while the player watches, so settle the camera on it
        // and hold a beat either side, giving the eye time to land on what is
        // about to move and where it stopped. The player's own move needs
        // neither: the camera is already on them.
        const watched = move.mover.kind === "enemy";
        if (watched) {
          await this.animator.focusOn(hexToPixel(move.path[0]));
          await this.animator.beat();
        }
        await this.animator.moveAlong(move.mover, move.path);
        if (watched) {
          await this.animator.beat();
        }
      }
      await this.animator.focusOn(hexToPixel(this.state.map.player));
    } finally {
      this.animating = false;
      this.render();
    }
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
    // Mid-animation the animator owns the camera; otherwise keep it on the player.
    if (!this.animating) {
      this.animator.snap(hexToPixel(this.state.map.player));
    }
    this.handView.render(
      this.state.deck.hand,
      this.selectedCardId(),
      this.state.phase.kind === "pending-discard",
    );
    this.hud.render(this.state);
    this.hud.renderAction(this.actionSlot, this.state, this.animating);

    setChildren(this.drawSlot, [
      pileButton("Draw", this.state.deck.draw.length, "draw", () => this.togglePile("draw")),
    ]);
    setChildren(this.discardSlot, [
      pileButton("Discard", this.state.deck.discard.length, "discard", () => this.togglePile("discard")),
    ]);
    this.renderMiddle();
  }

  /** A modal phase takes over the middle band; otherwise a pile may be open. */
  private renderMiddle(): void {
    // Hold back modals until the movement finishes, so a fatal enemy phase is
    // shown only after the assassin has actually reached the player.
    if (this.animating) {
      setChildren(this.middle, []);
      return;
    }
    if (isModalPhase(this.state.phase)) {
      this.openPile = null;
      this.featureView.render(this.state);
      return;
    }
    if (this.openPile === null) {
      this.featureView.render(this.state);
      return;
    }
    const pile = this.openPile;
    const cards = pile === "draw" ? this.state.deck.draw : this.state.deck.discard;
    const title = pile === "draw" ? "Draw pile" : "Discard pile";
    setChildren(this.middle, [pileOverlay(title, cards, () => this.closePile())]);
  }

  private togglePile(pile: Pile): void {
    if (this.animating) {
      return;
    }
    this.openPile = this.openPile === pile ? null : pile;
    this.render();
  }

  private closePile(): void {
    this.openPile = null;
    this.render();
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
    if (this.animating || this.state.phase.kind !== "playing") {
      return false;
    }
    const mode: CardMode | undefined = card.modes[modeIndex];
    return mode !== undefined && modeIsAvailable(this.state, mode);
  }

  private handlePlay(card: Card, modeIndex: number): void {
    if (this.animating) {
      return;
    }
    this.apply(beginPlay(this.state, card, modeIndex));
  }

  private handleDiscard(card: Card): void {
    if (this.animating) {
      return;
    }
    this.apply(
      this.state.phase.kind === "pending-discard"
        ? discardForChoice(this.state, card)
        : discardCard(this.state, card),
    );
  }

  private handleHexClick(coord: HexCoord): void {
    if (this.animating) {
      return;
    }
    const phase = this.state.phase;
    if (phase.kind === "pending-attack") {
      const target = this.state.enemies.find(
        (enemy) => this.targets().has(enemy.id) && hexKey(enemy.position) === hexKey(coord),
      );
      if (target !== undefined) {
        this.apply(resolveAttack(this.state, target.id));
      }
      return;
    }
    if (phase.kind !== "pending-move") {
      return;
    }
    if (!this.reachableKeys().has(hexKey(coord))) {
      return;
    }
    this.apply(resolveMoveTo(this.state, coord));
  }

  private handleCancel(): void {
    if (this.animating) {
      return;
    }
    this.apply(cancelPending(this.state));
  }

  private handleAction(): void {
    if (this.animating) {
      return;
    }
    this.apply(useFeature(this.state));
  }

  private handleFeatureAction(action: FeatureAction): void {
    if (this.animating) {
      return;
    }
    this.apply(applyFeatureAction(this.state, action));
  }
}

function element(tag: "div", className: string): HTMLDivElement {
  const node = document.createElement(tag);
  node.classList.add(className);
  return node;
}

function isModalPhase(phase: Phase): boolean {
  switch (phase.kind) {
    case "shop":
    case "smith":
    case "pending-remove":
    case "pending-gain":
    case "game-over":
      return true;
    case "playing":
    case "pending-move":
    case "pending-attack":
    case "pending-discard":
      return false;
  }
}
