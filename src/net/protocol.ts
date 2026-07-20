import type { Action, GameState, MatchConfig, RoleId } from "../core/types";

/** メッセージ互換性の版数。ゲームルールや状態形式を変えたら上げる */
export const PROTOCOL_VERSION = 3;

export type Msg =
  | { t: "hello"; v: number; name: string; host: boolean }
  | { t: "full" }
  // ホスト→各ゲスト: ロビー状態(namesとrolesは手番順、yourIndexは宛先ゲストの席)
  | { t: "lobby"; names: string[]; roles: (RoleId | null)[]; yourIndex: number }
  | { t: "pickRole"; role: RoleId }
  | { t: "start"; config: MatchConfig; yourIndex: number }
  | { t: "action"; a: Action }
  | { t: "state"; ver: number; s: GameState }
  // ホスト→ゲスト: メンバー切断等で対戦を中断する
  | { t: "abort" }
  | { t: "rematch"; accept?: boolean };

const MSG_TYPES = new Set([
  "hello",
  "full",
  "lobby",
  "pickRole",
  "start",
  "action",
  "state",
  "abort",
  "rematch",
]);

/** 受信データの緩い検証(詳細な整合性はエンジン側 legalActions で担保) */
export function asMsg(x: unknown): Msg | null {
  if (typeof x !== "object" || x === null) return null;
  const t = (x as { t?: unknown }).t;
  if (typeof t !== "string" || !MSG_TYPES.has(t)) return null;
  return x as Msg;
}
