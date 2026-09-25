import "./style.css";
import { requireElementById } from "./ui/dom";
import { App } from "./ui/app";
import { Editor } from "./ui/editor";
import { renderMenu } from "./ui/menu";
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
  const generated = generateMap(Math.random() * 1000 | 0, 3, 1, ids);
  const deck = buildDeck(STARTING_DECK, ids, generated.cursor.rng);
  const startSection = generated.records[0];

  const state: GameState = {
    turn: 1,
    currency: 0,
    deck,
    map: {
      tiles: generated.tiles,
      index: buildMapIndex(generated.records, generated.tiles),
      player: generated.player,
      previous: generated.player,
      cursor: generated.cursor,
    },
    playerSectionOrder: 0,
    enemies: generated.snipers,
    phase: { kind: "playing" },
    rng: generated.cursor.rng,
    ids,
    turnState: { cardsPlayedThisTurn: 0, skipBonusTaken: false },
    stats: startingStats(allCards(deck), startSection.id, 1),
  };

  const app = new App(root, ensureAhead(startTurn(state)), startGame, state.deck);
  app.mount();
}

function startEditor(): void {
  const editor = new Editor(root, showMenu);
  editor.mount();
}

function showMenu(): void {
  renderMenu(root, startGame, startEditor);
}

showMenu();
