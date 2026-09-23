# 10 — Testing, balance & next steps

**Goal:** lock in the rules with tests, tune the difficulty curve with data instead
of vibes, and leave a clear list of what comes after this guide.

## 1. Why this is easy here

Because `src/game/*` never touches the DOM (chapter 00), every rule in this guide is
a pure function and can be tested in Node with no browser and no `jsdom`. That is the
payoff of the architecture; use it.

Add Vitest (a dev dependency; the project already uses Vite so it shares config):

```sh
npm install -D vitest
```

```jsonc
// package.json (scripts)
{
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

Vitest understands TypeScript out of the box, and `tsconfig.json`'s `noEmit` suits it
fine.

## 2. What to test, chapter by chapter

| Module | Tests |
| ------ | ----- |
| `hex.ts` | `hexDistance` to self = 0; each neighbour = 1; `pixelToHex(hexToPixel(c)) === c` over a sample; `findPath` returns a path when one exists and `[]` when none does. |
| `terrain.ts` | `canEnter("dirt", t)` is true for every card terrain; `canEnter("impassible", t)` is false for every one; a grass card enters grass and dirt but not forest/water/mountain. |
| `deck.ts` | Total card count is conserved by `drawCards`/`toDiscard`/`addPurchase`; reshuffle happens exactly when draw empties; a purchase never appears before a reshuffle; `drawUpTo` never draws past the deck. |
| `movement.ts` | Reachable set honours the distance budget; it excludes impassible and unenterable hexes; a `distance: 0`-style card reaches nothing new. |
| `map.ts` | Same seed ⇒ identical map; footprints never overlap; every generated section has an entry→exit path for grass+forest. |
| `enemies.ts` | An assassin within budget of the player reports `killedPlayer`; one out of budget moves toward the leading edge by at most its movement; `sniperKills` is true exactly inside the radius; impassible terrain blocks a path. |
| `economy.ts` | Buying deducts currency and lands in discard; `upgradeCard` bumps movement and leaves attack range alone; `removeCardFromDeck` clears the id from all three zones; weighted picks never return a `starting` spec. |

A representative test, to show the style (pure in, pure out):

```ts
import { describe, expect, it } from "vitest";
import { canEnter } from "../game/terrain";
import { CARD_TERRAINS } from "../game/terrain";
import type { Terrain } from "../game/terrain";

const ALL_TERRAINS: readonly Terrain[] = [
  "grass", "forest", "water", "mountain", "dirt", "impassible",
];

describe("canEnter", () => {
  it("lets every card cross dirt", () => {
    for (const terrain of CARD_TERRAINS) {
      expect(canEnter("dirt", terrain)).toBe(true);
    }
  });

  it("never lets anything cross impassible", () => {
    for (const terrain of CARD_TERRAINS) {
      expect(canEnter("impassible", terrain)).toBe(false);
    }
  });

  it("confines a card to its own terrain plus dirt", () => {
    for (const terrain of CARD_TERRAINS) {
      for (const target of ALL_TERRAINS) {
        const expected = target === "dirt" || target === terrain;
        expect(canEnter(target, terrain)).toBe(expected);
      }
    }
  });
});
```

If you change the "grass also crosses forest" decision from chapter 02, this test is
the single place that encodes it.

## 3. Invariants worth a dedicated test

Some rules are best expressed as *invariants* checked after random sequences of
actions (a tiny fuzz test): run N random legal actions with a seeded RNG and assert
after every step:

- **Card conservation:** `draw.length + hand.length + discard.length` is constant
  except when a card is added or removed by design.
- **Player position is a real tile:** `tiles.has(hexKey(player))` always.
- **No enemy on a removed section:** every enemy's hex is in a live section.
- **Reachability:** from the player's hex there is always a grass-or-forest path
  toward the leading edge (the game should never soft-lock you, which is also what
  the pass-a-turn currency is defending against).
- **No overlapping sections** in `index.sections`, including removed ones.

Fuzz tests with a fixed seed are deterministic, so a failure is reproducible from the
seed alone.

## 4. Balance knobs

Put every tunable number in one module (`game/balance.ts`) so chapter 10's advice is
actionable and not scattered:

```ts
export const BALANCE = {
  handSize: 4,
  passTurnCurrency: 1,
  startCurrency: 0,
  shopStock: 3,
  shopRerollCost: 2,
  assassinBaseMovement: 2,
  assassinMovementPerTurns: 6,   // +1 movement every this many turns
  sniperRadius: 3,
  difficultyPerSection: 1,
} as const;
```

The values above are a starting point. Tune them with a quick harness rather than by
hand: simulate many games with a simple greedy bot (always take the shortest
grass/forest path to the leading edge, buy the cheapest movement card, use combat on
the nearest enemy) and log:

- **Turns survived** and **sections cleared** per seed.
- **Currency earned vs. spent** (is money too tight or too loose?).
- **Death cause** (assassin vs. sniper vs. caught) — this tells you which threat is
  over-tuned.

Target a death *distribution* rather than a single difficulty: early runs should
mostly end to assassins, mid runs should introduce sniper pressure, and a good player
should occasionally be squeezed out of currency rather than killed outright.

Curve guidance from the design:

- **Assassin count and speed** both scale with turns. Keep the two independent: more
  pressure from *numbers* reads as "swarm", more pressure from *speed* reads as
  "hunted". Mix them across difficulty bands to get both feelings.
- **Terrain difficulty** should gate the player, not the assassins: the *player* needs
  mountain cards to reach the rarest upgrades, while assassins merely move slowly
  there. So the amount of mountain/water on later sections is a direct lever on how
  much the player is forced to diversify their deck.
- **Rarity weights** (`RARITY_WEIGHT`) set how fast a deck matures. Lowering `rare`'s
  weight lengthens runs; raising `common`'s makes decks homogeneous.
- **Anti-softlock pay** should be *strictly worse* than playing for currency (that is
  why it is a flat 1), or players will idle. Verify in the harness that the greedy
  bot never prefers to pass.

## 5. Determinism and replays

Because `GameState` is plain data and all randomness flows through the seeded `Rng`
(chapter 00), you can serialise a run as `{ seed, actions: Action[] }` and replay it
exactly. That is a debugging superpower: a bug report becomes a seed and a list of
clicks. Keep every player action as a small tagged union (`{ kind: "play-card", id }`,
`{ kind: "end-turn" }`, …) and route the UI through an `applyAction(state, action)`
function so this stays possible.

```ts
export type Action =
  | { kind: "play-card"; cardId: string; modeIndex: number }
  | { kind: "discard-card"; cardId: string }
  | { kind: "move-to"; coord: HexCoord }
  | { kind: "attack"; enemyId: string }
  | { kind: "use-feature" }
  | { kind: "end-turn" };

export function applyAction(state: GameState, action: Action): GameState { /* … */ }
```

If the UI only ever calls `applyAction`, the whole game is testable and replayable
from actions alone.

## 6. Performance notes

- Only three sections are ever rendered, so a few hundred DOM hexes at most — no
  optimisation needed. If you do move to canvas later, the `game/*` layer is
  unchanged.
- Re-render on state change, not per frame. `requestAnimationFrame` is only needed if
  you animate the player stepping along a path; even then, animate the marker, not the
  whole map.
- `findPath`/`findPathByCost` run over ≤ 3 sections; the linear-scan priority queue
  is fine. Revisit only if profiling disagrees.

## 7. Accessibility & polish

- Cards are `<button>`s, so they are keyboard-focusable and Enter/Space activatable.
- Give the map hexes `aria-label`s like "grass, reachable" so the board is not silent
  to screen readers.
- Keep one focus style (a thick black outline) consistent with the visual language.
- Respect `prefers-reduced-motion`: skip the move animation but keep the logic.

## 8. What this guide does not cover

Deliberate gaps you can pick up next, roughly in order of value:

1. **Real card art.** The design says leave the image as a placeholder; the UI already
   handles `image === ""` with a coloured block.
2. **Authored section templates.** Chapter 05 gives the format and validator; writing
   ~15–25 hand-designed sections per difficulty band is the bulk of the remaining
   content work.
3. **Save/load.** `GameState` is serialisable already; persist
   `{ seed, actions }` and replay on load.
4. **Sound and juice.** Screen shake on spawn, a hit flash on kill — after the rules
   are locked.
5. **Meta-progression**, if you want it. Out of scope for the design as written.

## 9. Milestone

- `npm test` is green, including the `canEnter` table test and the deck-conservation
  invariant.
- The balance harness runs 100 seeded greedy games and prints survival and death-cause
  distributions.
- A run is replayable from `{ seed, actions }` and produces an identical final state.
- All tunables live in `balance.ts`, and changing one there visibly changes the
  harness output.

That is a complete, playable implementation of the design. From here, iterate on
content (sections and card costs) rather than architecture.
