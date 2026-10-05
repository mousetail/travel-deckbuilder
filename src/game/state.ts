import type { Card, IdFactory } from "./cards";
import type { Consumable } from "./consumables";
import type { Deck } from "./deck";
import type { HexCoord } from "./hex";
import type { Tile } from "./terrain";
import type { Enemy } from "./enemies";
import type { SectionRecord, MapCursor } from "./map";
import type { Rng } from "./rng";
import type { RunStats } from "./stats";
import type { WallEdge } from "./walls";

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
  | {
      kind: "pending-consumable";
      options: readonly Consumable[];
      position: HexCoord;
    }
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
    }
  | {
      kind: "map-panic";
      turn: number;
      /** How many sections existed when the panic fallback was used. */
      sectionOrder: number;
      /** The template that was placed from the panic pool. */
      templateId: string;
      /** Its radius, and the radius of the section it joined onto. */
      radius: number;
      frontierRadius: number;
    };

/** The decoy a Mimic consumable leaves behind. */
export type Mimic = { kind: "none" } | { kind: "placed"; position: HexCoord };

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
  /** Cumulative enemy movement added by Escalation, kept across turns. */
  enemySpeedBonus: number;
  /** Extra enemy movement granted by Escalation for this turn only. */
  enemySpeedThisTurn: number;
  /** At most three held consumables, used from the left-edge strip. */
  consumables: readonly Consumable[];
  /** The decoy enemies may chase instead of the player. */
  mimic: Mimic;
  /** Enemies that skip their movement on the next enemy phase. */
  frozenEnemyIds: readonly string[];
  /** Turns left (including this one) that cards cross any non-impassible terrain. */
  anyTerrainTurns: number;
  /** Directed hex edges that block movement and line of sight. */
  walls: readonly WallEdge[];
  /** Odd events seen this run, for the end-of-run report. */
  anomalies: readonly Anomaly[];
};
