# Implementing the Travel Card Game

This folder is a step-by-step implementation guide for the game described in
[`../design.md`](../design.md). Each document builds on the previous one and ends
with a concrete, testable milestone, so you can always run the game and see the
feature you just added.

The guide assumes you keep the rules of the game in plain TypeScript modules with
no DOM access, and keep all rendering in a thin UI layer. That separation is a
requirement from the design doc ("Keep the game logic separate from the UI") and it
is what makes the later steps (pathfinding, enemy AI, map generation) tractable.

## Prerequisites

- Node.js 20+ and npm.
- Comfort reading TypeScript tagged unions and `Map`/`Set`.
- The project already has Vite + TypeScript wired up. Run it with:

  ```sh
  npm install
  npm run dev      # http://localhost:5173
  npm run build    # tsc --noEmit + vite build
  ```

## How to read this series

| # | Document | Milestone you can play |
| - | -------- | ---------------------- |
| 00 | [Project setup & architecture](00-project-setup.md) | A blank app that runs and builds cleanly |
| 01 | [Hex grid fundamentals](01-hex-grid.md) | A visible grid of hexes you can hover |
| 02 | [Terrain & the tile model](02-terrain-and-tiles.md) | Coloured, correctly shaped hexes |
| 03 | [Cards, deck, and rarities](03-cards-and-deck.md) | The starting deck rendered as a fan |
| 04 | [Turns, drawing, and movement](04-turns-and-movement.md) | Play a movement card and walk the map |
| 05 | [Map generation](05-map-generation.md) | An endless, winding, difficulty-graded path |
| 06 | [Fog of war & tile streaming](06-fog-of-war.md) | Only three sections visible, memory of the path |
| 07 | [Enemies & combat](07-enemies-and-combat.md) | Assassins chase, snipers snipe, you can kill them |
| 08 | [Economy & upgrades](08-economy-and-upgrades.md) | Shops, smiths, removal, and coins |
| 09 | [UI & graphics](09-ui-and-graphics.md) | The fanned hand, piles, HUD, and pixel-art look |
| 10 | [Testing, balance & next steps](10-testing-and-balance.md) | A tuned difficulty curve and a green test suite |

The numbering above is the intended reading order. `../design.md` is the source of
truth for *what* the game is; these documents explain *how* to build it.

## Proposed source layout

The current `src/` is a stub (`main.ts`, `ui.ts`, `cards.ts`, `types.ts`). As the
game grows, split it into a DOM-free `game/` layer and a `ui/` layer:

```
src/
  main.ts                 # bootstrap only
  style.css
  game/
    hex.ts                # axial coordinates, neighbours, distance, pixel conversion
    terrain.ts            # terrain kinds + passability rules
    cards.ts              # card catalogue + factory helpers
    deck.ts               # draw/hand/discard zones, shuffle, draw, discard
    movement.ts           # reachable-hex search, path validation
    map.ts                # section templates, generation, streaming
    enemies.ts            # assassins, snipers, their AI
    economy.ts            # currency, shop, smith, removal
    state.ts              # GameState and the turn state machine
    rng.ts                # seeded random + weighted picks
  ui/
    app.ts                # root view, wires input to game actions
    map-view.ts           # hex layer
    hand-view.ts          # card fan, draw/discard piles
    hud.ts                # currency, end-turn button, upgrade button
    dom.ts                # small helpers (replaceChildren, classList)
  images/                 # existing 32×32 pixel-art textures and icons
```

`game/*` must never import from `ui/*`, and must never touch `document`. That is
the single rule that keeps this codebase pleasant; every later chapter depends on
it.

## Conventions used throughout

The design doc's "Code Guidelines" are applied literally in every snippet:

- **No `as`, `any`, or `unknown`.** When you read a DOM element, narrow it with a
  real runtime check (see `requireElement` in 00), never a cast.
- **No optional properties.** Model variants as tagged unions with a `kind` field,
  and include an explicit empty case (e.g. `{ kind: 'none' }`) instead of `null`
  or `?`. Narrow with `switch` on `kind` and rely on `noFallthroughCasesInSwitch`.
- **No default arguments.** Every call site passes every argument.
- **`replaceChildren` to clear, `classList` to change class.** Never assign
  `element.className = ...`, never set `innerHTML`.
- **Small types/classes.** Prefer a free function over a class method when state is
  not involved. Split a class before it grows seven responsibilities.
- **CSS nesting and grid.** Group selectors with `& .child { }`. Prefer `grid` to
  flexbox, simple hover backgrounds, few colours.

`tsconfig.json` already enables `noUnusedLocals`, `noUnusedParameters`,
`noFallthroughCasesInSwitch`, and `erasableSyntaxOnly`. Keep them on; they catch
exactly the mistakes those rules are designed to avoid.

## Glossary

| Term | Meaning |
| ---- | ------- |
| **Hex** | One tile of the grid, addressed by axial coordinates `(q, r)`. |
| **Section** | A pre-generated block of hexes, side length 4, that the map is tiled from. Some are 2× size. |
| **Leading edge** | The far edge of the newest section — the direction you are escaping toward. |
| **Trailing edge** | The edge behind you; sections and enemies here are dropped. |
| **Assassin** | A roaming enemy spawned from a tile timer; kills you if it ends its move on your hex. |
| **Sniper** | A fixed enemy that kills you if you end your turn inside its radius. |
| **Draw/Hand/Discard** | The three card zones. Bought cards go to discard; discard reshuffles only when draw runs out. |

## Decisions to confirm before you start

The design doc is intentionally loose in a few places. These documents pick a
default and flag it, but confirm them so the guide and your intent line up:

1. **Terrain naming.** `design.md` names *Grass, Forest, Water, Mountains, Dirt,
   Impassible*. The existing `src/types.ts` uses `'jungle' | 'water' | 'mountain'
   | 'village' | 'impassible'` and ships textures `jungle.png`, `village.png`,
   `water.png`, `mountain.png`, `impassible.png`. Chapter 02 proposes the canonical
   six-kind model and maps the existing art onto it
   (`jungle` → Forest/Grass, `village` → Dirt). Confirm the mapping you want.
2. **Movement is "up to N steps".** A movement card lets you walk *up to* its
   distance along passable hexes, not exactly N. Confirm.
3. **Rendering: DOM hexes vs. canvas.** Chapter 01 recommends DOM hexes
   (`clip-path` polygons) because it matches the existing DOM-oriented code and the
   pixel-art CSS workflow, and because only three sections are ever on screen.
   Canvas is a fine alternative if profiling ever demands it.
4. **Grid orientation.** Pointy-top hexes with axial coordinates are assumed
   throughout. Flat-top is a mechanical change confined to `hex.ts` and the CSS
   `clip-path`.

Answer these four and the rest of the guide applies as written.
