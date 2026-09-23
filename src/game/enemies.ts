import type { HexCoord } from "./hex";

export type Assassin = {
  kind: "assassin";
  id: string;
  position: HexCoord;
  /** Movement points available each enemy turn. */
  movement: number;
};

export type Sniper = {
  kind: "sniper";
  id: string;
  position: HexCoord;
  /** Lethal radius in hexes. */
  radius: number;
};

export type Enemy = Assassin | Sniper;