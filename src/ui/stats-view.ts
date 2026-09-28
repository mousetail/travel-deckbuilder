import type { CareerCard, CareerStats } from "../game/career";
import {
  averageSections,
  cardAverageSections,
  cardWinRate,
  winRate,
} from "../game/career";
import type { RunScores } from "../game/stats";
import { setChildren } from "./dom";
import { loadCareer } from "./career-store";
import { loadHistory } from "./stats-store";
import type { History } from "./stats-store";

type StatsTab = "Overall" | "Best run" | "Cards" | "Records";

const TABS: readonly StatsTab[] = ["Overall", "Best run", "Cards", "Records"];

/** The full-screen statistics screen shown from the main menu. */
export function renderStats(root: HTMLElement, onBack: () => void): void {
  const career = loadCareer();
  const history = loadHistory();

  const title = document.createElement("h1");
  title.classList.add("menu-title");
  title.textContent = "Statistics";

  const content = document.createElement("div");
  content.classList.add("stats-content");

  let active: StatsTab = "Overall";
  const tabButtons = TABS.map((tab) => {
    const button = document.createElement("button");
    button.classList.add("stats-tab");
    button.textContent = tab;
    button.addEventListener("click", () => {
      active = tab;
      update();
    });
    return button;
  });

  const tabBar = document.createElement("div");
  tabBar.classList.add("stats-tabs");
  setChildren(tabBar, tabButtons);

  const back = document.createElement("button");
  back.classList.add("menu-button");
  back.textContent = "Back";
  back.addEventListener("click", onBack);

  const update = (): void => {
    tabButtons.forEach((button, index) => {
      button.classList.toggle("stats-tab-active", TABS[index] === active);
    });
    setChildren(content, [tabContent(active, career, history)]);
  };
  update();

  const shell = document.createElement("div");
  shell.classList.add("stats-screen");
  setChildren(shell, [title, tabBar, content, back]);
  setChildren(root, [shell]);
}

function tabContent(
  tab: StatsTab,
  career: CareerStats,
  history: History,
): HTMLElement {
  switch (tab) {
    case "Overall":
      return overallTab(career);
    case "Best run":
      return bestRunTab(history);
    case "Cards":
      return cardsTab(career);
    case "Records":
      return recordsTab(career);
  }
}

function overallTab(career: CareerStats): HTMLElement {
  const summary = table(
    ["Stat", "Value"],
    [
      ["Runs played", `${career.runs}`],
      ["Wins", `${career.wins}`],
      [
        "Win rate",
        career.runs === 0 ? "—" : `${Math.round(winRate(career) * 100)}%`,
      ],
      [
        "Average sections visited",
        career.runs === 0 ? "—" : averageSections(career).toFixed(1),
      ],
    ],
  );
  const deaths = table(
    ["Cause of death", "Times"],
    [
      ["Assassin", `${career.deaths.assassin}`],
      ["Sniper", `${career.deaths.sniper}`],
      ["Watchtower", `${career.deaths.watchtower}`],
      ["Caught", `${career.deaths.caught}`],
    ],
  );
  return group([heading("Overall"), summary, heading("Deaths"), deaths]);
}

/** The best-ever and furthest-run columns of the game-over table. */
function bestRunTab(history: History): HTMLElement {
  const columns = ["Stat", "Best", "Furthest run"];
  const rows =
    history.kind === "none"
      ? SCORE_ROWS.map((row) => [row[0], "—", "—"])
      : SCORE_ROWS.map((row) => [
          row[0],
          `${row[1](history.best)}`,
          `${row[1](history.furthest.scores)}`,
        ]);
  return group([heading("Best and furthest run"), table(columns, rows)]);
}

const SCORE_ROWS: readonly (readonly [string, (scores: RunScores) => number])[] =
  [
    ["Tiles visited", (s) => s.tilesVisited],
    ["Cards played", (s) => s.cardsPlayed],
    ["Cards drawn", (s) => s.cardsDrawn],
    ["Enemies killed", (s) => s.enemiesKilled],
    ["Sites visited", (s) => s.sitesVisited],
    ["Currency gained", (s) => s.currencyGained],
    ["Currency spent", (s) => s.currencySpent],
  ];

function cardsTab(career: CareerStats): HTMLElement {
  if (career.cards.length === 0) {
    return group([heading("Cards"), note("No cards discovered yet.")]);
  }
  const rows = career.cards.map((card) => cardRow(card));
  return group([
    heading("Cards"),
    table(
      [
        "Card",
        "In shop",
        "In gift",
        "Taken",
        "Upgraded",
        "Removed",
        "Win rate",
        "Avg sections",
      ],
      rows,
    ),
  ]);
}

function cardRow(card: CareerCard): readonly string[] {
  return [
    card.name,
    `${card.shownInShop}`,
    `${card.shownInGift}`,
    `${card.taken}`,
    `${card.upgraded}`,
    `${card.removed}`,
    card.runsWithCard === 0
      ? "—"
      : `${Math.round(cardWinRate(card) * 100)}%`,
    card.runsWithCard === 0 ? "—" : cardAverageSections(card).toFixed(1),
  ];
}

function recordsTab(career: CareerStats): HTMLElement {
  const r = career.records;
  return group([
    heading("Records"),
    table(
      ["Record", "Best"],
      [
        ["Most cards played in a turn", `${r.mostCardsPlayedInTurn}`],
        ["Most distance covered in a turn", `${r.mostDistanceInTurn}`],
        ["Most enemies killed in a turn", `${r.mostEnemiesKilledInTurn}`],
        ["Most currency held at once", `${r.mostCurrencyHeld}`],
        ["Most currency earned in a turn", `${r.mostCurrencyEarnedInTurn}`],
        ["Most currency spent in a turn", `${r.mostCurrencySpentInTurn}`],
        ["Most cards in your deck", `${r.mostCardsInDeck}`],
        [
          "Fewest cards in your deck",
          r.leastCardsInDeck === null ? "—" : `${r.leastCardsInDeck}`,
        ],
        [
          "Most upgraded cards in your deck at once",
          `${r.mostUpgradedCardsInDeck}`,
        ],
      ],
    ),
  ]);
}

function table(
  headings: readonly string[],
  rows: readonly (readonly string[])[],
): HTMLTableElement {
  const table = document.createElement("table");
  table.classList.add("stats-table");

  const head = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const label of headings) {
    const cell = document.createElement("th");
    cell.textContent = label;
    headRow.append(cell);
  }
  head.append(headRow);

  const body = document.createElement("tbody");
  for (const row of rows) {
    const tr = document.createElement("tr");
    for (const value of row) {
      const cell = document.createElement("td");
      cell.textContent = value;
      tr.append(cell);
    }
    body.append(tr);
  }

  table.append(head, body);
  return table;
}

function group(nodes: readonly Node[]): HTMLElement {
  const element = document.createElement("div");
  element.classList.add("stats-group");
  setChildren(element, nodes);
  return element;
}

function heading(text: string): HTMLElement {
  const element = document.createElement("div");
  element.classList.add("overlay-title");
  element.textContent = text;
  return element;
}

function note(text: string): HTMLElement {
  const element = document.createElement("div");
  element.classList.add("stats-note");
  element.textContent = text;
  return element;
}