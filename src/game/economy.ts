import type { Card, CardMode } from "./cards";
import { SHOP_CATALOGUE, instantiate } from "./cards";
import type { Deck } from "./deck";
import { addPurchase } from "./deck";
import { hexKey } from "./hex";
import type { HexCoord } from "./hex";
import { SHOP_STOCK_SIZE, rollGift, rollShopStock } from "./shop";
import type { GameState } from "./state";
import type { TileFeature } from "./terrain";
import { endTurn } from "./turn";

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

export type EndTurnAction =
  | { kind: "end-turn" }
  | { kind: "use-feature"; feature: TileFeature };

/** What the end-turn button should do, given the feature under the player. */
export function endTurnAction(feature: TileFeature): EndTurnAction {
  if (feature.kind === "none") {
    return { kind: "end-turn" };
  }
  return { kind: "use-feature", feature };
}

/** The feature on the tile the player is standing on. */
export function playerFeature(state: GameState): TileFeature {
  const tile = state.map.tiles.get(hexKey(state.map.player));
  return tile === undefined ? { kind: "none" } : tile.feature;
}

/** Replace the feature on `coord` with the empty feature. */
function consumeFeatureAt(state: GameState, coord: HexCoord): GameState {
  const key = hexKey(coord);
  const tile = state.map.tiles.get(key);
  if (tile === undefined) {
    return state;
  }
  const tiles = new Map(state.map.tiles);
  tiles.set(key, { ...tile, feature: { kind: "none" } });
  return { ...state, map: { ...state.map, tiles } };
}

/** Write a shop's stock back to its tile so it survives leaving and returning. */
function withShopStock(state: GameState, stock: readonly Card[]): GameState {
  const key = hexKey(state.map.player);
  const tile = state.map.tiles.get(key);
  if (tile === undefined || tile.feature.kind !== "shop") {
    return state;
  }
  const tiles = new Map(state.map.tiles);
  tiles.set(key, {
    ...tile,
    feature: { kind: "shop", stock, rerollCost: tile.feature.rerollCost },
  });
  return { ...state, map: { ...state.map, tiles } };
}

/** Using a feature ends the turn, so every modal phase funnels through here. */
function finishFeature(state: GameState): GameState {
  return endTurn({ ...state, phase: { kind: "playing" } });
}

/**
 * The "use feature" action: enter the feature's phase, or resolve it at once.
 * A coin pays out and ends the turn; shops, smiths, removal and gains open a
 * modal phase whose own action ends the turn.
 */
export function useFeature(state: GameState): GameState {
  if (state.phase.kind !== "playing") {
    return state;
  }
  const feature = playerFeature(state);
  switch (feature.kind) {
    case "none":
      return endTurn(state);
    case "coin":
      return endTurn(collectCoin(state, state.map.player));
    case "shop":
      return {
        ...state,
        phase: { kind: "shop", stock: feature.stock, rerollCost: feature.rerollCost },
      };
    case "smith":
      return { ...state, phase: { kind: "smith" } };
    case "remove-card":
      return { ...state, phase: { kind: "pending-remove" } };
    case "gain-card": {
      const rolled = rollGift(SHOP_CATALOGUE, state.rng);
      return { ...state, rng: rolled.rng, phase: { kind: "pending-gain", spec: rolled.spec } };
    }
  }
}

export function buyCard(state: GameState, card: Card): GameState {
  if (state.phase.kind !== "shop") {
    return state;
  }
  const paid = spendCurrency(state, card.cost);
  const stock = state.phase.stock.filter((c) => c.id !== card.id);
  const next: GameState = {
    ...paid,
    deck: addPurchase(paid.deck, card),
    phase: { kind: "shop", stock, rerollCost: state.phase.rerollCost },
  };
  return withShopStock(next, stock);
}

export function rerollShop(state: GameState): GameState {
  if (state.phase.kind !== "shop") {
    return state;
  }
  const paid = spendCurrency(state, state.phase.rerollCost);
  const rolled = rollShopStock(SHOP_CATALOGUE, SHOP_STOCK_SIZE, paid.rng, paid.ids);
  const next: GameState = {
    ...paid,
    rng: rolled.rng,
    phase: { kind: "shop", stock: rolled.stock, rerollCost: state.phase.rerollCost },
  };
  return withShopStock(next, rolled.stock);
}

/** Bump the first movement mode by 1; attack modes are never touched. */
export function upgradeCard(card: Card): Card {
  let done = false;
  const modes = card.modes.map((mode): CardMode => {
    if (mode.kind === "move" && !done) {
      done = true;
      return { kind: "move", terrain: mode.terrain, distance: mode.distance + 1 };
    }
    return mode;
  });
  return { ...card, modes };
}

function mapDeckCards(deck: Deck, fn: (card: Card) => Card): Deck {
  return {
    draw: deck.draw.map(fn),
    hand: deck.hand.map(fn),
    discard: deck.discard.map(fn),
  };
}

export function upgradeCardInDeck(deck: Deck, cardId: string): Deck {
  return mapDeckCards(deck, (card) => (card.id === cardId ? upgradeCard(card) : card));
}

export function removeCardFromDeck(deck: Deck, cardId: string): Deck {
  const strip = (cards: readonly Card[]): Card[] => cards.filter((c) => c.id !== cardId);
  return { draw: strip(deck.draw), hand: strip(deck.hand), discard: strip(deck.discard) };
}

export function collectCoin(state: GameState, coord: HexCoord): GameState {
  const tile = state.map.tiles.get(hexKey(coord));
  if (tile === undefined || tile.feature.kind !== "coin") {
    throw new Error("no coin here");
  }
  return gainCurrency(consumeFeatureAt(state, coord), tile.feature.value);
}

/** A choice forwarded from the feature UI; every transition lives here. */
export type FeatureAction =
  | { kind: "buy"; card: Card }
  | { kind: "reroll" }
  | { kind: "leave" }
  | { kind: "upgrade"; cardId: string }
  | { kind: "remove"; cardId: string }
  | { kind: "take-gift" };

export function applyFeatureAction(state: GameState, action: FeatureAction): GameState {
  switch (action.kind) {
    case "buy":
      return buyCard(state, action.card);
    case "reroll":
      return rerollShop(state);
    case "leave":
      return leaveFeature(state);
    case "upgrade":
      return chooseSmithCard(state, action.cardId);
    case "remove":
      return chooseRemoveCard(state, action.cardId);
    case "take-gift":
      return takeGift(state);
  }
}

/**
 * Back out of a modal phase. The feature stays on the tile (shops and smiths are
 * reusable, and a left gift re-rolls next visit), but the turn still ends.
 */
export function leaveFeature(state: GameState): GameState {
  switch (state.phase.kind) {
    case "shop":
    case "smith":
    case "pending-remove":
    case "pending-gain":
      return finishFeature(state);
    case "playing":
    case "pending-move":
    case "pending-attack":
    case "pending-discard":
    case "game-over":
      return state;
  }
}

export function chooseSmithCard(state: GameState, cardId: string): GameState {
  if (state.phase.kind !== "smith") {
    return state;
  }
  return finishFeature({ ...state, deck: upgradeCardInDeck(state.deck, cardId) });
}

export function chooseRemoveCard(state: GameState, cardId: string): GameState {
  if (state.phase.kind !== "pending-remove") {
    return state;
  }
  return finishFeature({ ...state, deck: removeCardFromDeck(state.deck, cardId) });
}

export function takeGift(state: GameState): GameState {
  if (state.phase.kind !== "pending-gain") {
    return state;
  }
  const card = instantiate(state.phase.spec, state.ids());
  const withCard = { ...state, deck: addPurchase(state.deck, card) };
  return finishFeature(consumeFeatureAt(withCard, withCard.map.player));
}
