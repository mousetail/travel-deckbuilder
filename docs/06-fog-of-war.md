# 06 — Fog of war & tile streaming

**Goal:** only a few sections are ever relevant — the one you are on, the
`SECTIONS_BEHIND` sections behind, and the leading `FOG_DEPTH` rows of the one
ahead. Reveal the next section as you reach it, delete the sections now
`SECTIONS_BEHIND + 1` behind (with everything on them), but remember where they were.

## 1. What is visible

From the design doc:

- Generally a few **tiles (sections) are visible**:
  1. the section the player is on,
  2. the `SECTIONS_BEHIND` sections behind it,
  3. the first `FOG_DEPTH` rows of the next section (fog of war).
- When the player *reaches* the next section, it becomes fully revealed, and the
  section now `SECTIONS_BEHIND + 1` behind is **removed, including any assassins on
  it**.
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

Given the player's section index `i`, the fully visible sections are `i` and the
`SECTIONS_BEHIND` sections behind it, plus the **first `FOG_DEPTH` rows** of
`i + 1`. "Rows" here means the hex-rows nearest the player's entry edge into
section `i + 1`. Because sections are hexagonal and entered along an edge, the
natural definition is: the hexes of section `i + 1` whose distance to the *entry
edge centroid* is at most `FOG_DEPTH` in the entry direction. Simpler and robust:
expose a per-template list of "entry rows" computed at stamp time as the hexes
within `FOG_DEPTH - 1` steps of the entry edge, and reveal those while the player
is still in `i`.

The fog depth is a single constant, `FOG_DEPTH`, so the sliver can be widened or
narrowed in one place. Each peeked hex carries its **depth** from the entry edge
(0 is the row the player steps onto next). The renderer maps depth to opacity, so
the nearest row is the clearest and the furthest the faintest, and raising
`FOG_DEPTH` adds a gradation rather than needing new styles. Seeing further ahead
lets the player read the terrain they are about to walk into and pick a movement
card of the right size rather than overshooting.

```ts
/** How many rows of the next section are visible, from its entry edge inward. */
export const FOG_DEPTH = 3;

/**
 * How many sections behind the player stay on the map. The section this many
 * behind is the oldest live one, and is dropped as soon as the player advances.
 */
export const SECTIONS_BEHIND = 1;

export type FogHex = {
  coord: HexCoord;
  /** 0 is the row the player steps onto next; higher is further away. */
  depth: number;
};

export type Visibility = {
  /** Section ids fully visible. */
  full: readonly string[];
  /** Hexes visible in the not-yet-entered section (the fog-of-war sliver). */
  peek: readonly FogHex[];
};

export function computeVisibility(
  index: MapIndex,
  playerSectionOrder: number,
  forwardRows: (section: SectionRecord) => readonly FogHex[],
): Visibility {
  const full: string[] = [];
  for (
    let order = playerSectionOrder - SECTIONS_BEHIND;
    order <= playerSectionOrder;
    order += 1
  ) {
    const section = index.sections[order];
    if (section !== undefined && section.footprint.length > 0) {
      full.push(section.id);
    }
  }
  const next = index.sections[playerSectionOrder + 1];
  const peek = next !== undefined ? forwardRows(next) : [];
  return { full, peek };
}
```

`forwardRows` is a small helper that selects the hexes of the next section adjacent
to the edge the player will enter from. Store it per section record (`entryEdge`)
and compute the rows as the hexes within `FOG_DEPTH - 1` steps of the edge,
intersected with the section footprint, tagging each hex with its distance.

## 4. Removing the trailing section

When the player's section index increases:

1. The section just entered becomes fully visible.
2. Every section more than `SECTIONS_BEHIND` behind is removed.

Removal means: delete every hex in its footprint from `tiles`, drop it from
`hexToSection`, and **remove any enemies standing on it**. Keep its `SectionRecord`
(with `footprint`) in `index.sections` forever so the generator's no-re-entry check
still sees it.

```ts
export type StreamResult = {
  tiles: Map<string, Tile>;
  index: MapIndex;
  enemies: Enemy[];
  removed: readonly SectionRecord[];
};

export function streamToSection(
  tiles: Map<string, Tile>,
  index: MapIndex,
  enemies: readonly Enemy[],
  playerSectionOrder: number,
): StreamResult {
  const stale = index.sections.filter(
    (_, order) => order <= playerSectionOrder - SECTIONS_BEHIND - 1,
  );
  if (stale.length === 0) {
    return { tiles, index, enemies: [...enemies], removed: [] };
  }
  const staleHexes = new Set<string>();
  for (const section of stale) {
    for (const coord of section.footprint) {
      staleHexes.add(hexKey(coord));
    }
  }
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
the `peek` hexes), so it never has to know about streaming. Render each peek hex with
a `fog` class and an opacity derived from its depth, so the player reads it as
not-yet-accessible and the rows fade out the further they are from the player. Keep
to one discrete step per row rather than a smooth gradient, per the "limited colours"
guideline. Because hexes outside the window are simply absent from the input map,
they disappear for free.

## 7. Sleeping enemies

An enemy is only ever as visible as the hex it stands on. `visibleMap` already
knows which hexes are in the window — the fully visible sections plus the fog
sliver — so it exposes that set as `tiles`, and a `visibleEnemies` filter:

```ts
export function visibleEnemies(state: GameState): Enemy[] {
  const visible = visibleMap(state).tiles;
  return state.enemies.filter((enemy) => visible.has(hexKey(enemy.position)));
}
```

An enemy on a hex outside the window is **asleep**: it is not rendered, and the
enemy phase skips it entirely — it neither fires nor moves. This is what stops an
enemy from striking the instant its section scrolls into view. An enemy in the
fog sliver, by contrast, *is* visible, so it is awake and acts like any other:
it fires, moves, and shows its full danger zone.

There is one edge case. Stepping onto the leading edge of the fogged section
reveals that whole section, waking every hidden enemy in it — and they act that
same enemy phase, so the player could die with no warning. To keep that fair, a
sleeping enemy's **danger zone is still drawn, but only over the fog sliver of
the section it stands in**: those are exactly the hexes the player could end a
turn on to wake it. Anywhere else it is harmless until it wakes, so nothing is
drawn there.

```ts
export function enemyDangerZones(state: GameState): Map<string, Set<string>> {
  const visible = visibleMap(state);
  const fogOrder = state.playerSectionOrder + 1;
  const zones = new Map<string, Set<string>>();
  for (const enemy of state.enemies) {
    const zone = enemyDanger(enemy, state.map.tiles);
    if (!visible.tiles.has(hexKey(enemy.position))) {
      const wakes = sectionOrderAt(state.map.index, enemy.position) === fogOrder;
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
```

## 8. Milestone

- Walking from one section into the next reveals it fully and dims the following
  three rows, each fainter than the last.
- Sections more than `SECTIONS_BEHIND` behind are gone: their hexes no longer
  render and their enemies vanish.
- Moving forward then trying to walk back is impossible (the hexes no longer exist),
  yet generation never places a new section over the remembered footprint.
- Reaching a new section does not end the turn or refill the hand.
- An enemy on a hex the player cannot see is neither drawn nor moved; a sleeping
  enemy still marks the fog rows it could be woken from.

Next: [Enemies & combat](07-enemies-and-combat.md).
