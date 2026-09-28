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
  /** Times the card left the hand for the discard pile without being played. */
  discarded: number;
  /** Times the card was permanently upgraded at a smith. */
  upgraded: number;
  /** The turn the card left the deck, or null while it is still held. */
  removedTurn: number | null;
};

/** How often a card was offered to the player during a run, by card name. */
export type CardShowTally = {
  name: string;
  shownInShop: number;
  shownInGift: number;
};

/**
 * The best single-turn (and deck-size) values for one run, every field tracked
 * as a running maximum while the run is played. `leastCardsInDeck` is a running
 * minimum, or null before the deck has been measured once.
 */
export type RunRecords = {
  mostCardsPlayedInTurn: number;
  mostDistanceInTurn: number;
  mostEnemiesKilledInTurn: number;
  mostCurrencyHeld: number;
  mostCurrencyEarnedInTurn: number;
  mostCurrencySpentInTurn: number;
  mostCardsInDeck: number;
  leastCardsInDeck: number | null;
  mostUpgradedCardsInDeck: number;
};

/** The record keys that only ever rise, so `raise` can compare them as numbers. */
type MaxRecordKey = Exclude<keyof RunRecords, "leastCardsInDeck">;

export function emptyRecords(): RunRecords {
  return {
    mostCardsPlayedInTurn: 0,
    mostDistanceInTurn: 0,
    mostEnemiesKilledInTurn: 0,
    mostCurrencyHeld: 0,
    mostCurrencyEarnedInTurn: 0,
    mostCurrencySpentInTurn: 0,
    mostCardsInDeck: 0,
    leastCardsInDeck: null,
    mostUpgradedCardsInDeck: 0,
  };
}

/** Where a coin came from, for the end-of-run breakdown. */
export type CurrencyGainSource = "cards" | "combat" | "skips" | "coins";

/** Where a coin went: `cards` is a card's play cost, `shops` is a purchase or reroll. */
export type CurrencySpendSink = "cards" | "shops";

/** The run's coin ledger: totals plus the breakdown shown in the finance modal. */
export type CurrencyLedger = {
  gained: number;
  spent: number;
  gainedFromCards: number;
  gainedFromCombat: number;
  gainedFromSkips: number;
  gainedFromCoins: number;
  starting: number;
  spentOnCards: number;
  spentInShops: number;
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
  /** How often each card name was offered (whether or not it was taken). */
  cardShown: readonly CardShowTally[];
  /** Ids of cards permanently upgraded this run, still held in the deck. */
  upgradedCardIds: readonly string[];
  records: RunRecords;
  currency: CurrencyLedger;
};

/** The headline numbers, used to compare runs against each other. */
export type RunScores = {
  /** Sections entered; shown to the player as "tiles visited". */
  tilesVisited: number;
  cardsPlayed: number;
  cardsDrawn: number;
  enemiesKilled: number;
  sitesVisited: number;
  currencyGained: number;
  currencySpent: number;
};

export function emptyStats(): RunStats {
  return {
    sectionsVisited: [],
    cardsPlayed: 0,
    cardsDrawn: 0,
    enemiesKilled: 0,
    sitesVisited: 0,
    cards: [],
    cardShown: [],
    upgradedCardIds: [],
    records: emptyRecords(),
    currency: {
      gained: 0,
      spent: 0,
      gainedFromCards: 0,
      gainedFromCombat: 0,
      gainedFromSkips: 0,
      gainedFromCoins: 0,
      starting: 0,
      spentOnCards: 0,
      spentInShops: 0,
    },
  };
}

/** The stats at the moment a run begins: the start section and the opening deck. */
export function startingStats(
  cards: readonly Card[],
  startSection: string,
  turn: number,
  startingCurrency: number,
): RunStats {
  let stats = visitSections(emptyStats(), [startSection]);
  stats = {
    ...stats,
    currency: {
      ...stats.currency,
      gained: startingCurrency,
      starting: startingCurrency,
    },
  };
  for (const card of cards) {
    stats = acquireCard(stats, card, { kind: "starting" }, turn);
  }
  stats = recordDeckSize(stats, cards.length);
  return recordCurrencyHeld(stats, startingCurrency);
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
    discarded: 0,
    upgraded: 0,
    removedTurn: null,
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

export function countDiscarded(
  stats: RunStats,
  cards: readonly Card[],
): RunStats {
  if (cards.length === 0) {
    return stats;
  }
  const ids = new Set(cards.map((card) => card.id));
  return {
    ...stats,
    cards: stats.cards.map((record) =>
      ids.has(record.id)
        ? { ...record, discarded: record.discarded + 1 }
        : record,
    ),
  };
}

export function countCurrencyGain(
  stats: RunStats,
  source: CurrencyGainSource,
  amount: number,
): RunStats {
  if (amount <= 0) {
    return stats;
  }
  const currency = { ...stats.currency, gained: stats.currency.gained + amount };
  switch (source) {
    case "cards":
      currency.gainedFromCards += amount;
      break;
    case "combat":
      currency.gainedFromCombat += amount;
      break;
    case "skips":
      currency.gainedFromSkips += amount;
      break;
    case "coins":
      currency.gainedFromCoins += amount;
      break;
  }
  return { ...stats, currency };
}

export function countCurrencySpend(
  stats: RunStats,
  sink: CurrencySpendSink,
  amount: number,
): RunStats {
  if (amount <= 0) {
    return stats;
  }
  const currency = { ...stats.currency, spent: stats.currency.spent + amount };
  switch (sink) {
    case "cards":
      currency.spentOnCards += amount;
      break;
    case "shops":
      currency.spentInShops += amount;
      break;
  }
  return { ...stats, currency };
}

export function countRemoved(
  stats: RunStats,
  cardId: string,
  turn: number,
): RunStats {
  return {
    ...stats,
    cards: stats.cards.map((record) =>
      record.id === cardId ? { ...record, removedTurn: turn } : record,
    ),
    upgradedCardIds: stats.upgradedCardIds.filter((id) => id !== cardId),
  };
}

/** Mark a card as permanently upgraded at a smith, for the records. */
export function countUpgrade(stats: RunStats, cardId: string): RunStats {
  if (stats.upgradedCardIds.includes(cardId)) {
    return stats;
  }
  const upgraded: RunStats = {
    ...stats,
    cards: stats.cards.map((record) =>
      record.id === cardId ? { ...record, upgraded: record.upgraded + 1 } : record,
    ),
    upgradedCardIds: [...stats.upgradedCardIds, cardId],
  };
  return recordUpgradedCards(upgraded, upgraded.upgradedCardIds.length);
}

/** Note that `name` was offered in a shop or a gift space. */
export function countCardShown(
  stats: RunStats,
  name: string,
  where: "shop" | "gift",
): RunStats {
  const index = stats.cardShown.findIndex((tally) => tally.name === name);
  if (index === -1) {
    return {
      ...stats,
      cardShown: [
        ...stats.cardShown,
        {
          name,
          shownInShop: where === "shop" ? 1 : 0,
          shownInGift: where === "gift" ? 1 : 0,
        },
      ],
    };
  }
  return {
    ...stats,
    cardShown: stats.cardShown.map((tally, i) =>
      i === index
        ? {
            ...tally,
            shownInShop: tally.shownInShop + (where === "shop" ? 1 : 0),
            shownInGift: tally.shownInGift + (where === "gift" ? 1 : 0),
          }
        : tally,
    ),
  };
}

/** Raise one of the running maximum records to `value`, if it is higher. */
function raise(stats: RunStats, key: MaxRecordKey, value: number): RunStats {
  if (value <= stats.records[key]) {
    return stats;
  }
  const records: RunRecords = { ...stats.records };
  records[key] = value;
  return { ...stats, records };
}

export function recordCardsPlayedInTurn(stats: RunStats, value: number): RunStats {
  return raise(stats, "mostCardsPlayedInTurn", value);
}

export function recordDistanceInTurn(stats: RunStats, value: number): RunStats {
  return raise(stats, "mostDistanceInTurn", value);
}

export function recordEnemiesKilledInTurn(
  stats: RunStats,
  value: number,
): RunStats {
  return raise(stats, "mostEnemiesKilledInTurn", value);
}

export function recordCurrencyEarnedInTurn(
  stats: RunStats,
  value: number,
): RunStats {
  return raise(stats, "mostCurrencyEarnedInTurn", value);
}

export function recordCurrencySpentInTurn(
  stats: RunStats,
  value: number,
): RunStats {
  return raise(stats, "mostCurrencySpentInTurn", value);
}

export function recordCurrencyHeld(stats: RunStats, value: number): RunStats {
  return raise(stats, "mostCurrencyHeld", value);
}

/** Track the deck's size against the most and least seen during the run. */
export function recordDeckSize(stats: RunStats, size: number): RunStats {
  const records: RunRecords = { ...stats.records };
  let changed = false;
  if (size > records.mostCardsInDeck) {
    records.mostCardsInDeck = size;
    changed = true;
  }
  if (records.leastCardsInDeck === null || size < records.leastCardsInDeck) {
    records.leastCardsInDeck = size;
    changed = true;
  }
  return changed ? { ...stats, records } : stats;
}

export function recordUpgradedCards(stats: RunStats, value: number): RunStats {
  return raise(stats, "mostUpgradedCardsInDeck", value);
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
    currencyGained: stats.currency.gained,
    currencySpent: stats.currency.spent,
  };
}

/** A card name's usage across every copy the player still holds. */
export type CardUsage = {
  card: Card;
  drawn: number;
  played: number;
  discarded: number;
};

export type CardUsageSet = {
  most: CardUsage | null;
  mostDiscarded: CardUsage | null;
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
        discarded: record.discarded,
      });
    } else {
      existing.drawn += record.drawn;
      existing.played += record.played;
      existing.discarded += record.discarded;
    }
  }
  return [...byName.values()];
}

/**
 * The most played card name (normalised by how often it was drawn, among those
 * drawn at least `minDraws` times) and the most discarded card name. Returns
 * nulls when nothing qualifies.
 */
export function usageExtremes(
  cards: readonly Card[],
  stats: RunStats,
  minDraws: number,
): CardUsageSet {
  const usages = usageByCard(cards, stats);
  const eligible = usages.filter((usage) => usage.drawn >= minDraws);
  let most: CardUsage | null = null;
  for (const usage of eligible) {
    if (most === null || usageRate(usage) > usageRate(most)) {
      most = usage;
    }
  }
  let mostDiscarded: CardUsage | null = null;
  for (const usage of usages) {
    if (usage.discarded === 0) {
      continue;
    }
    if (mostDiscarded === null || usage.discarded > mostDiscarded.discarded) {
      mostDiscarded = usage;
    }
  }
  return { most, mostDiscarded };
}

function usageRate(usage: CardUsage): number {
  return usage.drawn === 0 ? 0 : usage.played / usage.drawn;
}

/** A row of the detailed per-card table. */
export type CardDetail = {
  name: string;
  origin: CardOrigin;
  acquiredTurn: number;
  discarded: number;
  played: number;
  /** True once the card has been removed from the deck (it may still have
   * been drawn and played while it was held). */
  removed: boolean;
  /** The turn the card left the deck, or the run's final turn if still held. */
  lastTurn: number;
};

/**
 * A record for every card the player ever acquired, oldest first — including
 * cards since removed from the deck, which are marked so.
 */
export function cardDetails(
  cards: readonly Card[],
  stats: RunStats,
  finalTurn: number,
): CardDetail[] {
  const held = new Set(cards.map((card) => card.id));
  return stats.cards
    .map((record) => ({
      name: record.name,
      origin: record.origin,
      acquiredTurn: record.acquiredTurn,
      discarded: record.discarded,
      played: record.played,
      removed: !held.has(record.id),
      lastTurn: record.removedTurn ?? finalTurn,
    }))
    .sort(
      (a, b) => a.acquiredTurn - b.acquiredTurn || a.name.localeCompare(b.name),
    );
}
