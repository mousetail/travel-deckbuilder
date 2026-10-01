import "./style.css";
import { requireElementById } from "./ui/dom";
import { App } from "./ui/app";
import { Editor } from "./ui/editor";
import { renderMenu } from "./ui/menu";
import { renderStats } from "./ui/stats-view";
import { loadSharePreference } from "./ui/share-store";
import { buildDeck } from "./game/deck";
import { allCards } from "./game/deck";
import { counterIds, STARTING_DECK } from "./game/cards";
import { buildMapIndex, generateMap } from "./game/map";
import { ensureAhead } from "./game/fog";
import { startingStats } from "./game/stats";
import { startTurn } from "./game/turn";
import type { GameState } from "./game/state";

const root = requireElementById("app", HTMLDivElement);

function startGame(): void {
  const ids = counterIds("id");
  const seed = (Math.random() * 1000) | 0;
  const generated = generateMap(seed, 3, 1, ids);
  const deck = buildDeck(STARTING_DECK, ids, generated.cursor.rng);
  const startSection = generated.records[0];
  const startingCurrency = 3;

  const state: GameState = {
    turn: 1,
    currency: startingCurrency,
    deck,
    map: {
      tiles: generated.tiles,
      index: buildMapIndex(generated.records, generated.tiles),
      player: generated.player,
      previous: generated.player,
      cursor: generated.cursor,
    },
    playerSectionOrder: 0,
    enemies: generated.enemies,
    phase: { kind: "playing" },
    rng: generated.cursor.rng,
    ids,
    turnState: {
      cardsPlayedThisTurn: 0,
      distanceThisTurn: 0,
      enemiesKilledThisTurn: 0,
      currencyEarnedThisTurn: 0,
      currencySpentThisTurn: 0,
      skipBonusTaken: false,
    },
    stats: startingStats(allCards(deck), startSection.id, 1, startingCurrency),
    terrainTrivialTurns: 0,
    anomalies: [],
  };

  const app = new App(
    root,
    ensureAhead(startTurn(state)),
    startGame,
    state.deck,
    {
      seed,
      startedAt: Date.now(),
      share: loadSharePreference(),
    },
  );
  app.mount();
}

function startEditor(): void {
  const editor = new Editor(root, showMenu);
  editor.mount();
}

function showMenu(): void {
  renderMenu(root, startGame, startEditor, showStats);
}

function showStats(): void {
  renderStats(root, showMenu);
}

showMenu();
