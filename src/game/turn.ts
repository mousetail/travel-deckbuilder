import type { Card, CardMode } from "./cards";
import { gainCurrency } from "./currency";
import type { Deck, DeckMutation } from "./deck";
import { drawCards, drawUpTo, removeFromHand, toDiscard } from "./deck";
import { bountyFor, enemiesInRange, killEnemy, resolveEnemyPhase } from "./enemies";
import { hexKey, parseHexKey } from "./hex";
import type { HexCoord } from "./hex";
import { leadingEdge, onPlayerMoved, visibleMap } from "./fog";
import { reachableHexes, resolveMove } from "./movement";
import type { TerrainLookup } from "./movement";
import type { Rng } from "./rng";
import type { GameState, TurnState } from "./state";
import { moving, still } from "./transition";
import type { Transition } from "./transition";

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
      // Draw first; the player then chooses which cards to discard, so this
      // opens a `pending-discard` phase instead of resolving fully.
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
  if (!deck.hand.some((c) => c.id === card.id)) {
    return deck;
  }
  const without = removeFromHand(deck, card);
  return toDiscard(without, [card]);
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

function spent(state: GameState, deck: Deck, rng: Rng): GameState {
  return {
    ...state,
    deck,
    rng,
    turnState: { cardsPlayedThisTurn: state.turnState.cardsPlayedThisTurn + 1 },
  };
}

/** Whether the player could usefully play `mode` right now. */
export function modeIsAvailable(state: GameState, mode: CardMode): boolean {
  switch (mode.kind) {
    case "attack":
      return enemiesInRange(state.enemies, state.map.player, mode.range).length > 0;
    case "discard-hand":
      return state.deck.hand.length >= mode.threshold;
    case "recover":
      return state.deck.discard.length > 0;
    case "draw":
    case "draw-discard":
      return state.deck.draw.length > 0 || state.deck.discard.length > 0;
    case "move": {
      const reachable = reachableHexes(state.map.player, mode.distance, mode.terrain, terrainAt(state));
      return [...reachable.keys()].some((key) => key !== hexKey(state.map.player));
    }
    case "currency":
      return true;
  }
}

/**
 * Play one mode of `card` (the player picks the mode in the UI). Movement enters
 * `pending-move`, an attack with no target is refused, and everything else
 * resolves at once.
 */
export function beginPlay(state: GameState, card: Card, modeIndex: number): Transition {
  if (state.phase.kind !== "playing") {
    return still(state);
  }
  const mode = card.modes[modeIndex];
  if (mode === undefined) {
    return still(state);
  }

  switch (mode.kind) {
    case "move": {
      const reachable = reachableHexes(state.map.player, mode.distance, mode.terrain, terrainAt(state));
      return still({
        ...state,
        phase: {
          kind: "pending-move",
          card,
          modeIndex,
          reachable: [...reachable.keys()].map(parseHexKey),
        },
      });
    }
    case "attack": {
      // No candidates: refuse rather than waste the card (the UI greys it out).
      if (enemiesInRange(state.enemies, state.map.player, mode.range).length === 0) {
        return still(state);
      }
      return still({ ...state, phase: { kind: "pending-attack", cardId: card.id, range: mode.range } });
    }
    case "draw":
    case "discard-hand":
    case "recover": {
      const applied = applyHandMode(state.deck, mode, state.rng);
      return still(spent(state, discardFromHand(applied.deck, card), applied.rng));
    }
    case "draw-discard": {
      const applied = applyHandMode(state.deck, mode, state.rng);
      const deck = discardFromHand(applied.deck, card);
      const played = spent(state, deck, applied.rng);
      if (mode.discard <= 0 || deck.hand.length === 0) {
        return still(played);
      }
      return still({ ...played, phase: { kind: "pending-discard", count: mode.discard } });
    }
    case "currency": {
      const paid = gainCurrency(state, mode.amount);
      return still(spent(paid, discardFromHand(paid.deck, card), state.rng));
    }
  }
}

/** Discard one card as part of a `draw-discard` choice; ends the phase when done. */
export function discardForChoice(state: GameState, card: Card): Transition {
  const phase = state.phase;
  if (phase.kind !== "pending-discard") {
    return still(state);
  }
  const deck = discardFromHand(state.deck, card);
  const remaining = phase.count - 1;
  if (remaining <= 0 || deck.hand.length === 0) {
    return still({ ...state, deck, phase: { kind: "playing" } });
  }
  return still({ ...state, deck, phase: { kind: "pending-discard", count: remaining } });
}

/** Kill one enemy in range and pay its bounty. */
export function resolveAttack(state: GameState, enemyId: string): Transition {
  const phase = state.phase;
  if (phase.kind !== "pending-attack") {
    return still(state);
  }
  const target = state.enemies.find((enemy) => enemy.id === enemyId);
  const card = state.deck.hand.find((c) => c.id === phase.cardId);
  if (target === undefined || card === undefined) {
    return still(state);
  }
  const paid = gainCurrency(state, bountyFor(target));
  return still({
    ...paid,
    enemies: killEnemy(paid.enemies, enemyId),
    deck: discardFromHand(paid.deck, card),
    phase: { kind: "playing" },
    turnState: { cardsPlayedThisTurn: paid.turnState.cardsPlayedThisTurn + 1 },
  });
}

export function resolveMoveTo(state: GameState, to: HexCoord): Transition {
  const phase = state.phase;
  if (phase.kind !== "pending-move") {
    return still(state);
  }
  const mode = phase.card.modes[phase.modeIndex];
  if (mode.kind !== "move") {
    return still(state);
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
  const next = onPlayerMoved(moved);
  return moving(next, [{ mover: { kind: "player" }, path }]);
}

export function cancelPending(state: GameState): Transition {
  switch (state.phase.kind) {
    case "pending-move":
    case "pending-attack":
      return still({ ...state, phase: { kind: "playing" } });
    case "playing":
    case "pending-discard":
    case "pending-remove":
    case "pending-gain":
    case "shop":
    case "smith":
    case "game-over":
      return still(state);
  }
}

/** Discarding by hand never counts as playing a card (anti-softlock rule). */
export function discardCard(state: GameState, card: Card): Transition {
  if (state.phase.kind !== "playing") {
    return still(state);
  }
  return still({ ...state, deck: discardFromHand(state.deck, card) });
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

export function endTurn(state: GameState): Transition {
  if (state.phase.kind !== "playing") {
    return still(state);
  }
  const bonus = endTurnCurrency(state.turnState);
  const paid: GameState = { ...state, currency: state.currency + bonus };
  const resolved = resolveEnemyPhase(paid, leadingEdge(paid));
  if (resolved.state.phase.kind === "game-over") {
    return resolved;
  }
  const next = startTurn({ ...resolved.state, turn: resolved.state.turn + 1 });
  return moving(next, resolved.moves);
}