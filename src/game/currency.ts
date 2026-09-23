import type { GameState } from "./state";

export function gainCurrency(state: GameState, amount: number): GameState {
  if (amount < 0) {
    throw new Error("negative currency gain");
  }
  return { ...state, currency: state.currency + amount };
}

export function spendCurrency(state: GameState, amount: number): GameState {
  if (amount > state.currency) {
    throw new Error("cannot afford purchase");
  }
  return { ...state, currency: state.currency - amount };
}
