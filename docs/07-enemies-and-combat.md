# 07 — Enemies & combat

**Goal:** assassins that spawn from tile timers, pathfind with terrain costs, and
kill you on contact; snipers that move slowly, then aim along a hex direction and
shoot down the whole line; watchtowers that kill you if you end your turn inside
their radius; and combat cards that let you kill any of them.

## 1. The enemy types

```ts
import type { HexCoord } from "./hex";

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
```

A tagged union again (not `kind: "assassin" | "sniper" | "watchtower"` plus
optional fields), so a `switch (enemy.kind)` narrows to exactly the fields that
variant has.

## 2. Terrain costs for movement

"Assassins have to consider terrain when moving and can also move faster over easier
terrain." That is a per-terrain step *cost*, with impassible = blocked:

```ts
import type { Terrain } from "./terrain";

export const TERRAIN_MOVE_COST: Record<Terrain, number> = {
  dirt: 1,
  grass: 1,
  forest: 1.25,
  water: 1.5,
  mountain: 1.5,
  impassible: Infinity,
};

/** Extra cost for stepping from one terrain type onto another. */
export const TERRAIN_BOUNDARY_COST = 2;
```

Terrain types differ only slightly, so hard ground never walls an assassin off
entirely. The real price of movement is *switching* terrain: crossing onto a
different type adds `TERRAIN_BOUNDARY_COST`, mirroring the player needing a fresh
card for each terrain they cross. The first step out of an assassin's own tile is
free, so one boxed in by mountains can always take at least one step.

## 3. Cost-aware pathfinding

The BFS in `hex.ts` assumed every step costs 1, which is wrong here. Use Dijkstra.
Keep it generic by passing a cost function (same pattern as `findPath`):

```ts
import { equalsHex, hexKey, neighbours } from "./hex";

/** Cost of stepping from one hex to an adjacent one; non-finite = blocked. */
export type StepCost = (from: HexCoord, to: HexCoord) => number;

export type CostPath = { path: HexCoord[]; cost: number };

export function findPathByCost(
  start: HexCoord,
  goal: HexCoord,
  stepCost: StepCost,
): CostPath | null {
  const best = new Map<string, number>();
  best.set(hexKey(start), 0);
  const cameFrom = new Map<string, HexCoord>();
  const open: HexCoord[] = [start];

  while (open.length > 0) {
    let cheapest = 0;
    for (let i = 1; i < open.length; i += 1) {
      const a = best.get(hexKey(open[i])) ?? Infinity;
      const b = best.get(hexKey(open[cheapest])) ?? Infinity;
      if (a < b) {
        cheapest = i;
      }
    }
    const [current] = open.splice(cheapest, 1);
    if (current === undefined) {
      break;
    }
    const currentCost = best.get(hexKey(current)) ?? Infinity;
    if (equalsHex(current, goal)) {
      return { path: reconstruct(cameFrom, start, goal), cost: currentCost };
    }
    for (const next of neighbours(current)) {
      const step = stepCost(current, next);
      if (!Number.isFinite(step)) {
        continue;
      }
      const candidate = currentCost + step;
      if (candidate < (best.get(hexKey(next)) ?? Infinity)) {
        best.set(hexKey(next), candidate);
        cameFrom.set(hexKey(next), current);
        open.push(next);
      }
    }
  }
  return null;
}
```

(`reconstruct` is the same back-walk used in chapter 01.) Linear scan of `open` is
fine at map sizes here; swap in a binary heap only if profiling says so.

## 4. Moving an assassin one enemy turn

The design's rule, restated precisely:

- If an assassin can reach the player this turn → the player dies.
- Otherwise it chases the spot nearest the player that is clear of its peers.
- It spends its movement points along the cheapest path, one step at a time.

```ts
export function advanceAlongPath(
  path: readonly HexCoord[],
  budget: number,
  stepCost: StepCost,
): { position: HexCoord; spent: number } {
  if (path.length === 0) {
    throw new Error("empty path");
  }
  let position = path[0];
  let spent = 0;
  for (let i = 1; i < path.length; i += 1) {
    const step = stepCost(path[i - 1], path[i]);
    if (spent + step > budget) {
      break;
    }
    spent += step;
    position = path[i];
  }
  return { position, spent };
}

export type AssassinTurn = { assassin: Assassin; killedPlayer: boolean };

export function takeAssassinTurn(
  assassin: Assassin,
  player: HexCoord,
  stepCost: StepCost,
  peers: readonly HexCoord[],
): AssassinTurn {
  const toPlayer = findPathByCost(assassin.position, player, stepCost);
  if (toPlayer !== null && toPlayer.cost <= assassin.movement) {
    return { assassin: { ...assassin, position: player }, killedPlayer: true };
  }

  const target = chaseTarget(player, assassin.position, peers);
  const toTarget = findPathByCost(assassin.position, target, stepCost);
  if (toTarget === null) {
    return { assassin, killedPlayer: false };
  }
  const advanced = advanceAlongPath(toTarget.path, assassin.movement, stepCost);
  return { assassin: { ...assassin, position: advanced.position }, killedPlayer: false };
}
```

`stepCost` here reads `TERRAIN_MOVE_COST[tile.terrain] * tile.cost` plus the
boundary surcharge, ignoring the player's cards — assassins are not governed by the
deck. `chaseTarget` returns the hex nearest the player that is not on or within
`ASSASSIN_SPACING` of a peer, so chasers do not pile onto the same approach; ties
break toward the assassin.

> The design's "pathfind towards the leading edge" is deliberately not implemented:
> assassins chase the player instead. `leadingEdge` is still exported from `fog.ts`
> if you want to switch back.

## 5. Spawning from tile timers

Spawns are **authored per template** in the level editor as two layers (chapter
05): an **enemy layer** (`enemies`) naming the kind on each hex — `.` none, `a`
assassin, `s` sniper, `w` watchtower — and an **enemy-timer layer**
(`enemyTimers`) giving the delay in turns, `.` meaning 0. Stamping writes both
onto the tile as `spawnKind` and `spawnDelay`.

A delay of **0 is special**: the enemy is placed the moment the section is
stamped, so it is on the map — and its danger zone is drawn — as soon as the
section is visible. This is how watchtowers work, and it is what lets the player
see the threat *before* ending a turn standing in it:

```ts
import type { Tile } from "./terrain";
import type { IdFactory } from "./cards";

export function instantEnemies(
  tiles: ReadonlyMap<string, Tile>,
  turn: number,
  ids: IdFactory,
): Enemy[] {
  const spawned: Enemy[] = [];
  for (const [key, tile] of tiles) {
    if (tile.spawnKind === null || tile.spawnDelay !== 0) {
      continue;
    }
    spawned.push(makeEnemy(tile.spawnKind, parseHexKey(key), turn, ids));
  }
  return spawned;
}
```

Any other delay is **relative**: entering the section arms the tile with an
absolute `spawnTurn = entryTurn + delay` (chapters 05–06), and the enemy phase
spawns it on the turn before that, so it is already on the map when the countdown
the player sees would reach 0 and the badge never shows 0:

```ts
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
    spawned.push(makeEnemy(tile.spawnKind, parseHexKey(key), currentTurn, ids));
  }
  return spawned;
}
```

Scaling ("further in, multiple spawn at once and get faster") is expressed purely
by the authored spawns — how many a band's templates carry and their delays — and
by the movement curves, e.g.:

```ts
export function assassinMovementFor(turn: number): number {
  return 1 + Math.floor(turn / 8);
}

/** Snipers are slower than assassins, and speed up more gradually. */
export function sniperMovementFor(turn: number): number {
  return 1 + Math.floor(turn / 16);
}
```

Keep the curves in one place so chapter 10 can tune them.

## 6. Watchtowers and snipers

Watchtowers are authored on the enemy layer with a timer of 0, so they are placed
as soon as their section is stamped (chapter 05) and are visible before the player
can end a turn inside them. They never move. (Like every enemy, a watchtower in a
section the player has not reached yet is asleep and harmless — chapter 06.) Their
rule is evaluated when the player **ends their turn**:

```ts
import { hexDistance } from "./hex";

export function watchtowerKills(watchtower: Watchtower, player: HexCoord): boolean {
  return hexDistance(watchtower.position, player) <= watchtower.radius;
}
```

Snipers walk on `sniperMovementFor`, **away** from the player (they are weak up
close) and never onto the section that is about to be streamed away — a sniper
left there is simply deleted. Then they aim along the hex direction closest to
the player; when the player sits exactly between two directions, the one with the
longer line wins. A sniper shoots the whole ray from its own hex outward,
stopping before the first impassable hex or the edge of the map:

```ts
import { AXIAL_DIRECTIONS, addHex, equalsHex, hexKey } from "./hex";

export function sniperLine(
  position: HexCoord,
  direction: number,
  tiles: ReadonlyMap<string, Tile>,
): HexCoord[] {
  const step = AXIAL_DIRECTIONS[direction];
  const line: HexCoord[] = [];
  let coord = addHex(position, step);
  while (true) {
    const tile = tiles.get(hexKey(coord));
    if (tile === undefined || tile.terrain === "impassible") {
      break;
    }
    line.push(coord);
    coord = addHex(coord, step);
  }
  return line;
}

export function sniperKills(
  sniper: Sniper,
  player: HexCoord,
  tiles: ReadonlyMap<string, Tile>,
): boolean {
  return (
    sniper.aim !== null &&
    sniperLine(sniper.position, sniper.aim, tiles).some((c) => equalsHex(c, player))
  );
}
```

The whole ray is the sniper's danger zone, so the map draws its red outline over
every hex of the line.

**Movement.** `sniperMove` ranks every hex within reach, most significant first:
outside the doomed section (`playerSectionOrder - 1`, the one `streamToSection`
drops next); not sharing a hex with another enemy; not adjacent to one; then
furthest from the player. Its own hex is not a candidate, so it always moves —
even a single step, and even if that step is toward the player. So a sniper
retreats until it would step into the doomed section, and if it is already in it,
it walks forward to escape rather than being deleted for free. Movement is
otherwise unrestricted: a sniper may walk past the player or even end on their
hex, which is harmless because it never kills by contact.

**Aiming.** `aimAt` takes the cube-space dot product of the offset to the player
with each of the six directions and keeps the largest. A tie means the player is
exactly between two directions, so it picks whichever of the two has the longer
`sniperLine`.

**Firing.** The sniper fires the line it aimed along *last* turn, before it moves
and re-aims. That is what makes the danger zone the player sees during their turn
the exact line that fires at the end of it — aim at the player, but give them a
turn to step off the line. A sniper is **ranged only**: `sniperLine` starts one
hex out from its own position, so a player sharing the sniper's hex is never hit,
and the enemy phase never checks for a contact kill.

## 7. The enemy phase

One function drives the whole end-of-turn enemy step. It returns a new state whose
`phase` may be `game-over`; it never throws. Only **awake** enemies act: one
standing on a hex the player cannot see yet is asleep and is skipped (chapter 06),
so it can never strike the moment it scrolls into view:

```ts
export function resolveEnemyPhase(state: GameState, maxDistance: number): Transition {
  const spawned = spawnEnemies(state.map.tiles, state.turn, state.ids);
  const alreadyHere = state.enemies;
  let enemies: Enemy[] = [...alreadyHere, ...spawned];
  const moves: MovePath[] = [];

  const visible = visibleMap(state).tiles;
  const awake = (enemy: Enemy) => visible.has(hexKey(enemy.position));

  // Watchtowers fire first: ending your turn in their radius is fatal.
  for (const enemy of enemies) {
    if (enemy.kind === "watchtower" && awake(enemy) && watchtowerKills(enemy, state.map.player)) {
      return moving({ ...state, enemies, phase: { kind: "game-over", reason: { kind: "watchtower" } } }, moves);
    }
  }

  // Snipers fire the line they aimed last turn, then walk away and re-aim.
  const alreadyIds = new Set(alreadyHere.map((enemy) => enemy.id));
  const doomed = state.playerSectionOrder - 1;
  const orderAt = (coord: HexCoord) => sectionOrderAt(state.map.index, coord);
  for (const enemy of [...enemies]) {
    if (enemy.kind !== "sniper" || !awake(enemy)) {
      continue;
    }
    if (sniperKills(enemy, state.map.player, state.map.tiles)) {
      return moving({ ...state, enemies, phase: { kind: "game-over", reason: { kind: "sniper" } } }, moves);
    }
    let sniper = enemy;
    if (alreadyIds.has(enemy.id)) {
      const result = sniperMove(sniper, state.map.player, state.map.tiles, doomed, orderAt);
      sniper = { ...sniper, position: result.position };
    }
    sniper = { ...sniper, aim: aimAt(sniper, state.map.player, state.map.tiles) };
    enemies = enemies.map((e) => (e.id === sniper.id ? sniper : e));
  }

  // Then assassins move, one at a time; the first to reach you wins.
  for (const enemy of alreadyHere) {
    if (enemy.kind !== "assassin" || !awake(enemy)) {
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
    if (turn.killedPlayer) {
      return moving({ ...state, enemies, phase: { kind: "game-over", reason: { kind: "assassin" } } }, moves);
    }
    enemies = enemies.map((e) => (e.id === turn.assassin.id ? turn.assassin : e));
  }

  return moving({ ...state, enemies }, moves);
}
```

A sleeping enemy's danger zone is still drawn, but only over the fog sliver of the
section it stands in — the hexes the player could end a turn on to wake it
(chapter 06). The player's own interactions follow the same rule: attack targets
and hover paths come from `visibleEnemies`, so an unseen enemy cannot be shot or
previewed.

Then `onPlayerMoved`-style streaming (chapter 06) drops any enemy standing on a
section that gets removed, which is the "disappear off the trailing edge" rule.

## 8. Killing enemies with cards

A combat card's `{ kind: "attack", range }` mode kills **one** enemy within `range`
hexes (`0` = same hex). Add a `pending-attack` phase and a pure resolver:

```ts
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
```

The UI lists the candidates from `enemiesInRange`; the player picks one; the game
removes it and pays the bounty (below). If there are no candidates, the card cannot
be played that way — grey out the mode rather than wasting the card.

## 9. Bounty

"Killing an enemy gives you some currency." Put the amount next to the enemy kind so
it stays data, not scattered magic numbers, and apply it in the same transition that
kills the enemy:

```ts
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
```

## 10. Crowding

One constraint keeps assassins readable instead of letting them pile up:

- An assassin never **targets** or **ends** its move on or within
  `ASSASSIN_SPACING` (2) hexes of a peer. `chaseTarget` picks the spot nearest the
  player that clears the crowd, and the walked path is trimmed back to the furthest
  step that clears it, or the assassin stays put if no step does.
- `chaseTarget` only looks `maxDistance` steps out from the player — the furthest
  tile the player can see (`visibleReach`, chapter 06) — keeping that search cheap.
  A chaser beyond that range still walks toward the target rather than freezing.

`maxDistance` and `peers` are passed into `takeAssassinTurn`, and
`resolveEnemyPhase` takes the `maxDistance` its caller computed:

```ts
const resolved = resolveEnemyPhase(paid, visibleReach(paid));
```

## 11. Milestone

- Tiles spawn their authored enemy on its `spawnTurn`; multiple can appear on the
  same turn. A section's timers only start once the player enters it, so a timed
  enemy never pops up in a section the player has not reached (and so cannot see).
  A delay-0 enemy (a watchtower) is placed when the section is stamped, so its
  danger zone is visible before it can fire.
- An assassin that can reach you ends the game; one that cannot chases the spot
  nearest you that is clear of its peers.
- Assassins cross grass quickly and water/mountains slowly, pay extra to switch
  terrain type, and cannot cross impassible hexes.
- A sniper moves more slowly than an assassin, always taking a step — away from
  the player, off the section about to be streamed away, and clear of other
  enemies (sharing a hex is worse than being adjacent) — then aims along the hex
  direction closest to the player (longest line breaks a tie). Ending your turn
  on that line ends the game; the line stops at the first impassible hex or the
  edge of the map. A sniper is ranged only: it never kills by contact, even when
  it ends on the player's hex.
- Ending your turn inside a watchtower's radius ends the game.
- An enemy on a hex the player cannot see is asleep: it is not drawn, does not
  fire, and does not move. A sleeping enemy still marks the fog rows of its own
  section, so the player can see which hexes would wake it into a kill.
- Assassins never end a move crowded next to a peer.
- A combat card kills a target within range and pays the bounty; a
  `range: 0` attack only works when you share the enemy's hex.
- Enemies on a removed trailing section are gone.

Next: [Economy & upgrades](08-economy-and-upgrades.md).
