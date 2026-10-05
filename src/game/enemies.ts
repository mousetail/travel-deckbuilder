import type { IdFactory } from "./cards";
import { DIFFICULTY_SCALING } from "./config";
import {
  AXIAL_DIRECTIONS,
  addHex,
  equalsHex,
  findPathByCost,
  hexDistance,
  hexKey,
  hexesInRange,
  hexesWithinCost,
  parseHexKey,
} from "./hex";
import type { HexCoord, StepCost } from "./hex";
import { SECTIONS_BEHIND, visibleMap } from "./fog";
import type { Anomaly, GameState, MapIndex } from "./state";
import type { EnemyKind, Terrain, Tile } from "./terrain";
import { moving } from "./transition";
import type { MovePath, Transition } from "./transition";
import { lineOfSightBlocked, wallBlocks } from "./walls";
import type { WallEdge } from "./walls";

export type Assassin = {
  kind: "assassin";
  id: string;
  position: HexCoord;
  /** Movement points available each enemy turn. */
  movement: number;
};

/**
 * A sniper walks like an assassin but more slowly, then picks one of the six
 * hex directions to aim along. Anything on that ray — up to the first
 * impassible hex or the edge of the map — is in its line of sight.
 */
export type Sniper = {
  kind: "sniper";
  id: string;
  position: HexCoord;
  /** Movement points available each enemy turn. */
  movement: number;
  /** Index into `AXIAL_DIRECTIONS` the sniper aims along, or null before it aims. */
  aim: number | null;
};

export type Watchtower = {
  kind: "watchtower";
  id: string;
  position: HexCoord;
  /** Lethal radius in hexes. */
  radius: number;
};

export type Enemy = Assassin | Sniper | Watchtower;

/** Lethal radius of a watchtower, in hexes. */
export const WATCHTOWER_RADIUS = 2;

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
  finish: 1,
};

/**
 * Extra cost for stepping from one terrain type onto another. The real price of
 * movement is switching terrain, mirroring the player needing a fresh card for
 * each terrain they cross, so crossing several types is dearer than covering
 * the same distance on one.
 */
export const TERRAIN_BOUNDARY_COST = 4;

/** Base movement points per enemy turn, before any difficulty ramp. */
export const ASSASSIN_BASE_MOVEMENT = 1;
export const SNIPER_BASE_MOVEMENT = 1;

/** Turns after which the turn-based scheme grants an enemy another step. */
const ASSASSIN_TURN_PERIOD = 8;
const SNIPER_TURN_PERIOD = 16;

/** Movement an enemy of `kind` gains from the turn number alone. */
function turnSpeedBonus(kind: EnemyKind, turn: number): number {
  switch (kind) {
    case "assassin":
      return Math.floor(turn / ASSASSIN_TURN_PERIOD);
    case "sniper":
      return Math.floor(turn / SNIPER_TURN_PERIOD);
    case "watchtower":
      return 0;
  }
}

/**
 * Extra movement `enemy` gets beyond its base for the coming enemy phase. This
 * is the one seam between the two difficulty schemes (see `config.ts`): in
 * `"card"` mode it is Escalation's permanent ramp plus the one-turn bump, and
 * in `"turn"` mode it is the enemy's turn-number bonus. Snipers are slower than
 * assassins, so in card mode they take half the ramp (their base is unchanged).
 */
export function enemySpeedBonusFor(state: GameState, enemy: Enemy): number {
  if (DIFFICULTY_SCALING === "turn") {
    return turnSpeedBonus(enemy.kind, state.turn);
  }
  const ramp = state.enemySpeedBonus + state.enemySpeedThisTurn;
  return enemy.kind === "sniper" ? ramp / 2 : ramp;
}

/**
 * The standing enemy movement shown in the HUD: base plus the permanent ramp.
 * It describes assassins, the faster kind; snipers are slower in both schemes
 * (half the card ramp, or a longer turn period). Both share a base, so one
 * figure otherwise suffices.
 */
export function permanentEnemyMovement(state: GameState): number {
  if (DIFFICULTY_SCALING === "turn") {
    return ASSASSIN_BASE_MOVEMENT + turnSpeedBonus("assassin", state.turn);
  }
  return ASSASSIN_BASE_MOVEMENT + state.enemySpeedBonus;
}

/** Enemy movement that applies only this turn, from Escalation or any effect. */
export function temporaryEnemyMovement(state: GameState): number {
  if (DIFFICULTY_SCALING === "turn") {
    return 0;
  }
  return state.enemySpeedThisTurn;
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
  /** Whether peer spacing turned a move that would have advanced into a stop. */
  blockedByPeers: boolean;
};

/** The outcome of one chaser's move: where it ended, and whether it caught you. */
export type ChaseResult = {
  position: HexCoord;
  killedPlayer: boolean;
  /** The hexes walked, start and end included. */
  path: readonly HexCoord[];
  /** Whether peer spacing turned a move that would have advanced into a stop. */
  blockedByPeers: boolean;
};

/**
 * The hex an assassin aims for when it cannot reach the player this turn: the
 * spot nearest to the player that is not on or within `ASSASSIN_SPACING` of a
 * peer, so chasers do not pile onto the same approach. Ties break toward the
 * assassin, so it does not cross the map for an equally close spot. Only tiles
 * in `tiles` are considered, so an invisible tile is never a destination. Falls
 * back to the player's own hex if every spot nearby is crowded.
 */
function chaseTarget(
  player: HexCoord,
  from: HexCoord,
  peers: readonly HexCoord[],
  maxDistance: number,
  tiles: ReadonlyMap<string, Tile>,
): HexCoord {
  let best = player;
  let bestToPlayer = Infinity;
  let bestToFrom = Infinity;
  for (const coord of hexesInRange(player, maxDistance)) {
    if (!tiles.has(hexKey(coord))) {
      continue;
    }
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
 * One chaser's move: if it can reach the player this turn the player dies;
 * otherwise it chases the spot nearest the player that is clear of its peers.
 * It never ends its move within `ASSASSIN_SPACING` of a peer. Shared by
 * assassins and snipers, which differ only in their movement budget.
 */
export function chase(
  from: HexCoord,
  movement: number,
  player: HexCoord,
  tiles: ReadonlyMap<string, Tile>,
  maxDistance: number,
  peers: readonly HexCoord[],
  walls: readonly WallEdge[],
): ChaseResult {
  const costAt = terrainCostAt(tiles, from, walls);
  const toPlayer = findPathByCost(from, player, costAt);
  if (toPlayer !== null && toPlayer.cost <= movement) {
    return {
      position: player,
      killedPlayer: true,
      path: toPlayer.path,
      blockedByPeers: false,
    };
  }

  const target = chaseTarget(player, from, peers, maxDistance, tiles);
  let toTarget = findPathByCost(from, target, costAt);
  if (toTarget === null) {
    // The nearest clear spot may sit across impassible ground; fall back to the
    // player so the chaser still closes in and lets the crowd rule stop it.
    toTarget = findPathByCost(from, player, costAt);
  }
  if (toTarget === null) {
    return {
      position: from,
      killedPlayer: false,
      path: [from],
      blockedByPeers: false,
    };
  }
  const advanced = advanceAlongPath(toTarget.path, movement, costAt);
  const path = retreatFromPeers(advanced.path, peers);
  return {
    position: path[path.length - 1] ?? from,
    killedPlayer: false,
    path,
    blockedByPeers: advanced.path.length > 1 && path.length <= 1,
  };
}

/**
 * The hex a chaser heads for: the mimic when it is nearer than the player, so a
 * placed decoy draws enemies away.
 */
function mimicTarget(
  from: HexCoord,
  player: HexCoord,
  mimic: HexCoord | null,
): HexCoord {
  if (mimic !== null && hexDistance(from, mimic) < hexDistance(from, player)) {
    return mimic;
  }
  return player;
}

/**
 * One assassin's move. If it can reach the player this turn the player dies;
 * otherwise it chases the spot nearest the player that is clear of its peers.
 * It never ends its move within `ASSASSIN_SPACING` of a peer.
 */
export function takeAssassinTurn(
  assassin: Assassin,
  player: HexCoord,
  tiles: ReadonlyMap<string, Tile>,
  maxDistance: number,
  peers: readonly HexCoord[],
  speedBonus: number,
  walls: readonly WallEdge[],
  mimic: HexCoord | null,
): AssassinTurn {
  const target = mimicTarget(assassin.position, player, mimic);
  const result = chase(
    assassin.position,
    assassin.movement + speedBonus,
    target,
    tiles,
    maxDistance,
    peers,
    walls,
  );
  return {
    assassin: { ...assassin, position: result.position },
    // Reaching the mimic is harmless; only reaching the player is fatal.
    killedPlayer: result.killedPlayer && equalsHex(target, player),
    path: result.path,
    blockedByPeers: result.blockedByPeers,
  };
}

/** Build one enemy of `kind` at `position` with its base movement. */
export function makeEnemy(
  kind: EnemyKind,
  position: HexCoord,
  ids: IdFactory,
): Enemy {
  switch (kind) {
    case "assassin":
      return {
        kind: "assassin",
        id: ids(),
        position,
        movement: ASSASSIN_BASE_MOVEMENT,
      };
    case "sniper":
      return {
        kind: "sniper",
        id: ids(),
        position,
        movement: SNIPER_BASE_MOVEMENT,
        aim: null,
      };
    case "watchtower":
      return {
        kind: "watchtower",
        id: ids(),
        position,
        radius: WATCHTOWER_RADIUS,
      };
  }
}

/**
 * The enemies that appear the instant their tile is stamped: every delay-0
 * spawn. They are placed when the section is generated, so the player sees them
 * — and their danger zone — as soon as the section is visible, instead of one
 * appearing and firing in the same enemy phase.
 */
export function instantEnemies(
  tiles: ReadonlyMap<string, Tile>,
  ids: IdFactory,
): Enemy[] {
  const spawned: Enemy[] = [];
  for (const [key, tile] of tiles) {
    if (tile.spawnKind === null || tile.spawnDelay !== 0) {
      continue;
    }
    spawned.push(makeEnemy(tile.spawnKind, parseHexKey(key), ids));
  }
  return spawned;
}

/**
 * Spawn an enemy on every live tile whose timer has come up. The enemy is due
 * at the start of turn `spawnTurn`, so it spawns in the enemy phase of the turn
 * before. Delay-0 spawns are not handled here: they are placed at generation
 * (`instantEnemies`), so they are visible before they can fire.
 */
export function spawnEnemies(
  tiles: ReadonlyMap<string, Tile>,
  currentTurn: number,
  ids: IdFactory,
): Enemy[] {
  const spawned: Enemy[] = [];
  for (const [key, tile] of tiles) {
    if (tile.spawnKind === null || tile.spawnDelay === 0) {
      continue;
    }
    if (tile.spawnTurn !== currentTurn + 1) {
      continue;
    }
    spawned.push(makeEnemy(tile.spawnKind, parseHexKey(key), ids));
  }
  return spawned;
}

/**
 * The hexes a sniper aiming along `direction` can shoot: the ray from its own
 * hex outward, stopping before the first impassible hex or the edge of the map.
 * The sniper's own hex is not part of the line.
 */
export function sniperLine(
  position: HexCoord,
  direction: number,
  tiles: ReadonlyMap<string, Tile>,
  walls: readonly WallEdge[],
): HexCoord[] {
  const step = AXIAL_DIRECTIONS[direction];
  if (step === undefined) {
    return [];
  }
  const line: HexCoord[] = [];
  let previous = position;
  let coord = addHex(position, step);
  while (true) {
    const tile = tiles.get(hexKey(coord));
    if (tile === undefined || tile.terrain === "impassible") {
      break;
    }
    if (wallBlocks(walls, previous, coord)) {
      break;
    }
    line.push(coord);
    previous = coord;
    coord = addHex(coord, step);
  }
  return line;
}

/** True if the player stands on the sniper's current line of sight. */
export function sniperKills(
  sniper: Sniper,
  player: HexCoord,
  tiles: ReadonlyMap<string, Tile>,
  walls: readonly WallEdge[],
): boolean {
  // Ranged only: the line starts one hex out, so a player sharing the sniper's
  // own hex is never hit.
  if (sniper.aim === null || equalsHex(sniper.position, player)) {
    return false;
  }
  return sniperLine(sniper.position, sniper.aim, tiles, walls).some((coord) =>
    equalsHex(coord, player),
  );
}

/** The order of the live section containing `coord`, or -1 if it is unknown. */
function sectionOrderAt(index: MapIndex, coord: HexCoord): number {
  const id = index.hexToSection.get(hexKey(coord));
  if (id === undefined) {
    return -1;
  }
  return index.sections.findIndex((section) => section.id === id);
}

/**
 * A destination's desirability for a sniper, most significant field first:
 * outside the doomed section, not sharing a hex with another enemy, not adjacent
 * to one, then furthest from the player.
 */
function sniperRank(
  coord: HexCoord,
  player: HexCoord,
  peers: readonly HexCoord[],
  doomed: number,
  orderAt: (coord: HexCoord) => number,
): readonly number[] {
  return [
    orderAt(coord) !== doomed ? 1 : 0,
    peers.some((peer) => equalsHex(peer, coord)) ? 0 : 1,
    peers.some((peer) => hexDistance(peer, coord) <= 1) ? 0 : 1,
    hexDistance(coord, player),
  ];
}

/** True if rank `a` beats `b`, comparing the most significant field first. */
function beatsRank(a: readonly number[], b: readonly number[]): boolean {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) {
      return a[i] > b[i];
    }
  }
  return false;
}

/**
 * Where a sniper walks this turn: away from the player, since it is weak up
 * close, but never onto the section that is about to be streamed away — a
 * sniper left behind there is simply deleted. It also keeps its distance from
 * other enemies: ending on one is strongly avoided, ending next to one weakly.
 * The sniper always moves, so its own hex is not a candidate: even a single step
 * beats standing still. Returns the destination and the path walked.
 *
 * Movement is otherwise unrestricted: a sniper may walk past the player or even
 * end on their hex. That is harmless because a sniper only ever kills down its
 * line of sight (`sniperKills`), never by contact.
 */
function sniperMove(
  sniper: Sniper,
  player: HexCoord,
  tiles: ReadonlyMap<string, Tile>,
  peers: readonly HexCoord[],
  doomed: number,
  orderAt: (coord: HexCoord) => number,
  speedBonus: number,
  walls: readonly WallEdge[],
): { position: HexCoord; path: HexCoord[] } {
  const costAt = terrainCostAt(tiles, sniper.position, walls);
  const reachable = hexesWithinCost(
    sniper.position,
    sniper.movement + speedBonus,
    costAt,
  );
  let best: HexCoord | null = null;
  let bestRank: readonly number[] | null = null;
  for (const coord of reachable) {
    if (equalsHex(coord, sniper.position)) {
      continue;
    }
    const rank = sniperRank(coord, player, peers, doomed, orderAt);
    if (bestRank === null || beatsRank(rank, bestRank)) {
      best = coord;
      bestRank = rank;
    }
  }
  if (best === null) {
    return { position: sniper.position, path: [sniper.position] };
  }
  const found = findPathByCost(sniper.position, best, costAt);
  return {
    position: best,
    path: found === null ? [sniper.position] : found.path,
  };
}

/**
 * The direction a sniper aims along: the one closest to the player. When the
 * player sits exactly between two directions, the one with the longer line
 * wins, so the sniper covers as much of the map as it can.
 */
function aimAt(
  sniper: Sniper,
  player: HexCoord,
  tiles: ReadonlyMap<string, Tile>,
  walls: readonly WallEdge[],
): number {
  const dq = player.q - sniper.position.q;
  const dr = player.r - sniper.position.r;
  const ds = -dq - dr;
  let bestDot = -Infinity;
  let candidates: number[] = [];
  for (let d = 0; d < AXIAL_DIRECTIONS.length; d += 1) {
    const dir = AXIAL_DIRECTIONS[d];
    const dot = dq * dir.q + dr * dir.r + ds * (-dir.q - dir.r);
    if (dot > bestDot) {
      bestDot = dot;
      candidates = [d];
    } else if (dot === bestDot) {
      candidates.push(d);
    }
  }
  let best = candidates[0];
  let bestLength = -1;
  for (const d of candidates) {
    const length = sniperLine(sniper.position, d, tiles, walls).length;
    if (length > bestLength) {
      bestLength = length;
      best = d;
    }
  }
  return best;
}

export function watchtowerKills(
  watchtower: Watchtower,
  player: HexCoord,
): boolean {
  return hexDistance(watchtower.position, player) <= watchtower.radius;
}

export function enemiesInRange(
  enemies: readonly Enemy[],
  origin: HexCoord,
  range: number,
  walls: readonly WallEdge[],
): Enemy[] {
  return enemies.filter(
    (enemy) =>
      hexDistance(enemy.position, origin) <= range &&
      !lineOfSightBlocked(walls, origin, enemy.position),
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
    case "watchtower":
      return "Watchtower";
  }
}

export function bountyFor(enemy: Enemy): number {
  switch (enemy.kind) {
    case "assassin":
      return 2;
    case "sniper":
      return 3;
    case "watchtower":
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
  walls: readonly WallEdge[],
): StepCost {
  const startKey = hexKey(start);
  return (from, to) => {
    if (wallBlocks(walls, from, to)) {
      return Infinity;
    }
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
 * within its movement, a sniper's line of sight, a watchtower's lethal radius.
 *
 * An assassin's reach is movement, so it is confined to `moveTiles` (the tiles
 * the enemy may actually walk on). A sniper's line of sight is physical, so it
 * uses `sightTiles` and is not limited by the fog.
 *
 * `frozen` marks an enemy that will skip its movement on the next enemy phase.
 * That only silences an assassin, which must move to attack; a sniper still
 * fires the line it already aimed and a watchtower never moves.
 */
function enemyDanger(
  enemy: Enemy,
  sightTiles: ReadonlyMap<string, Tile>,
  moveTiles: ReadonlyMap<string, Tile>,
  speedBonus: number,
  walls: readonly WallEdge[],
  mimic: HexCoord | null,
  frozen: boolean,
): Set<string> {
  const zone = new Set<string>();
  if (enemy.kind === "watchtower") {
    for (const coord of hexesInRange(enemy.position, enemy.radius)) {
      if (!lineOfSightBlocked(walls, enemy.position, coord)) {
        zone.add(hexKey(coord));
      }
    }
  } else if (enemy.kind === "sniper") {
    if (enemy.aim !== null) {
      for (const coord of sniperLine(
        enemy.position,
        enemy.aim,
        sightTiles,
        walls,
      )) {
        zone.add(hexKey(coord));
      }
    }
  } else if (!frozen) {
    // An assassin attacks by moving onto the player, so a frozen assassin — one
    // that will skip its movement on the next enemy phase — threatens nothing.
    // Snipers and watchtowers attack without moving, so freeze leaves them be.
    for (const coord of hexesWithinCost(
      enemy.position,
      enemy.movement + speedBonus,
      terrainCostAt(moveTiles, enemy.position, walls),
    )) {
      // A mimic draws the assassin away from any hex it is nearer to than the
      // player would be, so only hexes at least as close to the assassin as the
      // mimic are fatal: standing there, the player is the nearer target.
      if (
        mimic !== null &&
        hexDistance(enemy.position, coord) > hexDistance(enemy.position, mimic)
      ) {
        continue;
      }
      zone.add(hexKey(coord));
    }
  }
  return zone;
}

/**
 * Every hex an enemy could strike at the end of this turn, keyed by enemy id.
 * The map uses it to show which enemies threaten the tile under the cursor.
 *
 * A sleeping enemy — one the player cannot see yet — only threatens the fog
 * sliver of the section it stands in: stepping onto one of those leading rows
 * would wake that section, so the player must still be warned there. Anywhere
 * else it is harmless until it wakes.
 */
export function enemyDangerZones(state: GameState): Map<string, Set<string>> {
  const visible = visibleMap(state);
  const fogOrder = state.playerSectionOrder + 1;
  const mimic = state.mimic.kind === "placed" ? state.mimic.position : null;
  const frozen = new Set(state.frozenEnemyIds);
  const zones = new Map<string, Set<string>>();
  for (const enemy of state.enemies) {
    const awake = visible.tiles.has(hexKey(enemy.position));
    // An awake enemy moves only within the visible window, so its reach is
    // computed on those tiles. A sleeping enemy is still confined to its own
    // (invisible) section, so it keeps the full tile map and is filtered to the
    // fog sliver below.
    const zone = enemyDanger(
      enemy,
      state.map.tiles,
      awake ? visible.tiles : state.map.tiles,
      enemySpeedBonusFor(state, enemy),
      state.walls,
      mimic,
      frozen.has(enemy.id),
    );
    if (!awake) {
      const wakes =
        sectionOrderAt(state.map.index, enemy.position) === fogOrder;
      for (const key of zone) {
        if (!wakes || !visible.fog.has(key)) {
          zone.delete(key);
        }
      }
    }
    zones.set(enemy.id, zone);
  }
  return zones;
}

/**
 * Every hex an enemy could strike at the end of this turn, across the whole
 * field. Standing here when the turn ends is fatal.
 */
export function dangerZone(state: GameState): Set<string> {
  const zone = new Set<string>();
  for (const enemyZone of enemyDangerZones(state).values()) {
    for (const key of enemyZone) {
      zone.add(key);
    }
  }
  return zone;
}

/**
 * Whether the player is standing on a hex an enemy could strike at the end of
 * this turn. The end-turn button turns red while this is true, so the player is
 * warned before committing to a fatal turn.
 */
export function playerInDanger(state: GameState): boolean {
  return dangerZone(state).has(hexKey(state.map.player));
}

/**
 * The death of the player in the enemy phase, with any anomaly it implies. A
 * death on a hex the player was shown as dangerous (`savedDangerZone` is the
 * zone displayed when they ended their turn) is expected; a death anywhere else
 * is reported so it can be reproduced.
 */
function deathTransition(
  state: GameState,
  enemies: Enemy[],
  moves: readonly MovePath[],
  savedDangerZone: ReadonlySet<string>,
  reason: "assassin" | "sniper" | "watchtower",
  anomalies: readonly Anomaly[],
): Transition {
  const anomaly = unexplainedDeath(state, savedDangerZone, reason);
  const nextAnomalies = anomaly === null ? anomalies : [...anomalies, anomaly];
  return moving(
    {
      ...state,
      enemies,
      anomalies: nextAnomalies,
      phase: { kind: "game-over", reason: { kind: reason } },
    },
    moves,
  );
}

/**
 * Debug aid for the "died outside the danger zone" report. `savedDangerZone` is
 * the zone the player was shown when they ended their turn. If the enemy phase
 * kills them on a hex that zone did not cover, dump the whole board so the state
 * can be reproduced, and return the anomaly to record. A death on a covered hex
 * is expected: it logs nothing and returns null.
 */
function unexplainedDeath(
  state: GameState,
  savedDangerZone: ReadonlySet<string>,
  reason: "assassin" | "sniper" | "watchtower",
): Anomaly | null {
  const playerKey = hexKey(state.map.player);
  if (savedDangerZone.has(playerKey)) {
    return null;
  }
  console.log("Player died outside the danger zone", {
    reason,
    turn: state.turn,
    playerSectionOrder: state.playerSectionOrder,
    player: state.map.player,
    previous: state.map.previous,
    playerKey,
    savedDangerZone: [...savedDangerZone],
    enemies: state.enemies.map((enemy) => ({ ...enemy })),
    sections: state.map.index.sections.map((section) => ({
      id: section.id,
      difficulty: section.difficulty,
      origin: section.origin,
      entryEdge: section.entryEdge,
      exitEdge: section.exitEdge,
      footprint: section.footprint.map(hexKey),
    })),
    tiles: [...state.map.tiles].map(([key, tile]) => ({
      key,
      terrain: tile.terrain,
      cost: tile.cost,
      spawnKind: tile.spawnKind,
      spawnDelay: tile.spawnDelay,
      spawnTurn: tile.spawnTurn,
    })),
  });
  return {
    kind: "death-outside-danger-zone",
    reason,
    turn: state.turn,
    sectionOrder: state.playerSectionOrder,
  };
}

/**
 * The end-of-turn enemy step: spawn, fire the watchtowers, fire the snipers and
 * then walk and re-aim them, then move every assassin, one at a time. Returns
 * the new state together with the paths walked, in order, so the UI can show
 * each move in turn. It never throws.
 */
export function resolveEnemyPhase(
  state: GameState,
  maxDistance: number,
  savedDangerZone: ReadonlySet<string>,
): Transition {
  const spawned = spawnEnemies(state.map.tiles, state.turn, state.ids);
  const alreadyHere = state.enemies;
  let enemies: Enemy[] = [...alreadyHere, ...spawned];
  const moves: MovePath[] = [];
  let anomalies = state.anomalies;

  // An enemy the player cannot see yet is asleep: it neither fires nor moves
  // until it enters the visible window. Enemies in the fog sliver are visible,
  // so they act like any other. Movement is confined to the visible window too:
  // an enemy may not path through or onto an invisible tile, since that would
  // only put it back to sleep.
  const visible = visibleMap(state).tiles;
  const awake = (enemy: Enemy): boolean => visible.has(hexKey(enemy.position));
  const frozen = new Set(state.frozenEnemyIds);
  const mimic = state.mimic.kind === "placed" ? state.mimic.position : null;

  // Watchtowers fire first: ending your turn in their radius is fatal.
  for (const enemy of enemies) {
    if (
      enemy.kind === "watchtower" &&
      awake(enemy) &&
      watchtowerKills(enemy, state.map.player)
    ) {
      return deathTransition(
        state,
        enemies,
        moves,
        savedDangerZone,
        "watchtower",
        anomalies,
      );
    }
  }

  // Snipers fire down the line they aimed along last turn, then walk away from
  // the player and re-aim. Firing before they move means the danger zone the
  // player saw during their turn is exactly the line that fires. A freshly
  // spawned sniper has no aim yet, so it only takes up a line this turn.
  const alreadyIds = new Set(alreadyHere.map((enemy) => enemy.id));
  const doomed = state.playerSectionOrder - SECTIONS_BEHIND;
  const orderAt = (coord: HexCoord): number =>
    sectionOrderAt(state.map.index, coord);
  for (const enemy of [...enemies]) {
    if (enemy.kind !== "sniper" || !awake(enemy)) {
      continue;
    }
    if (sniperKills(enemy, state.map.player, state.map.tiles, state.walls)) {
      return deathTransition(
        state,
        enemies,
        moves,
        savedDangerZone,
        "sniper",
        anomalies,
      );
    }
    let sniper = enemy;
    // A frozen sniper still fires and re-aims, but does not move.
    if (alreadyIds.has(enemy.id) && !frozen.has(enemy.id)) {
      const peers = enemies
        .filter((e) => e.id !== enemy.id)
        .map((e) => e.position);
      const result = sniperMove(
        sniper,
        state.map.player,
        visible,
        peers,
        doomed,
        orderAt,
        enemySpeedBonusFor(state, sniper),
        state.walls,
      );
      if (result.path.length > 1) {
        moves.push({
          mover: { kind: "enemy", id: sniper.id },
          path: result.path,
        });
      }
      sniper = { ...sniper, position: result.position };
    }
    sniper = {
      ...sniper,
      aim: aimAt(sniper, state.map.player, state.map.tiles, state.walls),
    };
    enemies = enemies.map((e) => (e.id === sniper.id ? sniper : e));
  }

  // Then the assassins that were already on the map move, one at a time; the
  // first to reach you wins. A freshly spawned assassin waits a turn, so the
  // player always gets one turn's warning before it can strike.
  for (const enemy of alreadyHere) {
    if (enemy.kind !== "assassin" || !awake(enemy)) {
      continue;
    }
    // A frozen assassin cannot move, and cannot attack without moving.
    if (frozen.has(enemy.id)) {
      continue;
    }
    const peers = enemies
      .filter((e): e is Assassin => e.kind === "assassin" && e.id !== enemy.id)
      .map((e) => e.position);
    const turn = takeAssassinTurn(
      enemy,
      state.map.player,
      visible,
      maxDistance,
      peers,
      enemySpeedBonusFor(state, enemy),
      state.walls,
      mimic,
    );
    if (turn.path.length > 1) {
      moves.push({ mover: { kind: "enemy", id: enemy.id }, path: turn.path });
    }
    enemies = enemies.map((e) =>
      e.id === turn.assassin.id ? turn.assassin : e,
    );
    if (turn.killedPlayer) {
      return deathTransition(
        state,
        enemies,
        moves,
        savedDangerZone,
        "assassin",
        anomalies,
      );
    }
  }

  return moving({ ...state, enemies, anomalies, frozenEnemyIds: [] }, moves);
}
