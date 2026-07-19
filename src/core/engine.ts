import { getRole, getTrouble, TROUBLE_CARDS, EVENT_CARDS, ROLES } from "./cards";
import { nextInt, seedFrom, shuffle } from "./rng";
import {
  ROUNDS,
  SKILL_USES,
  TOKENS_PER_ROUND,
  type Action,
  type EventId,
  type GameState,
  type MatchConfig,
  type PlayerState,
  type TroubleCard,
} from "./types";

export class IllegalActionError extends Error {}

const EVENT_PREFIX = "E:";
/** 山札調整: 未使用役割の専門カテゴリから抜く枚数 */
const CARDS_REMOVED_PER_UNUSED_ROLE = 3;
/** 場に公開する枚数 = プレイヤー数 + FIELD_EXTRA */
const FIELD_EXTRA = 2;

function isEvent(deckId: string): boolean {
  return deckId.startsWith(EVENT_PREFIX);
}

function eventIdOf(deckId: string): EventId {
  return deckId.slice(EVENT_PREFIX.length) as EventId;
}

// ---------------- 初期化 ----------------

export function initGame(config: MatchConfig): GameState {
  const n = config.players.length;
  if (n < 2 || n > 4) throw new Error("players must be 2-4");
  const roles = config.players.map((p) => p.role);
  if (new Set(roles).size !== n) throw new Error("roles must be unique");

  let rng = seedFrom(config.seed);

  // 山札調整: 未使用役割の専門カテゴリからカテゴリごとに3枚ランダムに抜く
  const unusedSpecialties = ROLES.filter((r) => !roles.includes(r.id)).map(
    (r) => r.specialty,
  );
  let pool: TroubleCard[] = TROUBLE_CARDS.slice();
  for (const cat of unusedSpecialties) {
    const inCat = pool.filter((c) => c.category === cat);
    let shuffled: TroubleCard[];
    [shuffled, rng] = shuffle(rng, inCat);
    const removed = new Set(shuffled.slice(0, CARDS_REMOVED_PER_UNUSED_ROLE).map((c) => c.id));
    pool = pool.filter((c) => !removed.has(c.id));
  }

  const deckIds = [
    ...pool.map((c) => c.id),
    ...EVENT_CARDS.map((e) => EVENT_PREFIX + e.id),
  ];
  let deck: string[];
  [deck, rng] = shuffle(rng, deckIds);

  let startPlayer: number;
  [startPlayer, rng] = nextInt(rng, n);

  const players: PlayerState[] = config.players.map((pc) => ({
    config: pc,
    tokens: TOKENS_PER_ROUND,
    carryOver: 0,
    score: 0,
    gained: 0,
    penalty: 0,
    resolved: [],
    lastResolvedCategory: null,
    skillUsesLeft: SKILL_USES,
    pendingCarryOverChoice: false,
  }));

  return {
    round: 1,
    phase: "incoming",
    players,
    startPlayer,
    turn: startPlayer,
    consecutivePasses: 0,
    deck,
    field: [],
    discard: [],
    activeEvents: [],
    rngState: rng,
    log: [{ type: "roundStart", round: 1 }],
  };
}

// ---------------- 解決の計算 ----------------

export interface Resolution {
  cost: number;
  gain: number;
}

/**
 * カード解決時の支払いコストと獲得評価を計算する(状態は変更しない)。
 * 不正な組み合わせ(使えないスキル等)は IllegalActionError。
 */
export function computeResolution(
  state: GameState,
  playerIndex: number,
  cardId: string,
  useSkill?: "incidentCommand" | "autoScript" | "godResponse",
): Resolution {
  const player = state.players[playerIndex];
  const card = getTrouble(cardId);
  const role = getRole(player.config.role);
  const specialty = role.specialty === card.category;

  let cost = specialty ? Math.max(1, card.cost - 1) : card.cost;

  if (useSkill) {
    if (role.skillId !== useSkill) {
      throw new IllegalActionError(`role ${role.id} cannot use ${useSkill}`);
    }
    if (player.skillUsesLeft <= 0) {
      throw new IllegalActionError("no skill uses left");
    }
    if (useSkill === "incidentCommand" && !card.urgent) {
      throw new IllegalActionError("incidentCommand requires urgent card");
    }
    if (useSkill === "autoScript") {
      if (player.lastResolvedCategory !== card.category) {
        throw new IllegalActionError("autoScript requires same category as last resolved");
      }
      cost = 0;
    }
    if (useSkill === "godResponse" && card.cost !== 1) {
      throw new IllegalActionError("godResponse requires printed cost 1");
    }
  }

  let gain = card.eval;
  if (specialty) gain += 1;
  if (useSkill === "incidentCommand") gain += 1;
  if (state.activeEvents.includes("audit") && card.category === "security") gain += 1;
  if (useSkill === "godResponse") gain *= 2;

  return { cost, gain };
}

// ---------------- 合法手 ----------------

export function legalActions(state: GameState, playerIndex: number): Action[] {
  const player = state.players[playerIndex];
  const actions: Action[] = [];

  if (state.phase === "response" && state.turn === playerIndex) {
    for (const cardId of state.field) {
      const skills: (undefined | "incidentCommand" | "autoScript" | "godResponse")[] = [
        undefined,
      ];
      const role = getRole(player.config.role);
      if (role.skillId !== "redundancy" && player.skillUsesLeft > 0) {
        skills.push(role.skillId as "incidentCommand" | "autoScript" | "godResponse");
      }
      for (const useSkill of skills) {
        try {
          const { cost } = computeResolution(state, playerIndex, cardId, useSkill);
          if (player.tokens >= cost) {
            actions.push({ type: "RESOLVE", player: playerIndex, cardId, useSkill });
          }
        } catch (e) {
          if (!(e instanceof IllegalActionError)) throw e;
        }
      }
    }
    actions.push({ type: "PASS", player: playerIndex });
  }

  if (state.phase === "closing" && player.pendingCarryOverChoice) {
    actions.push({ type: "CARRY_OVER", player: playerIndex, use: true });
    actions.push({ type: "CARRY_OVER", player: playerIndex, use: false });
  }

  return actions;
}

// ---------------- 状態遷移 ----------------

export function applyAction(state: GameState, action: Action): GameState {
  const s = structuredClone(state);
  switch (action.type) {
    case "ADVANCE":
      return advanceIncoming(s);
    case "RESOLVE":
      return resolve(s, action);
    case "PASS":
      return pass(s, action);
    case "CARRY_OVER":
      return carryOver(s, action);
  }
}

/** 着信フェイズ: 場札を公開し、イベントを即適用して対応フェイズへ */
function advanceIncoming(s: GameState): GameState {
  if (s.phase !== "incoming") throw new IllegalActionError("not in incoming phase");
  const n = s.players.length;
  let toReveal = n + FIELD_EXTRA;
  let revealed = 0;

  while (revealed < toReveal) {
    if (s.deck.length === 0) {
      if (s.discard.length === 0) break; // 引き切り: あるだけで進行
      let reshuffled: string[];
      [reshuffled, s.rngState] = shuffle(s.rngState, s.discard);
      s.deck = reshuffled;
      s.discard = [];
    }
    const top = s.deck.shift()!;
    if (isEvent(top)) {
      const ev = eventIdOf(top);
      s.log.push({ type: "event", eventId: ev });
      if (ev === "audit") {
        s.activeEvents.push("audit");
      } else if (ev === "holiday") {
        toReveal += 2;
      } else if (ev === "budget") {
        for (const p of s.players) p.tokens += 1;
      }
      // イベントは適用後ゲームから除外(再シャッフル対象にしない)
    } else {
      s.field.push(top);
      s.log.push({ type: "reveal", cardId: top });
      revealed++;
    }
  }

  s.phase = "response";
  s.turn = s.startPlayer;
  s.consecutivePasses = 0;
  return s;
}

function resolve(
  s: GameState,
  action: Extract<Action, { type: "RESOLVE" }>,
): GameState {
  if (s.phase !== "response") throw new IllegalActionError("not in response phase");
  if (s.turn !== action.player) throw new IllegalActionError("not your turn");
  const idx = s.field.indexOf(action.cardId);
  if (idx < 0) throw new IllegalActionError("card not in field");

  const player = s.players[action.player];
  const { cost, gain } = computeResolution(s, action.player, action.cardId, action.useSkill);
  if (player.tokens < cost) throw new IllegalActionError("not enough tokens");

  const card = getTrouble(action.cardId);
  player.tokens -= cost;
  player.score += gain;
  player.gained += gain;
  player.resolved.push(card.id);
  player.lastResolvedCategory = card.category;
  if (action.useSkill) player.skillUsesLeft -= 1;
  s.field.splice(idx, 1);
  s.consecutivePasses = 0;
  s.log.push({
    type: "resolve",
    player: action.player,
    cardId: card.id,
    cost,
    gain,
    skill: action.useSkill ?? null,
  });
  s.turn = (s.turn + 1) % s.players.length;
  return s;
}

function pass(s: GameState, action: Extract<Action, { type: "PASS" }>): GameState {
  if (s.phase !== "response") throw new IllegalActionError("not in response phase");
  if (s.turn !== action.player) throw new IllegalActionError("not your turn");
  s.consecutivePasses += 1;
  s.log.push({ type: "pass", player: action.player });
  if (s.consecutivePasses >= s.players.length) {
    return enterClosing(s);
  }
  s.turn = (s.turn + 1) % s.players.length;
  return s;
}

/** 定時フェイズへ: 冗長構成の宣言待ちを設定。待ちがなければ即締め処理 */
function enterClosing(s: GameState): GameState {
  s.phase = "closing";
  let anyPending = false;
  for (const p of s.players) {
    const role = getRole(p.config.role);
    if (
      role.skillId === "redundancy" &&
      p.skillUsesLeft > 0 &&
      p.tokens > 0 &&
      s.round < ROUNDS
    ) {
      p.pendingCarryOverChoice = true;
      anyPending = true;
    }
  }
  return anyPending ? s : finishClosing(s);
}

function carryOver(
  s: GameState,
  action: Extract<Action, { type: "CARRY_OVER" }>,
): GameState {
  if (s.phase !== "closing") throw new IllegalActionError("not in closing phase");
  const player = s.players[action.player];
  if (!player.pendingCarryOverChoice) {
    throw new IllegalActionError("no carry-over choice pending");
  }
  player.pendingCarryOverChoice = false;
  if (action.use) {
    player.carryOver = player.tokens;
    player.skillUsesLeft -= 1;
    s.log.push({ type: "carryOver", player: action.player, amount: player.tokens });
  }
  if (s.players.some((p) => p.pendingCarryOverChoice)) return s;
  return finishClosing(s);
}

/** 締め処理: 緊急ペナルティ→場を流す→次ラウンド or 終了 */
function finishClosing(s: GameState): GameState {
  const urgentLeft = s.field.filter((id) => getTrouble(id).urgent);
  if (urgentLeft.length > 0) {
    for (const p of s.players) {
      p.score -= urgentLeft.length;
      p.penalty += urgentLeft.length;
    }
    s.log.push({ type: "urgentPenalty", cardIds: urgentLeft });
  }
  s.discard.push(...s.field);
  s.field = [];
  s.activeEvents = [];

  if (s.round >= ROUNDS) {
    s.phase = "finished";
    s.log.push({ type: "gameEnd", winners: winners(s) });
    return s;
  }

  s.round += 1;
  s.startPlayer = (s.startPlayer + 1) % s.players.length;
  s.turn = s.startPlayer;
  s.consecutivePasses = 0;
  s.phase = "incoming";
  for (const p of s.players) {
    p.tokens = TOKENS_PER_ROUND + p.carryOver;
    p.carryOver = 0;
  }
  s.log.push({ type: "roundStart", round: s.round });
  return s;
}

// ---------------- 順位 ----------------

/** 順位順のプレイヤーindex配列(評価→解決枚数の順で比較) */
export function ranking(s: GameState): number[] {
  return s.players
    .map((_, i) => i)
    .sort((a, b) => {
      const pa = s.players[a];
      const pb = s.players[b];
      if (pb.score !== pa.score) return pb.score - pa.score;
      return pb.resolved.length - pa.resolved.length;
    });
}

/** 同点タイブレーク込みの勝者(複数なら合同MVP) */
export function winners(s: GameState): number[] {
  const order = ranking(s);
  const top = s.players[order[0]];
  return order.filter((i) => {
    const p = s.players[i];
    return p.score === top.score && p.resolved.length === top.resolved.length;
  });
}
