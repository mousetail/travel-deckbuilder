import type { Card, CardSpec, IdFactory } from "./cards";
import { RARITY_WEIGHT, instantiate } from "./cards";
import type { Rng } from "./rng";
import { nextRng } from "./rng";

/** How many cards a shop offers at once. */
export const SHOP_STOCK_SIZE = 3;

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

/** Roll a fresh shop stock of `count` instantiated cards. */
export function rollShopStock(
  pool: readonly CardSpec[],
  count: number,
  rng: Rng,
  ids: IdFactory,
): { stock: Card[]; rng: Rng } {
  let current = rng;
  const stock: Card[] = [];
  for (let i = 0; i < count; i += 1) {
    const rolled = pickWeightedCard(pool, current);
    stock.push(instantiate(rolled.spec, ids()));
    current = rolled.rng;
  }
  return { stock, rng: current };
}

/** Roll a gain-card gift: uncommon and up only. */
export function rollGift(
  pool: readonly CardSpec[],
  rng: Rng,
): { spec: CardSpec; rng: Rng } {
  const eligible = pool.filter((spec) => spec.rarity === "uncommon" || spec.rarity === "rare");
  if (eligible.length === 0) {
    throw new Error("no eligible gift cards");
  }
  return pickWeightedCard(eligible, rng);
}
