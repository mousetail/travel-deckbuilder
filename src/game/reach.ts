import type { AttackMode, Card, MoveMode } from "./cards";
import { moveModeValue, playCost } from "./cards";
import { enemiesInRange, terrainCostAt } from "./enemies";
import type { Enemy } from "./enemies";
import { equalsHex, findPathByCost, hexDistance, hexKey } from "./hex";
import type { HexCoord } from "./hex";
import { visibleEnemies, visibleMap } from "./fog";
import { cardCostAt, reachableHexes } from "./movement";
import type { TileLookup } from "./movement";
import type { GameState } from "./state";

/** The tile at a world coord, or undefined outside the visible window. */
export function tileAt(state: GameState): TileLookup {
  // Movement is confined to the visible window: the current section, the one
  // behind, and the fog sliver of the next. Removed sections are gone entirely.
  const visible = visibleMap(state).tiles;
  return (coord) => visible.get(hexKey(coord));
}

/**
 * The tile lookup player movement uses. While Scout's effect is live every tile
 * costs 1 to enter; terrain-type passability is untouched.
 */
export function movementTileAt(state: GameState): TileLookup {
  const base = tileAt(state);
  if (state.terrainTrivialTurns <= 0) {
    return base;
  }
  return (coord) => {
    const tile = base(coord);
    return tile === undefined ? undefined : { ...tile, cost: 1 };
  };
}

/**
 * The hexes a teleport mode can jump to: every visible enemy within `range`,
 * ignoring terrain and obstacles.
 */
export function teleportTargets(state: GameState, range: number): HexCoord[] {
  const visible = tileAt(state);
  return state.enemies
    .filter(
      (enemy) =>
        hexDistance(enemy.position, state.map.player) <= range &&
        visible(enemy.position) !== undefined,
    )
    .map((enemy) => enemy.position);
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
            movementTileAt(state),
          ).filter((coord) => !equalsHex(coord, state.map.player)),
        });
        break;
      case "teleport":
        moves.push({ mode, reachable: teleportTargets(state, mode.range) });
        break;
      case "attack":
        attacks.push({
          mode,
          targets: enemiesInRange(
            visibleEnemies(state),
            state.map.player,
            mode.range,
          ),
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

/** A card and the move mode that would be used to walk somewhere. */
export type MovePlan = { card: Card; mode: MoveMode };

/**
 * The best card in hand to move to `to`, or null if none can reach it. "Best"
 * is the card whose move mode reaches `to` with the lowest distance, preferring
 * cards with fewer modes so their other effects are preserved.
 */
export function bestMove(state: GameState, to: HexCoord): MovePlan | null {
  // Movement is confined to the visible window, so an off-map tile is never
  // reachable; this also skips the per-card pathfinding for stray hovers.
  if (tileAt(state)(to) === undefined) {
    return null;
  }
  let best: MovePlan | null = null;
  let bestValue = Infinity;
  for (const card of state.deck.hand) {
    if (state.currency < playCost(card)) {
      continue;
    }
    for (const move of cardReach(state, card).moves) {
      if (!move.reachable.some((coord) => equalsHex(coord, to))) {
        continue;
      }
      const value = moveModeValue(move.mode);
      if (best === null || isBetter(card, value, best.card, bestValue)) {
        best = { card, mode: move.mode };
        bestValue = value;
      }
    }
  }
  return best;
}

export function bestMoveCard(state: GameState, to: HexCoord): Card | null {
  const plan = bestMove(state, to);
  return plan === null ? null : plan.card;
}

/** The first move mode of `card` that can reach `to`, or null. */
export function moveModeTo(
  state: GameState,
  card: Card,
  to: HexCoord,
): MoveMode | null {
  for (const move of cardReach(state, card).moves) {
    if (move.reachable.some((coord) => equalsHex(coord, to))) {
      return move.mode;
    }
  }
  return null;
}

/** The best card in hand to attack `enemyId`, or null if none can. */
export function bestAttackCard(state: GameState, enemyId: string): Card | null {
  let best: Card | null = null;
  let bestValue = Infinity;
  for (const card of state.deck.hand) {
    if (state.currency < playCost(card)) {
      continue;
    }
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

/** One path a hovered tile could be reached by, and who would walk it. */
export type HoverPath = {
  kind: "player" | "enemy";
  path: readonly HexCoord[];
};

/**
 * The paths a hovered tile would be reached by: the player's auto-played card,
 * then every assassin that could walk there this turn. Empty when nothing can
 * reach it, so the map draws no line.
 */
export function hoverPaths(state: GameState, to: HexCoord): HoverPath[] {
  const paths: HoverPath[] = [];
  const player = playerPathTo(state, to);
  if (player !== null) {
    paths.push({ kind: "player", path: player });
  }
  const visible = visibleMap(state).tiles;
  for (const enemy of state.enemies) {
    if (enemy.kind !== "assassin" || !visible.has(hexKey(enemy.position))) {
      continue;
    }
    const found = findPathByCost(
      enemy.position,
      to,
      terrainCostAt(visible, enemy.position),
    );
    if (
      found === null ||
      found.cost > enemy.movement ||
      found.path.length < 2
    ) {
      continue;
    }
    paths.push({ kind: "enemy", path: found.path });
  }
  return paths;
}

/** The path the player would walk to `to`, or null if they cannot reach it. */
function playerPathTo(state: GameState, to: HexCoord): HexCoord[] | null {
  const mode = playerMoveMode(state, to);
  if (mode === null) {
    return null;
  }
  // A teleport jumps straight to the enemy, so it previews as a direct line and
  // is allowed to land on an enemy hex.
  if (mode.kind === "teleport") {
    return [state.map.player, to];
  }
  // Standing on an enemy is never a move: clicking it attacks instead.
  if (state.enemies.some((enemy) => equalsHex(enemy.position, to))) {
    return null;
  }
  const found = findPathByCost(
    state.map.player,
    to,
    cardCostAt(mode.terrain, movementTileAt(state)),
  );
  return found === null ? null : found.path;
}

/** The move mode the player would use for `to`: the selected card, or the best. */
function playerMoveMode(state: GameState, to: HexCoord): MoveMode | null {
  if (state.phase.kind === "pending-card") {
    return moveModeTo(state, state.phase.card, to);
  }
  const card = bestMoveCard(state, to);
  return card === null ? null : moveModeTo(state, card, to);
}
