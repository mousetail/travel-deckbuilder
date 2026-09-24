import type { RunScores } from "../game/stats";

const STORAGE_KEY = "travel-card-game.history.v1";

/** The deepest run so far, used as the second grey comparison column. */
export type PreviousRun = {
  depth: number;
  scores: RunScores;
};

/**
 * Saved results from past runs. `none` means nothing has been recorded yet, so
 * the game-over panel shows placeholders instead of zeroes.
 */
export type History =
  | { kind: "none" }
  | { kind: "records"; best: RunScores; furthest: PreviousRun };

export function loadHistory(): History {
  const raw = readStorage();
  return raw === null ? { kind: "none" } : decode(raw);
}

export function saveHistory(history: History): void {
  writeStorage(encode(history));
}

/** Fold a finished run into the saved history: best-ever per category, and the
 * run that reached the greatest depth. */
export function recordRun(history: History, depth: number, scores: RunScores): History {
  if (history.kind === "none") {
    return { kind: "records", best: scores, furthest: { depth, scores } };
  }
  return {
    kind: "records",
    best: bestOf(history.best, scores),
    furthest: depth > history.furthest.depth ? { depth, scores } : history.furthest,
  };
}

function bestOf(a: RunScores, b: RunScores): RunScores {
  return {
    tilesVisited: Math.max(a.tilesVisited, b.tilesVisited),
    cardsPlayed: Math.max(a.cardsPlayed, b.cardsPlayed),
    cardsDrawn: Math.max(a.cardsDrawn, b.cardsDrawn),
    enemiesKilled: Math.max(a.enemiesKilled, b.enemiesKilled),
    sitesVisited: Math.max(a.sitesVisited, b.sitesVisited),
  };
}

/**
 * A flat, delimiter-separated encoding of the two score sets. Kept to plain
 * integers rather than JSON so decoding needs no `any`/`unknown` (see the
 * project's code guidelines).
 */
function encode(history: History): string {
  switch (history.kind) {
    case "none":
      return "none";
    case "records": {
      const f = history.furthest.scores;
      const b = history.best;
      const fields = [
        "v1",
        history.furthest.depth,
        f.tilesVisited,
        f.cardsPlayed,
        f.cardsDrawn,
        f.enemiesKilled,
        f.sitesVisited,
        b.tilesVisited,
        b.cardsPlayed,
        b.cardsDrawn,
        b.enemiesKilled,
        b.sitesVisited,
      ];
      return fields.join(",");
    }
  }
}

function decode(raw: string): History {
  const parts = raw.split(",");
  if (parts.length !== 12 || parts[0] !== "v1") {
    return { kind: "none" };
  }
  const numbers: number[] = [];
  for (const part of parts.slice(1)) {
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0) {
      return { kind: "none" };
    }
    numbers.push(value);
  }
  return {
    kind: "records",
    furthest: {
      depth: numberAt(numbers, 0),
      scores: {
        tilesVisited: numberAt(numbers, 1),
        cardsPlayed: numberAt(numbers, 2),
        cardsDrawn: numberAt(numbers, 3),
        enemiesKilled: numberAt(numbers, 4),
        sitesVisited: numberAt(numbers, 5),
      },
    },
    best: {
      tilesVisited: numberAt(numbers, 6),
      cardsPlayed: numberAt(numbers, 7),
      cardsDrawn: numberAt(numbers, 8),
      enemiesKilled: numberAt(numbers, 9),
      sitesVisited: numberAt(numbers, 10),
    },
  };
}

function numberAt(values: readonly number[], index: number): number {
  return values[index] ?? 0;
}

function readStorage(): string | null {
  try {
    return window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStorage(value: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    // Storage can be unavailable (private mode, quota); stats are a nicety.
  }
}
