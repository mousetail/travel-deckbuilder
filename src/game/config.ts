/**
 * Feature flags for quick A/B experiments. Flip a constant, rebuild, and the
 * whole game follows — no behaviour lives anywhere else.
 */

/**
 * How enemy movement ramps up over a run:
 *
 * - `"card"` — the `Escalation` starting card drives the ramp: every enemy
 *   gains +1 movement for the turn it is played and +1/5 permanently. The turn
 *   number has no effect on enemy speed.
 * - `"turn"` — the original scheme: enemy movement grows with the turn number
 *   (assassins every 8 turns, snipers every 16) and the `Escalation` card is
 *   left out of the starting deck entirely.
 *
 * Flip this one value to compare the two difficulty curves.
 */
export type DifficultyScaling = "card" | "turn";

export const DIFFICULTY_SCALING: DifficultyScaling = "card";
