import type { Card, CardMode } from "./cards";
import type { Deck, DeckMutation } from "./deck";
import { drawCards, drawUpTo, removeFromHand, toDiscard } from "./deck";
import { hexKey, parseHexKey } from "./hex";
import type { HexCoord } from "./hex";
import { onPlayerMoved, visibleMap } from "./fog";
import { reachableHexes, resolveMove } from "./movement";
import type { TerrainLookup } from "./movement";
import type { Rng } from "./rng";
import type { GameState, TurnState } from "./state";

export const HAND_SIZE = 4;

export function endTurnCurrency(turn: TurnState): number {
  return turn.cardsPlayedThisTurn === 0 ? 1 : 0;
}

export function applyHandMode(deck: Deck, mode: CardMode, rng: Rng): DeckMutation {
  switch (mode.kind) {
    case "draw": {
      return drawCards(deck, mode.count, rng);
    }
    case "draw-discard": {
      // Draw first; the player then chooses which cards to discard.
      // Return a pending-discard request to the UI instead of guessing.
      return drawCards(deck, mode.draw, rng);
    }
    case "discard-hand": {
      if (deck.hand.length < mode.threshold) {
        return { deck, rng };
      }
      const discarded = toDiscard({ ...deck, hand: [] }, deck.hand);
      return drawCards(discarded, mode.draw, rng);
    }
    case "recover": {
      const recovered = deck.discard.slice(-mode.count);
      const remaining = deck.discard.slice(0, deck.discard.length - recovered.length);
      return { deck: { draw: deck.draw, hand: [...deck.hand, ...recovered], discard: remaining }, rng };
    }
    case "move":
    case "attack":
    case "currency":
      throw new Error(`not a hand mode: ${mode.kind}`);
  }
}

export function discardFromHand(deck: Deck, card: Card): Deck {
  const without = removeFromHand(deck, card);
  return toDiscard(without, [card]);
}

function isHandMode(mode: CardMode): boolean {
  switch (mode.kind) {
    case "draw":
    case "draw-discard":
    case "discard-hand":
    case "recover":
      return true;
    case "move":
    case "attack":
    case "currency":
      return false;
  }
}

function terrainAt(state: GameState): TerrainLookup {
  // Movement is confined to the visible window: the current section, the one
  // behind, and the fog sliver of the next. Removed sections are gone entirely.
  const visible = visibleMap(state).tiles;
  return (coord) => {
    const tile = visible.get(hexKey(coord));
    return tile === undefined ? "impassible" : tile.terrain;
  };
}

/**
 * Resolve a card click. Movement cards enter `pending-move` with the reachable
 * set precomputed; hand-management cards resolve immediately. Attack and
 * currency modes arrive in chapters 07 and 08.
 */
export function beginPlay(state: GameState, card: Card): GameState {
  if (state.phase.kind !== "playing") {
    return state;
  }

  const moveIndex = card.modes.findIndex((mode) => mode.kind === "move");
  if (moveIndex >= 0) {
    const mode = card.modes[moveIndex];
    if (mode.kind === "move") {
      const reachable = reachableHexes(state.map.player, mode.distance, mode.terrain, terrainAt(state));
      return {
        ...state,
        phase: {
          kind: "pending-move",
          card,
          modeIndex: moveIndex,
          reachable: [...reachable.keys()].map(parseHexKey),
        },
      };
    }
  }

  const handMode = card.modes.find((mode) => isHandMode(mode));
  if (handMode !== undefined) {
    const applied = applyHandMode(state.deck, handMode, state.rng);
    return {
      ...state,
      deck: applied.deck,
      rng: applied.rng,
      turnState: { cardsPlayedThisTurn: state.turnState.cardsPlayedThisTurn + 1 },
    };
  }

  return state;
}

export function resolveMoveTo(state: GameState, to: HexCoord): GameState {
  const phase = state.phase;
  if (phase.kind !== "pending-move") {
    return state;
  }
  const mode = phase.card.modes[phase.modeIndex];
  if (mode.kind !== "move") {
    return state;
  }

  const path = resolveMove(state.map.player, to, mode.terrain, terrainAt(state));
  const destination = path[path.length - 1];
  const moved: GameState = {
    ...state,
    deck: discardFromHand(state.deck, phase.card),
    map: { ...state.map, player: destination, previous: state.map.player },
    phase: { kind: "playing" },
    turnState: { cardsPlayedThisTurn: state.turnState.cardsPlayedThisTurn + 1 },
  };
  // Crossing into a new section streams the map, but never ends the turn.
  return onPlayerMoved(moved);
}

export function cancelPending(state: GameState): GameState {
  if (state.phase.kind !== "pending-move") {
    return state;
  }
  return { ...state, phase: { kind: "playing" } };
}

/** Discarding by hand never counts as playing a card (anti-softlock rule). */
export function discardCard(state: GameState, card: Card): GameState {
  if (state.phase.kind !== "playing") {
    return state;
  }
  return { ...state, deck: discardFromHand(state.deck, card) };
}

export function startTurn(state: GameState): GameState {
  const drawn = drawUpTo(state.deck, HAND_SIZE, state.rng);
  return {
    ...state,
    deck: drawn.deck,
    rng: drawn.rng,
    turnState: { cardsPlayedThisTurn: 0 },
  };
}

export function endTurn(state: GameState): GameState {
  if (state.phase.kind !== "playing") {
    return state;
  }
  const bonus = endTurnCurrency(state.turnState);
  const advanced: GameState = {
    ...state,
    turn: state.turn + 1,
    currency: state.currency + bonus,
  };
  // The enemy phase (chapter 07) plugs in here, before the next turn starts.
  return startTurn(advanced);
}