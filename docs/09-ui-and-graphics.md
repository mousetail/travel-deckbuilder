# 09 — UI & graphics

**Goal:** the fanned hand, the draw/discard piles, the HUD, the upgrade button, and
the black-and-white pixel-art look — all as thin DOM code that only *displays* game
state and forwards intent.

## 1. Style rules from the design

- Retro / pixel art. The shipped `src/images/*.png` are **32×32 RGBA** files.
- Black-and-white UI: **thick borders, no border radius, few colours**. The
  `shop.png`, `smith.png`, `gain-card.png`, and `remove-card.png` icons are already
  white-on-transparent with black outlines, so they drop straight in.
- The **map may have colour**; the terrain swatches (`jungle`, `village`, `water`,
  `mountain`, `impassible`) are coloured and tile as backgrounds.
- Cards look like playing cards: a **symbolic representation in the top-left**,
  a name, and an image (placeholder for now).
- Cards are shown in a **fan**, angled left and right.
- **Draw pile on the left** with a count; **discard pile on the right** with a count;
  clicking either shows its exact contents.
- The **full screen is the map**, with the UI hovering above it.

## 2. Pixel-art foundation

Two CSS lines make every sprite crisp and scalable:

```css
:root {
  --ui-fg: #000;
  --ui-bg: #fff;
  --ui-border: 3px;
}

img.pixel,
.hex {
  image-rendering: pixelated;   /* nearest-neighbour upscale */
}

button {
  font: inherit;
  color: var(--ui-fg);
  background: var(--ui-bg);
  border: var(--ui-border) solid var(--ui-fg);
  border-radius: 0;
  padding: 6px 12px;

  &:hover { background: #ddd; }   /* simple hover background, per the guidelines */
}
```

That is the entire visual vocabulary: black, white, one grey for hover, a thin
border weight, and squared corners. Resist adding more.

## 3. Layout: map below, HUD above

Reuse the two-layer grid from chapter 00. The HUD layer has `pointer-events: none`
so it never blocks map clicks, and each interactive child re-enables its own pointer
events:

```css
.hud-layer {
  display: grid;
  grid-template-rows: auto 1fr auto;   /* top bar, middle, bottom bar */
  padding: 12px;

  & > * { pointer-events: auto; }
}
```

- **Top bar:** currency, turn number, difficulty.
- **Bottom bar:** draw pile (left), the hand fan (centre), discard pile (right), and
  the end-turn / use-upgrade button.

## 4. The hand fan

A card is a small grid: symbol + name + art placeholder.

```ts
import type { Card } from "../game/cards";
import type { CardMode } from "../game/cards";

export class CardView {
  constructor(private readonly card: Card) {}

  element(index: number, count: number): HTMLElement {
    const root = document.createElement("button");
    root.classList.add("card");
    root.dataset["cardId"] = this.card.id;
    root.style.setProperty("--i", `${index}`);
    root.style.setProperty("--n", `${count}`);

    const symbol = document.createElement("div");
    symbol.classList.add("card-symbol");
    symbol.replaceChildren(this.symbolText());

    const name = document.createElement("div");
    name.classList.add("card-name");
    name.textContent = this.card.name;

    const art = document.createElement("div");
    art.classList.add("card-art");
    if (this.card.image !== "") {
      const img = document.createElement("img");
      img.classList.add("pixel");
      img.src = this.card.image;
      img.alt = "";
      art.replaceChildren(img);
    }

    root.replaceChildren(symbol, name, art);
    return root;
  }

  private symbolText(): string {
    const mode = this.card.modes[0];   // the "headline" mode for the corner
    switch (mode.kind) {
      case "move": return `${terrainGlyph(mode.terrain)}${mode.distance}`;
      case "attack": return `${mode.range}⚔`;
      case "draw": return `+${mode.count}`;
      case "draw-discard": return `${mode.draw}/${mode.discard}`;
      case "discard-hand": return `${mode.threshold}→${mode.draw}`;
      case "recover": return `↺${mode.count}`;
      case "currency": return `¤${mode.amount}`;
    }
  }
}
```

`style.setProperty("--i", ...)` sets a *custom property*, not a class, so it does not
violate the "prefer `classList`" guideline (which is about `element.className =`).
It is the clean way to give the CSS an index it can compute a fan angle from:

```css
.hand {
  display: flex;
  justify-content: center;
  align-items: flex-end;
  gap: 0;

  & .card {
    width: 96px;
    height: 140px;
    margin-inline: -22px;          /* overlap into a fan */
    transform-origin: 50% 160%;
    transform: rotate(calc((var(--i) - (var(--n) - 1) / 2) * 7deg));
    display: grid;
    grid-template-rows: auto auto 1fr;
    text-align: left;
    background: var(--ui-bg);
    border: var(--ui-border) solid var(--ui-fg);
    border-radius: 0;

    &:hover { z-index: 1; transform: translateY(-16px) rotate(calc((var(--i) - (var(--n) - 1) / 2) * 7deg)); }

    & .card-symbol { font-size: 20px; }
    & .card-name { font-size: 12px; }
    & .card-art { background: #eee; border-top: 2px solid var(--ui-fg); }
  }
}
```

`--i` and `--n` make the fan symmetric: the middle card is upright and the ends lean
out, exactly the "slightly angled to the left and the right" look. Card DOM nodes are
created once per render with `replaceChildren`, never mutated piecemeal.

> The guideline says "prefer grid over flexbox". The hand fan is the one place where
> flexbox's natural overlap and centring genuinely fit; using `grid` here would need
> explicit column placement for every card. If your team prefers strict grid, use
> `display: grid; grid-auto-flow: column;` with the same negative margins.

## 5. Draw and discard piles

Each pile is a clickable button with a count, rendered near the fan:

```ts
export function pileView(label: string, count: number, which: "draw" | "discard"): HTMLElement {
  const button = document.createElement("button");
  button.classList.add("pile", `pile-${which}`);
  button.textContent = `${label} ${count}`;
  return button;
}
```

Clicking opens an overlay that lists the pile's cards, reusing `CardView` so the
contents look like the hand. The overlay is a sibling in the HUD layer, cleared with
`replaceChildren` each time it opens:

```ts
export function openPileOverlay(
  root: HTMLElement,
  title: string,
  cards: readonly Card[],
): void {
  const overlay = document.createElement("div");
  overlay.classList.add("overlay");

  const heading = document.createElement("h2");
  heading.textContent = title;

  const list = document.createElement("div");
  list.classList.add("overlay-cards");
  list.replaceChildren(...cards.map((card, index) => new CardView(card).element(index, cards.length)));

  const close = document.createElement("button");
  close.textContent = "close";
  close.addEventListener("click", () => root.replaceChildren());

  overlay.replaceChildren(heading, list, close);
  root.replaceChildren(overlay);
}
```

Important: the overlay shows cards but they are **not** in your hand. Give them a
`card--view-only` class (dimmed, `pointer-events: none`) so they cannot be played
from the viewer.

## 6. Overlays for the interactive phases

The same overlay pattern covers every `Phase` that needs a decision:

- `pending-move` → highlight reachable hexes on the map (chapter 04), no overlay.
- `pending-attack` → highlight enemies in range; clicking one kills it.
- `pending-discard` → hand cards gain a `selectable` class; each click toggles it;
  a confirm button applies the discards.
- `shop` / `smith` / `pending-remove` / `pending-gain` → an overlay listing the
  relevant cards with action buttons ("buy", "upgrade", "remove", "take", "reroll").

Keep these strictly as view code: each button calls one `game/*` function and stores
the returned `GameState`. Never re-derive a rule in the view.

## 7. The end-turn / use-upgrade button

One button whose label and action come from `endTurnAction` (chapter 08):

```ts
import { endTurnAction } from "../game/economy";

export function syncEndTurnButton(button: HTMLButtonElement, feature: TileFeature): void {
  const action = endTurnAction(feature);
  button.classList.toggle("use-feature", action.kind === "use-feature");
  switch (action.kind) {
    case "end-turn":
      button.textContent = "End turn";
      return;
    case "use-feature":
      switch (action.feature.kind) {
        case "shop": button.textContent = "Shop"; return;
        case "smith": button.textContent = "Smith"; return;
        case "remove-card": button.textContent = "Remove a card"; return;
        case "gain-card": button.textContent = "Take a card"; return;
        case "coin": button.textContent = "Collect"; return;
        case "none": button.textContent = "End turn"; return;
      }
  }
}
```

The nested `switch` on `feature.kind` is exhaustive, so adding a feature kind later
becomes a compile error here until it is handled — exactly the safety the tagged
union buys you.

## 8. Interaction model, end to end

1. **Arm a card.** Click a card: a single-mode card arms its mode immediately; a
   multi-mode card shows small mode buttons (one per mode) to pick from.
2. **Resolve.**
   - `move` → enter `pending-move`; highlight reachable hexes; click to walk there.
   - `attack` → enter `pending-attack`; highlight enemies; click one to kill.
   - `draw` / `currency` / `discard-hand` → resolve on the spot.
   - `draw-discard` / `recover` → enter the matching pending phase.
3. **Discard for free.** A hover "×" or a right-click discards a card without
   counting as a play.
4. **End turn** (or **use feature**) with the bottom-right button.

Escape and right-click cancel any pending phase back to `playing`. Every one of these
handlers is three lines: read the intent, call the game function, redraw.

## 9. Redrawing

One `render(state: GameState)` entry point on the root UI re-syncs every layer from
the new state:

```ts
export function render(root: UiRefs, state: GameState): void {
  root.map.render(state.map.tiles, state.map.player, state.phase);
  renderHand(root.hand, state.deck.hand);
  root.drawCount.textContent = `${state.deck.draw.length}`;
  root.discardCount.textContent = `${state.deck.discard.length}`;
  root.currency.textContent = `${state.currency}`;
  syncEndTurnButton(root.endTurn, currentTileFeature(state));
  renderPhaseOverlay(root, state);
}
```

`render` is pure with respect to the game state (it never mutates it) and is called
after every transition. Because transitions return fresh `GameState` values, there
is no "did I forget to update the UI" class of bug: change the state, call `render`.

## 10. Milestone

- The hand renders as a symmetric fan; cards are black-on-white with square corners.
- Draw/discard piles show live counts; clicking either opens a read-only list.
- Reachable hexes and in-range enemies highlight on the map during their phases.
- The bottom-right button reads "End turn" on plain hexes and the feature's name on
  an upgrade hex.
- The map uses the coloured 32×32 textures with `image-rendering: pixelated`; the UI
  stays black, white, and one grey.

Next: [Testing, balance & next steps](10-testing-and-balance.md).
