import type { GameOverReason } from "./state";
import type { RunRecords, RunStats } from "./stats";
import { emptyRecords } from "./stats";

/** The four ways a run can end without winning. */
export type DeathCause = "assassin" | "sniper" | "watchtower" | "caught";

export type DeathCounts = {
  assassin: number;
  sniper: number;
  watchtower: number;
  caught: number;
};

/** Everything remembered about one card across every run, keyed by its name. */
export type CareerCard = {
  name: string;
  shownInShop: number;
  shownInGift: number;
  taken: number;
  upgraded: number;
  removed: number;
  /** Runs in which the card was acquired at any point, win or lose. */
  runsWithCard: number;
  winsWithCard: number;
  /** Sum of sections visited over `runsWithCard`, for the average. */
  sectionsWithCard: number;
};

/** Lifetime statistics, folded in one run at a time as runs finish. */
export type CareerStats = {
  runs: number;
  wins: number;
  /** Sum of sections visited over `runs`, for the average. */
  sectionsVisited: number;
  deaths: DeathCounts;
  records: RunRecords;
  cards: readonly CareerCard[];
};

/** One finished run, reduced to what the career fold needs. */
export type RunOutcome = {
  victory: boolean;
  deathCause: DeathCause | null;
  sectionsVisited: number;
  stats: RunStats;
};

export function emptyCareer(): CareerStats {
  return {
    runs: 0,
    wins: 0,
    sectionsVisited: 0,
    deaths: { assassin: 0, sniper: 0, watchtower: 0, caught: 0 },
    records: emptyRecords(),
    cards: [],
  };
}

export function runOutcome(
  reason: GameOverReason,
  stats: RunStats,
): RunOutcome {
  return {
    victory: reason.kind === "victory",
    deathCause: deathCauseOf(reason),
    sectionsVisited: stats.sectionsVisited.length,
    stats,
  };
}

export function deathCauseOf(reason: GameOverReason): DeathCause | null {
  switch (reason.kind) {
    case "assassin":
    case "sniper":
    case "watchtower":
    case "caught":
      return reason.kind;
    case "victory":
      return null;
  }
}

export function foldRun(career: CareerStats, run: RunOutcome): CareerStats {
  return {
    runs: career.runs + 1,
    wins: career.wins + (run.victory ? 1 : 0),
    sectionsVisited: career.sectionsVisited + run.sectionsVisited,
    deaths:
      run.deathCause === null
        ? career.deaths
        : countDeath(career.deaths, run.deathCause),
    records: foldRecords(career.records, run.stats.records),
    cards: foldCards(career.cards, run),
  };
}

function countDeath(deaths: DeathCounts, cause: DeathCause): DeathCounts {
  switch (cause) {
    case "assassin":
      return { ...deaths, assassin: deaths.assassin + 1 };
    case "sniper":
      return { ...deaths, sniper: deaths.sniper + 1 };
    case "watchtower":
      return { ...deaths, watchtower: deaths.watchtower + 1 };
    case "caught":
      return { ...deaths, caught: deaths.caught + 1 };
  }
}

function foldRecords(career: RunRecords, run: RunRecords): RunRecords {
  const least =
    career.leastCardsInDeck === null || run.leastCardsInDeck === null
      ? (career.leastCardsInDeck ?? run.leastCardsInDeck)
      : Math.min(career.leastCardsInDeck, run.leastCardsInDeck);
  return {
    mostCardsPlayedInTurn: Math.max(
      career.mostCardsPlayedInTurn,
      run.mostCardsPlayedInTurn,
    ),
    mostDistanceInTurn: Math.max(
      career.mostDistanceInTurn,
      run.mostDistanceInTurn,
    ),
    mostEnemiesKilledInTurn: Math.max(
      career.mostEnemiesKilledInTurn,
      run.mostEnemiesKilledInTurn,
    ),
    mostCurrencyHeld: Math.max(career.mostCurrencyHeld, run.mostCurrencyHeld),
    mostCurrencyEarnedInTurn: Math.max(
      career.mostCurrencyEarnedInTurn,
      run.mostCurrencyEarnedInTurn,
    ),
    mostCurrencySpentInTurn: Math.max(
      career.mostCurrencySpentInTurn,
      run.mostCurrencySpentInTurn,
    ),
    mostCardsInDeck: Math.max(career.mostCardsInDeck, run.mostCardsInDeck),
    leastCardsInDeck: least,
    mostUpgradedCardsInDeck: Math.max(
      career.mostUpgradedCardsInDeck,
      run.mostUpgradedCardsInDeck,
    ),
  };
}

/** Merge one run's per-card tallies into the career's, by card name. */
function foldCards(
  career: readonly CareerCard[],
  run: RunOutcome,
): readonly CareerCard[] {
  const byName = new Map<string, CareerCard>();
  for (const card of career) {
    byName.set(card.name, card);
  }
  for (const addition of runCardStats(run)) {
    const existing = byName.get(addition.name);
    byName.set(
      addition.name,
      existing === undefined ? addition : mergeCard(existing, addition),
    );
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The tallies one run contributes, one entry per card name it touched. */
function runCardStats(run: RunOutcome): CareerCard[] {
  const byName = new Map<string, CareerCard>();
  const ensure = (name: string): CareerCard => {
    const existing = byName.get(name);
    if (existing !== undefined) {
      return existing;
    }
    const fresh: CareerCard = {
      name,
      shownInShop: 0,
      shownInGift: 0,
      taken: 0,
      upgraded: 0,
      removed: 0,
      runsWithCard: 0,
      winsWithCard: 0,
      sectionsWithCard: 0,
    };
    byName.set(name, fresh);
    return fresh;
  };

  const held = new Set<string>();
  for (const record of run.stats.cards) {
    const card = ensure(record.name);
    card.taken += 1;
    card.upgraded += record.upgraded;
    if (record.removedTurn !== null) {
      card.removed += 1;
    }
    held.add(record.name);
  }
  for (const shown of run.stats.cardShown) {
    const card = ensure(shown.name);
    card.shownInShop += shown.shownInShop;
    card.shownInGift += shown.shownInGift;
  }
  for (const name of held) {
    const card = ensure(name);
    card.runsWithCard += 1;
    card.winsWithCard += run.victory ? 1 : 0;
    card.sectionsWithCard += run.sectionsVisited;
  }
  return [...byName.values()];
}

function mergeCard(a: CareerCard, b: CareerCard): CareerCard {
  return {
    name: a.name,
    shownInShop: a.shownInShop + b.shownInShop,
    shownInGift: a.shownInGift + b.shownInGift,
    taken: a.taken + b.taken,
    upgraded: a.upgraded + b.upgraded,
    removed: a.removed + b.removed,
    runsWithCard: a.runsWithCard + b.runsWithCard,
    winsWithCard: a.winsWithCard + b.winsWithCard,
    sectionsWithCard: a.sectionsWithCard + b.sectionsWithCard,
  };
}

export function winRate(career: CareerStats): number {
  return career.runs === 0 ? 0 : career.wins / career.runs;
}

export function averageSections(career: CareerStats): number {
  return career.runs === 0 ? 0 : career.sectionsVisited / career.runs;
}

export function cardWinRate(card: CareerCard): number {
  return card.runsWithCard === 0 ? 0 : card.winsWithCard / card.runsWithCard;
}

export function cardAverageSections(card: CareerCard): number {
  return card.runsWithCard === 0
    ? 0
    : card.sectionsWithCard / card.runsWithCard;
}
