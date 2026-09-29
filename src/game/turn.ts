import type { Card, CardMode } from "./cards";
import {
  applyDiscardCostScaling,
  playCost,
  temporaryUpgradeCard,
} from "./cards";
import { gainCurrency, spendCurrency } from "./currency";
import type { Deck, DeckMutation } from "./deck";
import {
  discardPlayed,
  drawCards,
  drawUpTo,
  removeFromHand,
  sleepFromHand,
  sleepInDiscard,
  toDiscard,
} from "./deck";
import {
  bountyFor,
  dangerZone,
  enemiesInRange,
  killEnemy,
  resolveEnemyPhase,
} from "./enemies";
import { equalsHex, hexDistance } from "./hex";
import type { HexCoord } from "./hex";
import { onPlayerMoved, visibleEnemies, visibleReach } from "./fog";
import { reachableHexes, resolveMove } from "./movement";
import {
  cardReach,
  moveModeTo,
  movementTileAt,
  teleportTargets,
} from "./reach";
import type { Rng } from "./rng";
import type { GameState, TurnState } from "./state";
import {
  countDiscarded,
  countDrawn,
  countKill,
  countPlay,
  recordCardsPlayedInTurn,
  recordDistanceInTurn,
  recordEnemiesKilledInTurn,
} from "./stats";
import { playerOnFinish } from "./terrain";
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
  const paid = gainCurrency(state, bonus, "skips");
  return {
    ...paid,
    turnState: { ...paid.turnState, skipBonusTaken: true },
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
      // Sleeping cards are out of reach: recover the top-most awake cards.
      const awake = deck.discard.filter((card) => card.sleeping <= 0);
      const recovered = awake.slice(-mode.count);
      const recoveredIds = new Set(recovered.map((card) => card.id));
      const remaining = deck.discard.filter(
        (card) => !recoveredIds.has(card.id),
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
    case "teleport":
    case "currency":
    case "sleep-card":
    case "search":
    case "trivial-terrain":
    case "upgrade-hand":
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
  const paid = payForPlay(state, card);
  const playedThisTurn = paid.turnState.cardsPlayedThisTurn + 1;
  const stats = recordCardsPlayedInTurn(
    countPlay(countDrawn(paid.stats, drawn), card.id),
    playedThisTurn,
  );
  return {
    ...paid,
    deck,
    rng,
    stats,
    turnState: {
      ...paid.turnState,
      cardsPlayedThisTurn: playedThisTurn,
    },
  };
}

/** Spend a card's play cost, if it has one. */
function payForPlay(state: GameState, card: Card): GameState {
  const cost = playCost(card);
  return cost > 0 ? spendCurrency(state, cost, "cards") : state;
}

/** Whether the player could usefully play `mode` of `card` right now. */
export function modeIsAvailable(
  state: GameState,
  card: Card,
  mode: CardMode,
): boolean {
  switch (mode.kind) {
    case "attack":
      return (
        enemiesInRange(visibleEnemies(state), state.map.player, mode.range)
          .length > 0
      );
    case "discard-hand":
      return state.deck.hand.length >= mode.threshold;
    case "recover":
      return state.deck.discard.some((c) => c.sleeping <= 0);
    case "sleep-card":
      // Needs another card in hand to put to sleep.
      return state.deck.hand.some((c) => c.id !== card.id);
    case "draw":
    case "draw-discard":
      return (
        state.deck.draw.length > 0 ||
        state.deck.discard.some((c) => c.sleeping <= 0)
      );
    case "move": {
      const reachable = reachableHexes(
        state.map.player,
        mode.distance,
        mode.terrain,
        movementTileAt(state),
      );
      return reachable.some((coord) => !equalsHex(coord, state.map.player));
    }
    case "teleport":
      return teleportTargets(state, mode.range).length > 0;
    case "search":
      return state.deck.draw.length > 0;
    case "trivial-terrain":
      return true;
    case "upgrade-hand":
      return state.deck.hand.some(
        (c) =>
          c.id !== card.id && c.upgradedForm !== null && !c.temporaryUpgrade,
      );
    case "currency":
      return true;
  }
}

/** Whether any of `card`'s modes could be played right now. */
export function cardIsPlayable(state: GameState, card: Card): boolean {
  if (state.currency < playCost(card)) {
    return false;
  }
  return card.modes.some((mode) => modeIsAvailable(state, card, mode));
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
      // The played card is discarded by the effect too, but it counts as played.
      const thrown = discarded.filter((c) => c.id !== card.id);
      const withDiscards = {
        ...state,
        stats: countDiscarded(state.stats, thrown),
      };
      const played = spent(
        withDiscards,
        discardPlayed(applied.deck, card),
        applied.rng,
        card,
        applied.drawn,
      );
      return still(applyOnDiscard(played, discarded));
    }
    case "draw-discard": {
      const applied = applyHandMode(state.deck, mode, state.rng);
      const deck = discardPlayed(applied.deck, card);
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
      const paid = gainCurrency(state, mode.amount, "cards");
      return still(
        spent(paid, discardPlayed(paid.deck, card), state.rng, card, []),
      );
    }
    case "sleep-card": {
      const played = spent(
        state,
        discardPlayed(state.deck, card),
        state.rng,
        card,
        [],
      );
      return still({
        ...played,
        phase: { kind: "pending-sleep", reshuffles: mode.reshuffles },
      });
    }
    case "search": {
      const played = spent(
        state,
        discardPlayed(state.deck, card),
        state.rng,
        card,
        [],
      );
      return still({
        ...played,
        phase: { kind: "pending-search", count: mode.count },
      });
    }
    case "trivial-terrain": {
      const played = spent(
        state,
        discardPlayed(state.deck, card),
        state.rng,
        card,
        [],
      );
      return still({
        ...played,
        terrainTrivialTurns: Math.max(played.terrainTrivialTurns, mode.turns),
      });
    }
    case "upgrade-hand": {
      const upgraded = upgradeHand(state.deck, card);
      const played = spent(
        state,
        discardPlayed(upgraded, card),
        state.rng,
        card,
        [],
      );
      return still(played);
    }
    case "move":
    case "attack":
    case "teleport":
      throw new Error(`not an instant mode: ${mode.kind}`);
  }
}

/** Temporarily upgrade every other upgradable card in the hand. */
function upgradeHand(deck: Deck, card: Card): Deck {
  return {
    ...deck,
    hand: deck.hand.map((c) =>
      c.id !== card.id && c.upgradedForm !== null && !c.temporaryUpgrade
        ? temporaryUpgradeCard(c)
        : c,
    ),
  };
}

/** Apply every discarded card's on-discard effects. */
function applyOnDiscard(
  state: GameState,
  discarded: readonly Card[],
): GameState {
  let next = state;
  for (const card of discarded) {
    for (const effect of card.onDiscard) {
      switch (effect.kind) {
        case "currency":
          next = gainCurrency(next, effect.amount, "cards");
          break;
        case "sleep":
          next = {
            ...next,
            deck: sleepInDiscard(next.deck, card.id, effect.reshuffles),
          };
          break;
        case "halve-cost":
          next = {
            ...next,
            deck: {
              ...next.deck,
              discard: next.deck.discard.map((c) =>
                c.id === card.id ? applyDiscardCostScaling(c) : c,
              ),
            },
          };
          break;
        case "draw": {
          const applied = drawCards(next.deck, effect.count, next.rng);
          next = { ...next, deck: applied.deck, rng: applied.rng };
          break;
        }
        case "pay":
        case "double-cost":
          break;
      }
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
  const withEffect = applyOnDiscard(
    { ...state, deck, stats: countDiscarded(state.stats, [card]) },
    [card],
  );
  const remaining = phase.count - 1;
  if (remaining <= 0 || deck.hand.length === 0) {
    return still({ ...withEffect, phase: { kind: "playing" } });
  }
  return still({
    ...withEffect,
    phase: { kind: "pending-discard", count: remaining },
  });
}

/** Put one chosen hand card to sleep, resolving a `sleep-card` play. */
export function sleepForChoice(state: GameState, card: Card): Transition {
  const phase = state.phase;
  if (phase.kind !== "pending-sleep") {
    return still(state);
  }
  if (!state.deck.hand.some((c) => c.id === card.id)) {
    return still(state);
  }
  return still({
    ...state,
    deck: sleepFromHand(state.deck, card, phase.reshuffles),
    stats: countDiscarded(state.stats, [card]),
    phase: { kind: "playing" },
  });
}

/** Move one chosen card from the draw pile to the hand, resolving a search. */
export function searchForChoice(state: GameState, card: Card): Transition {
  const phase = state.phase;
  if (phase.kind !== "pending-search") {
    return still(state);
  }
  const index = state.deck.draw.findIndex((c) => c.id === card.id);
  if (index === -1) {
    return still(state);
  }
  const draw = [...state.deck.draw];
  const [chosen] = draw.splice(index, 1);
  if (chosen === undefined) {
    return still(state);
  }
  const deck = { ...state.deck, draw, hand: [...state.deck.hand, chosen] };
  const stats = countDrawn(state.stats, [chosen]);
  const remaining = phase.count - 1;
  if (remaining <= 0 || draw.length === 0) {
    return still({ ...state, deck, stats, phase: { kind: "playing" } });
  }
  return still({
    ...state,
    deck,
    stats,
    phase: { kind: "pending-search", count: remaining },
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
  const paid = payForPlay(gainCurrency(state, bountyFor(target), "combat"), card);
  const killedThisTurn = paid.turnState.enemiesKilledThisTurn + 1;
  const playedThisTurn = paid.turnState.cardsPlayedThisTurn + 1;
  const stats = recordCardsPlayedInTurn(
    recordEnemiesKilledInTurn(
      countPlay(countKill(paid.stats), card.id),
      killedThisTurn,
    ),
    playedThisTurn,
  );
  return still({
    ...paid,
    stats,
    enemies: killEnemy(paid.enemies, enemyId),
    deck: discardPlayed(paid.deck, card),
    phase: { kind: "playing" },
    turnState: {
      ...paid.turnState,
      cardsPlayedThisTurn: playedThisTurn,
      enemiesKilledThisTurn: killedThisTurn,
    },
  });
}

export function resolveMoveTo(state: GameState, to: HexCoord): Transition {
  const phase = state.phase;
  if (phase.kind !== "pending-card") {
    return still(state);
  }
  const mode = moveModeTo(state, phase.card, to);
  if (mode === null) {
    return still(state);
  }

  const path =
    mode.kind === "teleport"
      ? [state.map.player, to]
      : resolveMove(
          state.map.player,
          to,
          mode.terrain,
          movementTileAt(state),
          mode.distance,
        );
  const destination = path[path.length - 1];
  const distance =
    mode.kind === "teleport"
      ? hexDistance(state.map.player, to)
      : path.length - 1;
  const paid = payForPlay(state, phase.card);
  const playedThisTurn = paid.turnState.cardsPlayedThisTurn + 1;
  const distanceThisTurn = paid.turnState.distanceThisTurn + distance;
  const moved: GameState = {
    ...paid,
    deck: discardPlayed(paid.deck, phase.card),
    stats: recordCardsPlayedInTurn(
      recordDistanceInTurn(
        countPlay(paid.stats, phase.card.id),
        distanceThisTurn,
      ),
      playedThisTurn,
    ),
    map: { ...paid.map, player: destination, previous: paid.map.player },
    phase: { kind: "playing" },
    turnState: {
      ...paid.turnState,
      cardsPlayedThisTurn: playedThisTurn,
      distanceThisTurn,
    },
  };
  // Crossing into a new section streams the map, but never ends the turn.
  const next = onPlayerMoved(moved);
  // A teleport jumps instantly; a walk is shown hex by hex.
  if (mode.kind === "teleport") {
    return still(next);
  }
  return moving(next, [{ mover: { kind: "player" }, path }]);
}

export function cancelPending(state: GameState): Transition {
  switch (state.phase.kind) {
    case "pending-card":
      return still({ ...state, phase: { kind: "playing" } });
    case "playing":
    case "pending-discard":
    case "pending-sleep":
    case "pending-search":
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
  return still(
    applyOnDiscard(
      { ...state, deck, stats: countDiscarded(state.stats, [card]) },
      [card],
    ),
  );
}

export function startTurn(state: GameState): GameState {
  const drawn = drawUpTo(state.deck, HAND_SIZE, state.rng);
  const next: GameState = {
    ...state,
    deck: drawn.deck,
    rng: drawn.rng,
    stats: countDrawn(state.stats, drawn.drawn),
    terrainTrivialTurns: Math.max(0, state.terrainTrivialTurns - 1),
    turnState: {
      cardsPlayedThisTurn: 0,
      distanceThisTurn: 0,
      enemiesKilledThisTurn: 0,
      currencyEarnedThisTurn: 0,
      currencySpentThisTurn: 0,
      skipBonusTaken: false,
    },
  };
  // Surviving the enemy phase on the finish tile wins the run.
  if (playerOnFinish(next)) {
    return { ...next, phase: { kind: "game-over", reason: { kind: "victory" } } };
  }
  return next;
}

export function endTurn(state: GameState): Transition {
  if (state.phase.kind !== "playing") {
    return still(state);
  }
  const paid = takeSkipBonus(state);
  // The zone the player was shown when they committed to ending the turn. The
  // enemy phase checks its kills against this, so a death on a hex that was not
  // marked dangerous can be reported.
  const savedDangerZone = dangerZone(paid);
  const resolved = resolveEnemyPhase(
    paid,
    visibleReach(paid),
    savedDangerZone,
  );
  if (resolved.state.phase.kind === "game-over") {
    return resolved;
  }
  const next = startTurn({ ...resolved.state, turn: resolved.state.turn + 1 });
  return moving(next, resolved.moves);
}
