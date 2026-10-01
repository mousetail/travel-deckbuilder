import type { Card, IdFactory } from "./cards";
import type { Deck } from "./deck";
import type { HexCoord } from "./hex";
import type { Tile } from "./terrain";
import type { Enemy } from "./enemies";
import type { SectionRecord, MapCursor } from "./map";
import type { Rng } from "./rng";
import type { RunStats } from "./stats";

export type { Deck };

export type MapIndex = {
  hexToSection: Map<string, string>; // hexKey → section id, live sections only
  sections: SectionRecord[]; // oldest → newest, includes removed sections
};

export type MapState = {
  tiles: Map<string, Tile>; // key = hexKey(coord)
  index: MapIndex;
  player: HexCoord;
  previous: HexCoord;
  cursor: MapCursor; // generation front, advanced as the player moves
};

export type Phase =
  | { kind: "playing" }
  | {
      kind: "pending-card";
      card: Card;
      /** Union of every move mode's reachable hexes, the player's own excluded. */
      reachable: HexCoord[];
      /** Enemies in range of any attack mode. */
      targets: Enemy[];
    }
  | { kind: "pending-discard"; count: number }
  | { kind: "pending-sleep"; reshuffles: number }
  | { kind: "pending-search"; count: number }
  | { kind: "pending-remove" }
  | { kind: "pending-gain"; card: Card | null }
  | { kind: "shop"; stock: readonly (Card | null)[]; rerollCost: number }
  | { kind: "smith" }
  | { kind: "game-over"; reason: GameOverReason };

export type GameOverReason =
  | { kind: "assassin" }
  | { kind: "sniper" }
  | { kind: "watchtower" }
  | { kind: "caught" }
  | { kind: "victory" };

/**
 * Something that should not normally happen, recorded so an end-of-run report
 * can flag it for the developers.
 */
export type Anomaly =
  | {
      kind: "death-outside-danger-zone";
      reason: "assassin" | "sniper" | "watchtower";
      turn: number;
      /** The map section the player was in when they died. */
      sectionOrder: number;
    }
  | {
      kind: "assassin-did-not-move";
      turn: number;
      assassinId: string;
      position: HexCoord;
      player: HexCoord;
      distanceToPlayer: number;
      movement: number;
      peers: readonly HexCoord[];
      /** Whether a hex within the assassin's movement budget was closer to the player. */
      closerReachable: boolean;
      /** Whether such a closer hex was also clear of every peer, so the assassin
       * could legally have ended its move nearer the player. */
      closerClearReachable: boolean;
      /** Whether peer spacing turned a move that would have advanced into a stop. */
      blockedByPeers: boolean;
    };

/** Per-turn bookkeeping, reset at the start of every turn. */
export type TurnState = {
  cardsPlayedThisTurn: number;
  /** Hexes the player has stepped this turn, for the distance record. */
  distanceThisTurn: number;
  enemiesKilledThisTurn: number;
  currencyEarnedThisTurn: number;
  currencySpentThisTurn: number;
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
  stats: RunStats;
  /** Turns left (including this one) that every tile costs 1 to enter. */
  terrainTrivialTurns: number;
  /** Odd events seen this run, for the end-of-run report. */
  anomalies: readonly Anomaly[];
};
