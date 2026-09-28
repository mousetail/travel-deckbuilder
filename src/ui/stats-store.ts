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
export function recordRun(
  history: History,
  depth: number,
  scores: RunScores,
): History {
  if (history.kind === "none") {
    return { kind: "records", best: scores, furthest: { depth, scores } };
  }
  return {
    kind: "records",
    best: bestOf(history.best, scores),
    furthest:
      depth > history.furthest.depth ? { depth, scores } : history.furthest,
  };
}

function bestOf(a: RunScores, b: RunScores): RunScores {
  return {
    tilesVisited: Math.max(a.tilesVisited, b.tilesVisited),
    cardsPlayed: Math.max(a.cardsPlayed, b.cardsPlayed),
    cardsDrawn: Math.max(a.cardsDrawn, b.cardsDrawn),
    enemiesKilled: Math.max(a.enemiesKilled, b.enemiesKilled),
    sitesVisited: Math.max(a.sitesVisited, b.sitesVisited),
    currencyGained: Math.max(a.currencyGained, b.currencyGained),
    currencySpent: Math.max(a.currencySpent, b.currencySpent),
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
        "v2",
        history.furthest.depth,
        f.tilesVisited,
        f.cardsPlayed,
        f.cardsDrawn,
        f.enemiesKilled,
        f.sitesVisited,
        f.currencyGained,
        f.currencySpent,
        b.tilesVisited,
        b.cardsPlayed,
        b.cardsDrawn,
        b.enemiesKilled,
        b.sitesVisited,
        b.currencyGained,
        b.currencySpent,
      ];
      return fields.join(",");
    }
  }
}

function decode(raw: string): History {
  const parts = raw.split(",");
  if (parts[0] === "v2" && parts.length === 16) {
    const numbers = parseNumbers(parts.slice(1));
    if (numbers === null) {
      return { kind: "none" };
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
          currencyGained: numberAt(numbers, 6),
          currencySpent: numberAt(numbers, 7),
        },
      },
      best: {
        tilesVisited: numberAt(numbers, 8),
        cardsPlayed: numberAt(numbers, 9),
        cardsDrawn: numberAt(numbers, 10),
        enemiesKilled: numberAt(numbers, 11),
        sitesVisited: numberAt(numbers, 12),
        currencyGained: numberAt(numbers, 13),
        currencySpent: numberAt(numbers, 14),
      },
    };
  }
  // v1 predates the coin columns; read it with those left at zero.
  if (parts[0] === "v1" && parts.length === 12) {
    const numbers = parseNumbers(parts.slice(1));
    if (numbers === null) {
      return { kind: "none" };
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
          currencyGained: 0,
          currencySpent: 0,
        },
      },
      best: {
        tilesVisited: numberAt(numbers, 6),
        cardsPlayed: numberAt(numbers, 7),
        cardsDrawn: numberAt(numbers, 8),
        enemiesKilled: numberAt(numbers, 9),
        sitesVisited: numberAt(numbers, 10),
        currencyGained: 0,
        currencySpent: 0,
      },
    };
  }
  return { kind: "none" };
}

function parseNumbers(parts: readonly string[]): number[] | null {
  const numbers: number[] = [];
  for (const part of parts) {
    const value = Number(part);
    if (!Number.isInteger(value) || value < 0) {
      return null;
    }
    numbers.push(value);
  }
  return numbers;
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
