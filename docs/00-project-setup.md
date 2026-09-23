# 00 — Project setup & architecture

**Goal:** a running app with the folder split from the README, a tiny DOM helper,
and a game-state stub that the UI renders. No gameplay yet, but the seams you need
for everything else are in place.

## 1. What already exists

```
index.html            # mounts /src/main.ts into <div id="app">
src/main.ts           # new UI(document.getElementById('app') as HTMLDivElement)
src/types.ts          # Terrain, TileFeature, Tile, Position (stub)
src/cards.ts          # Card, CardType, movementCard(), StartingDeck, ShopInventory
src/ui.ts             # empty UI class
src/images/*.png      # 32×32 pixel-art textures and icons
package.json          # vite + typescript, scripts: dev / build / preview
tsconfig.json         # strict-ish compiler options
```

The first thing to fix is a guideline violation in `main.ts`: it uses `as`. Replace
the cast with a checked lookup helper. That helper is used everywhere afterwards.

## 2. The DOM helper

Create `src/ui/dom.ts`:

```ts
export function requireElement<T extends Element>(
  root: ParentNode,
  selector: string,
  expected: new () => T,
): T {
  const found = root.querySelector(selector);
  if (found === null) {
    throw new Error(`missing element: ${selector}`);
  }
  if (!(found instanceof expected)) {
    throw new Error(`element ${selector} is not a ${expected.name}`);
  }
  return found;
}

export function requireElementById<T extends Element>(
  id: string,
  expected: new () => T,
): T {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`missing element: #${id}`);
  }
  if (!(found instanceof expected)) {
    throw new Error(`element #${id} is not a ${expected.name}`);
  }
  return found;
}
```

`instanceof expected` is what lets you avoid `as`: the generic `T` is proven at
runtime by the constructor check. This is the pattern the design doc's "avoid `as`"
rule is pointing at.

Update `src/main.ts`:

```ts
import { requireElementById } from "./ui/dom";
import { App } from "./ui/app";

const root = requireElementById("app", HTMLDivElement);
const app = new App(root);
app.mount();
```

## 3. The `game/` vs `ui/` boundary

Two rules you enforce from day one:

1. Files under `src/game/` import nothing from `src/ui/` and never reference
   `document`, `window`, or `HTMLElement`.
2. Files under `src/ui/` may hold DOM references and call game functions, but they
   do not contain rules. If you are about to write `if (card.terrain === ...)` in a
   UI file, that condition belongs in `game/`.

The payoff is that every rule in this guide is testable without a browser (chapter
10) and that the map/enemy logic never gets entangled with rendering.

## 4. Game state shape

Create `src/game/state.ts` with a single discriminated state machine. Use a tagged
union rather than optional fields:

```ts
import type { Card, CardSpec, IdFactory } from "./cards";
import type { HexCoord } from "./hex";
import type { Tile } from "./terrain";
import type { Enemy } from "./enemies";
import type { SectionRecord } from "./map";
import type { Rng } from "./rng";

export type Deck = {
  draw: Card[];
  hand: Card[];
  discard: Card[];
};

export type MapIndex = {
  hexToSection: Map<string, string>;   // hexKey → section id, live sections only
  sections: SectionRecord[];           // oldest → newest, includes removed sections
};

export type MapState = {
  tiles: Map<string, Tile>;            // key = hexKey(coord)
  index: MapIndex;
  player: HexCoord;
  previous: HexCoord;
};

export type Phase =
  | { kind: "playing" }
  | { kind: "pending-move"; card: Card; modeIndex: number; reachable: HexCoord[] }
  | { kind: "pending-attack"; cardId: string; range: number }
  | { kind: "pending-discard"; count: number }
  | { kind: "pending-remove" }
  | { kind: "pending-gain"; spec: CardSpec }
  | { kind: "shop"; stock: readonly Card[]; rerollCost: number }
  | { kind: "smith"; cardId: string }
  | { kind: "game-over"; reason: GameOverReason };

export type GameOverReason =
  | { kind: 'assassin' }
  | { kind: 'sniper' }
  | { kind: 'caught' };

export type GameState = {
  turn: number;
  currency: number;
  deck: Deck;
  map: MapState;
  playerSectionOrder: number;
  enemies: Enemy[];
  phase: Phase;
  rng: Rng;
  ids: IdFactory;
};
```

Two things to notice, both from the code guidelines:

- `Phase` is a union, so "the UI is in a shop" is one value, not three booleans.
- There is no `phase?: ...`. Every field always has a value.

Some names above (`CardSpec`, `IdFactory`, `SectionRecord`, `MapIndex`, `Enemy`) are
defined in later chapters. Create those modules with just the exported types as you
go, or fill them in as each chapter arrives. The `Phase` union shown is the final
shape: chapters 04, 07 and 08 add the `pending-*` variants as they are introduced.
Because `Phase` is a tagged union, every `switch (phase.kind)` becomes a compile
error until the new variant is handled — you cannot forget a case.

## 5. A seeded RNG

Determinism makes map generation and shops reproducible and testable. Create
`src/game/rng.ts`:

```ts
export type Rng = {
  seed: number;
};

export function nextRng(rng: Rng): { value: number; rng: Rng } {
  // mulberry32
  const seed = (rng.seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, rng: { seed } };
}

export function pick<T>(rng: Rng, items: readonly T[]): { item: T; rng: Rng } {
  if (items.length === 0) {
    throw new Error("pick from empty list");
  }
  const roll = nextRng(rng);
  const index = Math.floor(roll.value * items.length);
  return { item: items[index], rng: roll.rng };
}
```

The `{ value, rng }` return shape (instead of a mutable object) keeps functions pure
and makes threaded seeding obvious. If you prefer mutation, that is fine too, but be
consistent.

> Optional dependency note: if you would rather not hand-roll this, a small library
> like `seedrandom` is fine. It is not required; the 20-line version above has no
> dependency and is easy to test.

## 6. The App shell

Create `src/ui/app.ts` with a mount method that builds the top-level layout. The map
fills the screen; the HUD overlays it (per the design doc: "The full screen is the
map with the UI hovering above it").

```ts
import { setChildren } from "./dom";

export class App {
  constructor(private readonly root: HTMLElement) {}

  mount(): void {
    const shell = document.createElement("div");
    shell.classList.add("app");

    const mapLayer = document.createElement("div");
    mapLayer.classList.add("map-layer");

    const hudLayer = document.createElement("div");
    hudLayer.classList.add("hud-layer");

    setChildren(shell, [mapLayer, hudLayer]);
    setChildren(this.root, [shell]);
  }
}
```

Matching CSS goes in `src/style.css` (currently empty). Use grid at the top level:

```css
.app {
  display: grid;
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #000;

  & .map-layer {
    grid-area: 1 / 1;
    position: relative;
  }

  & .hud-layer {
    grid-area: 1 / 1;
    position: relative;
    pointer-events: none; /* re-enable on interactive children */
  }
}
```

Stacking both layers in the same grid cell is the CSS way to overlay them without
absolute positioning calculations.

## 7. Milestone

- `npm run dev` shows a black full-screen app with no console errors.
- `npm run build` passes with zero TypeScript errors (this is your real safety net
  for the no-`as`/no-`any` rules).
- `src/game/` contains only pure modules; `src/ui/` contains all DOM code.

Commit here. Every later chapter assumes this skeleton.
