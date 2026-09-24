import type { Card } from "./cards";

/** Where a card entered the deck, and at what cost. */
export type CardOrigin =
  { kind: "starting" } | { kind: "shop"; cost: number } | { kind: "gift" };

/** Per-copy bookkeeping, keyed by the card's unique id. */
export type CardRecord = {
  id: string;
  name: string;
  origin: CardOrigin;
  acquiredTurn: number;
  drawn: number;
  played: number;
};

/** Everything tracked over a single run. */
export type RunStats = {
  /** Ids of the map sections the player has entered (a "tile" in the design). */
  sectionsVisited: readonly string[];
  cardsPlayed: number;
  cardsDrawn: number;
  enemiesKilled: number;
  sitesVisited: number;
  cards: readonly CardRecord[];
};

/** The headline numbers, used to compare runs against each other. */
export type RunScores = {
  /** Sections entered; shown to the player as "tiles visited". */
  tilesVisited: number;
  cardsPlayed: number;
  cardsDrawn: number;
  enemiesKilled: number;
  sitesVisited: number;
};

export function emptyStats(): RunStats {
  return {
    sectionsVisited: [],
    cardsPlayed: 0,
    cardsDrawn: 0,
    enemiesKilled: 0,
    sitesVisited: 0,
    cards: [],
  };
}

/** The stats at the moment a run begins: the start section and the opening deck. */
export function startingStats(
  cards: readonly Card[],
  startSection: string,
  turn: number,
): RunStats {
  let stats = visitSections(emptyStats(), [startSection]);
  for (const card of cards) {
    stats = acquireCard(stats, card, { kind: "starting" }, turn);
  }
  return stats;
}

export function visitSections(
  stats: RunStats,
  sectionIds: readonly string[],
): RunStats {
  let sectionsVisited = stats.sectionsVisited;
  for (const id of sectionIds) {
    if (!sectionsVisited.includes(id)) {
      sectionsVisited = [...sectionsVisited, id];
    }
  }
  if (sectionsVisited === stats.sectionsVisited) {
    return stats;
  }
  return { ...stats, sectionsVisited };
}

export function acquireCard(
  stats: RunStats,
  card: Card,
  origin: CardOrigin,
  turn: number,
): RunStats {
  if (stats.cards.some((record) => record.id === card.id)) {
    return stats;
  }
  const record: CardRecord = {
    id: card.id,
    name: card.name,
    origin,
    acquiredTurn: turn,
    drawn: 0,
    played: 0,
  };
  return { ...stats, cards: [...stats.cards, record] };
}

export function countDrawn(stats: RunStats, cards: readonly Card[]): RunStats {
  if (cards.length === 0) {
    return stats;
  }
  const ids = new Set(cards.map((card) => card.id));
  return {
    ...stats,
    cardsDrawn: stats.cardsDrawn + cards.length,
    cards: stats.cards.map((record) =>
      ids.has(record.id) ? { ...record, drawn: record.drawn + 1 } : record,
    ),
  };
}

export function countPlay(stats: RunStats, cardId: string): RunStats {
  return {
    ...stats,
    cardsPlayed: stats.cardsPlayed + 1,
    cards: stats.cards.map((record) =>
      record.id === cardId ? { ...record, played: record.played + 1 } : record,
    ),
  };
}

export function countKill(stats: RunStats): RunStats {
  return { ...stats, enemiesKilled: stats.enemiesKilled + 1 };
}

export function countSite(stats: RunStats): RunStats {
  return { ...stats, sitesVisited: stats.sitesVisited + 1 };
}

export function runScores(stats: RunStats): RunScores {
  return {
    tilesVisited: stats.sectionsVisited.length,
    cardsPlayed: stats.cardsPlayed,
    cardsDrawn: stats.cardsDrawn,
    enemiesKilled: stats.enemiesKilled,
    sitesVisited: stats.sitesVisited,
  };
}

/** A card name's usage across every copy the player still holds. */
export type CardUsage = {
  card: Card;
  drawn: number;
  played: number;
};

export type CardUsageSet = {
  most: CardUsage | null;
  least: CardUsage | null;
};

/**
 * Aggregate usage by card *name*, over the copies the player finished with.
 * Duplicates (two `Tredge`) share one entry so a single copy's low draw count
 * does not hide a card that was actually seen often.
 */
export function usageByCard(
  cards: readonly Card[],
  stats: RunStats,
): CardUsage[] {
  const byName = new Map<string, CardUsage>();
  for (const card of cards) {
    const record = stats.cards.find((candidate) => candidate.id === card.id);
    if (record === undefined) {
      continue;
    }
    const existing = byName.get(card.name);
    if (existing === undefined) {
      byName.set(card.name, {
        card,
        drawn: record.drawn,
        played: record.played,
      });
    } else {
      existing.drawn += record.drawn;
      existing.played += record.played;
    }
  }
  return [...byName.values()];
}

/**
 * The most and least played card names, normalised by how often each was drawn,
 * among those drawn at least `minDraws` times. Returns nulls when nothing
 * qualifies.
 */
export function usageExtremes(
  cards: readonly Card[],
  stats: RunStats,
  minDraws: number,
): CardUsageSet {
  const eligible = usageByCard(cards, stats).filter(
    (usage) => usage.drawn >= minDraws,
  );
  if (eligible.length === 0) {
    return { most: null, least: null };
  }
  let most = eligible[0];
  let least = eligible[0];
  for (const usage of eligible) {
    if (usageRate(usage) > usageRate(most)) {
      most = usage;
    }
    if (usageRate(usage) < usageRate(least)) {
      least = usage;
    }
  }
  return { most: most ?? null, least: least ?? null };
}

function usageRate(usage: CardUsage): number {
  return usage.drawn === 0 ? 0 : usage.played / usage.drawn;
}

/** A row of the detailed per-card table. */
export type CardDetail = {
  name: string;
  origin: CardOrigin;
  acquiredTurn: number;
  drawn: number;
  played: number;
  /** True once the card has been removed from the deck (it may still have
   * been drawn and played while it was held). */
  removed: boolean;
};

/**
 * A record for every card the player ever acquired, oldest first — including
 * cards since removed from the deck, which are marked so.
 */
export function cardDetails(
  cards: readonly Card[],
  stats: RunStats,
): CardDetail[] {
  const held = new Set(cards.map((card) => card.id));
  return stats.cards
    .map((record) => ({
      name: record.name,
      origin: record.origin,
      acquiredTurn: record.acquiredTurn,
      drawn: record.drawn,
      played: record.played,
      removed: !held.has(record.id),
    }))
    .sort(
      (a, b) => a.acquiredTurn - b.acquiredTurn || a.name.localeCompare(b.name),
    );
}
