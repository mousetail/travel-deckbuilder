import { MapView } from "./map-view";
import { Animator, prefersReducedMotion } from "./animator";
import { HandView } from "./hand-view";
import type { HandMode } from "./hand-view";
import { Hud } from "./hud";
import { FeatureView } from "./feature-view";
import { ConsumablesView } from "./consumables-view";
import { HelpView } from "./help-view";
import {
  pileButton,
  pileOverlay,
  searchOverlay,
} from "./pile-view";
import {
  CardAnimator,
  deckDiff,
  RESHUFFLE_DRAW_DELAY_MS,
} from "./card-animations";
import type { DeckDiff } from "./card-animations";
import { setChildren } from "./dom";
import { equalsHex, hexKey, hexToPixel } from "../game/hex";
import type { HexCoord } from "../game/hex";
import type { Card } from "../game/cards";
import type { Deck, GameState, Phase } from "../game/state";
import type { MovePath, Transition } from "../game/transition";
import { visibleEnemies, visibleMap } from "../game/fog";
import { dangerZone, enemyDangerZones } from "../game/enemies";
import { applyFeatureAction, useFeature } from "../game/economy";
import type { FeatureAction } from "../game/economy";
import { useConsumable, mimicPosition } from "../game/consumables";
import { runScores } from "../game/stats";
import { foldRun, runOutcome } from "../game/career";
import { loadHistory, recordRun, saveHistory } from "./stats-store";
import type { History } from "./stats-store";
import { loadCareer, saveCareer } from "./career-store";
import { buildRunReport, uploadRunReport } from "./run-report";
import {
  beginPlay,
  cancelPending,
  cardIsPlayable,
  chooseWall,
  confirmStore,
  discardCard,
  discardForChoice,
  resolveAttack,
  resolveMoveTo,
  searchForChoice,
  sleepForChoice,
  toggleStoreChoice,
} from "../game/turn";
import {
  bestAttackCard,
  bestMoveCard,
  handReach,
  hoverPaths,
} from "../game/reach";
import type { HoverPath } from "../game/reach";
import { hexagonSideWallEdges, sideToward } from "../game/walls";
import type { WallEdge } from "../game/walls";
import type { HighlightGroup } from "./map-view";

type Pile = "draw" | "discard";

/** Per-run details that only the end-of-run report needs. */
export type RunInfo = {
  seed: number;
  /** Wall-clock time the run began, for the report's duration. */
  startedAt: number;
  /** Whether the player opted in to sharing this run's data. */
  share: boolean;
};

/** The highlight key for the union across the whole hand. */
const UNION_KEY = "union";

export class App {
  private readonly root: HTMLElement;
  private readonly shell: HTMLDivElement;
  private readonly mapView: MapView;
  private readonly animator: Animator;
  private readonly handView: HandView;
  private readonly hud: Hud;
  private readonly featureView: FeatureView;
  private readonly consumablesView: ConsumablesView;
  private readonly helpView: HelpView;
  private readonly middle: HTMLElement;
  private readonly bottomBar: HTMLElement;
  private readonly handLayer: HTMLElement;
  private readonly drawSlot: HTMLElement;
  private readonly discardSlot: HTMLElement;
  private readonly actionSlot: HTMLElement;
  private readonly consumablesSlot: HTMLElement;
  private readonly cardAnimator: CardAnimator;
  /** The deck as of the last render, so card movements can be animated. */
  private previousDeck: Deck;
  private openPile: Pile | null = null;
  /** True while a movement animation plays; input is ignored until it ends. */
  private animating = false;
  /** The card highlighted by hover (hovering it or a tile), playing only. */
  private hoveredCard: Card | null = null;
  /** The wall side the hovered hex would place while a Wall is being aimed. */
  private hoveredWallSide: number | null = null;
  /** Best card per hovered tile, valid until the next state change. */
  private readonly bestCardCache = new Map<string, Card | null>();
  /** Paths per hovered tile, valid until the next state change. */
  private readonly hoverPathCache = new Map<string, HoverPath[]>();
  /** The finished run is folded into saved history exactly once. */
  private recordedGameOver = false;
  /** Saved records, updated as runs finish. */
  private history: History;
  /** The records as they stood before this run, for the grey comparison columns. */
  private previousHistory: History;
  private readonly runInfo: RunInfo;
  private state: GameState;

  constructor(
    root: HTMLElement,
    state: GameState,
    restart: () => void,
    previousDeck: Deck,
    runInfo: RunInfo,
  ) {
    this.root = root;
    this.state = state;
    this.previousDeck = previousDeck;
    this.runInfo = runInfo;
    this.history = loadHistory();
    this.previousHistory = this.history;

    const mapLayer = element("div", "map-layer");
    const hudLayer = element("div", "hud-layer");
    const topBar = element("div", "hud-top");
    const middleRow = element("div", "hud-middle");
    this.middle = element("div", "hud-overlay");
    const bottomBar = element("div", "hud-bottom");
    this.handLayer = element("div", "hand");
    this.drawSlot = element("div", "pile-slot");
    this.discardSlot = element("div", "pile-slot");
    this.actionSlot = element("div", "hud-action");
    this.consumablesSlot = element("div", "hud-consumables");

    setChildren(middleRow, [
      this.middle,
      this.consumablesSlot,
      this.actionSlot,
    ]);
    setChildren(bottomBar, [this.drawSlot, this.handLayer, this.discardSlot]);
    setChildren(hudLayer, [topBar, middleRow, bottomBar]);
    this.bottomBar = bottomBar;

    this.shell = element("div", "app");
    const animationLayer = element("div", "card-animation-layer");
    const helpLayer = element("div", "help-layer");
    setChildren(this.shell, [mapLayer, hudLayer, animationLayer, helpLayer]);
    this.cardAnimator = new CardAnimator(animationLayer);
    this.helpView = new HelpView(helpLayer);

    this.mapView = new MapView(
      mapLayer,
      (coord) => this.handleHexClick(coord),
      (coord) => this.handleHexHover(coord),
      () => this.handleCancel(),
    );
    this.animator = new Animator(this.mapView);
    this.handView = new HandView(
      this.handLayer,
      (card) => this.handlePlay(card),
      (card) => this.handleDiscard(card),
      (card) => this.handleSleep(card),
      (card) => this.handleStoreToggle(card),
      (card) => this.cardPlayable(card),
      (card) => this.handleCardHover(card),
    );
    this.hud = new Hud(
      topBar,
      () => this.handleAction(),
      () => this.handleCancel(),
      () => this.handleStoreConfirm(),
      () => this.helpView.toggle(),
    );
    this.featureView = new FeatureView(
      this.middle,
      (action) => this.handleFeatureAction(action),
      restart,
    );
    this.consumablesView = new ConsumablesView(this.consumablesSlot, (id) =>
      this.handleUseConsumable(id),
    );
  }

  mount(): void {
    setChildren(this.root, [this.shell]);
    window.addEventListener("resize", this.onResize);
    this.render();
  }

  /**
   * A resize moves the card band, so re-measure it and re-centre the camera.
   * Removes itself once this app has been replaced by a restart.
   */
  private readonly onResize = (): void => {
    if (!this.shell.isConnected) {
      window.removeEventListener("resize", this.onResize);
      return;
    }
    this.updateMapInset();
    if (!this.animating) {
      this.animator.snap(hexToPixel(this.state.map.player));
    }
  };

  /**
   * Adopt a transition: store its state, then show the movements it reported.
   * The state is always the destination, so input is locked while the marker
   * catches up to it.
   */
  private apply(next: Transition): void {
    this.state = next.state;
    this.hoveredCard = null;
    this.hoveredWallSide = null;
    this.captureGameOver(next.state);
    if (next.moves.length === 0 || prefersReducedMotion()) {
      this.render();
      return;
    }
    void this.animate(next.moves);
  }

  /** Fold a finished run into the saved history, once, before it is shown. */
  private captureGameOver(state: GameState): void {
    if (this.recordedGameOver || state.phase.kind !== "game-over") {
      return;
    }
    this.recordedGameOver = true;
    const scores = runScores(state.stats);
    this.previousHistory = this.history;
    this.history = recordRun(this.history, state.playerSectionOrder, scores);
    saveHistory(this.history);
    const career = foldRun(
      loadCareer(),
      runOutcome(state.phase.reason, state.stats),
    );
    saveCareer(career);
    if (this.runInfo.share) {
      uploadRunReport(
        buildRunReport(
          scores,
          state.stats,
          career,
          state.anomalies,
          this.runInfo.seed,
          this.runInfo.startedAt,
        ),
      );
    }
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
    this.bestCardCache.clear();
    this.hoverPathCache.clear();
    this.mapView.setHoverPaths([]);
    const oldHand = this.handCardRects();
    const visible = visibleMap(this.state);
    this.mapView.render({
      tiles: visible.tiles,
      fog: visible.fog,
      fogEdge: visible.fogEdge,
      player: this.state.map.player,
      enemies: visibleEnemies(this.state),
      danger: dangerZone(this.state),
      enemyDanger: enemyDangerZones(this.state),
      turn: this.state.turn,
      trivialTerrain: this.state.terrainTrivialTurns > 0,
      highlights: this.highlightGroups(),
      activeHighlight: this.activeHighlightKey(),
      killable: this.killableEnemies(),
      walls: this.state.walls,
      mimic: mimicPosition(this.state),
    });
    this.mapView.setWallPreview(this.wallPreviewEdges());
    this.renderHand();
    this.hud.render(this.state);
    this.consumablesView.render(this.state, this.animating);
    if (isModalPhase(this.state.phase)) {
      setChildren(this.actionSlot, []);
    } else {
      this.hud.renderAction(this.actionSlot, this.state, this.animating);
    }

    setChildren(this.drawSlot, [
      pileButton("Draw", this.state.deck.draw.length, "draw", () =>
        this.togglePile("draw"),
      ),
    ]);
    setChildren(this.discardSlot, [
      pileButton("Discard", this.state.deck.discard.length, "discard", () =>
        this.togglePile("discard"),
      ),
    ]);
    this.renderMiddle();
    this.updateMapInset();
    // Mid-animation the animator owns the camera; otherwise keep it on the player.
    if (!this.animating) {
      this.animator.snap(hexToPixel(this.state.map.player));
    }

    if (!prefersReducedMotion()) {
      this.animateDeck(deckDiff(this.previousDeck, this.state.deck), oldHand);
    }
    this.previousDeck = this.state.deck;
  }

  /**
   * Tell the map how much of its bottom edge the card band covers, so the
   * camera centres actors in the visible area above the cards rather than the
   * geometric centre that the cards sit over.
   */
  private updateMapInset(): void {
    const viewport = this.mapView.viewportSize();
    const cardsTop = this.bottomBar.getBoundingClientRect().top;
    this.mapView.setBottomInset(Math.max(0, viewport.height - cardsTop));
  }

  /** Every hand card's screen rect, keyed by card id. */
  private handCardRects(): Map<string, DOMRect> {
    const rects = new Map<string, DOMRect>();
    for (const node of this.handLayer.querySelectorAll(".card")) {
      const id = node.getAttribute("data-card-id");
      if (id !== null) {
        rects.set(id, node.getBoundingClientRect());
      }
    }
    return rects;
  }

  /** Fly ghosts for every card that moved between the piles and the hand. */
  private animateDeck(
    diff: DeckDiff,
    oldHand: ReadonlyMap<string, DOMRect>,
  ): void {
    const drawRect = this.drawSlot.getBoundingClientRect();
    const discardRect = this.discardSlot.getBoundingClientRect();

    if (diff.reshuffled > 0) {
      this.cardAnimator.reshuffle(discardRect, drawRect, diff.reshuffled);
    }

    const newHand = this.handCardRects();
    const drawDelay = diff.reshuffled > 0 ? RESHUFFLE_DRAW_DELAY_MS : 0;
    for (const { card, from } of diff.drawn) {
      const to = newHand.get(card.id);
      if (to !== undefined) {
        this.cardAnimator.drawCard(
          from === "draw" ? drawRect : discardRect,
          to,
          drawDelay,
        );
      }
    }
    for (const card of diff.discarded) {
      const from = oldHand.get(card.id);
      if (from !== undefined) {
        this.cardAnimator.discardCard(card, from, discardRect);
      }
    }
  }

  /** The wall preview to draw: the hovered side's wall while placing, else none. */
  private wallPreviewEdges(): readonly WallEdge[] {
    const phase = this.state.phase;
    if (phase.kind !== "pending-wall" || this.hoveredWallSide === null) {
      return [];
    }
    const tiles = visibleMap(this.state).tiles;
    return hexagonSideWallEdges(
      this.state.map.player,
      this.hoveredWallSide,
      phase.radius,
    ).filter(
      (edge) =>
        tiles.has(hexKey(edge.from)) && tiles.has(hexKey(edge.to)),
    );
  }

  private renderHand(): void {
    this.handView.render(
      this.state.deck.hand,
      this.selectedCardId(),
      this.hoveredCard?.id ?? null,
      this.handMode(),
    );
  }

  /** What a hand click does, given the current phase. */
  private handMode(): HandMode {
    switch (this.state.phase.kind) {
      case "pending-discard":
        return { kind: "discard" };
      case "pending-sleep":
        return { kind: "sleep" };
      case "pending-search":
        return { kind: "none" };
      case "pending-store":
        return {
          kind: "store",
          selected: new Set(this.state.phase.selected),
          binId: this.state.phase.card.id,
        };
      case "pending-wall":
        return { kind: "none" };
      case "playing":
      case "pending-card":
      case "pending-remove":
      case "pending-gain":
      case "pending-consumable":
      case "shop":
      case "smith":
      case "game-over":
        return { kind: "play" };
    }
  }

  /** A modal phase takes over the middle band; otherwise a pile may be open. */
  private renderMiddle(): void {
    // Hold back modals until the movement finishes, so a fatal enemy phase is
    // shown only after the assassin has actually reached the player.
    if (this.animating) {
      setChildren(this.middle, []);
      return;
    }
    if (this.state.phase.kind === "pending-search") {
      this.openPile = null;
      setChildren(this.middle, [
        searchOverlay(this.state.deck.draw, (card) =>
          this.handleSearchChoice(card),
        ),
      ]);
      return;
    }
    if (isModalPhase(this.state.phase)) {
      this.openPile = null;
      this.featureView.render(this.state, this.previousHistory);
      return;
    }
    if (this.openPile === null) {
      this.featureView.render(this.state, this.previousHistory);
      return;
    }
    const pile = this.openPile;
    const cards =
      pile === "draw" ? this.state.deck.draw : this.state.deck.discard;
    const title = pile === "draw" ? "Draw pile" : "Discard pile";
    setChildren(this.middle, [
      pileOverlay(title, cards, () => this.closePile()),
    ]);
  }

  private togglePile(pile: Pile): void {
    if (this.animating) {
      return;
    }
    this.openPile = this.openPile === pile ? null : pile;
    this.hoveredCard = null;
    this.render();
  }

  private closePile(): void {
    this.openPile = null;
    this.render();
  }

  /**
   * Every possible highlight, pre-computed so hover can just show/hide: the
   * union across the hand, plus one group per card in hand.
   */
  private highlightGroups(): HighlightGroup[] {
    const hand = handReach(this.state);
    const groups = hand.cards.map((reach) => ({
      key: reach.card.id,
      reachable: new Set(
        reach.moves.flatMap((move) => move.reachable).map(hexKey),
      ),
      targets: new Set(
        reach.attacks
          .flatMap((attack) => attack.targets)
          .map((enemy) => enemy.id),
      ),
    }));
    groups.unshift({
      key: UNION_KEY,
      reachable: new Set(hand.reachable.map(hexKey)),
      targets: new Set(hand.targets.map((enemy) => enemy.id)),
    });
    return groups;
  }

  /** Enemy ids that clicking would kill right now, so the cursor shows a reticle. */
  private killableEnemies(): ReadonlySet<string> {
    const phase = this.state.phase;
    if (phase.kind === "pending-card") {
      return new Set(phase.targets.map((enemy) => enemy.id));
    }
    if (phase.kind !== "playing") {
      return new Set();
    }
    const killable = new Set<string>();
    for (const enemy of this.state.enemies) {
      if (bestAttackCard(this.state, enemy.id) !== null) {
        killable.add(enemy.id);
      }
    }
    return killable;
  }

  /** Which highlight is visible right now. */
  private activeHighlightKey(): string | null {
    const phase = this.state.phase;
    if (phase.kind === "pending-card") {
      return phase.card.id;
    }
    if (phase.kind === "playing") {
      return this.hoveredCard?.id ?? UNION_KEY;
    }
    return null;
  }

  private selectedCardId(): string | null {
    if (this.state.phase.kind !== "pending-card") {
      return null;
    }
    return this.state.phase.card.id;
  }

  private cardPlayable(card: Card): boolean {
    if (this.animating || this.state.phase.kind !== "playing") {
      return false;
    }
    return cardIsPlayable(this.state, card);
  }

  private handleCardHover(card: Card | null): void {
    this.setHoveredCard(card);
  }

  private handleHexHover(coord: HexCoord | null): void {
    this.setHoveredCard(this.bestCardFor(coord));
    this.updateHoverPaths(coord);
    this.updateWallHover(coord);
  }

  /** Track which wall side the hovered hex would place, and preview it. */
  private updateWallHover(coord: HexCoord | null): void {
    const phase = this.state.phase;
    this.hoveredWallSide =
      phase.kind === "pending-wall" &&
      coord !== null &&
      !equalsHex(coord, this.state.map.player)
        ? sideToward(this.state.map.player, coord)
        : null;
    this.mapView.setWallPreview(this.wallPreviewEdges());
  }

  /** Show the paths the hovered tile would be reached by, or none. */
  private updateHoverPaths(coord: HexCoord | null): void {
    const phase = this.state.phase;
    if (
      this.animating ||
      coord === null ||
      (phase.kind !== "playing" && phase.kind !== "pending-card")
    ) {
      this.mapView.setHoverPaths([]);
      return;
    }
    const key = hexKey(coord);
    const cached = this.hoverPathCache.get(key);
    if (cached !== undefined) {
      this.mapView.setHoverPaths(cached);
      return;
    }
    const paths = hoverPaths(this.state, coord);
    this.hoverPathCache.set(key, paths);
    this.mapView.setHoverPaths(paths);
  }

  /** The card that would be auto-played for `coord`, or null. */
  private bestCardFor(coord: HexCoord | null): Card | null {
    if (coord === null) {
      return null;
    }
    const key = hexKey(coord);
    const cached = this.bestCardCache.get(key);
    if (cached !== undefined) {
      return cached;
    }
    const card = this.computeBestCardFor(coord);
    this.bestCardCache.set(key, card);
    return card;
  }

  private computeBestCardFor(coord: HexCoord): Card | null {
    const enemy = this.state.enemies.find(
      (e) => hexKey(e.position) === hexKey(coord),
    );
    if (enemy !== undefined) {
      const attack = bestAttackCard(this.state, enemy.id);
      if (attack !== null) {
        return attack;
      }
    }
    return bestMoveCard(this.state, coord);
  }

  /** Adopt a hovered card, re-rendering only when it actually changes. */
  private setHoveredCard(card: Card | null): void {
    if (this.animating || this.state.phase.kind !== "playing") {
      return;
    }
    if (card !== null && !cardIsPlayable(this.state, card)) {
      card = null;
    }
    if (card?.id !== this.hoveredCard?.id) {
      this.hoveredCard = card;
      this.mapView.setHighlight(this.activeHighlightKey());
      this.renderHand();
    }
  }

  private handlePlay(card: Card): void {
    if (this.animating) {
      return;
    }
    this.apply(beginPlay(this.state, card));
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

  private handleSleep(card: Card): void {
    if (this.animating) {
      return;
    }
    this.apply(sleepForChoice(this.state, card));
  }

  private handleStoreToggle(card: Card): void {
    if (this.animating) {
      return;
    }
    this.apply(toggleStoreChoice(this.state, card));
  }

  private handleStoreConfirm(): void {
    if (this.animating) {
      return;
    }
    this.apply(confirmStore(this.state));
  }

  private handleSearchChoice(card: Card): void {
    if (this.animating) {
      return;
    }
    this.apply(searchForChoice(this.state, card));
  }

  private handleHexClick(coord: HexCoord): void {
    if (this.animating) {
      return;
    }
    const phase = this.state.phase;
    if (phase.kind === "pending-wall") {
      if (!equalsHex(coord, this.state.map.player)) {
        this.apply(
          chooseWall(this.state, sideToward(this.state.map.player, coord)),
        );
      }
      return;
    }
    if (phase.kind === "pending-card") {
      // An enemy on a reachable tile is attacked, not walked onto: standing on an
      // enemy is never useful, and the enemy marker is the more precise target.
      const target = phase.targets.find(
        (enemy) => hexKey(enemy.position) === hexKey(coord),
      );
      if (target !== undefined) {
        this.apply(resolveAttack(this.state, target.id));
        return;
      }
      if (phase.reachable.some((c) => hexKey(c) === hexKey(coord))) {
        this.apply(resolveMoveTo(this.state, coord));
      }
      return;
    }
    if (phase.kind !== "playing") {
      return;
    }
    // No card selected: play the best card for the clicked tile directly.
    const enemy = this.state.enemies.find(
      (e) => hexKey(e.position) === hexKey(coord),
    );
    if (enemy !== undefined) {
      const attack = bestAttackCard(this.state, enemy.id);
      if (attack !== null) {
        const pending = beginPlay(this.state, attack);
        if (pending.state.phase.kind === "pending-card") {
          this.apply(resolveAttack(pending.state, enemy.id));
        }
        return;
      }
    }
    const move = bestMoveCard(this.state, coord);
    if (move !== null) {
      const pending = beginPlay(this.state, move);
      if (pending.state.phase.kind === "pending-card") {
        this.apply(resolveMoveTo(pending.state, coord));
      }
    }
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

  private handleUseConsumable(id: string): void {
    if (this.animating) {
      return;
    }
    this.apply(useConsumable(this.state, id));
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
    case "pending-consumable":
    case "game-over":
      return true;
    case "playing":
    case "pending-card":
    case "pending-discard":
    case "pending-sleep":
    case "pending-search":
    case "pending-store":
    case "pending-wall":
      return false;
  }
}
