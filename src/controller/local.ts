import { chooseNpcAction } from "../ai/npc";
import { applyAction, initGame } from "../core/engine";
import { seedFrom } from "../core/rng";
import type { Action, MatchConfig } from "../core/types";
import { BaseSession } from "./session";

/** 着信フェイズの演出待ち(ms) */
const ADVANCE_DELAY = 900;
/** NPCの思考演出(ms) */
const NPC_DELAY_MIN = 600;
const NPC_DELAY_RANGE = 800;

/** PvE: 人間1人+NPC1〜3体をローカルで進行する */
export class LocalSession extends BaseSession {
  readonly kind = "local" as const;
  readonly meIndex = 0;
  private aiRng: number;
  private timer: ReturnType<typeof setTimeout> | null = null;

  constructor(config: MatchConfig) {
    super(config, initGame(config));
    // AIの意思決定用乱数はゲーム本体と別系統(シードから派生)
    this.aiRng = seedFrom(config.seed ^ 0x5bd1e995);
    this.schedule();
  }

  act(action: Action): void {
    this.state = applyAction(this.state, action);
    this.notify();
    this.schedule();
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    super.dispose();
  }

  /** 次に自動で動くべきもの(着信めくり・NPC手番・NPCの繰越宣言)を予約する */
  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.disposed) return;
    const s = this.state;

    if (s.phase === "incoming") {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.act({ type: "ADVANCE" });
      }, ADVANCE_DELAY);
      return;
    }

    if (s.phase === "response") {
      const p = s.players[s.turn];
      if (p.config.kind === "npc") {
        const delay = NPC_DELAY_MIN + Math.random() * NPC_DELAY_RANGE;
        this.timer = setTimeout(() => {
          this.timer = null;
          const cur = this.state;
          const npc = cur.players[cur.turn];
          const [action, rng] = chooseNpcAction(cur, cur.turn, npc.config.npcLevel!, this.aiRng);
          this.aiRng = rng;
          this.act(action);
        }, delay);
      }
      return;
    }

    if (s.phase === "closing") {
      const idx = s.players.findIndex(
        (p) => p.pendingCarryOverChoice && p.config.kind === "npc",
      );
      if (idx >= 0) {
        this.timer = setTimeout(() => {
          this.timer = null;
          const cur = this.state;
          const npc = cur.players[idx];
          const [action, rng] = chooseNpcAction(cur, idx, npc.config.npcLevel!, this.aiRng);
          this.aiRng = rng;
          this.act(action);
        }, 500);
      }
    }
  }
}
