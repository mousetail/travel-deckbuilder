import type { Card } from "./cards";

export type Terrain =
  | "grass"
  | "forest"
  | "water"
  | "mountain"
  | "dirt"
  | "impassible";

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
  /** Turn index at which an assassin spawns here; -1 means never. */
  spawnTurn: number;
};