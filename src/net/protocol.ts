import type { Action, GameState, MatchConfig, RoleId } from "../core/types";

/** メッセージ互換性の版数。ゲームルールや状態形式を変えたら上げる */
export const PROTOCOL_VERSION = 1;

export type Msg =
  | { t: "hello"; v: number; name: string; host: boolean }
  | { t: "full" }
  | { t: "lobby"; roles: (RoleId | null)[]; ready: boolean[] }
  | { t: "pickRole"; role: RoleId }
  | { t: "start"; config: MatchConfig }
  | { t: "action"; a: Action }
  | { t: "state"; ver: number; s: GameState }
  | { t: "rematch"; accept?: boolean };

const MSG_TYPES = new Set([
  "hello",
  "full",
  "lobby",
  "pickRole",
  "start",
  "action",
  "state",
  "rematch",
]);

/** 受信データの緩い検証(詳細な整合性はエンジン側 legalActions で担保) */
export function asMsg(x: unknown): Msg | null {
  if (typeof x !== "object" || x === null) return null;
  const t = (x as { t?: unknown }).t;
  if (typeof t !== "string" || !MSG_TYPES.has(t)) return null;
  return x as Msg;
}
