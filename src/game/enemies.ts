import type { IdFactory } from "./cards";
import {
  findPathByCost,
  hexDistance,
  hexKey,
  hexesInRange,
  hexesWithinCost,
  parseHexKey,
} from "./hex";
import type { CostLookup, HexCoord } from "./hex";
import type { GameState } from "./state";
import type { Terrain, Tile } from "./terrain";
import { moving } from "./transition";
import type { MovePath, Transition } from "./transition";

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

/**
 * Assassins never rest on or within this many hexes of a peer. They may walk
 * straight through each other, but must not end a move crowded together.
 */
export const ASSASSIN_SPACING = 2;

/**
 * Spend `budget` movement points walking as far along `path` as possible. The
 * returned `path` is the prefix actually walked, so the UI can animate it.
 */
export function advanceAlongPath(
  path: readonly HexCoord[],
  budget: number,
  costAt: CostLookup,
): { position: HexCoord; spent: number; path: HexCoord[] } {
  const start = path[0];
  if (start === undefined) {
    throw new Error("empty path");
  }
  let position = start;
  let spent = 0;
  let reached = 0;
  for (let i = 1; i < path.length; i += 1) {
    const step = costAt(path[i]);
    if (spent + step > budget) {
      break;
    }
    spent += step;
    position = path[i];
    reached = i;
  }
  return { position, spent, path: path.slice(0, reached + 1) };
}

/**
 * Trim a path so it never steps further than `maxDistance` from the player — the
 * furthest tile the player can see. An assassin already beyond that line cannot
 * advance, so it never slips further into the dark.
 */
function clampToReach(
  path: readonly HexCoord[],
  player: HexCoord,
  maxDistance: number,
): HexCoord[] {
  const start = path[0];
  if (start === undefined) {
    throw new Error("empty path");
  }
  const kept = [start];
  for (let i = 1; i < path.length; i += 1) {
    if (hexDistance(path[i], player) > maxDistance) {
      break;
    }
    kept.push(path[i]);
  }
  return kept;
}

/**
 * Shorten a walked path until the assassin no longer ends within
 * `ASSASSIN_SPACING` hexes of a peer. Only the resting spot matters, so a walk
 * that crosses a crowd is fine; if no step escapes it, the assassin stays put.
 */
function retreatFromPeers(
  path: readonly HexCoord[],
  peers: readonly HexCoord[],
): HexCoord[] {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const spot = path[i];
    if (
      spot !== undefined &&
      peers.every((peer) => hexDistance(spot, peer) > ASSASSIN_SPACING)
    ) {
      return path.slice(0, i + 1);
    }
  }
  return path.slice(0, 1);
}

export type AssassinTurn = {
  assassin: Assassin;
  killedPlayer: boolean;
  /** The hexes the assassin walked, start and end included. */
  path: readonly HexCoord[];
};

/**
 * One assassin's move. If it can reach the player this turn the player dies;
 * otherwise it heads for the leading edge to cut the player off. Either way it
 * stays within `maxDistance` of the player — the furthest tile the player can
 * see — and never ends its move within `ASSASSIN_SPACING` of a peer.
 */
export function takeAssassinTurn(
  assassin: Assassin,
  player: HexCoord,
  leadingEdge: HexCoord,
  costAt: CostLookup,
  maxDistance: number,
  peers: readonly HexCoord[],
): AssassinTurn {
  const toPlayer = findPathByCost(assassin.position, player, costAt);
  if (toPlayer !== null && toPlayer.cost <= assassin.movement) {
    return {
      assassin: { ...assassin, position: player },
      killedPlayer: true,
      path: toPlayer.path,
    };
  }

  const toEdge = findPathByCost(assassin.position, leadingEdge, costAt);
  if (toEdge === null) {
    return { assassin, killedPlayer: false, path: [assassin.position] };
  }
  const inSight = clampToReach(toEdge.path, player, maxDistance);
  const advanced = advanceAlongPath(inSight, assassin.movement, costAt);
  const path = retreatFromPeers(advanced.path, peers);
  return {
    assassin: {
      ...assassin,
      position: path[path.length - 1] ?? assassin.position,
    },
    killedPlayer: false,
    path,
  };
}

/**
 * Spawn an assassin on every live tile whose timer has come up. The assassin is
 * due at the start of turn `spawnTurn`, so it spawns in the enemy phase of the
 * turn before — except a delay-0 tile, which is armed mid-turn and can only
 * appear at the end of that same turn.
 */
export function spawnAssassins(
  tiles: ReadonlyMap<string, Tile>,
  currentTurn: number,
  movementFor: (turn: number) => number,
  ids: IdFactory,
): Assassin[] {
  const spawned: Assassin[] = [];
  for (const [key, tile] of tiles) {
    const due =
      tile.spawnTurn === currentTurn + 1 ||
      (tile.spawnDelay === 0 && tile.spawnTurn === currentTurn);
    if (!due) {
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
  return enemies.filter(
    (enemy) => hexDistance(enemy.position, origin) <= range,
  );
}

export function killEnemy(
  enemies: readonly Enemy[],
  targetId: string,
): Enemy[] {
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

/**
 * Terrain step cost for enemies, from the live tile map. Harder tiles cost
 * more: the terrain's base cost times the tile's own cost.
 */
export function terrainCostAt(tiles: ReadonlyMap<string, Tile>): CostLookup {
  return (coord) => {
    const tile = tiles.get(hexKey(coord));
    return tile === undefined
      ? Infinity
      : TERRAIN_MOVE_COST[tile.terrain] * tile.cost;
  };
}

/**
 * Every hex one enemy could strike at the end of this turn: an assassin's reach
 * within its movement, a sniper's lethal radius.
 */
function enemyDanger(enemy: Enemy, costAt: CostLookup): Set<string> {
  const zone = new Set<string>();
  if (enemy.kind === "sniper") {
    for (const coord of hexesInRange(enemy.position, enemy.radius)) {
      zone.add(hexKey(coord));
    }
  } else {
    for (const coord of hexesWithinCost(
      enemy.position,
      enemy.movement,
      costAt,
    )) {
      zone.add(hexKey(coord));
    }
  }
  return zone;
}

/**
 * Every hex an enemy could strike at the end of this turn, keyed by enemy id.
 * The map uses it to show which enemies threaten the tile under the cursor.
 */
export function enemyDangerZones(state: GameState): Map<string, Set<string>> {
  const costAt = terrainCostAt(state.map.tiles);
  const zones = new Map<string, Set<string>>();
  for (const enemy of state.enemies) {
    zones.set(enemy.id, enemyDanger(enemy, costAt));
  }
  return zones;
}

/**
 * Every hex an enemy could strike at the end of this turn, across the whole
 * field. Standing here when the turn ends is fatal.
 */
export function dangerZone(state: GameState): Set<string> {
  const costAt = terrainCostAt(state.map.tiles);
  const zone = new Set<string>();
  for (const enemy of state.enemies) {
    for (const key of enemyDanger(enemy, costAt)) {
      zone.add(key);
    }
  }
  return zone;
}

/**
 * The end-of-turn enemy step: spawn, snipe, then move every assassin, one at a
 * time. Returns the new state together with the paths walked, in order, so the
 * UI can show each assassin move in turn. It never throws.
 */
export function resolveEnemyPhase(
  state: GameState,
  leadingEdge: HexCoord,
  maxDistance: number,
): Transition {
  const costAt = terrainCostAt(state.map.tiles);

  const spawned = spawnAssassins(
    state.map.tiles,
    state.turn,
    assassinMovementFor,
    state.ids,
  );
  const alreadyHere = state.enemies;
  let enemies: Enemy[] = [...alreadyHere, ...spawned];
  const moves: MovePath[] = [];

  // Snipers fire first: ending your turn in their radius is fatal.
  for (const enemy of enemies) {
    if (enemy.kind === "sniper" && sniperKills(enemy, state.map.player)) {
      return moving(
        {
          ...state,
          enemies,
          phase: { kind: "game-over", reason: { kind: "sniper" } },
        },
        moves,
      );
    }
  }

  // Then the assassins that were already on the map move, one at a time; the
  // first to reach you wins. A freshly spawned assassin waits a turn, so the
  // player always gets one turn's warning before it can strike.
  for (const enemy of alreadyHere) {
    if (enemy.kind !== "assassin") {
      continue;
    }
    const peers = enemies
      .filter((e): e is Assassin => e.kind === "assassin" && e.id !== enemy.id)
      .map((e) => e.position);
    const turn = takeAssassinTurn(
      enemy,
      state.map.player,
      leadingEdge,
      costAt,
      maxDistance,
      peers,
    );
    if (turn.path.length > 1) {
      moves.push({ mover: { kind: "enemy", id: enemy.id }, path: turn.path });
    }
    enemies = enemies.map((e) =>
      e.id === turn.assassin.id ? turn.assassin : e,
    );
    if (turn.killedPlayer) {
      return moving(
        {
          ...state,
          enemies,
          phase: { kind: "game-over", reason: { kind: "assassin" } },
        },
        moves,
      );
    }
  }

  return moving({ ...state, enemies }, moves);
}
