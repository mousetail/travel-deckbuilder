import type { Card } from "./cards";
import { hexKey } from "./hex";
import type { GameState } from "./state";
import grassUrl from "../images/grass.png";
import forestUrl from "../images/jungle.png";
import waterUrl from "../images/water.png";
import mountainUrl from "../images/mountain.png";
import dirtUrl from "../images/village.png";
import impassibleUrl from "../images/impassible.png";
import shopUrl from "../images/shop.png";
import smithUrl from "../images/smith.png";
import removeCardUrl from "../images/map-icons/delete-card.svg";
import gainCardUrl from "../images/map-icons/add-card.svg";
import coinUrl from "../images/card-icons/coin.svg";
import grassIconUrl from "../images/terrain-icons/grass.svg";
import treeUrl from "../images/terrain-icons/tree.svg";
import dropUrl from "../images/terrain-icons/drop.svg";
import rockUrl from "../images/terrain-icons/rock.svg";
import houseUrl from "../images/terrain-icons/house.png";
import targetUrl from "../images/terrain-icons/target.png";
import moonUrl from "../images/terrain-icons/moon.svg";
import finishUrl from "../images/finish.png";

export type Terrain =
  "grass" | "forest" | "water" | "mountain" | "dirt" | "impassible" | "finish";

/** Terrain that a card can be printed with, hardest last. */
export const CARD_TERRAINS: readonly Terrain[] = [
  "grass",
  "forest",
  "water",
  "mountain",
];

export const TERRAIN_TEXTURE: Record<Terrain, string> = {
  grass: grassUrl,
  forest: forestUrl,
  water: waterUrl,
  mountain: mountainUrl,
  dirt: dirtUrl,
  impassible: impassibleUrl,
  finish: finishUrl,
};

/**
 * The icon for each terrain, drawn on the tile and on movement cards.
 * Impassible has none: an icon shows the cost of crossing, and impassible
 * cannot be crossed at any cost.
 */
export const TERRAIN_ICON: Record<Terrain, string | null> = {
  grass: grassIconUrl,
  forest: treeUrl,
  water: dropUrl,
  mountain: rockUrl,
  dirt: houseUrl,
  impassible: null,
  finish: null,
};

/** Icon for attack cards: the target reticle. */
export const ATTACK_ICON = targetUrl;

/** Icon for sleeping: a moon, shown wherever a sleep amount is printed. */
export const SLEEP_ICON = moonUrl;

/**
 * A movement card printed with `cardTerrain` may enter `terrain`.
 * Dirt and the finish are universally passable; impassible never is.
 */
export function canEnter(terrain: Terrain, cardTerrain: Terrain): boolean {
  if (terrain === "impassible") {
    return false;
  }
  if (terrain === "dirt" || terrain === "finish") {
    return true;
  }
  return terrain === cardTerrain;
}

/** Whether the player is standing on a finish tile, which wins the run. */
export function playerOnFinish(state: GameState): boolean {
  const tile = state.map.tiles.get(hexKey(state.map.player));
  return tile !== undefined && tile.terrain === "finish";
}

export type TileFeature =
  | { kind: "none" }
  | { kind: "shop"; stock: readonly (Card | null)[]; rerollCost: number }
  | { kind: "smith" }
  | { kind: "remove-card" }
  | { kind: "gain-card"; card: Card | null }
  | { kind: "coin"; value: number }
  /** Rolled into one of `options` when the section is placed; never in play. */
  | { kind: "random"; tier: UpgradeTier; options: readonly TileFeature[] };

/** The difficulty tier of a random upgrade. */
export type UpgradeTier = "common" | "uncommon" | "rare";

/** The kinds of enemy that can be authored to spawn on a tile. */
export type EnemyKind = "assassin" | "sniper" | "watchtower";

export type Tile = {
  terrain: Terrain;
  /** Movement points to cross this tile; also the number of icons shown. */
  cost: number;
  feature: TileFeature;
  /** Which enemy spawns here, or null for none. */
  spawnKind: EnemyKind | null;
  /**
   * Turns after the player enters this tile's section that the enemy spawns
   * here; -1 means never. Fixed at generation, and the timer only starts when
   * the section is entered (chapter 05).
   */
  spawnDelay: number;
  /** Absolute turn the enemy appears; -1 until the section is entered. */
  spawnTurn: number;
};

export function emptyTile(terrain: Terrain, spawnDelay: number): Tile {
  return {
    terrain,
    cost: 1,
    feature: { kind: "none" },
    spawnKind: null,
    spawnDelay,
    spawnTurn: -1,
  };
}

/** How a feature is drawn over its hex. */
export type FeatureVisual =
  | { kind: "none" }
  | { kind: "image"; url: string }
  | { kind: "random"; tier: UpgradeTier };

/** The overlay for a tile feature. */
export function featureVisual(feature: TileFeature): FeatureVisual {
  switch (feature.kind) {
    case "none":
      return { kind: "none" };
    case "coin":
      return { kind: "image", url: coinUrl };
    case "shop":
      return { kind: "image", url: shopUrl };
    case "smith":
      return { kind: "image", url: smithUrl };
    case "remove-card":
      return { kind: "image", url: removeCardUrl };
    case "gain-card":
      return { kind: "image", url: gainCardUrl };
    case "random":
      return { kind: "random", tier: feature.tier };
  }
}

/** One icon drawn on a tile. */
export type TileIcon =
  | { kind: "image"; url: string }
  | { kind: "terrain"; url: string }
  | { kind: "random"; tier: UpgradeTier };

/**
 * The icons of a tile: `cost` copies of the terrain's cost icon, then the
 * feature's. A list so a tile can later carry several icons (harder terrain).
 */
export function tileIcons(
  terrain: Terrain,
  cost: number,
  feature: TileFeature,
): readonly TileIcon[] {
  const icons: TileIcon[] = [];
  const terrainIcon = TERRAIN_ICON[terrain];
  if (terrainIcon !== null) {
    for (let i = 0; i < cost; i += 1) {
      icons.push({ kind: "terrain", url: terrainIcon });
    }
  }
  const visual = featureVisual(feature);
  switch (visual.kind) {
    case "none":
      break;
    case "image":
      icons.push({ kind: "image", url: visual.url });
      break;
    case "random":
      icons.push({ kind: "random", tier: visual.tier });
      break;
  }
  return icons;
}
