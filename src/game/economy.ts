import type { Card, ShopSlot } from "./cards";
import { SHOP_CATALOGUE, instantiate, isIndestructible, upgradeTarget } from "./cards";
import { CONSUMABLE_CAPACITY, rollConsumableOptions } from "./consumables";
import type { Consumable } from "./consumables";
import { gainCurrency, spendCurrency } from "./currency";
import type { Deck } from "./deck";
import { addPurchase, allCards, deckSize } from "./deck";
import { hexKey } from "./hex";
import type { HexCoord } from "./hex";
import { SHOP_STOCK_SIZE, rollShopStock } from "./shop";
import type { GameState } from "./state";
import {
  acquireCard,
  countCardShown,
  countRemoved,
  countSite,
  countUpgrade,
  recordDeckSize,
} from "./stats";
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
function withShopStock(
  state: GameState,
  stock: readonly (ShopSlot | null)[],
): GameState {
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
      const withShown = {
        ...site,
        stats: feature.stock.reduce(
          (stats, slot) =>
            slot === null
              ? stats
              : countCardShown(stats, slot.card.name, "shop"),
          site.stats,
        ),
      };
      const opened = takeSkipBonus(withShown);
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
      const opened = takeSkipBonus(site);
      const stats =
        feature.card === null
          ? opened.stats
          : countCardShown(opened.stats, feature.card.name, "gift");
      return still({
        ...opened,
        stats,
        phase: { kind: "pending-gain", card: feature.card },
      });
    }
    case "consumable": {
      // The window opens even when the player holds three, so they can see the
      // offer and use a consumable to make room.
      const opened = takeSkipBonus(site);
      const rolled = rollConsumableOptions(2, opened.rng, opened.ids);
      return still({
        ...opened,
        rng: rolled.rng,
        phase: {
          kind: "pending-consumable",
          options: rolled.options,
          position: opened.map.player,
        },
      });
    }
    case "random":
      throw new Error("unresolved random feature");
  }
}

export function buyCard(state: GameState, card: Card, cost: number): GameState {
  if (state.phase.kind !== "shop") {
    return state;
  }
  const paid = spendCurrency(state, cost, "shops");
  const stock = state.phase.stock.map((slot) =>
    slot !== null && slot.card.id === card.id ? null : slot,
  );
  const bought = addPurchase(paid.deck, card);
  const next: GameState = {
    ...paid,
    deck: bought,
    stats: recordDeckSize(
      acquireCard(paid.stats, card, { kind: "shop", cost }, paid.turn),
      deckSize(bought),
    ),
    phase: { kind: "shop", stock, rerollCost: state.phase.rerollCost },
  };
  return withShopStock(next, stock);
}

export function rerollShop(state: GameState): GameState {
  if (state.phase.kind !== "shop") {
    return state;
  }
  const paid = spendCurrency(state, state.phase.rerollCost, "shops");
  const rolled = rollShopStock(
    SHOP_CATALOGUE,
    SHOP_STOCK_SIZE,
    paid.rng,
    paid.ids,
  );
  const next: GameState = {
    ...paid,
    rng: rolled.rng,
    stats: rolled.stock.reduce(
      (stats, slot) => countCardShown(stats, slot.card.name, "shop"),
      paid.stats,
    ),
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
  const target = upgradeTarget(card);
  if (target === null) {
    return card;
  }
  return {
    ...instantiate(target, card.id),
    traits: card.traits,
    sleeping: card.sleeping,
    temporary: card.temporary,
    // Easter egg: upgrading a full storage bin upgrades everything inside it too.
    stored: card.stored.map((stored) => upgradeCard(stored)),
  };
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
  return gainCurrency(
    consumeFeatureAt(state, coord),
    tile.feature.value,
    "coins",
  );
}

/** A choice forwarded from the feature UI; every transition lives here. */
export type FeatureAction =
  | { kind: "buy"; card: Card; cost: number }
  | { kind: "reroll" }
  | { kind: "leave" }
  | { kind: "upgrade"; cardId: string }
  | { kind: "remove"; cardId: string }
  | { kind: "take-gift" }
  | { kind: "take-consumable"; consumable: Consumable };

export function applyFeatureAction(
  state: GameState,
  action: FeatureAction,
): Transition {
  switch (action.kind) {
    case "buy":
      return still(buyCard(state, action.card, action.cost));
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
    case "take-consumable":
      return takeConsumable(state, action.consumable);
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
    case "pending-consumable":
      return finishFeature(state);
    case "playing":
    case "pending-card":
    case "pending-discard":
    case "pending-sleep":
    case "pending-search":
    case "pending-store":
    case "pending-wall":
    case "game-over":
      return still(state);
  }
}

export function chooseSmithCard(state: GameState, cardId: string): Transition {
  if (state.phase.kind !== "smith") {
    return still(state);
  }
  const upgraded = {
    ...state,
    deck: upgradeCardInDeck(state.deck, cardId),
    stats: countUpgrade(state.stats, cardId),
  };
  return finishFeature(consumeFeatureAt(upgraded, upgraded.map.player));
}

export function chooseRemoveCard(state: GameState, cardId: string): Transition {
  if (state.phase.kind !== "pending-remove") {
    return still(state);
  }
  // An indestructible card can never be removed from the deck.
  const target = allCards(state.deck).find((card) => card.id === cardId);
  if (target === undefined || isIndestructible(target)) {
    return still(state);
  }
  const deck = removeCardFromDeck(state.deck, cardId);
  const removed = {
    ...state,
    deck,
    stats: recordDeckSize(
      countRemoved(state.stats, cardId, state.turn),
      deckSize(deck),
    ),
  };
  return finishFeature(consumeFeatureAt(removed, removed.map.player));
}

/** Empty a gain-card slot, leaving the feature in place as a blank slot. */
function clearGainCard(state: GameState, coord: HexCoord): GameState {
  const key = hexKey(coord);
  const tile = state.map.tiles.get(key);
  if (tile === undefined || tile.feature.kind !== "gain-card") {
    return state;
  }
  const tiles = new Map(state.map.tiles);
  tiles.set(key, { ...tile, feature: { kind: "gain-card", card: null } });
  return { ...state, map: { ...state.map, tiles } };
}

export function takeGift(state: GameState): Transition {
  if (state.phase.kind !== "pending-gain") {
    return still(state);
  }
  const card = state.phase.card;
  if (card === null) {
    return still(state);
  }
  const gift = addPurchase(state.deck, card);
  const withCard = {
    ...state,
    deck: gift,
    stats: recordDeckSize(
      acquireCard(state.stats, card, { kind: "gift" }, state.turn),
      deckSize(gift),
    ),
  };
  return finishFeature(clearGainCard(withCard, withCard.map.player));
}

/** Keep one offered consumable, if there is room, and consume the pickup space. */
export function takeConsumable(
  state: GameState,
  consumable: Consumable,
): Transition {
  if (state.phase.kind !== "pending-consumable") {
    return still(state);
  }
  if (state.consumables.length >= CONSUMABLE_CAPACITY) {
    return still(state);
  }
  const position = state.phase.position;
  const withItem: GameState = {
    ...state,
    consumables: [...state.consumables, consumable],
  };
  return finishFeature(consumeFeatureAt(withItem, position));
}
