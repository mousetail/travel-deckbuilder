# 12 — New cards: implementation plan

**Status:** plan only — no gameplay code written yet.
**Scope:** five new shop cards (`Millionaire`, `Foresight`, `Scout`, `Hookshot`,
`Upgrader`), the mechanics they need, the UI to play and read them, and blank SVG
placeholders for every new icon (a human artist fills the art in later).

This chapter is a working plan, not a design reference. It records the decisions
made while scoping the work and maps every one of them onto concrete files. Once
approved, the implementation follows this document.

---

## 0. Decisions confirmed before planning

1. **`Scout` name clash.** A `Scout` already exists (uncommon, "draw 2", sleeps
   2). It is **renamed to `Survey`**; the new terrain card takes the `Scout`
   name.
2. **Millionaire's "cost"** is a **play cost in coins**, modelled as a new
   `onPlay` effect (an *AND* requirement alongside the card's modes), not the
   shop price.
3. **Scout's "difficulty 1"** means **every tile's movement cost counts as 1** for
   the rest of the turn — the number of points a card needs to enter the tile.
   The terrain-*type* passability rule is unchanged (a grass card still cannot
   enter water). *Assumption to re-confirm — see §8.*
4. **Hookshot** teleports onto the enemy's hex itself, and is modelled as a move
   ability: enemy hexes within range join the card's set of reachable tiles and
   light up with the existing green outline.
5. **Upgrader's temporary upgrades** are lost the moment the card **leaves the
   hand** (played, discarded, or put to sleep), but survive across turns while
   the card stays in hand.

---

## 1. Card-by-card spec

Shop cost is the price printed in the shop (`Card.cost`); play cost is the coin
cost of actually playing the card (new concept). All five are shop cards, so they
enter the deck through the discard pile as usual.

| Card | Rarity | Shop cost | Upgraded | New mechanics used |
| ---- | ------ | --------- | -------- | ------------------ |
| Millionaire | rare | 4 | draws 4 | play cost (`pay`), cost scaling |
| Foresight | uncommon | 3 | no sleep | draw-pile search phase |
| Scout | uncommon | 3 | 2 turns + sleep 1 | temporary terrain-cost override |
| Hookshot | rare | 5 | sleep 1 | teleport to enemies move mode, sleep 2 |
| Upgrader | uncommon | 3 | — | temporary upgrades |

### 1.1 Millionaire — rare

> Pay 1 coin to draw 3 cards, then double this card's cost. On discard: halve
> this card's cost (minimum of 1). Upgraded draws 4.

- Modes: `[{ kind: "draw", count: 3 }]` (`4` upgraded).
- `onPlay: [{ kind: "pay", amount: 1 }, { kind: "double-cost" }]`.
- `onDiscard: [{ kind: "halve-cost" }]`.
- Play cost starts at 1. Each play pays the current cost and doubles it:
  `1 → 2 → 4 → 8 …`. Discarding by hand halves it, floored at 1
  (`4 → 2 → 1`).
- The card is **disabled while unaffordable** (`currency < play cost`).
- The play line on the card face shows the current pay amount; `double-cost` /
  `halve-cost` render as small text ("then ×2" / "discard: ½").
- `double-cost` fires on play; `halve-cost` fires only on a *hand* discard (the
  normal played-to-discard move does not trigger `onDiscard`, matching existing
  rules).

### 1.2 Foresight — uncommon

> Pick any card from your draw pile and add it to your hand. Then go to sleep
> for 1 reroll. Upgraded version doesn't sleep.

- Modes: `[{ kind: "search", count: 1 }]`.
- `onPlay: [sleep(1)]`; upgraded `onPlay: []`.
- Playing it opens a new **`pending-search`** phase showing the draw pile face
  up. The player clicks one card; it moves to the hand and the phase ends.
- Unplayable when the draw pile is empty.
- The searched card counts as drawn (`countDrawn`) for the run stats.
- Not cancellable (the card is already spent); if the draw pile empties the
  phase closes on its own, so it can never soft-lock.

### 1.3 Scout — uncommon

> This turn, all terrain counts as difficulty 1 (add 50% opacity to the terrain
> icons when this is played). The upgraded version has this effect for two turns
> but also goes to sleep for one reroll afterwards.

- Modes: `[{ kind: "trivial-terrain", turns: 1 }]`;
  upgraded `turns: 2`.
- `onPlay: []`; upgraded `onPlay: [sleep(1)]`.
- Adds `terrainTrivialTurns` to the game state, set to
  `max(current, turns)` on play and decremented at the start of every turn.
- While `> 0`, every tile's movement cost is treated as **1** for player
  movement (reach outlines, path previews, and the actual move). Terrain-type
  passability is untouched.
- Visual: the terrain cost icons on every hex are drawn at 50% opacity while
  the effect is live.
- Can not stack. `terrainTrivialTurns` is set to the maximum of the old and new value when this card is played while the effect of another card is still active.

### 1.4 Hookshot — rare

> Teleport to any enemy location within 8 tiles regardless of obstacles or
> terrain, then go to sleep for 2 turns. Upgraded version goes to sleep for just
> 1 turn after use.

- Modes: `[{ kind: "teleport", range: 8 }]` (range stays 8 when upgraded).
- `onPlay: [sleep(2)]`; upgraded `onPlay: [sleep(1)]`.
- Reachable set = positions of every enemy within 8 hexes, ignoring terrain and
  obstacles. They join the card's move reach, so they show in the green
  outline and the hover path.
- Resolves as an instant jump to the enemy hex (no walk animation); section
  streaming (`onPlayerMoved`) still runs.
- Risk note baked into balance, not code: ending a turn on an unkilled assassin or watchtower is lethal. Player can either move out of the assasins range or kill them.

### 1.5 Upgrader — uncommon

> Upgrade all upgradable cards in your hand until played. (display a sigil on
> the cards to indicate the upgrade is only temporary)

- Modes: `[{ kind: "upgrade-hand" }]`, no `onPlay`/`onDiscard`, no upgraded
  form.
- On play, every *other* upgradable card in hand (has `upgradedForm`, not
  already temporary) is temporarily upgraded.
- A temporary upgrade is **dropped when the card leaves the hand** — played,
  discarded, or slept — by reverting to the card's permanent `baseSpec`.
- It survives across turns while the card stays in hand.
- Temporarily upgraded cards show a **sigil** badge, like the sleep badge.
- Unplayable when no other upgradable card is in hand.

---

## 2. Data-model changes (`src/game/`)

### `cards.ts`

```ts
export type MoveMode =
  | { kind: "move"; terrain: Terrain; distance: number }
  | { kind: "teleport"; range: number };            // new

export type CardMode =
  | MoveMode | AttackMode
  | /* existing instant modes */
  | { kind: "search"; count: number }               // new
  | { kind: "trivial-terrain"; turns: number }      // new
  | { kind: "upgrade-hand" };                       // new

export type CardEffect =
  | { kind: "currency"; amount: number }
  | { kind: "sleep"; reshuffles: number }
  | { kind: "pay"; amount: number }                 // new
  | { kind: "double-cost" }                         // new
  | { kind: "halve-cost" };                         // new

export type Card = {
  /* existing fields */
  /** The permanent form, used to undo a temporary upgrade. */
  baseSpec: CardSpec;
  /** True while an Upgrader upgrade is applied. */
  temporaryUpgrade: boolean;
};
```

New helpers in `cards.ts`:

- `playCost(card): number` — sum of `pay` amounts in `onPlay`.
- `moveModeValue(mode): number` — `distance` for `move`, `range` for `teleport`.
- `temporaryUpgradeCard(card): Card` — swap in `upgradedForm`, set
  `temporaryUpgrade: true`, keep `baseSpec`.
- `revertTemporary(card): Card` — rebuild from `baseSpec`, preserve `sleeping`.
- `applyPlayCostScaling(card): Card` — double the `pay` amount (for `double-cost`).
- `applyDiscardCostScaling(card): Card` — halve the `pay` amount, min 1 (for
  `halve-cost`).

`instantiate` sets `baseSpec: spec, temporaryUpgrade: false`.

### `state.ts`

```ts
export type Phase =
  | /* existing */
  | { kind: "pending-search"; count: number };      // new

export type GameState = {
  /* existing */
  /** Turns left (including this one) that every tile costs 1. */
  terrainTrivialTurns: number;                       // new
};
```

### `deck.ts`

- `toDiscard` maps each card through `revertTemporary` — this covers every
  hand→discard path (`discardFromHand`, `sleepFromHand`, `discardPlayed`,
  `discard-hand`) in one place, and is a no-op for ordinary cards.
- `discardPlayed` applies `applyPlayCostScaling` to the discarded copy so a
  played Millionaire carries its doubled cost.

### `turn.ts`

- `payForPlay(state, card)` — `spendCurrency` if `playCost > 0`; used by `spent`,
  `resolveAttack`, and `resolveMoveTo` so the pay requirement holds on every play
  path.
- `cardIsPlayable` — also requires `currency >= playCost(card)`.
- `modeIsAvailable` — new cases:
  - `search`: draw pile non-empty.
  - `trivial-terrain`: always playable.
  - `upgrade-hand`: another upgradable card is in hand.
  - `teleport`: at least one enemy within range.
- `playInstant` — new cases:
  - `search`: discard the card, open `pending-search`.
  - `trivial-terrain`: set `terrainTrivialTurns = max(current, turns)`, discard.
  - `upgrade-hand`: temporarily upgrade the rest of the hand, discard.
- `searchForChoice(state, card)` — move a chosen card from draw to hand, tick
  stats, end the phase when the count runs out or the draw pile empties.
- `applyOnDiscard` — new `halve-cost` case updates the discarded copy's pay.
- `resolveMoveTo` — branch on `teleport`: jump straight to the destination
  (`still`, no path animation) but still run `onPlayerMoved`.
- `modeIsAvailable`/`resolveMoveTo`/`cardReach` use the new
  `movementTileAt(state)` cost lookup.
- `startTurn` — decrement `terrainTrivialTurns` (floored at 0).
- `cancelPending` — `pending-search` is not cancellable (`still`).

### `movement.ts` / `reach.ts`

- `movementTileAt(state)` in `reach.ts` — wraps `tileAt` and returns `cost: 1`
  clones while `terrainTrivialTurns > 0`; used by every player-movement cost
  lookup.
- `cardReach` — `teleport` case pushes enemy hexes within range as a `MoveReach`.
- `bestMove` — uses `moveModeValue`; skips cards that can't be afforded.
- `bestAttackCard` — skips unaffordable cards.
- `playerPathTo` — a teleport returns the direct `[from, to]` line (so hovering
  an enemy still previews the jump), ahead of the "enemies are not moves" guard.

### `economy.ts`

- No new logic. `upgradeCard`/smith already work on the permanent form; a
  temporarily-upgraded card's `upgradedForm` is `null`, so the smith simply won't
  offer it (noted as a known edge, §8).

---

## 3. UI changes (`src/ui/`)

- **`card-text.ts`** — symbols/descriptions for `teleport`, `search`,
  `trivial-terrain`, `upgrade-hand`, `pay`, `double-cost`, `halve-cost`.
- **`card-view.ts`** — render the temporary-upgrade **sigil** badge when
  `card.temporaryUpgrade` is set (mirrors `sleepBadge`).
- **`hand-view.ts`** — add a `HandMode` "none": the hand is inert during
  `pending-search` (no play/discard/sleep clicks).
- **`app.ts`**
  - `handMode`: `pending-search → none`.
  - `renderMiddle`: `pending-search` shows a selectable draw-pile overlay.
  - `handleSearchChoice(card)` → `searchForChoice`.
  - Pass `trivialTerrain: state.terrainTrivialTurns > 0` into `mapView.render`.
  - `isModalPhase`: `pending-search → false` (hand stays visible, just inert).
- **`pile-view.ts`** — a `searchOverlay` (selectable cards) alongside the
  read-only `pileOverlay`.
- **`feature-view.ts`** — add `pending-search` to the no-op `panel` cases.
- **`hud.ts`** — `hintFor` text for `pending-search`; no action-button change.
- **`tile-icons.ts`** — mark terrain cost icons (a `terrain` icon kind) so the
  map can dim just those.
- **`terrain.ts`** — `tileIcons` emits `{ kind: "terrain", url }` for cost
  icons; `TileIcon` gains that variant.
- **`map-view.ts`** — `MapViewState` gains `trivialTerrain`; when set, the hex
  gets a class that dims its terrain icons to 50%.
- **`main.ts`** — initialise `terrainTrivialTurns: 0`.

---

## 4. New icons — blank SVG placeholders

Per instruction, every new icon is created as a **blank SVG** for an artist to
fill in. Proposed location `src/images/card-icons/`:

| File | Used for |
| ---- | -------- |
| `coin.svg` | `pay` play cost |
| `search.svg` | Foresight `search` mode |
| `scout.svg` | Scout `trivial-terrain` mode |
| `upgrade.svg` | Upgrader `upgrade-hand` mode |
| `temporary.svg` | temporary-upgrade sigil on cards |
| `teleport.svg` | Hookshot `teleport` mode |

Each is a valid 16×16 SVG with no visible geometry (blank), carrying a comment
naming the intended glyph. Card art stays the existing empty-string placeholder.

---

## 5. Catalogue changes (`cards.ts`)

- Rename `Scout` → `Survey` (stats unchanged).
- Add the five specs from §1, appended in the hand-management section.
- Values table (shop cost / rarities) is in §1.

---

## 6. Cross-cutting switch sites to update

Adding variants to the unions makes the compiler flag every exhaustive switch;
these are the known ones:

- `turn.ts`: `applyHandMode` (throw list), `playInstant`, `modeIsAvailable`,
  `applyOnDiscard`, `cancelPending`, `resolveMoveTo`.
- `reach.ts`: `cardReach`, `bestMove`, `playerPathTo`.
- `card-text.ts`: `modeSymbolNodes`, `effectNodes`, `describeEffect`.
- `economy.ts`: `leaveFeature`.
- `app.ts`: `handMode`, `isModalPhase`.
- `feature-view.ts`: `panel`.
- `hud.ts`: `hintFor`.

---

## 7. Validation

- `PATH=.../node npm run build` (runs `tsc` then `vite build`) with no errors.
- Manual playtest per card:
  - Millionaire: cost escalation `1→2→4`, halving `4→2→1`, greyed when broke.
  - Foresight: draw-pile overlay appears, pick moves a card to hand, sleep ticks.
  - Scout: terrain icons dim; a cost-3 tile becomes crossable by a 1-point card;
    upgraded lasts a second turn then sleeps.
  - Hookshot: enemy hexes outlined green; click teleports; sleeps 2 (1 upgraded).
  - Upgrader: hand cards show the sigil; upgrade survives a turn; vanishes on
    play/discard; played effect uses the upgraded mode.

---

## 8. Assumptions and open questions to re-confirm

1. **Scout's terrain-*type* rule.** This plan reduces only the *cost* to 1 and
   leaves passability unchanged, per your clarification ("the points of each
   tile"). If instead Scout should let *any* movement card cross *any*
   non-impassible tile, `movementTileAt` must also override the terrain check.
2. **Hookshot targets watchtowers too.** Enemy hexes include stationary watchtowers;
   jumping onto a watchtower is lethal at end of turn unless it is killed that turn.
   Say the word if watchtowers should be excluded.
3. **Upgrader excludes itself.** It upgrades every *other* upgradable card in
   hand. Upgrading itself would be pointless (it leaves the hand immediately).
4. **Upgrader has no upgraded form.** None was specified; the smith will not
   offer it.
5. **Millionaire's upgraded form resets the cost to 1** (a fresh spec), which is
   the natural reading of "the upgraded version draws 4".
