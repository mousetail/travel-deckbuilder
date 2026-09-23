import "./style.css";
import { requireElementById } from "./ui/dom";
import { App } from "./ui/app";
import { buildDeck } from "./game/deck";
import { counterIds, STARTING_DECK } from "./game/cards";
import { buildMapIndex, generateMap } from "./game/map";
import { ensureAhead } from "./game/fog";
import { startTurn } from "./game/turn";
import type { GameState } from "./game/state";

const root = requireElementById("app", HTMLDivElement);

const ids = counterIds("id");
const generated = generateMap(1, 3, ids);

const state: GameState = {
  turn: 1,
  currency: 0,
  deck: buildDeck(STARTING_DECK, ids, generated.cursor.rng),
  map: {
    tiles: generated.tiles,
    index: buildMapIndex(generated.records, generated.tiles),
    player: generated.player,
    previous: generated.player,
    cursor: generated.cursor,
  },
  playerSectionOrder: 0,
  enemies: [],
  phase: { kind: "playing" },
  rng: generated.cursor.rng,
  ids,
  turnState: { cardsPlayedThisTurn: 0 },
};

const app = new App(root, ensureAhead(startTurn(state)));
app.mount();