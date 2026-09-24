import type { Card } from "./cards";
import grassUrl from "../images/grass.png";
import forestUrl from "../images/jungle.png";
import waterUrl from "../images/water.png";
import mountainUrl from "../images/mountain.png";
import dirtUrl from "../images/village.png";
import impassibleUrl from "../images/impassible.png";
import shopUrl from "../images/shop.png";
import smithUrl from "../images/smith.png";
import removeCardUrl from "../images/remove-card.png";
import gainCardUrl from "../images/gain-card.png";

export type Terrain =
  | "grass"
  | "forest"
  | "water"
  | "mountain"
  | "dirt"
  | "impassible";

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
};

/**
 * A movement card printed with `cardTerrain` may enter `terrain`.
 * Dirt is universally passable; impassible never is.
 */
export function canEnter(terrain: Terrain, cardTerrain: Terrain): boolean {
  if (terrain === "impassible") {
    return false;
  }
  if (terrain === "dirt") {
    return true;
  }
  return terrain === cardTerrain;
}

export type TileFeature =
  | { kind: "none" }
  | { kind: "shop"; stock: readonly Card[]; rerollCost: number }
  | { kind: "smith" }
  | { kind: "remove-card" }
  | { kind: "gain-card" }
  | { kind: "coin"; value: number };

export type Tile = {
  terrain: Terrain;
  feature: TileFeature;
  /**
   * Turns after the player enters this tile's section that an assassin spawns
   * here; -1 means never. Fixed at generation, and the timer only starts when
   * the section is entered (chapter 05).
   */
  spawnDelay: number;
  /** Absolute turn the armed timer fires; -1 until the section is entered. */
  spawnTurn: number;
};

export function emptyTile(terrain: Terrain, spawnDelay: number): Tile {
  return { terrain, feature: { kind: "none" }, spawnDelay, spawnTurn: -1 };
}

/** How a feature is drawn over its hex. */
export type FeatureVisual =
  | { kind: "none" }
  | { kind: "image"; url: string }
  | { kind: "coin" };

/**
 * The overlay for a tile feature. There is no `coin.png`, so the coin is drawn
 * as a CSS badge instead; every other feature has pixel-art of its own.
 */
export function featureVisual(feature: TileFeature): FeatureVisual {
  switch (feature.kind) {
    case "none":
      return { kind: "none" };
    case "coin":
      return { kind: "coin" };
    case "shop":
      return { kind: "image", url: shopUrl };
    case "smith":
      return { kind: "image", url: smithUrl };
    case "remove-card":
      return { kind: "image", url: removeCardUrl };
    case "gain-card":
      return { kind: "image", url: gainCardUrl };
  }
}