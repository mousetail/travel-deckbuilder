import { setChildren } from "./dom";
import shopUrl from "../images/shop.png";
import smithUrl from "../images/smith.png";
import removeCardUrl from "../images/map-icons/delete-card.svg";
import gainCardUrl from "../images/map-icons/add-card.svg";
import consumableUrl from "../images/map-icons/consumable.svg";
import coinUrl from "../images/card-icons/coin.svg";
import grassUrl from "../images/terrain-icons/grass.svg";
import treeUrl from "../images/terrain-icons/tree.svg";
import dropUrl from "../images/terrain-icons/drop.svg";
import rockUrl from "../images/terrain-icons/rock.svg";
import finishUrl from "../images/finish.png";
import assassinUrl from "../images/enemies/assasin.svg";
import sniperUrl from "../images/enemies/sniper.svg";
import watchtowerUrl from "../images/enemies/watchtower.svg";
import { DIFFICULTY_SCALING } from "../game/config";
import { ESCALATE_ICON, ESCALATE_TEMP_ICON } from "./card-icons";

type HelpEntry = {
  icon: string;
  name: string;
  description: string;
};

const UPGRADES: readonly HelpEntry[] = [
  {
    icon: shopUrl,
    name: "Shop",
    description: "Buy new cards.",
  },
  {
    icon: smithUrl,
    name: "Smith",
    description: "Upgrade your cards",
  },
  {
    icon: removeCardUrl,
    name: "Remove a card",
    description: "Remove a card from your deck.",
  },
  {
    icon: gainCardUrl,
    name: "Gain a card",
    description: "Option to take a free card.",
  },
  {
    icon: consumableUrl,
    name: "Consumable",
    description: "Take a consumable.",
  },
  {
    icon: coinUrl,
    name: "Coins",
    description: "Gain currency.",
  },
];

const ENEMIES: readonly HelpEntry[] = [
  {
    icon: assassinUrl,
    name: "Assassin",
    description: "Chases the player and kills at short range",
  },
  {
    icon: sniperUrl,
    name: "Sniper",
    description:
      "Stays away from the player and aims in certain direction. Can kill from any range.",
  },
  {
    icon: watchtowerUrl,
    name: "Watchtower",
    description: "Can kill the player if they end their turn in their radius.",
  },
];

/** The modal help panel: goal, controls, upgrade tiles, enemies and links. */
export class HelpView {
  private readonly layer: HTMLElement;
  private open = false;

  constructor(layer: HTMLElement) {
    this.layer = layer;
    this.layer.addEventListener("click", () => this.close());
  }

  toggle(): void {
    this.open = !this.open;
    this.render();
  }

  close(): void {
    this.open = false;
    this.render();
  }

  render(): void {
    if (!this.open) {
      setChildren(this.layer, []);
      return;
    }
    const panel = document.createElement("div");
    panel.classList.add("help-overlay");
    panel.addEventListener("click", (event) => event.stopPropagation());
    setChildren(panel, [
      this.header(),
      this.goalSection(),
      this.controlsSection(),
      this.upgradesSection(),
      this.enemiesSection(),
      this.linksSection(),
    ]);
    setChildren(this.layer, [panel]);
  }

  private header(): HTMLElement {
    const title = document.createElement("div");
    title.classList.add("help-title");
    title.textContent = "How to play";

    const close = document.createElement("button");
    close.classList.add("help-close");
    close.textContent = "Close";
    close.addEventListener("click", () => this.close());

    const header = document.createElement("div");
    header.classList.add("help-header");
    setChildren(header, [title, close]);
    return header;
  }

  private goalSection(): HTMLElement {
    const paragraphDivs = [
      `The goal of the game is to advance through the map and reach the finish before
      enemies catch up to you.`,
      [icon(finishUrl, "Finish")],
      `In order to move, you need to play a card matching the terrain type. Grass, Forest,
      Water, or Mountain`,
      [
        icon(grassUrl, "Grass"),
        icon(treeUrl, "Forest"),
        icon(dropUrl, "Water"),
        icon(rockUrl, "Mountain"),
      ],
      `The area with the red border marks the area an enemy could kill you at the end of
      their turn. It's save to move through as long as you don't end in it`,
      DIFFICULTY_SCALING === "card"
        ? `Enemy speed increases each time you play an escalation card`
        : "Enemy speed increases every turn",
      [
        icon(ESCALATE_ICON, "escalate"),
        icon(ESCALATE_TEMP_ICON, "escalate temp"),
      ],
    ].map((paragraph) => {
      if (typeof paragraph === "string") {
        const text = document.createElement("p");
        text.classList.add("help-text");
        text.textContent = paragraph;
        return text;
      } else {
        const icons = document.createElement("div");
        icons.classList.add("help-icons");
        setChildren(icons, paragraph);
        return icons;
      }
    });

    return section("Synopsis", paragraphDivs);
  }

  private controlsSection(): HTMLElement {
    const controls = document.createElement("div");
    controls.classList.add("help-controls");
    setChildren(controls, [
      controlText("Middle-click and drag to move the map."),
      controlText(
        "Right-click a card to discard it. You draw up to 4 cards each turn so discard cards if you don't intend to play them.",
      ),
    ]);
    return section("Controls", [controls]);
  }

  private upgradesSection(): HTMLElement {
    return section("Upgrade tiles", [entriesGrid(UPGRADES)]);
  }

  private enemiesSection(): HTMLElement {
    return section("Enemies", [entriesGrid(ENEMIES)]);
  }

  private linksSection(): HTMLElement {
    const links = document.createElement("div");
    links.classList.add("help-links");
    setChildren(links, [
      link("https://mousetail.nl/", "Website — mousetail.nl"),
      link("https://discord.gg/ugbfdgzpjK", "Discord"),
      link(
        "https://bsky.app/profile/themousetail.bsky.social",
        "Bluesky — @themousetail",
      ),
    ]);
    return section("Follow the game", [links]);
  }
}

function section(title: string, nodes: readonly Node[]): HTMLElement {
  const heading = document.createElement("div");
  heading.classList.add("help-section-title");
  heading.textContent = title;

  const element = document.createElement("div");
  element.classList.add("help-section");
  setChildren(element, [heading, ...nodes]);
  return element;
}

function icon(url: string, alt: string): HTMLImageElement {
  const image = document.createElement("img");
  image.classList.add("help-icon");
  image.src = url;
  image.alt = alt;
  return image;
}

function controlText(text: string): HTMLElement {
  const label = document.createElement("div");
  label.classList.add("help-control-text");
  label.textContent = text;
  return label;
}

function entriesGrid(entries: readonly HelpEntry[]): HTMLElement {
  const grid = document.createElement("div");
  grid.classList.add("help-upgrades");
  setChildren(
    grid,
    entries.map((entry) => entryRow(entry)),
  );
  return grid;
}

function entryRow(entry: HelpEntry): HTMLElement {
  const name = document.createElement("div");
  name.classList.add("help-upgrade-name");
  name.textContent = entry.name;

  const description = document.createElement("div");
  description.classList.add("help-upgrade-text");
  description.textContent = entry.description;

  const body = document.createElement("div");
  body.classList.add("help-upgrade-body");
  setChildren(body, [name, description]);

  const element = document.createElement("div");
  element.classList.add("help-upgrade");
  setChildren(element, [icon(entry.icon, ""), body]);
  return element;
}

function link(url: string, text: string): HTMLAnchorElement {
  const anchor = document.createElement("a");
  anchor.classList.add("help-link");
  anchor.href = url;
  anchor.target = "_blank";
  anchor.rel = "noopener noreferrer";
  anchor.textContent = text;
  return anchor;
}
