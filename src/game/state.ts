import type { Card, CardSpec, IdFactory } from "./cards";
import type { Deck } from "./deck";
import type { HexCoord } from "./hex";
import type { Tile } from "./terrain";
import type { Enemy } from "./enemies";
import type { SectionRecord, MapCursor } from "./map";
import type { Rng } from "./rng";

export type { Deck };

export type MapIndex = {
  hexToSection: Map<string, string>;   // hexKey → section id, live sections only
  sections: SectionRecord[];           // oldest → newest, includes removed sections
};

export type MapState = {
  tiles: Map<string, Tile>;            // key = hexKey(coord)
  index: MapIndex;
  player: HexCoord;
  previous: HexCoord;
  cursor: MapCursor;                   // generation front, advanced as the player moves
};

export type Phase =
  | { kind: "playing" }
  | { kind: "pending-move"; card: Card; modeIndex: number; reachable: HexCoord[] }
  | { kind: "pending-attack"; cardId: string; range: number }
  | { kind: "pending-discard"; count: number }
  | { kind: "pending-remove" }
  | { kind: "pending-gain"; spec: CardSpec }
  | { kind: "shop"; stock: readonly Card[]; rerollCost: number }
  | { kind: "smith" }
  | { kind: "game-over"; reason: GameOverReason };

export type GameOverReason =
  | { kind: 'assassin' }
  | { kind: 'sniper' }
  | { kind: 'caught' };

/** Per-turn bookkeeping, reset at the start of every turn. */
export type TurnState = {
  cardsPlayedThisTurn: number;
  /**
   * Whether the no-card "skip turn" bonus has already been paid this turn. It
   * is granted when the player commits to ending the turn, which is before a
   * shop opens, so this stops it being paid again on the way out.
   */
  skipBonusTaken: boolean;
};

export type GameState = {
  turn: number;
  currency: number;
  deck: Deck;
  map: MapState;
  playerSectionOrder: number;
  enemies: Enemy[];
  phase: Phase;
  rng: Rng;
  ids: IdFactory;
  turnState: TurnState;
};