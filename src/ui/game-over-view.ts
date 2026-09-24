import type { Card } from "../game/cards";
import { allCards } from "../game/deck";
import { cardDetails, runScores, usageExtremes } from "../game/stats";
import type {
  CardDetail,
  CardOrigin,
  CardUsage,
  RunScores,
  RunStats,
} from "../game/stats";
import type { GameOverReason, GameState } from "../game/state";
import { NOT_IN_HAND, cardWithCaption } from "./card-view";
import { setChildren } from "./dom";
import type { History } from "./stats-store";

/** A card must be seen at least this often before it counts toward usage. */
const MIN_DRAWS = 3;

const STATS: readonly { label: string; pick: (scores: RunScores) => number }[] =
  [
    { label: "Tiles visited", pick: (scores) => scores.tilesVisited },
    { label: "Cards played", pick: (scores) => scores.cardsPlayed },
    { label: "Cards drawn", pick: (scores) => scores.cardsDrawn },
    { label: "Enemies killed", pick: (scores) => scores.enemiesKilled },
    { label: "Sites visited", pick: (scores) => scores.sitesVisited },
  ];

/**
 * The end-of-run panel: the reason the run ended, this run's headline numbers
 * beside the best-ever and furthest-run columns (from `history`, i.e. runs
 * before this one), the most and least played cards, and an expandable table of
 * every card acquired (removed cards included, and marked).
 */
export function gameOverPanel(
  reason: GameOverReason,
  state: GameState,
  history: History,
  onRestart: () => void,
): HTMLElement {
  const cards = allCards(state.deck);
  const scores = runScores(state.stats);

  const message = document.createElement("div");
  message.classList.add("feature-text");
  message.textContent = gameOverText(reason);

  const details = detailsSection(cards, state.stats);
  details.hidden = true;

  const moreButton = document.createElement("button");
  moreButton.classList.add("hud-button");
  moreButton.textContent = "More stats";
  moreButton.addEventListener("click", () => {
    details.hidden = !details.hidden;
    moreButton.textContent = details.hidden ? "More stats" : "Fewer stats";
  });

  const playAgain = document.createElement("button");
  playAgain.classList.add("hud-button");
  playAgain.textContent = "Play again";
  playAgain.addEventListener("click", onRestart);

  const buttons = document.createElement("div");
  buttons.classList.add("game-over-buttons");
  setChildren(buttons, [moreButton, playAgain]);

  const panel = document.createElement("div");
  panel.classList.add("overlay");
  setChildren(panel, [
    title("Game over"),
    message,
    statsTable(scores, history),
    usageSection(cards, state.stats),
    details,
    buttons,
  ]);
  return panel;
}

function statsTable(scores: RunScores, history: History): HTMLElement {
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
  for (const stat of STATS) {
    const row = document.createElement("tr");

    const name = document.createElement("td");
    name.textContent = stat.label;

    const current = document.createElement("td");
    current.classList.add("stat-current");
    current.textContent = `${stat.pick(scores)}`;

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

function usageSection(cards: readonly Card[], stats: RunStats): HTMLElement {
  const extremes = usageExtremes(cards, stats, MIN_DRAWS);
  const section = document.createElement("div");
  section.classList.add("usage");
  setChildren(section, [
    usageBlock("Most used card", extremes.most),
    usageBlock("Least used card", extremes.least),
  ]);
  return section;
}

function usageBlock(heading: string, usage: CardUsage | null): HTMLElement {
  const block = document.createElement("div");
  block.classList.add("usage-block");

  const label = document.createElement("div");
  label.classList.add("usage-heading");
  label.textContent = heading;

  const nodes: Node[] = [label];
  if (usage === null) {
    const empty = document.createElement("div");
    empty.classList.add("usage-empty");
    empty.textContent = `No card drawn ${MIN_DRAWS}+ times`;
    nodes.push(empty);
  } else {
    nodes.push(
      cardWithCaption(
        usage.card,
        { index: 0, count: 1, viewOnly: true },
        NOT_IN_HAND,
        `Played ${usage.played} times · drawn ${usage.drawn} times`,
      ),
    );
  }
  setChildren(block, nodes);
  return block;
}

function detailsSection(cards: readonly Card[], stats: RunStats): HTMLElement {
  const section = document.createElement("div");
  section.classList.add("more-stats");

  const label = document.createElement("div");
  label.classList.add("overlay-title");
  label.textContent = "Every card";

  const table = document.createElement("table");
  table.classList.add("stats-table");

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const heading of [
    "Card",
    "Acquired",
    "Turn",
    "Drawn",
    "Played",
    "Status",
  ]) {
    const cell = document.createElement("th");
    cell.textContent = heading;
    headRow.append(cell);
  }
  head.append(headRow);

  const body = document.createElement("tbody");
  for (const detail of cardDetails(cards, stats)) {
    body.append(detailRow(detail));
  }

  table.append(head, body);
  setChildren(section, [label, table]);
  return section;
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
  turn.textContent = `Turn ${detail.acquiredTurn}`;

  const drawn = document.createElement("td");
  drawn.textContent = `${detail.drawn}`;

  const played = document.createElement("td");
  played.textContent = `${detail.played}`;

  const status = document.createElement("td");
  status.textContent = detail.removed ? "Removed" : "In deck";

  row.append(name, acquired, turn, drawn, played, status);
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
