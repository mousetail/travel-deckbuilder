export type Rng = {
  seed: number;
};

export function nextRng(rng: Rng): { value: number; rng: Rng } {
  // mulberry32
  const seed = (rng.seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, rng: { seed } };
}

export function pick<T>(rng: Rng, items: readonly T[]): { item: T; rng: Rng } {
  if (items.length === 0) {
    throw new Error("pick from empty list");
  }
  const roll = nextRng(rng);
  const index = Math.floor(roll.value * items.length);
  return { item: items[index], rng: roll.rng };
}

/** Fisher–Yates shuffle, threading the RNG so the order stays reproducible. */
export function shuffle<T>(items: readonly T[], rng: Rng): { items: T[]; rng: Rng } {
  const result = [...items];
  let current = rng;
  for (let i = result.length - 1; i > 0; i -= 1) {
    const roll = nextRng(current);
    current = roll.rng;
    const j = Math.floor(roll.value * (i + 1));
    const tmp = result[i];
    result[i] = result[j];
    result[j] = tmp;
  }
  return { items: result, rng: current };
}