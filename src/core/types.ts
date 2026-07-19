// ---- マスタデータ ----
export type Category = "support" | "infra" | "security" | "dev" | "unreasonable";

export interface TroubleCard {
  id: string; // "Y1" など
  name: string;
  category: Category;
  urgent: boolean;
  cost: number; // 印刷コスト
  eval: number; // 印刷評価
}

export type EventId = "audit" | "holiday" | "budget";

export interface EventCard {
  id: EventId;
  name: string;
  description: string;
}

export type RoleId = "csirt" | "infra" | "dev" | "helpdesk";

export type SkillId = "incidentCommand" | "redundancy" | "autoScript" | "godResponse";

export interface RoleDef {
  id: RoleId;
  name: string;
  specialty: Category;
  skillId: SkillId;
  skillName: string;
  skillDescription: string;
}

// ---- 対戦設定 ----
export type NpcLevel = "easy" | "normal" | "hard";

export interface PlayerConfig {
  name: string;
  kind: "human" | "npc" | "remote"; // remote = PvPの相手
  npcLevel?: NpcLevel;
  role: RoleId;
}

export interface MatchConfig {
  seed: number; // 決定論的進行の元
  players: PlayerConfig[]; // 並び順=手番順(2〜4人)
}

// ---- ゲーム状態 ----
export type Phase = "incoming" | "response" | "closing" | "finished";

export interface PlayerState {
  config: PlayerConfig;
  tokens: number; // 現在の工数
  carryOver: number; // 冗長構成の繰越(次ラウンド加算分)
  score: number; // 評価(負値許容)
  gained: number; // 解決で得た評価の累計(リザルト内訳用)
  penalty: number; // 緊急残置ペナルティの累計(正の数で記録)
  resolved: string[]; // 解決したカードID(枚数タイブレークに使用)
  lastResolvedCategory: Category | null; // 自動化スクリプト判定用
  skillUsesLeft: number; // 残スキル回数(初期2)
  pendingCarryOverChoice: boolean; // 定時フェイズの冗長構成宣言待ち
}

export type LogEntry =
  | { type: "roundStart"; round: number }
  | { type: "reveal"; cardId: string }
  | { type: "event"; eventId: EventId }
  | {
      type: "resolve";
      player: number;
      cardId: string;
      cost: number;
      gain: number;
      skill: SkillId | null;
    }
  | { type: "pass"; player: number }
  | { type: "urgentPenalty"; cardIds: string[] }
  | { type: "carryOver"; player: number; amount: number }
  | { type: "gameEnd"; winners: number[] };

export interface GameState {
  round: number; // 1..5
  phase: Phase;
  players: PlayerState[];
  startPlayer: number; // このラウンドのスタートプレイヤー index
  turn: number; // 現在手番の players index(response中のみ有効)
  consecutivePasses: number; // 連続パス数(人数に達したらラウンド終了)
  deck: string[]; // 山札(カードID列。イベントは "E:audit" 形式。先頭=山の上)
  field: string[]; // 場のトラブルカードID
  discard: string[]; // 捨て札(トラブルカードのみ再シャッフル対象)
  activeEvents: EventId[]; // このラウンド有効なイベント(audit)
  rngState: number; // シード付き乱数の内部状態
  log: LogEntry[];
}

// ---- アクション ----
export type Action =
  | {
      type: "RESOLVE";
      player: number;
      cardId: string;
      useSkill?: "incidentCommand" | "autoScript" | "godResponse";
    }
  | { type: "PASS"; player: number }
  | { type: "CARRY_OVER"; player: number; use: boolean } // 冗長構成の宣言
  | { type: "ADVANCE" }; // 着信フェイズの進行(コントローラが駆動)

export const ROUNDS = 5;
export const TOKENS_PER_ROUND = 3;
export const SKILL_USES = 2;
