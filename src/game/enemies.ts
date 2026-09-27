import type { IdFactory } from "./cards";
import {
  findPathByCost,
  hexDistance,
  hexKey,
  hexesInRange,
  hexesWithinCost,
  parseHexKey,
} from "./hex";
import type { HexCoord, StepCost } from "./hex";
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
 * they cross anything but impassible terrain. Terrain types differ only
 * slightly, so hard ground never walls an assassin off entirely.
 */
export const TERRAIN_MOVE_COST: Record<Terrain, number> = {
  dirt: 1,
  grass: 1,
  forest: 1.25,
  water: 1.5,
  mountain: 1.5,
  impassible: Infinity,
};

/**
 * Extra cost for stepping from one terrain type onto another. The real price of
 * movement is switching terrain, mirroring the player needing a fresh card for
 * each terrain they cross, so crossing several types is dearer than covering
 * the same distance on one.
 */
export const TERRAIN_BOUNDARY_COST = 4;

/** Assassins get faster the deeper the player is. */
export function assassinMovementFor(turn: number): number {
  return 1 + Math.floor(turn / 8);
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
  stepCost: StepCost,
): { position: HexCoord; spent: number; path: HexCoord[] } {
  const start = path[0];
  if (start === undefined) {
    throw new Error("empty path");
  }
  let position = start;
  let spent = 0;
  let reached = 0;
  for (let i = 1; i < path.length; i += 1) {
    const step = stepCost(path[i - 1], path[i]);
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
 * The hex an assassin aims for when it cannot reach the player this turn: the
 * spot nearest to the player that is not on or within `ASSASSIN_SPACING` of a
 * peer, so chasers do not pile onto the same approach. Ties break toward the
 * assassin, so it does not cross the map for an equally close spot. Falls back
 * to the player's own hex if every spot nearby is crowded.
 */
function chaseTarget(
  player: HexCoord,
  from: HexCoord,
  peers: readonly HexCoord[],
  maxDistance: number,
): HexCoord {
  let best = player;
  let bestToPlayer = Infinity;
  let bestToFrom = Infinity;
  for (const coord of hexesInRange(player, maxDistance)) {
    if (peers.some((peer) => hexDistance(coord, peer) <= ASSASSIN_SPACING)) {
      continue;
    }
    const toPlayer = hexDistance(coord, player);
    const toFrom = hexDistance(coord, from);
    if (
      toPlayer < bestToPlayer ||
      (toPlayer === bestToPlayer && toFrom < bestToFrom)
    ) {
      best = coord;
      bestToPlayer = toPlayer;
      bestToFrom = toFrom;
    }
  }
  return best;
}

/**
 * One assassin's move. If it can reach the player this turn the player dies;
 * otherwise it chases the spot nearest the player that is clear of its peers.
 * It never ends its move within `ASSASSIN_SPACING` of a peer.
 */
export function takeAssassinTurn(
  assassin: Assassin,
  player: HexCoord,
  costAt: StepCost,
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

  const target = chaseTarget(player, assassin.position, peers, maxDistance);
  let toTarget = findPathByCost(assassin.position, target, costAt);
  if (toTarget === null) {
    // The nearest clear spot may sit across impassible ground; fall back to the
    // player so the assassin still closes in and lets the crowd rule stop it.
    toTarget = findPathByCost(assassin.position, player, costAt);
  }
  if (toTarget === null) {
    return { assassin, killedPlayer: false, path: [assassin.position] };
  }
  const advanced = advanceAlongPath(toTarget.path, assassin.movement, costAt);
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

export function enemyName(enemy: Enemy): string {
  switch (enemy.kind) {
    case "assassin":
      return "Assassin";
    case "sniper":
      return "Sniper";
  }
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
 * Step cost for enemies, from the live tile map. Terrain types differ only
 * slightly; crossing onto a different terrain type adds a boundary surcharge,
 * so switching terrain costs more than covering distance on one type. The first
 * step out of `start` is free, so an assassin boxed in by hard ground can always
 * take at least one step.
 */
export function terrainCostAt(
  tiles: ReadonlyMap<string, Tile>,
  start: HexCoord,
): StepCost {
  const startKey = hexKey(start);
  return (from, to) => {
    const tile = tiles.get(hexKey(to));
    if (tile === undefined) {
      return Infinity;
    }
    const base = TERRAIN_MOVE_COST[tile.terrain] * tile.cost;
    if (!Number.isFinite(base)) {
      return Infinity;
    }
    if (hexKey(from) === startKey) {
      return 0;
    }
    const fromTile = tiles.get(hexKey(from));
    if (fromTile !== undefined && fromTile.terrain !== tile.terrain) {
      return base + TERRAIN_BOUNDARY_COST;
    }
    return base;
  };
}

/**
 * Every hex one enemy could strike at the end of this turn: an assassin's reach
 * within its movement, a sniper's lethal radius.
 */
function enemyDanger(
  enemy: Enemy,
  tiles: ReadonlyMap<string, Tile>,
): Set<string> {
  const zone = new Set<string>();
  if (enemy.kind === "sniper") {
    for (const coord of hexesInRange(enemy.position, enemy.radius)) {
      zone.add(hexKey(coord));
    }
  } else {
    for (const coord of hexesWithinCost(
      enemy.position,
      enemy.movement,
      terrainCostAt(tiles, enemy.position),
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
  const zones = new Map<string, Set<string>>();
  for (const enemy of state.enemies) {
    zones.set(enemy.id, enemyDanger(enemy, state.map.tiles));
  }
  return zones;
}

/**
 * Every hex an enemy could strike at the end of this turn, across the whole
 * field. Standing here when the turn ends is fatal.
 */
export function dangerZone(state: GameState): Set<string> {
  const zone = new Set<string>();
  for (const enemy of state.enemies) {
    for (const key of enemyDanger(enemy, state.map.tiles)) {
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
  maxDistance: number,
): Transition {
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
      terrainCostAt(state.map.tiles, enemy.position),
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
