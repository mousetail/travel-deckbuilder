# 07 — Enemies & combat

**Goal:** assassins that spawn from tile timers, pathfind with terrain costs, and
kill you on contact; snipers that kill you if you end your turn inside their radius;
and combat cards that let you kill either.

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
  /** Lethal radius in hexes. */
  radius: number;
};

export type Enemy = Assassin | Sniper;
```

A tagged union again (not `kind: "assassin" | "sniper"` plus optional fields), so a
`switch (enemy.kind)` narrows to exactly the fields that variant has.

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

Assassin spawn points are **authored per template** in the level editor: each
`SectionTemplate` lists `{ q, r, delay }` points (chapter 05). Stamping marks those
tiles with `spawnDelay`; entering the section arms each one with an absolute
`spawnTurn = entryTurn + delay` (chapters 05–06) — the turn the assassin appears.
The enemy phase spawns an assassin on every live tile due at the start of the next
turn, so the assassin is already on the map when the countdown the player sees
would reach 0, and the badge never shows 0. A delay-0 tile is armed mid-turn, so
it can only appear at the end of that same turn:

```ts
import type { Tile } from "./terrain";
import type { IdFactory } from "./cards";

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
    const [q, r] = key.split(",");
    spawned.push({
      kind: "assassin",
      id: ids(),
      position: { q: Number(q), r: Number(r) },
      movement: movementFor(currentTurn),
    });
  }
  return spawned;
}
```

Scaling ("further in, multiple spawn at once and get faster") is expressed purely
by the authored spawn points — how many a band's templates carry and their delays —
and by `movementFor`, e.g.:

```ts
export function assassinMovementFor(turn: number): number {
  return 2 + Math.floor(turn / 8);
}
```

Keep the curve in one function so chapter 10 can tune it.

## 6. Snipers

Snipers are placed at fixed hexes during generation, only in high-difficulty
sections. They never move. Their rule is evaluated when the player **ends their
turn**:

```ts
import { hexDistance } from "./hex";

export function sniperKills(sniper: Sniper, player: HexCoord): boolean {
  return hexDistance(sniper.position, player) <= sniper.radius;
}
```

Check every sniper after the assassins have moved (the player's position does not
change during the enemy phase, so the exact order of the sniper checks does not
matter, but do them once and early).

## 7. The enemy phase

One function drives the whole end-of-turn enemy step. It returns a new state whose
`phase` may be `game-over`; it never throws:

```ts
export function resolveEnemyPhase(state: GameState, maxDistance: number): GameState {
  const spawned = spawnAssassins(
    state.map.tiles,
    state.turn,
    assassinMovementFor,
    state.ids,
  );
  let enemies: Enemy[] = [...state.enemies, ...spawned];

  // Snipers fire first: ending your turn in their radius is fatal.
  for (const enemy of enemies) {
    if (enemy.kind === "sniper" && sniperKills(enemy, state.map.player)) {
      return { ...state, phase: { kind: "game-over", reason: { kind: "sniper" } } };
    }
  }

  // Then assassins move, one at a time; the first to reach you wins.
  for (const enemy of enemies) {
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
    if (turn.killedPlayer) {
      return { ...state, phase: { kind: "game-over", reason: { kind: "assassin" } } };
    }
    enemies = enemies.map((e) => (e.id === turn.assassin.id ? turn.assassin : e));
  }

  return { ...state, enemies };
}
```

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

- Tiles spawn assassins on their `spawnTurn`; multiple can appear on the same turn.
  A section's timers only start once the player enters it, so an assassin never
  pops up in a section the player has not reached (and so cannot see).
- An assassin that can reach you ends the game; one that cannot chases the spot
  nearest you that is clear of its peers.
- Assassins cross grass quickly and water/mountains slowly, pay extra to switch
  terrain type, and cannot cross impassible hexes.
- Ending your turn inside a sniper's radius ends the game.
- Assassins never end a move crowded next to a peer.
- A combat card kills a target within range and pays the bounty; a
  `range: 0` attack only works when you share the enemy's hex.
- Enemies on a removed trailing section are gone.

Next: [Economy & upgrades](08-economy-and-upgrades.md).
