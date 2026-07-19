import { applyAction, legalActions } from "../src/core/engine";
import { nextInt } from "../src/core/rng";
import type { Action, GameState, MatchConfig, NpcLevel, RoleId } from "../src/core/types";

export function makeConfig(
  seed: number,
  roles: RoleId[],
  levels?: (NpcLevel | "human")[],
): MatchConfig {
  return {
    seed,
    players: roles.map((role, i) => {
      const lv = levels?.[i] ?? "human";
      return lv === "human"
        ? { name: `P${i}`, kind: "human" as const, role }
        : { name: `NPC${i}`, kind: "npc" as const, npcLevel: lv, role };
    }),
  };
}

export type Policy = (state: GameState, playerIndex: number, rng: number) => [Action, number];

/** ランダムな合法手を選ぶポリシー */
export const randomPolicy: Policy = (state, playerIndex, rng) => {
  const actions = legalActions(state, playerIndex);
  if (actions.length === 0) throw new Error("no legal actions");
  const [idx, rng2] = nextInt(rng, actions.length);
  return [actions[idx], rng2];
};

/** ポリシーに従って1ゲームを最後まで進める */
export function playGame(
  initial: GameState,
  policyFor: (playerIndex: number) => Policy,
  rngSeed: number,
): GameState {
  let state = initial;
  let rng = rngSeed >>> 0;
  for (let step = 0; step < 10_000; step++) {
    if (state.phase === "finished") return state;
    if (state.phase === "incoming") {
      state = applyAction(state, { type: "ADVANCE" });
      continue;
    }
    let actor: number;
    if (state.phase === "response") {
      actor = state.turn;
    } else {
      actor = state.players.findIndex((p) => p.pendingCarryOverChoice);
      if (actor < 0) throw new Error("closing phase with no pending choice");
    }
    let action: Action;
    [action, rng] = policyFor(actor)(state, actor, rng);
    state = applyAction(state, action);
  }
  throw new Error("game did not finish within step budget");
}
