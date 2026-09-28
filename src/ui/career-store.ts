import type { CareerCard, CareerStats } from "../game/career";
import { emptyCareer } from "../game/career";

const STORAGE_KEY = "travel-card-game.career.v1";
const FORMAT = "career-v1";

/** A loose sentinel for an unmeasured `leastCardsInDeck`. */
const UNSET = -1;

export function loadCareer(): CareerStats {
  const raw = readStorage();
  return raw === null ? emptyCareer() : decode(raw);
}

export function saveCareer(career: CareerStats): void {
  writeStorage(encode(career));
}

/**
 * A newline-separated encoding: a format marker, one line each for the overall
 * counters and the records, then one line per card. Field order is fixed, and a
 * card's name is percent-encoded so it cannot introduce a delimiter.
 */
function encode(career: CareerStats): string {
  const d = career.deaths;
  const r = career.records;
  const lines = [
    FORMAT,
    [
      career.runs,
      career.wins,
      career.sectionsVisited,
      d.assassin,
      d.sniper,
      d.watchtower,
      d.caught,
    ].join(","),
    [
      r.mostCardsPlayedInTurn,
      r.mostDistanceInTurn,
      r.mostEnemiesKilledInTurn,
      r.mostCurrencyHeld,
      r.mostCurrencyEarnedInTurn,
      r.mostCurrencySpentInTurn,
      r.mostCardsInDeck,
      r.leastCardsInDeck ?? UNSET,
      r.mostUpgradedCardsInDeck,
    ].join(","),
  ];
  for (const card of career.cards) {
    lines.push(
      [
        encodeURIComponent(card.name),
        card.shownInShop,
        card.shownInGift,
        card.taken,
        card.upgraded,
        card.removed,
        card.runsWithCard,
        card.winsWithCard,
        card.sectionsWithCard,
      ].join(","),
    );
  }
  return lines.join("\n");
}

function decode(raw: string): CareerStats {
  const lines = raw.split("\n");
  const [marker, overallLine, recordsLine] = lines;
  if (marker !== FORMAT || overallLine === undefined || recordsLine === undefined) {
    return emptyCareer();
  }
  const overall = parseNumbers(overallLine.split(","), 7);
  const records = parseNumbers(recordsLine.split(","), 9);
  if (overall === null || records === null) {
    return emptyCareer();
  }
  const cards: CareerCard[] = [];
  for (const line of lines.slice(3)) {
    const card = decodeCard(line);
    if (card !== null) {
      cards.push(card);
    }
  }
  const least = numberAt(records, 7);
  return {
    runs: numberAt(overall, 0),
    wins: numberAt(overall, 1),
    sectionsVisited: numberAt(overall, 2),
    deaths: {
      assassin: numberAt(overall, 3),
      sniper: numberAt(overall, 4),
      watchtower: numberAt(overall, 5),
      caught: numberAt(overall, 6),
    },
    records: {
      mostCardsPlayedInTurn: numberAt(records, 0),
      mostDistanceInTurn: numberAt(records, 1),
      mostEnemiesKilledInTurn: numberAt(records, 2),
      mostCurrencyHeld: numberAt(records, 3),
      mostCurrencyEarnedInTurn: numberAt(records, 4),
      mostCurrencySpentInTurn: numberAt(records, 5),
      mostCardsInDeck: numberAt(records, 6),
      leastCardsInDeck: least < 0 ? null : least,
      mostUpgradedCardsInDeck: numberAt(records, 8),
    },
    cards,
  };
}

function decodeCard(line: string): CareerCard | null {
  const parts = line.split(",");
  const [name, ...numbers] = parts;
  if (name === undefined) {
    return null;
  }
  const values = parseNumbers(numbers, 8);
  if (values === null) {
    return null;
  }
  return {
    name: decodeURIComponent(name),
    shownInShop: numberAt(values, 0),
    shownInGift: numberAt(values, 1),
    taken: numberAt(values, 2),
    upgraded: numberAt(values, 3),
    removed: numberAt(values, 4),
    runsWithCard: numberAt(values, 5),
    winsWithCard: numberAt(values, 6),
    sectionsWithCard: numberAt(values, 7),
  };
}

/** Parse exactly `expected` non-negative integers, or null if any is invalid. */
function parseNumbers(
  parts: readonly string[],
  expected: number,
): number[] | null {
  if (parts.length !== expected) {
    return null;
  }
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