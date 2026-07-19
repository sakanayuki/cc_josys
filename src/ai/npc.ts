import { getRole, getTrouble } from "../core/cards";
import { computeResolution, legalActions } from "../core/engine";
import { next, nextInt } from "../core/rng";
import { ROUNDS, type Action, type GameState, type NpcLevel } from "../core/types";

interface Candidate {
  action: Extract<Action, { type: "RESOLVE" }>;
  cost: number;
  gain: number;
  urgent: boolean;
}

function candidates(state: GameState, me: number): Candidate[] {
  return legalActions(state, me)
    .filter((a): a is Extract<Action, { type: "RESOLVE" }> => a.type === "RESOLVE")
    .map((action) => {
      const { cost, gain } = computeResolution(state, me, action.cardId, action.useSkill);
      return { action, cost, gain, urgent: getTrouble(action.cardId).urgent };
    });
}

/**
 * NPCの1手を決める。思考の揺らぎ用乱数はゲーム状態とは別系統のrngStateを
 * 持ち回る(呼び出し側が保存する)。
 */
export function chooseNpcAction(
  state: GameState,
  me: number,
  level: NpcLevel,
  rngState: number,
): [Action, number] {
  const player = state.players[me];

  // 定時フェイズ: 冗長構成の宣言
  if (state.phase === "closing" && player.pendingCarryOverChoice) {
    const use =
      level !== "easy" && player.tokens >= 2 && state.round < ROUNDS;
    return [{ type: "CARRY_OVER", player: me, use }, rngState];
  }

  if (state.phase !== "response" || state.turn !== me) {
    throw new Error("npc asked to act out of turn");
  }

  switch (level) {
    case "easy":
      return chooseEasy(state, me, rngState);
    case "normal":
      return chooseNormal(state, me, rngState);
    case "hard":
      return chooseHard(state, me, rngState);
  }
}

/** 弱い: 気まぐれ。35%でパス、それ以外は取れるカードから一様ランダム。スキル不使用 */
function chooseEasy(state: GameState, me: number, rng: number): [Action, number] {
  const cands = candidates(state, me).filter((c) => !c.action.useSkill);
  let roll: number;
  [roll, rng] = next(rng);
  if (cands.length === 0 || roll < 0.35) {
    return [{ type: "PASS", player: me }, rng];
  }
  let idx: number;
  [idx, rng] = nextInt(rng, cands.length);
  return [cands[idx].action, rng];
}

/** ふつう: 貪欲法。評価と緊急を加味した価値最大のカードを取り、価値が無ければパス */
function chooseNormal(state: GameState, me: number, rng: number): [Action, number] {
  const cands = candidates(state, me);
  let best: Candidate | null = null;
  let bestValue = 0; // 価値0以下ならパス
  for (const c of cands) {
    const value = c.gain + (c.urgent ? 1 : 0) - 0.5 * c.cost;
    if (value > bestValue) {
      best = c;
      bestValue = value;
    }
  }
  if (!best) return [{ type: "PASS", player: me }, rng];
  return [best.action, rng];
}

/**
 * つよい: ラウンド配分(終盤ほどコストを軽視)、スキル温存、
 * 競り合う相手の専門カードのカット、緊急カードのチキンレース判断。
 */
function chooseHard(state: GameState, me: number, rng: number): [Action, number] {
  const cands = candidates(state, me);
  if (cands.length === 0) return [{ type: "PASS", player: me }, rng];

  const n = state.players.length;
  const myScore = state.players[me].score;
  // 終盤ほど工数を出し惜しみしない
  const costWeight = Math.max(0.1, 0.9 - 0.2 * (state.round - 1));
  // 自分のパスでラウンドが終わる局面か(=残り物は流れて緊急ペナルティ確定)
  const roundWouldEnd = state.consecutivePasses === n - 1;

  // 僅差で競っている相手の専門カテゴリ(カット対象)
  const rivalSpecialties = new Set(
    state.players
      .map((p, i) => ({ p, i }))
      .filter(({ p, i }) => i !== me && Math.abs(p.score - myScore) <= 3)
      .map(({ p }) => getRole(p.config.role).specialty),
  );

  // スキル温存: スキル版はスキル無し版よりどれだけ得か(marginal)が閾値以上のときのみ
  const skillThreshold = state.round <= 3 ? 2 : 1;
  const baseline = new Map<string, number>(); // cardId -> スキル無し版の value
  const value = (c: Candidate): number => {
    let v = c.gain - costWeight * c.cost;
    if (c.urgent) {
      // 誰かが拾いそうなら評価控えめ、自分のパスで流れるなら実質+枚数分の損回避
      v += roundWouldEnd ? 1.5 : likelyTakenByOther(state, me, c.action.cardId) ? 0.3 : 1.0;
    }
    if (rivalSpecialties.has(getTrouble(c.action.cardId).category)) v += 0.5;
    return v;
  };
  for (const c of cands) {
    if (!c.action.useSkill) baseline.set(c.action.cardId, value(c));
  }

  let best: Candidate | null = null;
  let bestValue = -Infinity;
  for (const c of cands) {
    let v = value(c);
    if (c.action.useSkill) {
      const base = baseline.get(c.action.cardId);
      const marginal = base === undefined ? v : v - base;
      if (marginal < skillThreshold) continue; // 温存
    }
    if (v > bestValue) {
      best = c;
      bestValue = v;
    }
  }

  if (!best) return [{ type: "PASS", player: me }, rng];

  // パスとの比較: 取る価値が僅かに負でも、自分のパスで緊急が流れるなら拾う
  if (bestValue <= 0) {
    const urgentLeft = state.field.filter((id) => getTrouble(id).urgent).length;
    if (!(roundWouldEnd && urgentLeft > 0 && bestValue > -urgentLeft)) {
      return [{ type: "PASS", player: me }, rng];
    }
  }
  return [best.action, rng];
}

/** 他プレイヤーがこのカードを取りそうか(専門かつ支払い可能な相手がいるか)の簡易推定 */
function likelyTakenByOther(state: GameState, me: number, cardId: string): boolean {
  const card = getTrouble(cardId);
  return state.players.some((p, i) => {
    if (i === me) return false;
    const role = getRole(p.config.role);
    if (role.specialty !== card.category) return false;
    const cost = Math.max(1, card.cost - 1);
    return p.tokens >= cost;
  });
}
