import type { AttackMode, Card, MoveMode } from "./cards";
import { enemiesInRange } from "./enemies";
import type { Enemy } from "./enemies";
import { equalsHex, hexKey } from "./hex";
import type { HexCoord } from "./hex";
import { visibleMap } from "./fog";
import { reachableHexes } from "./movement";
import type { TileLookup } from "./movement";
import type { GameState } from "./state";

/** The tile at a world coord, or undefined outside the visible window. */
export function tileAt(state: GameState): TileLookup {
  // Movement is confined to the visible window: the current section, the one
  // behind, and the fog sliver of the next. Removed sections are gone entirely.
  const visible = visibleMap(state).tiles;
  return (coord) => visible.get(hexKey(coord));
}

export type MoveReach = {
  mode: MoveMode;
  /** Hexes this mode reaches, the player's own excluded. */
  reachable: HexCoord[];
};

export type AttackReach = {
  mode: AttackMode;
  targets: readonly Enemy[];
};

/** What one card could do from here: each move mode's reach and attack mode's targets. */
export type CardReach = {
  card: Card;
  moves: readonly MoveReach[];
  attacks: readonly AttackReach[];
};

export function cardReach(state: GameState, card: Card): CardReach {
  const moves: MoveReach[] = [];
  const attacks: AttackReach[] = [];
  for (const mode of card.modes) {
    switch (mode.kind) {
      case "move":
        moves.push({
          mode,
          reachable: reachableHexes(
            state.map.player,
            mode.distance,
            mode.terrain,
            tileAt(state),
          ).filter((coord) => !equalsHex(coord, state.map.player)),
        });
        break;
      case "attack":
        attacks.push({
          mode,
          targets: enemiesInRange(state.enemies, state.map.player, mode.range),
        });
        break;
      default:
        break;
    }
  }
  return { card, moves, attacks };
}

/** Everything the hand could do from here, computed in one pass. */
export type HandReach = {
  /** Per-card reach, in hand order. */
  cards: readonly CardReach[];
  /** Union of every card's reachable tiles. */
  reachable: readonly HexCoord[];
  /** Union of every card's attack targets. */
  targets: readonly Enemy[];
};

export function handReach(state: GameState): HandReach {
  const cards = state.deck.hand.map((card) => cardReach(state, card));
  const seenTiles = new Set<string>();
  const reachable: HexCoord[] = [];
  const seenEnemies = new Set<string>();
  const targets: Enemy[] = [];
  for (const reach of cards) {
    for (const move of reach.moves) {
      for (const coord of move.reachable) {
        const key = hexKey(coord);
        if (seenTiles.has(key)) {
          continue;
        }
        seenTiles.add(key);
        reachable.push(coord);
      }
    }
    for (const attack of reach.attacks) {
      for (const enemy of attack.targets) {
        if (seenEnemies.has(enemy.id)) {
          continue;
        }
        seenEnemies.add(enemy.id);
        targets.push(enemy);
      }
    }
  }
  return { cards, reachable, targets };
}

/**
 * The best card in hand to move to `to`, or null if none can reach it. "Best"
 * is the card whose move mode reaches `to` with the lowest distance, preferring
 * cards with fewer modes so their other effects are preserved.
 */
export function bestMoveCard(state: GameState, to: HexCoord): Card | null {
  // Movement is confined to the visible window, so an off-map tile is never
  // reachable; this also skips the per-card pathfinding for stray hovers.
  if (tileAt(state)(to) === undefined) {
    return null;
  }
  let best: Card | null = null;
  let bestValue = Infinity;
  for (const card of state.deck.hand) {
    const value = moveValueTo(state, card, to);
    if (value === null) {
      continue;
    }
    if (best === null || isBetter(card, value, best, bestValue)) {
      best = card;
      bestValue = value;
    }
  }
  return best;
}

/** The best card in hand to attack `enemyId`, or null if none can. */
export function bestAttackCard(state: GameState, enemyId: string): Card | null {
  let best: Card | null = null;
  let bestValue = Infinity;
  for (const card of state.deck.hand) {
    const value = attackValueTo(state, card, enemyId);
    if (value === null) {
      continue;
    }
    if (best === null || isBetter(card, value, best, bestValue)) {
      best = card;
      bestValue = value;
    }
  }
  return best;
}

/** The lowest distance among `card`'s move modes that reach `to`, or null. */
function moveValueTo(
  state: GameState,
  card: Card,
  to: HexCoord,
): number | null {
  let best: number | null = null;
  for (const move of cardReach(state, card).moves) {
    if (!move.reachable.some((coord) => equalsHex(coord, to))) {
      continue;
    }
    if (best === null || move.mode.distance < best) {
      best = move.mode.distance;
    }
  }
  return best;
}

/** The lowest range among `card`'s attack modes that reach `enemyId`, or null. */
function attackValueTo(
  state: GameState,
  card: Card,
  enemyId: string,
): number | null {
  let best: number | null = null;
  for (const attack of cardReach(state, card).attacks) {
    if (!attack.targets.some((enemy) => enemy.id === enemyId)) {
      continue;
    }
    if (best === null || attack.mode.range < best) {
      best = attack.mode.range;
    }
  }
  return best;
}

/**
 * Whether `card` with `value` beats `best` with `bestValue`: lower value first,
 * then fewer modes so a card's other effects are preserved.
 */
function isBetter(
  card: Card,
  value: number,
  best: Card,
  bestValue: number,
): boolean {
  if (value !== bestValue) {
    return value < bestValue;
  }
  return card.modes.length < best.modes.length;
}