# 06 — Fog of war & tile streaming

**Goal:** only three sections are ever relevant — the one you are on, the one behind,
and the leading two rows of the one ahead. Reveal the next section as you reach it,
delete the one now two behind (with everything on it), but remember where it was.

## 1. What is visible

From the design doc:

- Generally **3 tiles (sections) are visible**:
  1. the section the player is on,
  2. the previous section,
  3. the first 2 rows of the next section (fog of war).
- When the player *reaches* the next section, it becomes fully revealed, and the
  section now two behind is **removed, including any assassins on it**.
- Reaching a new section does **not** end the turn.
- The player can never go back.
- The removed section's **position is still remembered** so the path cannot wind back
  into it.

So visibility is a function of *which section the player currently occupies*, not of
individual hex distances. Keep an ordered list of live sections and derive the
window from the player's index in it.

## 2. Section membership

You need a fast "which section is this hex in?" lookup. Build it from the live
sections' footprints, and keep the remembered footprints in the same structure even
after removal so re-entry checks (chapter 05) still work:

```ts
import { hexKey } from "./hex";
import type { HexCoord } from "./hex";
import type { SectionRecord } from "./map";
import type { MapIndex } from "./state";

export function sectionAt(index: MapIndex, coord: HexCoord): string | null {
  return index.hexToSection.get(hexKey(coord)) ?? null;
}

/** Index of the newest live section whose footprint contains `coord`. */
export function liveSectionOrderId(index: MapIndex, coord: HexCoord): number {
  const id = sectionAt(index, coord);
  if (id === null) {
    return -1;
  }
  return index.sections.findIndex((section) => section.id === id);
}
```

## 3. Deriving the visible window

Given the player's section index `i`, the three visible sections are
`i - 1`, `i` (fully), and the **first two rows** of `i + 1`. "Rows" here means the
two hex-rows nearest the player's entry edge into section `i + 1`. Because sections
are hexagonal and entered along an edge, the natural definition is: the hexes of
section `i + 1` whose distance to the *entry edge centroid* is at most 2 in the
entry direction. Simpler and robust: expose a per-template list of "entry rows"
computed at stamp time as the hexes within 1 step of the entry edge, and reveal
those while the player is still in `i`.

```ts
export type Visibility = {
  /** Section ids fully visible. */
  full: readonly string[];
  /** Hexes visible in the not-yet-entered section (the fog-of-war sliver). */
  peek: readonly HexCoord[];
};

export function computeVisibility(
  index: MapIndex,
  playerSectionOrder: number,
  forwardRows: (section: SectionRecord) => readonly HexCoord[],
): Visibility {
  const full: string[] = [];
  const previous = index.sections[playerSectionOrder - 1];
  const current = index.sections[playerSectionOrder];
  const next = index.sections[playerSectionOrder + 1];

  if (previous !== undefined && previous.footprint.length > 0) {
    full.push(previous.id);
  }
  if (current !== undefined) {
    full.push(current.id);
  }
  const peek = next !== undefined ? forwardRows(next) : [];
  return { full, peek };
}
```

`forwardRows` is a small helper that selects the hexes of the next section adjacent
to the edge the player will enter from. Store it per section record (`entryEdge`)
and compute the two rows as `hexesInRange(entryEdgeCentroid, 2)` intersected with the
section footprint.

## 4. Removing the trailing section

When the player's section index increases:

1. The previous section becomes fully visible.
2. The section at `playerSectionOrder - 2` (now two behind) is removed.

Removal means: delete every hex in its footprint from `tiles`, drop it from
`hexToSection`, and **remove any enemies standing on it**. Keep its `SectionRecord`
(with `footprint`) in `index.sections` forever so the generator's no-re-entry check
still sees it.

```ts
export type StreamResult = {
  tiles: Map<string, Tile>;
  index: MapIndex;
  enemies: Enemy[];
  removed: SectionRecord | null;
};

export function streamToSection(
  tiles: Map<string, Tile>,
  index: MapIndex,
  enemies: readonly Enemy[],
  playerSectionOrder: number,
): StreamResult {
  const stale = index.sections[playerSectionOrder - 2];
  if (stale === undefined) {
    return { tiles, index, enemies: [...enemies], removed: null };
  }
  const staleHexes = new Set(stale.footprint.map(hexKey));
  const nextTiles = new Map(tiles);
  for (const key of staleHexes) {
    nextTiles.delete(key);
  }
  const nextHexToSection = new Map(index.hexToSection);
  for (const key of staleHexes) {
    nextHexToSection.delete(key);
  }
  const survivors = enemies.filter((enemy) => !staleHexes.has(hexKey(enemy.position)));
  return {
    tiles: nextTiles,
    index: { hexToSection: nextHexToSection, sections: index.sections },
    enemies: survivors,
    removed: stale,
  };
}
```

Note this is where the design's "including any assassins" and "if they disappear off
the trailing edge of the screen" both happen: enemies whose position was inside the
removed footprint are dropped — whether that is a mercy or a threat removed.

## 5. Revealing without ending the turn

Streaming must be callable *after each single-hex move* (chapter 04), not only at end
of turn. When a move completes:

1. Recompute the player's section order.
2. If it grew, arm the entered section's assassin timers, call `streamToSection` and
   recompute `computeVisibility`.
3. Re-render the map layer.

Since the move does not end the turn, this is a pure "react to new position" step.
Put it in one function so both movement and any future teleport-like effects use the
same path:

```ts
export function onPlayerMoved(state: GameState): GameState {
  const order = liveSectionOrderId(state.index, state.map.player);
  if (order <= state.playerSectionOrder) {
    return state;                       // still in the same section
  }
  const entered = state.map.index.sections[order];
  const tiles =
    entered === undefined ? state.map.tiles : armSection(state.map.tiles, entered, state.turn);
  const streamed = streamToSection(tiles, state.index, state.enemies, order);
  return {
    ...state,
    playerSectionOrder: order,
    map: { ...state.map, tiles: streamed.tiles },
    index: streamed.index,
    enemies: streamed.enemies,
  };
}
```

Entering a section is also when its assassin timers start (`armSection`, chapters 05
and 07), which is why the arming happens here rather than at generation.

## 6. Rendering the window

`MapView.render` should be given only the visible tiles (from the live sections plus
the `peek` hexes), so it never has to know about streaming. Render the peek hexes with
a `fog` class (dimmed, per the "limited colours" guideline) so the player reads them
as not-yet-accessible. Because hexes outside the window are simply absent from the
input map, they disappear for free.

## 7. Milestone

- Walking from one section into the next reveals it fully and dims the following
  two rows.
- Two sections behind is gone: its hexes no longer render and its enemies vanish.
- Moving forward then trying to walk back is impossible (the hexes no longer exist),
  yet generation never places a new section over the remembered footprint.
- Reaching a new section does not end the turn or refill the hand.

Next: [Enemies & combat](07-enemies-and-combat.md).
