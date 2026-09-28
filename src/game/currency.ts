import type { GameState } from "./state";
import { countCurrencyGain, countCurrencySpend } from "./stats";
import type { CurrencyGainSource, CurrencySpendSink } from "./stats";

export function gainCurrency(
  state: GameState,
  amount: number,
  source: CurrencyGainSource,
): GameState {
  if (amount < 0) {
    throw new Error("negative currency gain");
  }
  return {
    ...state,
    currency: state.currency + amount,
    stats: countCurrencyGain(state.stats, source, amount),
  };
}

export function spendCurrency(
  state: GameState,
  amount: number,
  sink: CurrencySpendSink,
): GameState {
  if (amount > state.currency) {
    throw new Error("cannot afford purchase");
  }
  return {
    ...state,
    currency: state.currency - amount,
    stats: countCurrencySpend(state.stats, sink, amount),
  };
}
