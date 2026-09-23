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
  forest: 2,
  water: 3,
  mountain: 3,
  impassible: Infinity,
};
```

Assassins can therefore cross water and mountains, but slowly — which is what makes
the player's forest/water shortcuts less safe than they first look.

## 3. Cost-aware pathfinding

The BFS in `hex.ts` assumed every step costs 1, which is wrong here. Use Dijkstra.
Keep it generic by passing a cost function (same pattern as `findPath`):

```ts
import { equalsHex, hexKey, neighbours } from "./hex";

export type CostLookup = (coord: HexCoord) => number;

export type CostPath = { path: HexCoord[]; cost: number };

export function findPathByCost(
  start: HexCoord,
  goal: HexCoord,
  costAt: CostLookup,
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
      const step = costAt(next);
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
- Otherwise it paths toward the **leading edge** to cut the player off.
- If it has terrain to consider, it spends its movement points along the cheapest
  path, one step at a time.

```ts
export function advanceAlongPath(
  path: readonly HexCoord[],
  budget: number,
  costAt: CostLookup,
): { position: HexCoord; spent: number } {
  if (path.length === 0) {
    throw new Error("empty path");
  }
  let position = path[0];
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
```

`costAt` here reads `TERRAIN_MOVE_COST[tile.terrain]`, ignoring the player's cards —
assassins are not governed by the deck.

> Design interpretation to confirm: "if they can not reach the player they will
> pathfind towards the leading edge" is implemented literally — assassins head for
> the escape front rather than tailing the player. This makes them interceptors that
> threaten the *route ahead*. If you actually want them to chase, swap `leadingEdge`
> for `player` in the second branch. Both are one-line changes; pick the feel you
> want.

## 5. Spawning from tile timers

Each tile carries a `spawnTurn` (set during generation; chapter 05). At the start of
the enemy phase, spawn an assassin on every live tile whose `spawnTurn` equals the
current turn:

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
    if (tile.spawnTurn !== currentTurn) {
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

Scaling ("further in, multiple spawn at once and get faster") is expressed purely by
`spawnTurn` clustering and `movementFor`, e.g.:

```ts
export function assassinMovementFor(turn: number): number {
  return 2 + Math.floor(turn / 6);
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
export function resolveEnemyPhase(state: GameState, leadingEdge: HexCoord): GameState {
  const costAt: CostLookup = (coord) => {
    const tile = state.map.tiles.get(hexKey(coord));
    return tile === undefined ? Infinity : TERRAIN_MOVE_COST[tile.terrain];
  };

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
    const turn = takeAssassinTurn(enemy, state.map.player, leadingEdge, costAt);
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

## 10. Milestone

- Tiles spawn assassins on their `spawnTurn`; multiple can appear on the same turn.
- An assassin that can reach you ends the game; one that cannot heads toward the
  leading edge.
- Assassins cross grass quickly and water/mountains slowly, and cannot cross
  impassible hexes.
- Ending your turn inside a sniper's radius ends the game.
- A combat card kills a target within range and pays the bounty; a
  `range: 0` attack only works when you share the enemy's hex.
- Enemies on a removed trailing section are gone.

Next: [Economy & upgrades](08-economy-and-upgrades.md).
