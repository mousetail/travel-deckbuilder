# 13 — Consumables: implementation plan

**Status:** plan only — no gameplay code written yet.
**Scope:** the consumables system from `design.md`: up to 3 held items, a rare
pickup space, a left-edge UI strip, one starting consumable, and the seven
consumables themselves.

This chapter is a working plan, not a design reference. It records the decisions
made while scoping the work and maps every one onto concrete files. Once
approved, the implementation follows this document. The checklist in §8 is the
todo list; the sections above it are the reasoning behind each item.

---

## 0. Decisions confirmed before planning

1. **Names.** The seven names — `Reshuffle`, `Retreat`, `Freeze`, `Slow`,
   `Mimic`, `Trailblaze`, `Barricade` — are confirmed.
2. **"Safe space" for Retreat.** A grass tile in the section behind the player
   that is not in any enemy's danger zone (`dangerZone`, chapter 07) and not
   occupied by an enemy.
3. **Freeze timing.** "Will not move next turn" is the enemy phase at the end of
   the current turn — the next enemy phase to run.
4. **Mimic lifetime.** Lasts until the section it stands on is destroyed. As the
   player advances the mimic falls behind and is eventually streamed away, which
   is the balance.
5. **Barricade duration.** Lasts until the section it surrounds is destroyed,
   balanced the same way.
6. **Trailblaze and impassible.** "Any kind of terrain" excludes impassible; it
   makes any movement card interchangeable with another.
7. **Slow in turn-scaling mode.** Disabled entirely: it is neither offered nor
   usable when `DIFFICULTY_SCALING === "turn"`.
8. **Full hands at the pickup space.** The options are still shown, but taking
   one is disabled until a consumable is used to make room. Consumables can be
   used while the pickup window (or a shop) is open. There is no discarding a
   consumable without using it.

---

## 1. Consumable-by-consumable spec

| Consumable | Effect | Usable when |
| ---------- | ------ | ----------- |
| Reshuffle | Shuffle draw + hand + discard together, wake every sleeping card, draw 4 | always |
| Retreat | Jump to the closest safe grass tile in the section behind | a safe tile exists |
| Freeze | Enemies within 8 hexes do not move on the next enemy phase | an enemy is within 8 |
| Slow | Enemy movement −2 this turn | always, except in turn-scaling mode |
| Mimic | Place a mimic on the player's hex; enemies chase it when it is nearer | no mimic is already out |
| Trailblaze | Cards cross any terrain this turn | always |
| Barricade | One-way wall around the player's section until it is destroyed | always |

### 1.1 Reshuffle

- Combine `deck.draw`, `deck.hand`, `deck.discard`; set every card's `sleeping`
  to 0; shuffle; then `drawCards(..., 4, rng)`.
- Always usable: a deck is never empty.
- The drawn cards count as drawn for the run stats (`countDrawn`).

### 1.2 Retreat

- Target section is `index.sections[playerSectionOrder - 1]`; unusable when that
  is undefined (the player is in the first section).
- Candidates: live grass tiles in that section's footprint, not in `dangerZone`,
  not occupied by an enemy.
- Pick the closest to the player by `hexDistance`; break ties deterministically
  (lowest `hexKey`) so replays are stable.
- Resolves as a jump (no walk animation), reusing the teleport handling from
  `resolveMoveTo`; run `onPlayerMoved` (a no-op going backwards, but keeps the
  invariant).

### 1.3 Freeze

- Record the ids of every enemy within 8 hexes of the player in
  `state.frozenEnemyIds`.
- In `resolveEnemyPhase`, a frozen enemy skips its movement step but still
  attacks from where it stands: watchtowers are unaffected, snipers may still
  aim and shoot, assassins cannot attack without moving.
- Clear `frozenEnemyIds` after the enemy phase resolves.

### 1.4 Slow

- `enemySpeedThisTurn -= 2`. The HUD already renders the signed temporary value
  (`enemy speed 1.2 (-2)`), so no HUD change is needed.
- Snipers take half the ramp, so they slow by 1 — consistent with the existing
  Escalation rule.
- **Disabled in turn-scaling mode.** When `DIFFICULTY_SCALING === "turn"`,
  `enemySpeedThisTurn` is ignored, so Slow is left out of the roll pool and
  `canUseConsumable` returns false for it.

### 1.5 Mimic

- `state.mimic` is a tagged union: `{ kind: "none" }` or
  `{ kind: "placed"; position: HexCoord }`.
- Enemy AI (`chase`/`chaseTarget` in `enemies.ts`) targets the mimic when
  `hexDistance(enemy, mimic) < hexDistance(enemy, player)`, otherwise the player.
- Lasts until the section it stands on is destroyed: cleared in `onPlayerMoved`
  when its hex is streamed away. It is not destroyed by an enemy reaching it.
- Unusable while a mimic is already placed.

### 1.6 Trailblaze

- `state.anyTerrainTurns` set to 1 on use, decremented in `startTurn`.
- Player movement ignores terrain-*type* passability while active (impassible
  still blocks). This is the passability counterpart to Scout's
  `terrainTrivialTurns`, which only overrides *cost*.
- Applies to reach outlines, hover paths, and the actual move.

### 1.7 Barricade

The highest-risk item; it touches movement and every line-of-sight check.

- Walls are stored per **directed hex edge**, not per section, so any edge can
  be walled and later cards can wall off arbitrary areas (see `walls.ts`, §2).
- Barricade adds every boundary edge of the player's section, each directed
  inward: crossing from outside the section to inside is blocked, crossing
  outward is allowed.
- **Movement:** a step is forbidden when `wallBlocks` reports the `from → to`
  edge is walled. Applies to both the player and enemies.
- **Shooting:** a line of sight stops at a walled edge it would cross. Affects
  sniper lines of sight, watchtower radii, and player attacks.
- Walls are permanent: never removed by a timer, only when the tiles they sit on
  leave the map. Barricade's wall therefore disappears once its section is
  streamed away.

---

## 2. Data model (`src/game/`)

### New file `consumables.ts`

```ts
export type ConsumableKind =
  | "reshuffle" | "retreat" | "freeze" | "slow"
  | "mimic" | "trailblaze" | "barricade";

export type ConsumableSpec = {
  kind: ConsumableKind;
  name: string;
  description: string;
  icon: string;
};

export type Consumable = { id: string; spec: ConsumableSpec };

/** Excludes `slow` when `DIFFICULTY_SCALING === "turn"`. */
export const CONSUMABLE_CATALOGUE: readonly ConsumableSpec[];

/** Roll `count` distinct consumables for the pickup space. */
export function rollConsumableOptions(
  count: number, rng: Rng, ids: IdFactory,
): { options: Consumable[]; rng: Rng };

/** Whether using `consumable` right now would do anything. */
export function canUseConsumable(state: GameState, consumable: Consumable): boolean;

/**
 * Use a held consumable. Preserves the current phase, so it can be used with a
 * shop or pickup window open; returns the new state and any movement to animate.
 */
export function useConsumable(state: GameState, id: string): Transition;
```

### `state.ts`

```ts
export type Phase =
  | /* existing */
  | { kind: "pending-consumable"; options: readonly Consumable[] };  // new

export type Mimic =
  | { kind: "none" }
  | { kind: "placed"; position: HexCoord };

export type GameState = {
  /* existing */
  consumables: readonly Consumable[];   // at most 3
  mimic: Mimic;
  frozenEnemyIds: readonly string[];
  anyTerrainTurns: number;
  walls: readonly WallEdge[];           // from walls.ts
};
```

### New file `walls.ts`

Walls are per **directed hex edge**, so any edge can be walled — not just
section boundaries. A two-way wall is simply both directions of an edge. Walls
are permanent: they are never removed by a timer, only when the tiles they sit
on leave the map.

```ts
/** A directed hex edge: crossing from `from` to its neighbour `to` is blocked. */
export type WallEdge = { from: HexCoord; to: HexCoord };

/** Canonical key for a directed edge, for set membership. */
export function wallEdgeKey(edge: WallEdge): string;

/** Whether crossing `from → to` is blocked by any wall. */
export function wallBlocks(
  walls: readonly WallEdge[], from: HexCoord, to: HexCoord,
): boolean;

/** Every boundary edge of `sectionId`, directed inward. */
export function sectionWallEdges(
  index: MapIndex, sectionId: string,
): WallEdge[];
```

`wallBlocks` is the single query used by both movement and line-of-sight, so a
future card only has to append a `WallEdge` to `state.walls` to take effect.

### `terrain.ts`

- Add `{ kind: "consumable" }` to `TileFeature`.
- `featureVisual` returns a new map icon for it.
- `tileIcons` draws that icon.

### `map.ts`

- Add a feature char (e.g. `C`) to `FEATURE_BY_CHAR` mapping to
  `{ kind: "consumable" }`.
- Author it on rare sections in `tiles.json` (mountains / out-of-the-way spots),
  and/or add it to the `3` random-tier options.

### `deck.ts`

- Add `shuffleAll(deck, rng): DeckMutation` for Reshuffle: merge the three
  zones, wake every card, shuffle, then draw 4.

### `movement.ts` / `reach.ts`

- Add a cost lookup that ignores terrain type while `anyTerrainTurns > 0`
  (impassible still blocks), and use it in `cardReach` and `playerPathTo`.
- Add a wall check to the step-cost functions: a step is forbidden when
  `wallBlocks(walls, from, to)`.

### `enemies.ts`

- `chase`/`chaseTarget`: pick the mimic as the target when it is closer.
- `resolveEnemyPhase`: skip movement for frozen enemies; clear
  `frozenEnemyIds` at the end.
- `sniperLine` / `enemyDanger`: stop a line of sight at a walled edge it would
  cross (`wallBlocks`).

### `fog.ts`

- `onPlayerMoved` / `streamToSection`: clear `mimic` when its hex is removed,
  and drop every wall edge whose `from` or `to` hex is no longer on the map.

### `turn.ts`

- `startTurn`: decrement `anyTerrainTurns`.
- `endTurn`/`resolveEnemyPhase` wiring for freeze as above.

### `economy.ts`

- `useFeature`: new `consumable` case — roll 2 options, open
  `pending-consumable` (paying the skip bonus first, like the other features).
  The window opens even when the player holds 3.
- `FeatureAction`: add `{ kind: "take-consumable"; consumable: Consumable }`.
- `applyFeatureAction`: handle it — refuse while holding 3, otherwise add to
  `state.consumables`, consume the tile feature, end the turn.
- `leaveFeature`: add `pending-consumable` to the modal cases.

### `main.ts`

- Initialise `consumables` with one random consumable, and `mimic`,
  `frozenEnemyIds`, `anyTerrainTurns`, `wall` to their empty values.

---

## 3. UI (`src/ui/`)

- **New `consumables-view.ts`** — the left center edge strip: one button per
  held consumable, disabled when `canUseConsumable` is false, click calls
  `useConsumable`. Hover shows name + description (reuse the card tooltip
  pattern).
- **`app.ts`** — add a `consumablesSlot` to the middle row on the left; render
  the strip; wire the click handler to apply the returned `Transition`. The
  strip stays interactive during modal phases (shop, pickup), so a consumable
  can be used with a window open; it is inert only during `pending-card` and
  `game-over`. Add `pending-consumable` to `isModalPhase` and `handMode`.
- **`feature-view.ts`** — a `pending-consumable` panel offering the 2 rolled
  options as choices ("take" / "skip"). The take buttons are disabled while
  the player holds 3, but the options are still shown.
- **`hud.ts`** — `endTurnLabel` case for the `consumable` feature ("& Take a
  consumable"); `hintFor` text for `pending-consumable`.
- **`card-text.ts` / tooltip** — the seven descriptions.
- **`style.css`** — the left-edge strip: a small vertical grid of square
  black-on-white buttons, matching the existing UI vocabulary.

---

## 4. New icons — blank SVG placeholders

Per the existing convention, every new icon is a **blank SVG** for an artist to
fill in. Proposed location `src/images/consumable-icons/`:

| File | Used for |
| ---- | -------- |
| `reshuffle.svg` | Reshuffle |
| `retreat.svg` | Retreat |
| `freeze.svg` | Freeze |
| `slow.svg` | Slow |
| `mimic.svg` | Mimic |
| `trailblaze.svg` | Trailblaze |
| `barricade.svg` | Barricade |

Plus a map icon for the pickup space, e.g. `src/images/map-icons/consumable.svg`.

Each is a valid 16×16 SVG with no visible geometry (blank), carrying a comment
naming the intended glyph.

---

## 5. Cross-cutting switch sites to update

Adding the `consumable` feature and the `pending-consumable` phase makes the
compiler flag every exhaustive switch; the known ones:

- `terrain.ts`: `featureVisual`, `tileIcons`.
- `economy.ts`: `useFeature`, `applyFeatureAction`, `leaveFeature`.
- `hud.ts`: `endTurnLabel`, `hintFor`.
- `feature-view.ts`: `panels`.
- `app.ts`: `handMode`, `isModalPhase`.
- `movement.ts` / `reach.ts`: the cost lookups.

---

## 6. Validation

- `npm run build` (runs `tsc` then `vite build`) with no errors.
- Manual playtest per consumable:
  - Reshuffle: sleeping cards wake; 4 cards drawn; piles merge.
  - Retreat: jumps to the nearest safe grass tile behind; greyed when none.
  - Freeze: enemies within 8 stay put for the enemy phase; watchtowers still
    fire; snipers still aim.
  - Slow: HUD shows `(-2)`; enemies move less; not offered in turn-scaling mode.
  - Mimic: enemies divert to the mimic; it survives an enemy reaching it and is
    cleared only when its section is destroyed.
  - Trailblaze: a grass card crosses water/mountain this turn; impassible still
    blocks.
  - Barricade: enemies cannot enter the section; the player can leave but not
    return; shots into the section are blocked; it clears when the section is
    destroyed.
- Pickup space: offers 2 options; taking is disabled while holding 3, and a
  consumable can be used from the open window to make room.
- Starting consumable: exactly one, random, at run start.

---

## 7. Remaining risks

All of §0 is confirmed; these are the implementation risks left.

1. **Barricade is the riskiest item.** It touches movement and every
   line-of-sight check. If the one-way wall proves too complex, the fallback is
   a simpler "enemies cannot enter the section" wall that drops the shooting
   rule.
2. **Consumables during modal phases.** The strip must stay live while a shop or
   pickup window is open, and `useConsumable` must preserve the current phase
   rather than dropping to `playing`.
3. **Mimic and wall cleanup.** The mimic and any wall edges on removed tiles are
   cleared when their section is streamed away, so
   `onPlayerMoved`/`streamToSection` must handle them.

---

## 8. Todo list

### Data model
- [ ] Create `src/game/consumables.ts` with `ConsumableKind`, `ConsumableSpec`,
      `Consumable`, `CONSUMABLE_CATALOGUE`, `rollConsumableOptions`,
      `canUseConsumable`, `useConsumable`.
- [ ] Create `src/game/walls.ts` with `WallEdge`, `wallEdgeKey`, `wallBlocks`,
      `sectionWallEdges`.
- [ ] Add `consumables`, `mimic`, `frozenEnemyIds`, `anyTerrainTurns`, `walls` to
      `GameState` in `state.ts`.
- [ ] Add the `pending-consumable` phase to `Phase`.
- [ ] Add `{ kind: "consumable" }` to `TileFeature` in `terrain.ts`.
- [ ] Add `shuffleAll` to `deck.ts`.

### Consumable effects
- [ ] Reshuffle: merge zones, wake all, shuffle, draw 4.
- [ ] Retreat: find the closest safe grass tile in the section behind; jump.
- [ ] Freeze: record enemies within 8; skip their movement next enemy phase.
- [ ] Slow: `enemySpeedThisTurn -= 2`; disabled in turn-scaling mode.
- [ ] Mimic: place on the player's hex; retarget enemy AI; clear when its
      section is destroyed.
- [ ] Trailblaze: ignore terrain-type passability this turn.
- [ ] Barricade: append the section's boundary edges, directed inward, to
      `state.walls`; block movement and shots across a walled edge.

### Pickup space
- [ ] Add the `C` feature char to `FEATURE_BY_CHAR` in `map.ts`.
- [ ] Author the feature on rare sections in `tiles.json`.
- [ ] `useFeature` rolls 2 options and opens `pending-consumable` (even when
      full).
- [ ] `applyFeatureAction` handles `take-consumable`; `leaveFeature` handles the
      phase.
- [ ] Enforce the 3-item cap; show options but disable take while full.

### Turn & enemy integration
- [ ] `startTurn` decrements `anyTerrainTurns`.
- [ ] `resolveEnemyPhase` honours freeze and the mimic.
- [ ] Clear the mimic and wall edges on removed tiles in
      `onPlayerMoved`/`streamToSection`.
- [ ] `wallBlocks` checks in movement and line-of-sight.

### UI
- [ ] New `consumables-view.ts` left-edge strip.
- [ ] Wire the strip into `app.ts` (slot, click handler, `handMode`,
      `isModalPhase`); keep it live during modal phases.
- [ ] `pending-consumable` panel in `feature-view.ts`.
- [ ] `endTurnLabel` and `hintFor` cases in `hud.ts`.
- [ ] Descriptions in `card-text.ts` / tooltip.
- [ ] Left-edge strip CSS in `style.css`.

### Icons
- [ ] Blank SVGs for the seven consumables in `src/images/consumable-icons/`.
- [ ] Blank map icon for the pickup space.

### Start & validation
- [ ] Seed one random consumable in `main.ts`.
- [ ] `npm run build` clean.
- [ ] Manual playtest of every consumable and the pickup space (§6).
