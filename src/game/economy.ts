import type { Card } from "./cards";
import { SHOP_CATALOGUE, instantiate } from "./cards";
import { gainCurrency, spendCurrency } from "./currency";
import type { Deck } from "./deck";
import { addPurchase } from "./deck";
import { hexKey } from "./hex";
import type { HexCoord } from "./hex";
import { SHOP_STOCK_SIZE, rollGift, rollShopStock } from "./shop";
import type { GameState } from "./state";
import { acquireCard, countSite } from "./stats";
import type { TileFeature } from "./terrain";
import { still } from "./transition";
import type { Transition } from "./transition";
import { endTurn, endTurnCurrency, takeSkipBonus } from "./turn";

export { gainCurrency, spendCurrency };

export type EndTurnAction =
  | { kind: "end-turn"; bonus: number }
  | { kind: "use-feature"; feature: TileFeature; bonus: number };

/**
 * What the end-turn button should do, given the feature under the player. The
 * bonus is the coin for a turn with no card played, so the button can say
 * exactly what pressing it will do — and so the UI never re-derives the rule.
 */
export function endTurnAction(state: GameState): EndTurnAction {
  const bonus = endTurnCurrency(state.turnState);
  const feature = playerFeature(state);
  if (feature.kind === "none") {
    return { kind: "end-turn", bonus };
  }
  return { kind: "use-feature", feature, bonus };
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
function finishFeature(state: GameState): Transition {
  return endTurn({ ...state, phase: { kind: "playing" } });
}

/**
 * The "use feature" action: enter the feature's phase, or resolve it at once.
 * A coin pays out and ends the turn; shops, smiths, removal and gains open a
 * modal phase whose own action ends the turn.
 *
 * Opening a modal phase pays the skip bonus up front, so a coin earned by
 * standing still can be spent in the shop it just opened.
 */
export function useFeature(state: GameState): Transition {
  if (state.phase.kind !== "playing") {
    return still(state);
  }
  const feature = playerFeature(state);
  const site =
    feature.kind === "none"
      ? state
      : { ...state, stats: countSite(state.stats) };
  switch (feature.kind) {
    case "none":
      return endTurn(site);
    case "coin":
      return endTurn(collectCoin(site, site.map.player));
    case "shop": {
      const opened = takeSkipBonus(site);
      return still({
        ...opened,
        phase: {
          kind: "shop",
          stock: feature.stock,
          rerollCost: feature.rerollCost,
        },
      });
    }
    case "smith":
      return still({ ...takeSkipBonus(site), phase: { kind: "smith" } });
    case "remove-card":
      return still({
        ...takeSkipBonus(site),
        phase: { kind: "pending-remove" },
      });
    case "gain-card": {
      const rolled = rollGift(SHOP_CATALOGUE, site.rng);
      return still({
        ...takeSkipBonus(site),
        rng: rolled.rng,
        phase: { kind: "pending-gain", spec: rolled.spec },
      });
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
    stats: acquireCard(
      paid.stats,
      card,
      { kind: "shop", cost: card.cost },
      paid.turn,
    ),
    phase: { kind: "shop", stock, rerollCost: state.phase.rerollCost },
  };
  return withShopStock(next, stock);
}

export function rerollShop(state: GameState): GameState {
  if (state.phase.kind !== "shop") {
    return state;
  }
  const paid = spendCurrency(state, state.phase.rerollCost);
  const rolled = rollShopStock(
    SHOP_CATALOGUE,
    SHOP_STOCK_SIZE,
    paid.rng,
    paid.ids,
  );
  const next: GameState = {
    ...paid,
    rng: rolled.rng,
    phase: {
      kind: "shop",
      stock: rolled.stock,
      rerollCost: state.phase.rerollCost,
    },
  };
  return withShopStock(next, rolled.stock);
}

/** Bump the first movement mode by 1; attack modes are never touched. */
export function upgradeCard(card: Card): Card {
  return card.upgradedForm ? instantiate(card.upgradedForm, card.id): card
}

function mapDeckCards(deck: Deck, fn: (card: Card) => Card): Deck {
  return {
    draw: deck.draw.map(fn),
    hand: deck.hand.map(fn),
    discard: deck.discard.map(fn),
  };
}

export function upgradeCardInDeck(deck: Deck, cardId: string): Deck {
  return mapDeckCards(deck, (card) =>
    card.id === cardId ? upgradeCard(card) : card,
  );
}

export function removeCardFromDeck(deck: Deck, cardId: string): Deck {
  const strip = (cards: readonly Card[]): Card[] =>
    cards.filter((c) => c.id !== cardId);
  return {
    draw: strip(deck.draw),
    hand: strip(deck.hand),
    discard: strip(deck.discard),
  };
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

export function applyFeatureAction(
  state: GameState,
  action: FeatureAction,
): Transition {
  switch (action.kind) {
    case "buy":
      return still(buyCard(state, action.card));
    case "reroll":
      return still(rerollShop(state));
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
export function leaveFeature(state: GameState): Transition {
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
      return still(state);
  }
}

export function chooseSmithCard(state: GameState, cardId: string): Transition {
  if (state.phase.kind !== "smith") {
    return still(state);
  }
  return finishFeature({
    ...state,
    deck: upgradeCardInDeck(state.deck, cardId),
  });
}

export function chooseRemoveCard(state: GameState, cardId: string): Transition {
  if (state.phase.kind !== "pending-remove") {
    return still(state);
  }
  return finishFeature({
    ...state,
    deck: removeCardFromDeck(state.deck, cardId),
  });
}

export function takeGift(state: GameState): Transition {
  if (state.phase.kind !== "pending-gain") {
    return still(state);
  }
  const card = instantiate(state.phase.spec, state.ids());
  const withCard = {
    ...state,
    deck: addPurchase(state.deck, card),
    stats: acquireCard(state.stats, card, { kind: "gift" }, state.turn),
  };
  return finishFeature(consumeFeatureAt(withCard, withCard.map.player));
}
