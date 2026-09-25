# 11 — Differently sized sections and generation dead-ends

> Design note, not a milestone chapter. It records **why** the map generator
> sometimes stops early now that sections can have different radii, what has been
> tried, and the options for fixing it. Code lives in `src/game/map.ts`; the
> throwaway sweep/visualiser used for the numbers below is `mapcheck.ts`.

## 1. The symptom

`advanceMap` returns `null` after `MAX_ATTEMPTS` (40) when no template can be
placed at the current frontier, so `generateMap` stops short of the requested
section count.

- Measured baseline: **18 / 400 seeds (4.5 %)** stop before 30 sections.
- After the lateral-slide work (§4, §5A): **0 / 2000** and **1 / 5000 seeds
  (0.02 %)** stop before 30 sections, and **0 / 100 at 120 sections**. Maps stay
  varied: across ~150 000 sections, turns split about 47 % straight, 47 % 60°,
  6 % 120°.
- The one residual failure (seed 2286) is a tight **radius-1 spiral**: earlier
  panic steps dropped the radius to 1, the path wound around itself, and even a
  panic radius-2 tile collides. See §5 for the remaining levers.
- The maps that *are* produced are always structurally sound: over 400 seeds,
  **0 footprint overlaps and 0 non-adjacent consecutive sections**. This is purely
  "cannot continue", never "placed something wrong".

## 2. How placement works today

The frontier carries the previous section, not the next one:

```ts
type MapFrontier = {
  origin: HexCoord;   // centre of the section already placed
  radius: number;     // its radius, or 0 before the first section
  entryEdge: number;  // where the next section will be entered (faces back)
  lastTurn: number;   // signed bend of that section: 0, ±1 (60°), ±2 (120°), ±3
  bannedEdges: [number, number];
};
```

The next section's centre is deterministic up to one integer, the **lateral shift**:

```
origin' = frontier.origin + sectionOffset(frontier.entryEdge, frontier.radius, newRadius)
                           + slideAxis(frontier.entryEdge) * shift
```

`slideAxis(e) = OUTWARD[(e + 4) % 6]` is the direction along the shared edge.

`sectionOffset` generalises the old equal-radius `sideOffset`:

```ts
sideOffset(s, r) = OUTWARD[s] * (r + 1) + OUTWARD[s - 1] * r
sectionOffset(e, from, to) = sideOffset(e + 3, from) - OUTWARD[e - 1] * (to - from)
```

`sideOffset` places a same-radius neighbour edge-to-edge; the second term slides
the crossing by the radius difference so differently sized sections still **share
their edge** instead of overlapping. The two shared edge lines are aligned at
their `r = 0` end.

Two consequences matter for the dead-ends:

1. **The lateral alignment is asymmetric.** Equal radii join exactly; mismatched
   radii skew the smaller section to one side of the join. `sectionOffset` pins the
   crossing flush to one end of the shared edge, and `shift` moves it from there
   (within `±(1 + |ΔR|)` hexes before the sections part company).

On top of the geometry, `placeSection` filters candidates:

- the exit edge may not be the entry edge nor either `bannedEdges`;
- a smaller tile (or any tile in panic mode) may not exit toward the previous
  section's flank (`entryEdge ± 1`);
- in normal mode the radius may change by at most 1;
- in the last quarter of attempts ("panic") templates are drawn from the
  `radius <= 2` emergency pool instead, and **panic tiles may only exit straight on**
  (a bend while already struggling is what folds the map back on itself);
- each candidate is tried at `shift = 0` first, then progressively further out.

## 3. Why it dead-ends: the 120° fold

A **120° turn** is `exit = entry ± 1` (two edges off straight). It folds the path
so that the section *after* the turn ends up beside the section *before* it. With
large sections, the **corner (pointy vertex hex) of the big section protrudes into
the cone where the section-after-next wants to go.**

The concrete pattern you identified (radii 5, 5, 4):

```
tile1 r5  ──┐
            │ 120° turn
tile2 r5  ──┘   tile3 r4 placed, turning, runs into tile1's corner
                tile4 cannot be placed: tile1's corner is in the way
                panic tries r3, then r2 — still blocked
```

The panic tiles don't help: after a fold, the *corners* of two big hexagons sit
next to each other, leaving a thin wedge. The radius has to drop by several before
anything fits, but the radius guard only allows `±1` per step and panic bottoms out
at radius 2.

### Evidence

The section that finally fails to place is almost never the one that made the
fold — the fold is **2–3 sections earlier**, and by then the path has straightened
out and run into the overhang. Of the 18 dead-ends at 30 sections:

```
last-placed section's turn:   straight 14 | 60° 4 | 120° 0 | 180° 0
radius mismatch at last join: |ΔR| 0: 10  | |ΔR| 1: 8
```

Every dead-end has a `120°` turn within its last four sections:

```
seed  24: r4:60       r3:60  r3:120  r3:straight  -> next r3
seed  25: r3:straight r4:60  r4:120  r3:60        -> next r3
seed  75: r4:straight r3:60  r3:120  r3:straight  -> next r3
seed  94: r3:straight r4:120 r3:60   r3:straight  -> next r3
seed 124: r5:straight r4:60  r4:120  r3:straight  -> next r3
seed 202: r3:120      r2:60  r3:120  r2:straight  -> next r2
... (18 total; the failure is always preceded by a 120° fold)
```

## 4. What has been tried

| Change | Result |
| ------ | ------ |
| Frontier reworked so `origin` is the *last* section's centre and it carries `radius` | Removed the equal-radius assumption; placements are edge-to-edge for any radii |
| `sectionOffset` (two-radius generalisation of `sideOffset`) | Same as above; exact for equal radii, so existing seeds are unchanged |
| `bannedEdges` (first edge seeded randomly, then carried forward) | Replaced the old winding/`lastTurn` state |
| Radius guard (`|ΔR| <= 1`) + panic pool (`radius <= 2`, last quarter of attempts) | Keeps join sizes sane, and gives a fallback when nothing bigger fits |
| "Bend back" rule for smaller/panic tiles | Avoids the most obvious fold |
| Mirrored templates | Doubled the pool *once the ids were made unique* |
| **Lateral slide** (`sectionOrigin(..., shift)`, `MapFrontier` unchanged geometry) | The main fix; see §5A |
| **Slide fully to the far edge** after a 120° fold when the next tile is smaller | Pushes the follow-up section away from the protruding corner |
| **Panic mode exits straight only** | Stops the last-resort radius-2 tiles from folding the path back |
| **Ban 120° / 180° turns (experiment)** | **0 / 400 dead-ends at 30 *and* 300 sections — but every path is nearly straight, so maps are far less varied.** Reverted; kept in reserve |

Bugs found and fixed along the way (left here so they aren't reintroduced):

- `frontier.radius === 0` (the "no predecessor" sentinel) made the radius guard
  reject all 31 normal attempts at the opening section, so ~7 % of seeds could not
  even place the first section. Guard now skips when `radius === 0`.
- `mirrorTemplate` reused `template.id`, so `drawTemplate`'s
  `pool.find(t => t.id === id)` always returned the original and **no mirrored
  template was ever drawn**. Fixed by giving mirrors distinct ids.

## 5. Options for the future

### A. Slide along the cross axis — *implemented*

When `Rp != Rn` the shared edge lines have `Rp + 1` and `Rn + 1` hexes; placement
only needs them to overlap by **at least one** hex, so there is a free lateral
shift. Progressively larger shifts are tried as extra candidates when the flush
position (`shift = 0`) collides, and every shift is validated against both the
occupied set **and** adjacency to the previous section (so a slide can never
detach the map).

Implemented rules:

- `sectionOrigin(frontier, radius, shift)` adds `slideAxis(entryEdge) * shift`;
- the shift range is `±(1 + |ΔR|)`: one hex past the flush crossing, plus the
  radius gap when the sections differ in size;
- **after a 120° fold, a smaller follow-up section is slid fully to the outside of
  the bend** (away from the section the fold came from) to leave the most room for
  the section after it;
- in panic mode, exits are restricted to straight on.

Result: **1 / 5000** dead-ends at 30 sections and **0 / 100** at 120, with the turn
mix unchanged (~6 % 120°). The residual case is a radius-1 spiral (§1).

### B. Look ahead, and (really) backtrack

- **Look ahead:** when choosing section *i*'s exit, require that at least one
  placement exists for section *i+1* (probe with a representative radius, say 3).
- **Why 1-step alone is not enough:** in the observed failure, *i+1* **is**
  placeable — it is *i+2* that fails. The check that catches it is at section
  *i+1*'s *exit selection*: only accept an *i+1* placement if some exit still
  leaves *i+2* placeable. But if none does, *i+1* must be rejected, which means
  undoing the choice that produced it.
- **Robust form = backtracking:** when a placement fails, undo the previous
  section and try its next candidate (different exit / template / shift). That is a
  small DFS over the existing greedy loop. It is complete up to the retry budget
  and, crucially, **does not distort the map** the way banning turns does.
- **Cost:** moderate — `placeSection` should yield its candidate placements
  (template, rotation, shift) and `advanceMap` becomes a stack/recursive search
  with a step budget. Generation runs ahead of the player, so the extra work is
  affordable. (Note `placeSection` currently rebuilds the `occupied` set on every
  call — `O(n²)` over a long map; a shared set would help both this and B.)

### C. Filler / corridor rows

If nothing fits, stamp a thin strip (one or two rows, copied from the adjacent
section) to buy distance, then retry.

- **Why it helps:** it *always* makes progress, so the generator can never fully
  deadlock.
- **Cost:** high, and it changes gameplay. The whole pipeline assumes a hexagon
  keyed off `entryEdge` + `radius`: `forwardRows` in `fog.ts`, streaming, assassin
  arming, `radiusOf`, and the difficulty band. A strip would need a new tagged
  section kind and each of those sites taught to handle it. A featureless corridor
  also plays differently.
- **Verdict:** a rarely-hit escape valve behind a tagged union, not the main
  mechanism.

### D. Ban tight turns (reference)

Measured above: a complete fix in practice, at the cost of variety. If it is
wanted at all, apply it **only in panic mode** — ban the `120°`/`180°` exit once
the generator is already struggling (e.g. `attempt > MAX_ATTEMPTS / 2`, or after
two turns already bent the same way). That removes the pathological folds while
leaving normal maps free to wind.

## 6. Recommendation

1. **A (lateral slide)** — done, and it is enough for all but one seed in 1500.
   **B (exit feasibility / bounded backtracking)** remains the lever for the last
   stragglers and for any future guarantee; it keeps the current varied terrain and
   fixes the real cause (the fold plus the greedy exit choice).
2. If a hard "never stops" guarantee is wanted without a second section shape, add
   **D restricted to panic** as a last resort, and check it doesn't flatten the
   maps.
3. Reach for **C** only if the gameplay region can tolerate a corridor-like
   section.

Cleanest ordering for **B**: make `placeSection` return a *list* of candidate
placements for the current frontier (template, rotation, shift, allowed exits),
then choose from that list with backtracking.

## 7. How to evaluate a change

`mapcheck.ts` (bundled with `vite build --ssr mapcheck.ts --outDir /tmp/mc`, run
with `node /tmp/mc/mapcheck.js [seed] [sections] [seeds]`) renders the placed
sections plus the last rejected candidate, sweeps seeds, and reports:

- the dead-end rate over `seeds × sections`;
- the **turn trail** of the last four placed sections at each dead-end;
- the turn mix over **every** placed section (variety check — a low `120°` count
  means the fix flattened the maps);
- radius mismatch at the last join;
- template-id uniqueness.

A single-seed run (`node mapcheck.js <seed>`) renders that map.

Compare policies on the dead-end rate **and** on the trail histogram — the point
is not only to stop deadlocking but to do so without making every path straight.
Keep test runs small (a few hundred seeds at 30 sections is instant; large
`sections` values are slow because of the `O(n²)` occupied-set rebuild).