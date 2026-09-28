import type { Card } from "../game/cards";
import { allCards } from "../game/deck";
import { cardDetails, runScores, usageExtremes } from "../game/stats";
import type {
  CardDetail,
  CardOrigin,
  CardUsage,
  CurrencyLedger,
  RunScores,
  RunStats,
} from "../game/stats";
import type { GameOverReason, GameState } from "../game/state";
import { cardWithCaption } from "./card-view";
import { setChildren } from "./dom";
import type { History } from "./stats-store";

/** A card must be seen at least this often before it counts toward usage. */
const MIN_DRAWS = 3;

/** A row of the headline stats table; a `link` row opens the finance modal. */
type StatRow =
  | { kind: "plain"; label: string; pick: (scores: RunScores) => number }
  | {
      kind: "link";
      label: string;
      pick: (scores: RunScores) => number;
      onOpen: () => void;
    };

/**
 * The end-of-run panel: the reason the run ended, this run's headline numbers
 * beside the best-ever and furthest-run columns (from `history`, i.e. runs
 * before this one), the most played and most discarded cards, and buttons that
 * open the card and finance modals. The currency rows and the usage cards are
 * themselves shortcuts into those modals.
 */
export function gameOverPanel(
  reason: GameOverReason,
  state: GameState,
  history: History,
  onRestart: () => void,
  onOpenCards: () => void,
  onOpenFinance: () => void,
): HTMLElement {
  const cards = allCards(state.deck);
  const scores = runScores(state.stats);

  const message = document.createElement("div");
  message.classList.add("feature-text");
  message.textContent = gameOverText(reason);

  const buttons = document.createElement("div");
  buttons.classList.add("game-over-buttons");
  const cardStats = button("card stats", onOpenCards);
  cardStats.classList.add("feature-button");
  const playAgain = button("Play again", onRestart);
  playAgain.classList.add("feature-button");
  setChildren(buttons, [cardStats, playAgain]);

  const panel = document.createElement("div");
  panel.classList.add("overlay");
  setChildren(panel, [
    title("Game over"),
    message,
    statsTable(scores, history, onOpenFinance),
    button("finance stats", onOpenFinance),
    usageSection(cards, state.stats, onOpenCards),
    buttons,
  ]);
  return panel;
}

/** The full per-card table, shown as a modal over the end-of-run panel. */
export function cardStatsPanel(
  cards: readonly Card[],
  stats: RunStats,
  finalTurn: number,
  onClose: () => void,
): HTMLElement {
  const panel = document.createElement("div");
  panel.classList.add("overlay", "overlay-confirm");
  setChildren(panel, [
    title("card stats"),
    cardTable(cards, stats, finalTurn),
    button("Close", onClose),
  ]);
  return panel;
}

/** The coin ledger breakdown, shown as a modal over the end-of-run panel. */
export function financeStatsPanel(
  ledger: CurrencyLedger,
  onClose: () => void,
): HTMLElement {
  const panel = document.createElement("div");
  panel.classList.add("overlay", "overlay-confirm");
  setChildren(panel, [
    title("Finance"),
    currencyBreakdown(ledger),
    button("Close", onClose),
  ]);
  return panel;
}

function statsTable(
  scores: RunScores,
  history: History,
  onOpenFinance: () => void,
): HTMLElement {
  const rows: readonly StatRow[] = [
    { kind: "plain", label: "Tiles visited", pick: (s) => s.tilesVisited },
    { kind: "plain", label: "Cards played", pick: (s) => s.cardsPlayed },
    { kind: "plain", label: "Cards drawn", pick: (s) => s.cardsDrawn },
    { kind: "plain", label: "Enemies killed", pick: (s) => s.enemiesKilled },
    { kind: "plain", label: "Sites visited", pick: (s) => s.sitesVisited },
    {
      kind: "link",
      label: "Currency gained",
      pick: (s) => s.currencyGained,
      onOpen: onOpenFinance,
    },
    {
      kind: "link",
      label: "Currency spent",
      pick: (s) => s.currencySpent,
      onOpen: onOpenFinance,
    },
  ];

  const table = document.createElement("table");
  table.classList.add("stats-table");

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of ["Stat", "This run", "Best", "Furthest run"]) {
    const cell = document.createElement("th");
    cell.textContent = label;
    headRow.append(cell);
  }
  head.append(headRow);

  const body = document.createElement("tbody");
  for (const stat of rows) {
    const row = document.createElement("tr");

    const name = document.createElement("td");
    if (stat.kind === "link") {
      const link = document.createElement("button");
      link.classList.add("stat-link");
      link.textContent = stat.label;
      link.addEventListener("click", stat.onOpen);
      name.append(link);
    } else {
      name.textContent = stat.label;
    }

    const value = stat.pick(scores);
    const current = document.createElement("td");
    current.classList.add("stat-current");
    if (isNewBest(history, stat.pick, value)) {
      current.classList.add("stat-best");
    }
    current.textContent = `${value}`;

    const past = pastValues(history, stat.pick);
    const best = document.createElement("td");
    best.classList.add("stat-past");
    best.textContent = past.best;

    const furthest = document.createElement("td");
    furthest.classList.add("stat-past");
    furthest.textContent = past.furthest;

    row.append(name, current, best, furthest);
    body.append(row);
  }

  table.append(head, body);
  return table;
}

/** Whether this run's value beats the best of every run before it. */
function isNewBest(
  history: History,
  pick: (scores: RunScores) => number,
  value: number,
): boolean {
  return history.kind === "records" && value > pick(history.best);
}

/** The best-ever and furthest-run values for one category, or dashes. */
function pastValues(
  history: History,
  pick: (scores: RunScores) => number,
): { best: string; furthest: string } {
  switch (history.kind) {
    case "none":
      return { best: "—", furthest: "—" };
    case "records":
      return {
        best: `${pick(history.best)}`,
        furthest: `${pick(history.furthest.scores)}`,
      };
  }
}

function usageSection(
  cards: readonly Card[],
  stats: RunStats,
  onOpenCards: () => void,
): HTMLElement {
  const extremes = usageExtremes(cards, stats, MIN_DRAWS);
  const section = document.createElement("div");
  section.classList.add("usage");
  setChildren(section, [
    usageBlock(
      "Most played card",
      extremes.most,
      `No card drawn ${MIN_DRAWS}+ times`,
      onOpenCards,
    ),
    usageBlock(
      "Most discarded card",
      extremes.mostDiscarded,
      "No card discarded",
      onOpenCards,
    ),
  ]);
  return section;
}

function usageBlock(
  heading: string,
  usage: CardUsage | null,
  emptyText: string,
  onOpen: () => void,
): HTMLElement {
  const block = document.createElement("div");
  block.classList.add("usage-block");

  const label = document.createElement("div");
  label.classList.add("usage-heading");
  label.textContent = heading;

  const nodes: Node[] = [label];
  if (usage === null) {
    const empty = document.createElement("div");
    empty.classList.add("usage-empty");
    empty.textContent = emptyText;
    nodes.push(empty);
  } else {
    const card = cardWithCaption(
      usage.card,
      { index: 0, count: 1, viewOnly: true },
      `Played ${usage.played} · Discarded ${usage.discarded}`,
    );
    card.classList.add("usage-card");
    card.addEventListener("click", onOpen);
    nodes.push(card);
  }
  setChildren(block, nodes);
  return block;
}

function currencyBreakdown(ledger: CurrencyLedger): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.classList.add("currency-breakdown");
  setChildren(wrapper, [
    breakdownTable("Earned", [
      ["From cards", ledger.gainedFromCards],
      ["From combat", ledger.gainedFromCombat],
      ["From skipping turns", ledger.gainedFromSkips],
      ["From coin spaces", ledger.gainedFromCoins],
      ["Starting currency", ledger.starting],
    ]),
    breakdownTable("Spent", [
      ["On cards", ledger.spentOnCards],
      ["In shops", ledger.spentInShops],
    ]),
  ]);
  return wrapper;
}

function breakdownTable(
  heading: string,
  rows: readonly (readonly [string, number])[],
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.classList.add("finance-table-wrap");

  const label = document.createElement("div");
  label.classList.add("overlay-title");
  label.textContent = heading;

  const table = document.createElement("table");
  table.classList.add("stats-table", "finance-table");

  const body = document.createElement("tbody");
  for (const [name, value] of [...rows].sort((a, b) => b[1] - a[1])) {
    const row = document.createElement("tr");
    const nameCell = document.createElement("td");
    nameCell.textContent = name;
    const amountCell = document.createElement("td");
    amountCell.textContent = `${value}`;
    row.append(nameCell, amountCell);
    body.append(row);
  }

  table.append(body);
  setChildren(wrapper, [label, table]);
  return wrapper;
}

function cardTable(
  cards: readonly Card[],
  stats: RunStats,
  finalTurn: number,
): HTMLElement {
  const table = document.createElement("table");
  table.classList.add("stats-table");

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const heading of ["Card", "Acquired", "Turn", "Discarded", "Played"]) {
    const cell = document.createElement("th");
    cell.textContent = heading;
    headRow.append(cell);
  }
  head.append(headRow);

  const body = document.createElement("tbody");
  for (const detail of cardDetails(cards, stats, finalTurn)) {
    body.append(detailRow(detail));
  }

  table.append(head, body);
  return table;
}

function detailRow(detail: CardDetail): HTMLElement {
  const row = document.createElement("tr");
  if (detail.removed) {
    row.classList.add("card-removed");
  }

  const name = document.createElement("td");
  name.textContent = detail.name;

  const acquired = document.createElement("td");
  acquired.textContent = originText(detail.origin);

  const turn = document.createElement("td");
  turn.textContent = `${detail.acquiredTurn}-${detail.lastTurn}`;

  const discarded = document.createElement("td");
  discarded.textContent = `${detail.discarded}`;

  const played = document.createElement("td");
  played.textContent = `${detail.played}`;

  row.append(name, acquired, turn, discarded, played);
  return row;
}

function originText(origin: CardOrigin): string {
  switch (origin.kind) {
    case "starting":
      return "Starting deck";
    case "shop":
      return `Shop (${origin.cost})`;
    case "gift":
      return "Gift";
  }
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.classList.add("hud-button");
  element.textContent = text;
  element.addEventListener("click", onClick);
  return element;
}

function title(text: string): HTMLElement {
  const element = document.createElement("div");
  element.classList.add("overlay-title");
  element.textContent = text;
  return element;
}

function gameOverText(reason: GameOverReason): string {
  switch (reason.kind) {
    case "assassin":
      return "An assassin caught you.";
    case "sniper":
      return "A sniper shot you down.";
    case "caught":
      return "You were caught.";
  }
}
