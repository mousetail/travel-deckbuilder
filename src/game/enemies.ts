import type { IdFactory } from "./cards";
import { findPathByCost, hexDistance, hexKey, hexesInRange, hexesWithinCost, parseHexKey } from "./hex";
import type { CostLookup, HexCoord } from "./hex";
import type { GameState } from "./state";
import type { Terrain, Tile } from "./terrain";

export type Assassin = {
  kind: "assassin";
  id: string;
  position: HexCoord;
  /** Movement points available each enemy turn. */
  movement: number;
};

export type Sniper = {
  kind: "sniper";
  id: string;
  position: HexCoord;
  /** Lethal radius in hexes. */
  radius: number;
};

export type Enemy = Assassin | Sniper;

/**
 * Per-step cost for an assassin. Unlike the player, enemies ignore the deck:
 * they cross anything but impassible terrain, just slower over hard ground.
 */
export const TERRAIN_MOVE_COST: Record<Terrain, number> = {
  dirt: 1,
  grass: 1,
  forest: 2,
  water: 3,
  mountain: 3,
  impassible: Infinity,
};

/** Assassins get faster the deeper the player is. */
export function assassinMovementFor(turn: number): number {
  return 2 + Math.floor(turn / 6);
}

/** Spend `budget` movement points walking as far along `path` as possible. */
export function advanceAlongPath(
  path: readonly HexCoord[],
  budget: number,
  costAt: CostLookup,
): { position: HexCoord; spent: number } {
  const start = path[0];
  if (start === undefined) {
    throw new Error("empty path");
  }
  let position = start;
  let spent = 0;
  for (let i = 1; i < path.length; i += 1) {
    const step = costAt(path[i]);
    if (spent + step > budget) {
      break;
    }
    spent += step;
    position = path[i];
  }
  return { position, spent };
}

export type AssassinTurn = { assassin: Assassin; killedPlayer: boolean };

/**
 * One assassin's move. If it can reach the player this turn the player dies;
 * otherwise it heads for the leading edge to cut the player off.
 */
export function takeAssassinTurn(
  assassin: Assassin,
  player: HexCoord,
  leadingEdge: HexCoord,
  costAt: CostLookup,
): AssassinTurn {
  const toPlayer = findPathByCost(assassin.position, player, costAt);
  if (toPlayer !== null && toPlayer.cost <= assassin.movement) {
    return { assassin: { ...assassin, position: player }, killedPlayer: true };
  }

  const toEdge = findPathByCost(assassin.position, leadingEdge, costAt);
  if (toEdge === null) {
    return { assassin, killedPlayer: false };
  }
  const advanced = advanceAlongPath(toEdge.path, assassin.movement, costAt);
  return { assassin: { ...assassin, position: advanced.position }, killedPlayer: false };
}

/** Spawn an assassin on every live tile whose timer has come up. */
export function spawnAssassins(
  tiles: ReadonlyMap<string, Tile>,
  currentTurn: number,
  movementFor: (turn: number) => number,
  ids: IdFactory,
): Assassin[] {
  const spawned: Assassin[] = [];
  for (const [key, tile] of tiles) {
    if (tile.spawnTurn !== currentTurn) {
      continue;
    }
    spawned.push({
      kind: "assassin",
      id: ids(),
      position: parseHexKey(key),
      movement: movementFor(currentTurn),
    });
  }
  return spawned;
}

export function sniperKills(sniper: Sniper, player: HexCoord): boolean {
  return hexDistance(sniper.position, player) <= sniper.radius;
}

export function enemiesInRange(
  enemies: readonly Enemy[],
  origin: HexCoord,
  range: number,
): Enemy[] {
  return enemies.filter((enemy) => hexDistance(enemy.position, origin) <= range);
}

export function killEnemy(enemies: readonly Enemy[], targetId: string): Enemy[] {
  return enemies.filter((enemy) => enemy.id !== targetId);
}

export function bountyFor(enemy: Enemy): number {
  switch (enemy.kind) {
    case "assassin":
      return 2;
    case "sniper":
      return 4;
  }
}

/** Terrain step cost for enemies, from the live tile map. */
export function terrainCostAt(tiles: ReadonlyMap<string, Tile>): CostLookup {
  return (coord) => {
    const tile = tiles.get(hexKey(coord));
    return tile === undefined ? Infinity : TERRAIN_MOVE_COST[tile.terrain];
  };
}

/**
 * Every hex an enemy could strike at the end of this turn: an assassin's reach
 * within its movement, a sniper's lethal radius. Standing here when the turn
 * ends is fatal.
 */
export function dangerZone(state: GameState): Set<string> {
  const costAt = terrainCostAt(state.map.tiles);
  const zone = new Set<string>();
  for (const enemy of state.enemies) {
    if (enemy.kind === "sniper") {
      for (const coord of hexesInRange(enemy.position, enemy.radius)) {
        zone.add(hexKey(coord));
      }
    } else {
      for (const coord of hexesWithinCost(enemy.position, enemy.movement, costAt)) {
        zone.add(hexKey(coord));
      }
    }
  }
  return zone;
}

/**
 * The end-of-turn enemy step: spawn, snipe, then move every assassin. Returns a
 * state whose phase may be `game-over`; it never throws.
 */
export function resolveEnemyPhase(state: GameState, leadingEdge: HexCoord): GameState {
  const costAt = terrainCostAt(state.map.tiles);

  const spawned = spawnAssassins(state.map.tiles, state.turn, assassinMovementFor, state.ids);
  const alreadyHere = state.enemies;
  let enemies: Enemy[] = [...alreadyHere, ...spawned];

  // Snipers fire first: ending your turn in their radius is fatal.
  for (const enemy of enemies) {
    if (enemy.kind === "sniper" && sniperKills(enemy, state.map.player)) {
      return { ...state, phase: { kind: "game-over", reason: { kind: "sniper" } } };
    }
  }

  // Then the assassins that were already on the map move, one at a time; the
  // first to reach you wins. A freshly spawned assassin waits a turn, so the
  // player always gets one turn's warning before it can strike.
  for (const enemy of alreadyHere) {
    if (enemy.kind !== "assassin") {
      continue;
    }
    const turn = takeAssassinTurn(enemy, state.map.player, leadingEdge, costAt);
    if (turn.killedPlayer) {
      return { ...state, phase: { kind: "game-over", reason: { kind: "assassin" } } };
    }
    enemies = enemies.map((e) => (e.id === turn.assassin.id ? turn.assassin : e));
  }

  return { ...state, enemies };
}
