import type { Card, CardSpec, IdFactory } from "./cards";
import type { HexCoord } from "./hex";
import type { Tile } from "./terrain";
import type { Enemy } from "./enemies";
import type { SectionRecord } from "./map";
import type { Rng } from "./rng";

export type Deck = {
  draw: Card[];
  hand: Card[];
  discard: Card[];
};

export type MapIndex = {
  hexToSection: Map<string, string>;   // hexKey → section id, live sections only
  sections: SectionRecord[];           // oldest → newest, includes removed sections
};

export type MapState = {
  tiles: Map<string, Tile>;            // key = hexKey(coord)
  index: MapIndex;
  player: HexCoord;
  previous: HexCoord;
};

export type Phase =
  | { kind: "playing" }
  | { kind: "pending-move"; card: Card; modeIndex: number; reachable: HexCoord[] }
  | { kind: "pending-attack"; cardId: string; range: number }
  | { kind: "pending-discard"; count: number }
  | { kind: "pending-remove" }
  | { kind: "pending-gain"; spec: CardSpec }
  | { kind: "shop"; stock: readonly Card[]; rerollCost: number }
  | { kind: "smith"; cardId: string }
  | { kind: "game-over"; reason: GameOverReason };

export type GameOverReason =
  | { kind: 'assassin' }
  | { kind: 'sniper' }
  | { kind: 'caught' };

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
};