import type { Terrain } from "./terrain";

export type CardMode =
  | { kind: "move"; terrain: Terrain; distance: number }
  | { kind: "attack"; range: number }
  | { kind: "draw-discard"; draw: number; discard: number }
  | { kind: "discard-hand"; threshold: number; draw: number }
  | { kind: "draw"; count: number }
  | { kind: "recover"; count: number }
  | { kind: "currency"; amount: number };

export type Rarity = "starting" | "common" | "uncommon" | "rare";

export type Card = {
  id: string;
  name: string;
  image: string;
  cost: number;
  rarity: Rarity;
  modes: readonly CardMode[];
};

export type CardSpec = {
  name: string;
  image: string;
  cost: number;
  rarity: Rarity;
  modes: readonly CardMode[];
};

export type IdFactory = () => string;