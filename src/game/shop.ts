import type { Card, CardSpec, IdFactory, InventionPool } from "./cards";
import { RARITY_WEIGHT, SHOP_CATALOGUE, instantiate, instantiateTemporary } from "./cards";
import type { Rng } from "./rng";
import { nextRng } from "./rng";

/** How many cards a shop offers at once. */
export const SHOP_STOCK_SIZE = 4;

/** Draw one spec from `pool`, weighted by rarity. */
export function pickWeightedCard(
  pool: readonly CardSpec[],
  rng: Rng,
): { spec: CardSpec; rng: Rng } {
  const total = pool.reduce((sum, spec) => sum + RARITY_WEIGHT[spec.rarity], 0);
  if (total <= 0) {
    throw new Error("empty card pool");
  }
  const roll = nextRng(rng);
  let remaining = roll.value * total;
  for (const spec of pool) {
    remaining -= RARITY_WEIGHT[spec.rarity];
    if (remaining <= 0) {
      return { spec, rng: roll.rng };
    }
  }
  return { spec: pool[pool.length - 1], rng: roll.rng };
}

/**
 * Roll a fresh shop stock of `count` instantiated cards. Cards are drawn without
 * replacement, so a shop never offers the same card twice.
 */
export function rollShopStock(
  pool: readonly CardSpec[],
  count: number,
  rng: Rng,
  ids: IdFactory,
): { stock: Card[]; rng: Rng } {
  let current = rng;
  const remaining = [...pool];
  const stock: Card[] = [];
  for (let i = 0; i < count && remaining.length > 0; i += 1) {
    const rolled = pickWeightedCard(remaining, current);
    stock.push(instantiate(rolled.spec, ids()));
    current = rolled.rng;
    remaining.splice(remaining.indexOf(rolled.spec), 1);
  }
  return { stock, rng: current };
}

/** Roll a gain-card gift: uncommon and up only. */
export function rollGift(
  pool: readonly CardSpec[],
  rng: Rng,
): { spec: CardSpec; rng: Rng } {
  const eligible = pool.filter(
    (spec) => spec.rarity === "uncommon" || spec.rarity === "rare",
  );
  if (eligible.length === 0) {
    throw new Error("no eligible gift cards");
  }
  return pickWeightedCard(eligible, rng);
}

/**
 * Roll `count` distinct temporary cards for Invention, weighted by rarity. The
 * storage bins and Invention itself are excluded, so a conjured card can never
 * recurse or carry state. `pool` restricts the rarity: `uncommon-plus` is the
 * upgraded Invention's pool.
 */
export function rollTemporaryCards(
  count: number,
  pool: InventionPool,
  rng: Rng,
  ids: IdFactory,
): { cards: Card[]; rng: Rng } {
  const eligible = SHOP_CATALOGUE.filter(
    (spec) =>
      !spec.modes.some(
        (mode) =>
          mode.kind === "store" ||
          mode.kind === "unstore" ||
          mode.kind === "invention",
      ) &&
      (pool === "all" || spec.rarity === "uncommon" || spec.rarity === "rare"),
  );
  let current = rng;
  const remaining = [...eligible];
  const cards: Card[] = [];
  for (let i = 0; i < count && remaining.length > 0; i += 1) {
    const rolled = pickWeightedCard(remaining, current);
    cards.push(instantiateTemporary(rolled.spec, ids()));
    current = rolled.rng;
    remaining.splice(remaining.indexOf(rolled.spec), 1);
  }
  return { cards, rng: current };
}
