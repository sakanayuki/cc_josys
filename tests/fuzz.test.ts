import { describe, expect, it } from "vitest";
import { getTrouble } from "../src/core/cards";
import { initGame } from "../src/core/engine";
import type { RoleId } from "../src/core/types";
import { makeConfig, playGame, randomPolicy } from "./helpers";

const ROLE_SETS: RoleId[][] = [
  ["csirt", "infra"],
  ["helpdesk", "dev"],
  ["csirt", "infra", "dev"],
  ["csirt", "infra", "dev", "helpdesk"],
];

describe("ファズ: ランダム自己対戦", () => {
  it("1000ゲームが不変条件を守って完走する", () => {
    for (let i = 0; i < 1000; i++) {
      const roles = ROLE_SETS[i % ROLE_SETS.length];
      const initial = initGame(makeConfig(i + 1, roles));
      const initialTroubles = initial.deck.filter((id) => !id.startsWith("E:")).length;

      const final = playGame(initial, () => randomPolicy, i * 31 + 7);

      expect(final.phase).toBe("finished");
      expect(final.round).toBe(5);
      for (const p of final.players) {
        // 工数は負にならない
        expect(p.tokens).toBeGreaterThanOrEqual(0);
        // スコア = 獲得 − ペナルティ
        expect(p.score).toBe(p.gained - p.penalty);
        // 解決したカードは実在のトラブルカード
        for (const id of p.resolved) expect(() => getTrouble(id)).not.toThrow();
      }
      // カード保存則: 山札+場+捨て札+全員の解決済み = 初期トラブル枚数
      const remaining =
        final.deck.filter((id) => !id.startsWith("E:")).length +
        final.field.length +
        final.discard.length +
        final.players.reduce((acc, p) => acc + p.resolved.length, 0);
      expect(remaining).toBe(initialTroubles);
    }
  });
});
