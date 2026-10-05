# 14 — More cards: implementation plan

**Status:** plan only — no gameplay code written yet.
**Scope:** six new cards (`Storage Bin (Empty)`, `Storage Bin (Full)`,
`Monotony`, `Hop`, `Wall`, `Invention`), the mechanics they need, the UI to play
and read them, and blank SVG placeholders for every new icon (a human artist
fills the art in later).

This chapter is a working plan, not a design reference. It records the decisions
made while scoping the work and maps every one of them onto concrete files. Once
approved, the implementation follows this document.

---

## 0. Decisions confirmed before planning

1. **Storage Bin is two specs, one physical card.** `Storage Bin (Empty)` is the
   rare shop card; `Storage Bin (Full)` is its transformed form and is never
   offered in a shop or a gift (rarity `none`, weight 0). The card keeps its
   `id` across the transformation, so the UI and stats track one card.
2. **Stored cards live on the card.** A new `Card.stored` field holds the cards
   inside the bin. They are not in any deck zone while stored, so `allCards` and
   `deckSize` do not see them.
3. **A full bin discarded by hand does nothing and stays full** (your
   clarification). Only *playing* a full bin empties it.
4. **Monotony reads the terrain under the player** at the moment it is played
   (and while its reach is previewed). Dirt/finish count as their own terrain.
5. **Hop jumps over exactly one tile.** The hopped tile may be anything except
   impassible; the landing tile must be grass of cost 1. Walls block the hop.
6. **Wall is one side of a radius-3 hexagon centred on the player**, directed
   inward so the player can leave but enemies cannot enter. The player picks one
   of the six sides. See §8.1 for the "3-wide" wording.
7. **Invention's temporary cards are conjured into the hand** and removed from
   the deck the moment they leave the hand (played, discarded, or slept). They
   are drawn from the shop pool, weighted by rarity, excluding the storage bins
   and Invention itself.

---

## 1. Card-by-card spec

Shop cost is the price printed in the shop (`Card.cost`); play cost is the coin
cost of actually playing the card (`pay` effects). All six are shop cards, so
they enter the deck through the discard pile as usual.

| Card | Rarity | Shop cost | Upgraded | New mechanics used |
| ---- | ------ | --------- | -------- | ------------------ |
| Storage Bin (Empty) | rare | 4 | release gives temporary copies | store phase, card transformation, `stored` |
| Storage Bin (Full) | none | — | — | unstore, transformation |
| Monotony | uncommon | 3 | distance 4 | move over the current terrain |
| Hop | uncommon | 3 | cost ≤ 2 | hop-over move mode |
| Wall | rare | 5 | play cost 1 | play cost 3, wall-choice phase, one-sided wall |
| Invention | rare | 4 | 2 cards, uncommon+ | temporary cards |

### 1.1 Storage Bin (Empty) — rare

> Pick any number of cards from your hand. Transform this card into Storage Bin
> (Full) and store those cards inside it.

- Modes: `[{ kind: "store" }]`.
- Playing it opens a new **`pending-store`** phase. The hand stays visible and
  inert except that clicking a card toggles it into the selection; the bin
  itself is not selectable. A confirm button resolves the choice.
- On confirm, the selected cards leave the hand and are held inside the bin; the
  bin becomes `Storage Bin (Full)` (same `id`) and is discarded.
- Zero cards is a legal choice, producing an empty full bin.
- Not cancellable (the card is already spent); confirming with nothing selected
  is always available, so it can never soft-lock.
- Upgraded form `Storage Bin (Empty)+` (same rarity/cost). The upgrade changes
  what the *full* form does when played, not the storing itself.

### 1.2 Storage Bin (Full) — none

> Play and add all cards stored in the storage bin to your hand.

- Modes: `[{ kind: "unstore"; copies: false }]`; the upgraded full form uses
  `copies: true`.
- Playing it moves every stored card into the hand, then the bin becomes
  `Storage Bin (Empty)` (same `id`) and is discarded.
- **Basic:** each released card is released *temporarily upgraded* (the Upgrader
  effect, dropped when it leaves the hand).
- **Upgraded:** each released card is returned normally, plus a **temporary copy**
  of each (removed from the deck when it leaves the hand, like Invention's
  cards).
- **Discarding it by hand does nothing**: the bin moves to the discard pile
  unchanged, still full. (The normal played-to-discard move is the only path
  that empties it.)
- **Easter egg:** the full bin is itself upgradable at a smith (`Full → Full+`),
  and upgrading it also upgrades every card stored inside it. `upgradeCard`
  recurses into `stored` for this.
- Never appears in a shop or gift; rarity `none` (weight 0).

### 1.3 Monotony — uncommon

> Move 3 over the terrain type you are currently standing on.

- Modes: `[{ kind: "move-current-terrain"; distance: 3 }]`; upgraded
  `distance: 4`.
- The terrain is resolved from the tile under the player whenever reach is
  computed, so the reach outline and hover path always match the tile the
  player is on. Terrain-type passability is the normal rule (`canEnter`).
- Standing on dirt or the finish makes the card move over dirt/finish only,
  which is almost always useless — an accepted edge case.

### 1.4 Hop — uncommon

> Hop over one tile (anything except impassable) and land on a 1 grass.

- Modes: `[{ kind: "hop"; maxCost: 1 }]`; upgraded `maxCost: 2`.
- For each of the six directions: the middle tile (one step away) must be on
  the map and not impassible; the landing tile (two steps away) must be on the
  map, grass, cost ≤ `maxCost`, not occupied by an enemy, and neither edge may
  be walled.
- The hop is a jump: it resolves as a direct `[from, to]` move (no walk
  animation), like a teleport, and counts as 2 distance.

### 1.5 Wall — rare

> Spend 3 money to create a 3-wide 1-way wall on a 3 tile radius from the
> player. Oriented so the player can leave. The player chooses which of the 6
> directions to place the wall in. Then goes to sleep for a reroll.

- Modes: `[{ kind: "wall"; radius: 3 }]`; the upgraded form keeps `radius: 3`
  and drops the play cost to 1 (`onPlay: [pay(1), sleep(1)]`).
- `onPlay: [pay(3), sleep(1)]`.
- Playing it discards the card (asleep for 1 reshuffle) and opens a new
  **`pending-wall`** phase. The map shows all six candidate walls as faint
  dashed previews; clicking a hex picks the side whose direction is nearest the
  click. The phase is not cancellable.
- The wall is the directed edges of one side of the radius-`radius` hexagon
  centred on the player, each directed **inward** (outside → inside blocked), so
  the player can cross outward but enemies cannot cross inward.
- Walls are pruned when the tiles they sit on leave the map, exactly like the
  Barricade consumable.

### 1.6 Invention — rare

> Gain three random temporary cards (according to rarity). They are removed
> from your deck when played or discarded. The upgraded version draws two, but
> only uncommon or rarer cards.

- Modes: `[{ kind: "invention"; count: 3; pool: "all" }]`; upgraded
  `count: 2; pool: "uncommon-plus"`.
- On play, `count` distinct cards are rolled from the shop pool, weighted by
  rarity, excluding the storage bins and Invention itself, and added to the
  hand marked `temporary`. `pool: "uncommon-plus"` restricts the roll to
  uncommon and rare cards.
- A temporary card is removed from the deck (not put in the discard pile) the
  moment it leaves the hand: played, discarded by hand, or put to sleep.
- Temporary cards show a sigil badge, like the temporary-upgrade sigil.
- They are not recorded in the run stats (they are conjured, not acquired).

---

## 2. Data-model changes (`src/game/`)

### `cards.ts`

```ts
export type MoveMode =
  | { kind: "move"; terrain: Terrain; distance: number }
  | { kind: "move-current-terrain"; distance: number }   // new
  | { kind: "hop"; maxCost: number }                     // new
  | { kind: "teleport"; range: number };

export type CardMode =
  | MoveMode | AttackMode
  | /* existing instant modes */
  | { kind: "store" }                                    // new
  | { kind: "unstore"; copies: boolean }                 // new
  | { kind: "wall"; radius: number }                     // new
  | { kind: "invention"; count: number; pool: InventionPool };  // new

export type InventionPool = "all" | "uncommon-plus";

export type StorageForm =
  | "none" | "empty" | "empty-upgraded" | "full" | "full-upgraded";

export type Rarity = "starting" | "common" | "uncommon" | "rare" | "none";

export type Card = {
  /* existing fields */
  /** Cards held inside a storage bin; empty for every other card. */
  stored: readonly Card[];
  /** True for a card conjured by Invention: it is removed when it leaves the hand. */
  temporary: boolean;
  /** Which storage-bin form this is, or `none` for every other card. */
  storage: StorageForm;
};
```

New helpers in `cards.ts`:

- `instantiate` sets `stored: []`, `temporary: false`, `storage: spec.storage`.
- `instantiateTemporary(spec, id): Card` — `instantiate` with `temporary: true`.
- `temporaryCopy(card, id): Card` — a temporary duplicate under a fresh id.
- `transformStorage(card, stored): Card` — swap in the other storage spec
  (matching the card's `storage` form, so an upgraded bin stays upgraded),
  keeping the `id`, and set `stored`.
- `moveModeValue` gains the two new move kinds (`distance` for
  `move-current-terrain`, `2` for `hop`).

`RARITY_WEIGHT` gains `none: 0`. `rollGift` already filters to
`uncommon`/`rare`, so `none` is never gifted.

### `state.ts`

```ts
export type Phase =
  | /* existing */
  | { kind: "pending-store"; card: Card; selected: readonly string[] }  // new
  | { kind: "pending-wall"; radius: number };                           // new
```

No new `GameState` fields: `stored`/`temporary` live on the cards.

### `walls.ts`

- Move the editor's `sideEdges` into `hexagon.ts` as `hexSideEdges(side, radius)`
  (returns `{ hex, dir }`), and have the editor import it.
- New `hexagonSideWallEdges(centre, side, radius): WallEdge[]` — the inward
  directed edges of one side.
- `sectionWallEdges` is rewritten to loop `side = 0..5` and call
  `hexagonSideWallEdges(section.origin, side, section.radius)`, replacing the
  brute-force footprint scan. Verified to produce exactly the same edge set.
- New `sideToward(centre, coord): number` — the side whose facing direction is
  nearest the direction from `centre` to `coord`, for the wall-choice click.

### `deck.ts`

- `toDiscard` drops `temporary` cards instead of adding them, so every
  hand→discard path (discard, sleep, played) removes them in one place.

### `turn.ts`

- `applyHandMode` throw list gains the new non-hand modes.
- `modeIsAvailable`:
  - `store`: always.
  - `unstore`: always.
  - `wall`: always.
  - `invention`: always.
  - `move-current-terrain`: reach non-empty, using the current terrain.
  - `hop`: at least one hop target.
- `playInstant`:
  - `store`: `spent`, open `pending-store` (the card is not discarded yet).
  - `unstore`: move `stored` to hand, discard the emptied bin.
  - `wall`: `spent` + `discardPlayed` (applies the sleep), open `pending-wall`.
  - `invention`: roll temporary cards into the hand, discard the played card.
- New actions:
  - `toggleStoreChoice(state, card)` — toggle a hand card in `selected`.
  - `confirmStore(state)` — move the selection into the bin, transform to full,
    discard it, end the phase.
  - `chooseWall(state, side)` — append the side's wall edges, end the phase.
- `cancelPending` — `pending-store`/`pending-wall` are not cancellable.
- `resolveMoveTo` — branch on the new move kinds: `hop` jumps directly
  (`[from, to]`, distance 2); `move-current-terrain` resolves its terrain from
  the player's tile.

### `reach.ts` / `movement.ts`

- `cardReach` gains `move-current-terrain` (terrain from the player's tile) and
  `hop` (hop targets) cases.
- `playerPathTo` returns the direct `[from, to]` line for `hop`, and uses the
  current terrain for `move-current-terrain`.
- `moveTerrain(state, mode)` helper shared by `cardReach` and `resolveMoveTo`.
- `hopTargets(state, maxCost)` helper (in `reach.ts`).

### `shop.ts`

- `rollTemporaryCards(count, rng, ids): { cards: Card[]; rng: Rng }` — draw
  `count` distinct specs from `SHOP_CATALOGUE`, weighted by rarity, excluding
  storage and Invention specs, instantiated with `instantiateTemporary`.

---

## 3. UI changes (`src/ui/`)

- **`card-icons.ts`** — new icons: `storage`, `monotony`, `hop`, `wall`,
  `invention`, `ephemeral`.
- **`card-text.ts`** — symbols and descriptions for `store`, `unstore`,
  `move-current-terrain`, `hop`, `wall`, `invention`.
- **`card-view.ts`** — an `ephemeral` badge when `card.temporary` is set.
- **`hand-view.ts`** — a `HandMode` variant
  `{ kind: "store"; selected: ReadonlySet<string>; binId: string }`: clicking a
  non-bin card toggles it; selected cards get a `selected` class.
- **`pile-view.ts`** — a `storeOverlay(selectedCount, onConfirm)` with the
  confirm button.
- **`map-view.ts`** — `MapViewState.wallChoices: readonly (readonly WallEdge[])[]`;
  render them as faint dashed previews (`wallsSvg` gains a class-name argument).
- **`app.ts`**
  - `handMode`: `pending-store → store`, `pending-wall → none`.
  - `renderMiddle`: `pending-store` shows the store overlay.
  - `render`: pass `wallChoices` (the six candidates while `pending-wall`).
  - `handleHexClick`: `pending-wall` chooses the nearest side.
  - `handleStoreToggle` / `handleStoreConfirm`.
  - `isModalPhase`: both new phases are false.
- **`feature-view.ts`** — add both phases to the no-op `panel` cases.
- **`hud.ts`** — `hintFor` text for both phases.
- **`economy.ts`** — `leaveFeature` treats both phases as non-modal.

---

## 4. New icons — blank SVG placeholders

Per instruction, every new icon is created as a **blank SVG** for an artist to
fill in. Location `src/images/card-icons/`:

| File | Used for |
| ---- | -------- |
| `storage.svg` | Storage Bin `store`/`unstore` mode |
| `monotony.svg` | Monotony `move-current-terrain` mode |
| `hop.svg` | Hop mode |
| `wall.svg` | Wall mode |
| `invention.svg` | Invention mode |
| `ephemeral.svg` | temporary-card sigil |

Each is a valid 16×16 SVG with no visible geometry (blank), carrying a comment
naming the intended glyph. Card art stays the existing empty-string placeholder.

---

## 5. Catalogue changes (`cards.ts`)

- Add the six specs from §1, appended in the hand-management / movement
  sections. `Storage Bin (Full)` is a module constant, not in `SHOP_CATALOGUE`.
- Values table (shop cost / rarities) is in §1.

---

## 6. Cross-cutting switch sites to update

Adding variants to the unions makes the compiler flag every exhaustive switch;
these are the known ones:

- `turn.ts`: `applyHandMode`, `playInstant`, `modeIsAvailable`, `cancelPending`,
  `resolveMoveTo`.
- `reach.ts`: `cardReach`, `playerPathTo`, `moveModeValue`.
- `card-text.ts`: `modeSymbolNodes`, `describeMode`.
- `economy.ts`: `leaveFeature`.
- `app.ts`: `handMode`, `isModalPhase`.
- `feature-view.ts`: `panels`.
- `hud.ts`: `hintFor`.
- `deck.test.ts`: the local `spec` helper (if `CardSpec` changes).

---

## 7. Validation

- `PATH=.../node npm run build` (runs `tsc` then `vite build`) with no errors.
- `PATH=.../node npm test` with the existing suite green.
- Manual playtest per card:
  - Storage Bin: store 0/1/many cards; the bin becomes full and carries them;
    playing the basic full bin returns them temporarily upgraded; the upgraded
    full bin returns them plus a temporary copy of each; discarding the full bin
    keeps it full.
  - Monotony: reach matches the tile underfoot; moving onto water switches the
    card's terrain.
  - Hop: only cost-1 grass two steps away is offered; impassible middles and
    walled edges are excluded.
  - Wall: six previews appear; clicking a direction places a one-way wall the
    player can cross outward; the card sleeps one reshuffle; the upgraded card
    costs 1 instead of 3.
  - Invention: three temporary cards appear in hand (two, uncommon+ upgraded);
    each vanishes when played or discarded; the sigil shows.

---

## 8. Assumptions and open questions to re-confirm

1. **"3-wide" wall.** A side of a radius-3 hexagon in this codebase's geometry
   is **7 directed edges** (the same partition `sectionWallEdges` uses for a
   whole section). The plan uses that full side. If "3-wide" meant a shorter
   straight run of 3 edges, say so and `hexagonSideWallEdges` changes in one
   place.
2. **Invention's rarity and cost** were not specified; the plan uses rare / 4.
3. **Upgraded forms** were not specified; the plan gives each card a simple
   upgrade (see §1). Storage Bin's upgrade changes the release behaviour rather
   than a number.
4. **Invention's cards go to the hand**, not the discard pile, so they can be
   used immediately. "Gain" elsewhere in the game means the discard pile.
5. **Hop is blocked by walls.** A hop ignores terrain but not a walled edge.
6. **Stored cards are lost if the bin is removed** at a smith or destroyed;
   there is no way to remove a card from inside a bin.
