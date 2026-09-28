import type { GameState } from "./state";
import {
  countCurrencyGain,
  countCurrencySpend,
  recordCurrencyEarnedInTurn,
  recordCurrencyHeld,
  recordCurrencySpentInTurn,
} from "./stats";
import type { CurrencyGainSource, CurrencySpendSink } from "./stats";

export function gainCurrency(
  state: GameState,
  amount: number,
  source: CurrencyGainSource,
): GameState {
  if (amount < 0) {
    throw new Error("negative currency gain");
  }
  const earnedThisTurn = state.turnState.currencyEarnedThisTurn + amount;
  const currency = state.currency + amount;
  const stats = recordCurrencyHeld(
    recordCurrencyEarnedInTurn(
      countCurrencyGain(state.stats, source, amount),
      earnedThisTurn,
    ),
    currency,
  );
  return {
    ...state,
    currency,
    stats,
    turnState: { ...state.turnState, currencyEarnedThisTurn: earnedThisTurn },
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
  const spentThisTurn = state.turnState.currencySpentThisTurn + amount;
  return {
    ...state,
    currency: state.currency - amount,
    stats: recordCurrencySpentInTurn(
      countCurrencySpend(state.stats, sink, amount),
      spentThisTurn,
    ),
    turnState: { ...state.turnState, currencySpentThisTurn: spentThisTurn },
  };
}
