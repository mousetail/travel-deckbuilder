import type { Card, CardMode, MoveMode } from "./cards";
import { gainCurrency } from "./currency";
import type { Deck, DeckMutation } from "./deck";
import { drawCards, drawUpTo, removeFromHand, toDiscard } from "./deck";
import {
  bountyFor,
  enemiesInRange,
  killEnemy,
  resolveEnemyPhase,
} from "./enemies";
import { equalsHex } from "./hex";
import type { HexCoord } from "./hex";
import { leadingEdge, onPlayerMoved, visibleReach } from "./fog";
import { reachableHexes, resolveMove } from "./movement";
import { cardReach, tileAt } from "./reach";
import type { Rng } from "./rng";
import type { GameState, TurnState } from "./state";
import { countDrawn, countKill, countPlay } from "./stats";
import { moving, still } from "./transition";
import type { Transition } from "./transition";

export const HAND_SIZE = 4;

/** The anti-softlock bonus for ending a turn without playing a card. */
export function endTurnCurrency(turn: TurnState): number {
  return turn.cardsPlayedThisTurn === 0 && !turn.skipBonusTaken ? 1 : 0;
}

/**
 * Pay the skip bonus, if it is due, and mark it paid. It is granted when the
 * player commits to ending the turn — before a shop opens — so the coin can be
 * spent immediately rather than only after the shop closes.
 */
export function takeSkipBonus(state: GameState): GameState {
  const bonus = endTurnCurrency(state.turnState);
  if (bonus === 0) {
    return state;
  }
  return {
    ...state,
    currency: state.currency + bonus,
    turnState: { ...state.turnState, skipBonusTaken: true },
  };
}

export function applyHandMode(
  deck: Deck,
  mode: CardMode,
  rng: Rng,
): DeckMutation {
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
        return { deck, rng, drawn: [] };
      }
      const discarded = toDiscard({ ...deck, hand: [] }, deck.hand);
      return drawCards(discarded, mode.draw, rng);
    }
    case "recover": {
      const recovered = deck.discard.slice(-mode.count);
      const remaining = deck.discard.slice(
        0,
        deck.discard.length - recovered.length,
      );
      return {
        deck: {
          draw: deck.draw,
          hand: [...deck.hand, ...recovered],
          discard: remaining,
        },
        rng,
        drawn: [],
      };
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

function spent(
  state: GameState,
  deck: Deck,
  rng: Rng,
  card: Card,
  drawn: readonly Card[],
): GameState {
  const stats = countPlay(countDrawn(state.stats, drawn), card.id);
  return {
    ...state,
    deck,
    rng,
    stats,
    turnState: {
      ...state.turnState,
      cardsPlayedThisTurn: state.turnState.cardsPlayedThisTurn + 1,
    },
  };
}

/** Whether the player could usefully play `mode` right now. */
export function modeIsAvailable(state: GameState, mode: CardMode): boolean {
  switch (mode.kind) {
    case "attack":
      return (
        enemiesInRange(state.enemies, state.map.player, mode.range).length > 0
      );
    case "discard-hand":
      return state.deck.hand.length >= mode.threshold;
    case "recover":
      return state.deck.discard.length > 0;
    case "draw":
    case "draw-discard":
      return state.deck.draw.length > 0 || state.deck.discard.length > 0;
    case "move": {
      const reachable = reachableHexes(
        state.map.player,
        mode.distance,
        mode.terrain,
        tileAt(state),
      );
      return reachable.some((coord) => !equalsHex(coord, state.map.player));
    }
    case "currency":
      return true;
  }
}

/** Whether any of `card`'s modes could be played right now. */
export function cardIsPlayable(state: GameState, card: Card): boolean {
  return card.modes.some((mode) => modeIsAvailable(state, mode));
}

/**
 * Play `card`: the player clicked it. A card with move or attack modes opens the
 * `pending-card` phase, where the map shows every reachable tile and every enemy
 * in range and the player clicks one. A card with only instant modes resolves at
 * once. A card with nothing usable right now is refused.
 */
export function beginPlay(state: GameState, card: Card): Transition {
  if (state.phase.kind !== "playing") {
    return still(state);
  }
  if (!state.deck.hand.some((c) => c.id === card.id)) {
    return still(state);
  }
  if (!cardIsPlayable(state, card)) {
    return still(state);
  }

  const reach = cardReach(state, card);
  if (reach.moves.length > 0 || reach.attacks.length > 0) {
    return still({
      ...state,
      phase: {
        kind: "pending-card",
        card,
        reachable: reach.moves.flatMap((move) => move.reachable),
        targets: reach.attacks.flatMap((attack) => attack.targets),
      },
    });
  }

  const instant = card.modes[0];
  if (instant === undefined) {
    return still(state);
  }
  return playInstant(state, card, instant);
}

/** Resolve a card whose only modes are instant effects. */
function playInstant(state: GameState, card: Card, mode: CardMode): Transition {
  switch (mode.kind) {
    case "draw":
    case "discard-hand":
    case "recover": {
      const applied = applyHandMode(state.deck, mode, state.rng);
      const discarded =
        mode.kind === "discard-hand" &&
        state.deck.hand.length >= mode.threshold
          ? state.deck.hand
          : [];
      const played = spent(
        state,
        discardFromHand(applied.deck, card),
        applied.rng,
        card,
        applied.drawn,
      );
      return still(applyOnDiscard(played, discarded));
    }
    case "draw-discard": {
      const applied = applyHandMode(state.deck, mode, state.rng);
      const deck = discardFromHand(applied.deck, card);
      const played = spent(state, deck, applied.rng, card, applied.drawn);
      if (mode.discard <= 0 || deck.hand.length === 0) {
        return still(played);
      }
      return still({
        ...played,
        phase: { kind: "pending-discard", count: mode.discard },
      });
    }
    case "currency": {
      const paid = gainCurrency(state, mode.amount);
      return still(
        spent(paid, discardFromHand(paid.deck, card), state.rng, card, []),
      );
    }
    case "move":
    case "attack":
      throw new Error(`not an instant mode: ${mode.kind}`);
  }
}

/** Apply every discarded card's on-discard effect. */
function applyOnDiscard(
  state: GameState,
  discarded: readonly Card[],
): GameState {
  let next = state;
  for (const card of discarded) {
    if (card.onDiscard === null) {
      continue;
    }
    switch (card.onDiscard.kind) {
      case "currency":
        next = gainCurrency(next, card.onDiscard.amount);
    }
  }
  return next;
}

/** Discard one card as part of a `draw-discard` choice; ends the phase when done. */
export function discardForChoice(state: GameState, card: Card): Transition {
  const phase = state.phase;
  if (phase.kind !== "pending-discard") {
    return still(state);
  }
  const deck = discardFromHand(state.deck, card);
  const withEffect = applyOnDiscard({ ...state, deck }, [card]);
  const remaining = phase.count - 1;
  if (remaining <= 0 || deck.hand.length === 0) {
    return still({ ...withEffect, phase: { kind: "playing" } });
  }
  return still({
    ...withEffect,
    phase: { kind: "pending-discard", count: remaining },
  });
}

/** Kill one enemy in range and pay its bounty. */
export function resolveAttack(state: GameState, enemyId: string): Transition {
  const phase = state.phase;
  if (phase.kind !== "pending-card") {
    return still(state);
  }
  const target = state.enemies.find((enemy) => enemy.id === enemyId);
  const card = state.deck.hand.find((c) => c.id === phase.card.id);
  if (
    target === undefined ||
    card === undefined ||
    !phase.targets.some((enemy) => enemy.id === enemyId)
  ) {
    return still(state);
  }
  const paid = gainCurrency(state, bountyFor(target));
  return still({
    ...paid,
    stats: countPlay(countKill(paid.stats), card.id),
    enemies: killEnemy(paid.enemies, enemyId),
    deck: discardFromHand(paid.deck, card),
    phase: { kind: "playing" },
    turnState: {
      ...paid.turnState,
      cardsPlayedThisTurn: paid.turnState.cardsPlayedThisTurn + 1,
    },
  });
}

export function resolveMoveTo(state: GameState, to: HexCoord): Transition {
  const phase = state.phase;
  if (phase.kind !== "pending-card") {
    return still(state);
  }
  const mode = moveModeReaching(state, phase.card, to);
  if (mode === null) {
    return still(state);
  }

  const path = resolveMove(
    state.map.player,
    to,
    mode.terrain,
    tileAt(state),
    mode.distance,
  );
  const destination = path[path.length - 1];
  const moved: GameState = {
    ...state,
    deck: discardFromHand(state.deck, phase.card),
    stats: countPlay(state.stats, phase.card.id),
    map: { ...state.map, player: destination, previous: state.map.player },
    phase: { kind: "playing" },
    turnState: {
      ...state.turnState,
      cardsPlayedThisTurn: state.turnState.cardsPlayedThisTurn + 1,
    },
  };
  // Crossing into a new section streams the map, but never ends the turn.
  const next = onPlayerMoved(moved);
  return moving(next, [{ mover: { kind: "player" }, path }]);
}

/** The first move mode of `card` that can reach `to`, or null. */
function moveModeReaching(
  state: GameState,
  card: Card,
  to: HexCoord,
): MoveMode | null {
  for (const move of cardReach(state, card).moves) {
    if (move.reachable.some((coord) => equalsHex(coord, to))) {
      return move.mode;
    }
  }
  return null;
}

export function cancelPending(state: GameState): Transition {
  switch (state.phase.kind) {
    case "pending-card":
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
  const deck = discardFromHand(state.deck, card);
  return still(applyOnDiscard({ ...state, deck }, [card]));
}

export function startTurn(state: GameState): GameState {
  const drawn = drawUpTo(state.deck, HAND_SIZE, state.rng);
  return {
    ...state,
    deck: drawn.deck,
    rng: drawn.rng,
    stats: countDrawn(state.stats, drawn.drawn),
    turnState: { cardsPlayedThisTurn: 0, skipBonusTaken: false },
  };
}

export function endTurn(state: GameState): Transition {
  if (state.phase.kind !== "playing") {
    return still(state);
  }
  const paid = takeSkipBonus(state);
  const resolved = resolveEnemyPhase(
    paid,
    leadingEdge(paid),
    visibleReach(paid),
  );
  if (resolved.state.phase.kind === "game-over") {
    return resolved;
  }
  const next = startTurn({ ...resolved.state, turn: resolved.state.turn + 1 });
  return moving(next, resolved.moves);
}
