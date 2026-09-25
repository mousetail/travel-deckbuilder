# 02 — Terrain & the tile model

**Goal:** define the terrain kinds, the rule that decides whether a card can enter a
given terrain, and the `Tile` record the map stores. Render a small block of hexes
so you can *see* terrain before any gameplay exists.

## 1. The terrain kinds

The design doc lists four difficulty-ordered terrain types plus two special ones:

| Terrain | Difficulty | Notes |
| ------- | ---------- | ----- |
| `grass` | easiest | Movement cards are common and have the highest numbers. |
| `forest` | | |
| `water` | | |
| `mountain` | hardest | Cards are rare and have the smallest numbers. |
| `dirt` | special | Passable by *any* movement card. |
| `impassible` | special | Never passable. |

`src/game/terrain.ts`:

```ts
export type Terrain =
  | "grass"
  | "forest"
  | "water"
  | "mountain"
  | "dirt"
  | "impassible";

/** Terrain that a card can be printed with, hardest last. */
export const CARD_TERRAINS: readonly Terrain[] = [
  "grass",
  "forest",
  "water",
  "mountain",
];

export const TERRAIN_TEXTURE: Record<Terrain, string> = {
  grass: "/images/jungle.png",
  forest: "/images/jungle.png",
  water: "/images/water.png",
  mountain: "/images/mountain.png",
  dirt: "/images/village.png",
  impassible: "/images/impassible.png",
};
```

### Reconciling with the existing art

The shipped textures are `jungle.png` (green), `village.png` (olive), `water.png`
(blue), `mountain.png` (purple), and `impassible.png` (grey) — all 32×32
flat-colour swatches with a diagonal hatch. The canonical model above needs six
kinds but only five distinct textures, so `grass` and `forest` currently share the
`jungle` texture (grass reads lighter, forest darker — see the CSS tint in §4).

Two reasonable resolutions; pick one and note it in the README's decision list:

1. **Reuse `jungle` for both grass and forest** and distinguish them with a CSS
   tint/overlay (what the snippet above assumes). Zero new art.
2. **Add a sixth texture** (e.g. `grass.png`) and delete the guesswork. Recommended
   if you want grass and forest to be instantly distinguishable.

Also confirm the `village` → `dirt` mapping: the design calls it "dirt ... passable
by any movement card", and `village` is the only olive/brown swatch, so it is the
natural fit.

## 2. Passability

This is the heart of movement. One pure function, used by the player move search
(chapter 04) *and* by enemy pathfinding (chapter 07):

```ts
import type { Terrain } from "./terrain";

/**
 * A movement card printed with `cardTerrain` may enter `terrain`.
 * Dirt is universally passable; impassible never is.
 */
export function canEnter(terrain: Terrain, cardTerrain: Terrain): boolean {
  if (terrain === "impassible") {
    return false;
  }
  if (terrain === "dirt") {
    return true;
  }
  return terrain === cardTerrain;
}
```

Design decision worth stating explicitly: a grass card crosses **grass and dirt
only**. It does *not* cross forest. "At the start you can only cross grass and
forest" is a statement about the starting *deck* (which contains both grass and
forest cards), not a special rule on the grass terrain. If you intended grass to be
strictly easier than forest (i.e. grass cards also cross forest), say so — it would
change `canEnter` to a small ordering rule. **Confirm.**

## 3. Tiles and features

A `Tile` is a terrain plus at most one feature. Follow the guideline "no optional
properties; prefer tagged unions" by giving the empty case a name instead of using
`null`:

```ts
import type { Card } from "./cards";

export type TileFeature =
  | { kind: "none" }
  | { kind: "shop"; stock: readonly Card[]; rerollCost: number }
  | { kind: "smith" }
  | { kind: "remove-card" }
  | { kind: "gain-card" }
  | { kind: "coin"; value: number };

export type Tile = {
  terrain: Terrain;
  feature: TileFeature;
  /**
   * Turns after the player enters this tile's section that an assassin spawns
   * here; -1 means never.
   */
  spawnDelay: number;
  /** Absolute turn the assassin appears; -1 until the section is entered. */
  spawnTurn: number;
};

export function emptyTile(terrain: Terrain, spawnDelay: number): Tile {
  return { terrain, feature: { kind: "none" }, spawnDelay, spawnTurn: -1 };
}
```

Features and the spawn timer are filled in by map generation (chapter 05) and read
by the economy (chapter 08) and enemy (chapter 07) chapters. `spawnDelay` is the
per-tile delay, fixed at generation; `spawnTurn` is filled in when the player
enters the tile's section, so the timer only starts once the player is there.
Declaring them here keeps the tile the single source of truth for "what is on this
hex".

> If `Card` is not defined yet in your build order, create a minimal `cards.ts`
> exporting a `Card` type now; chapter 03 fills in the catalogue.

## 4. Rendering a hex

Create `src/ui/map-view.ts`. For each `Tile` you render a positioned element shaped
like a pointy-top hex via `clip-path`, with the terrain texture as a tiled
background:

```ts
import { hexToPixel, hexKey } from "../game/hex";
import type { HexCoord } from "../game/hex";
import { TERRAIN_TEXTURE } from "../game/terrain";
import type { Tile } from "../game/terrain";

export class MapView {
  constructor(private readonly layer: HTMLElement) {}

  render(tiles: ReadonlyMap<string, Tile>): void {
    const nodes: Node[] = [];
    for (const [key, tile] of tiles) {
      nodes.push(this.hexElement(key, tile));
    }
    this.layer.replaceChildren(...nodes);
  }

  private hexElement(key: string, tile: Tile): HTMLElement {
    const [q, r] = key.split(",");
    const coord: HexCoord = { q: Number(q), r: Number(r) };
    const pixel = hexToPixel(coord);

    const element = document.createElement("div");
    element.classList.add("hex", `terrain-${tile.terrain}`);
    element.style.backgroundImage = `url("${TERRAIN_TEXTURE[tile.terrain]}"")`;
    element.dataset["hexKey"] = key;
    element.style.transform = `translate(${pixel.x}px, ${pixel.y}px)`;
    return element;
  }
}
```

> Note: `element.dataset` access — `dataset["hexKey"]` — is a `string | undefined`
> read when *reading*, but on *writing* it takes a string, so no cast is needed.
> When you later read it back, narrow it (`const key = element.dataset["hexKey"];
> if (key === undefined) return;`).

The CSS makes an element the right shape and size for a pointy-top hex:

```css
.hex {
  position: absolute;
  width: 55.4px;   /* sqrt(3) * HEX_SIZE for HEX_SIZE=32 */
  height: 64px;    /* 2 * HEX_SIZE */
  background-size: 32px 32px; /* tile the 32×32 texture */
  image-rendering: pixelated;
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
  border: none;

  &.terrain-forest { background-blend-mode: multiply; background-color: #2f7d2f; }
  &.terrain-grass  { background-color: transparent; }
  &.terrain-impassible { filter: brightness(0.5); }
}
```

Because `hexToPixel` returns the hex *centre*, translate by the centre minus half the
element size (subtract `width/2`, `height/2`) — or use `translate(-50%, -50%)`
composed with the pixel offset. Keeping the top-left origin at the element's centre
makes rotation and range rings much easier later.

`clip-path` + `background-image` is a clean, scalable way to get textured hexes with
no image editing, and the pixel texture stays crisp thanks to
`image-rendering: pixelated`. This is the "DOM hexes" default from the README
decision list; canvas is the alternative if you ever need thousands of hexes.

## 5. Milestone

- `terrain.ts` exports `Terrain`, `canEnter`, `Tile`, `TileFeature`, `emptyTile`.
- `canEnter("dirt", t)` is `true` for every card terrain; `canEnter("impassible", t)`
  is `false` for every card terrain.
- Temporarily seed a 5-hex-wide block of mixed terrain in `main.ts` and confirm the
  hexes tile without gaps or overlaps. Delete the seed data when chapter 05
  provides a real map.

Next: [Cards, deck, and rarities](03-cards-and-deck.md).
