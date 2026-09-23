import type { HexCoord } from "./hex";
import type { GameState } from "./state";

/** Who a movement belongs to. */
export type Mover =
  | { kind: "player" }
  | { kind: "enemy"; id: string };

/**
 * One actor's movement as a hex-by-hex path, start and end included. The UI
 * walks a marker along it instead of teleporting to the destination.
 */
export type MovePath = {
  mover: Mover;
  path: readonly HexCoord[];
};

/** A new state plus the movements that produced it, in the order to show them. */
export type Transition = {
  state: GameState;
  moves: readonly MovePath[];
};

const NO_MOVES: readonly MovePath[] = [];

/** A transition where nothing moved. */
export function still(state: GameState): Transition {
  return { state, moves: NO_MOVES };
}

/** A transition where these movements happened, in order. */
export function moving(state: GameState, moves: readonly MovePath[]): Transition {
  return { state, moves };
}
