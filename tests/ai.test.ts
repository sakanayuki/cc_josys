import { describe, expect, it } from "vitest";
import { chooseNpcAction } from "../src/ai/npc";
import { initGame, winners } from "../src/core/engine";
import type { NpcLevel, RoleId } from "../src/core/types";
import { makeConfig, playGame, type Policy } from "./helpers";

function npcPolicy(level: NpcLevel): Policy {
  return (state, playerIndex, rng) => chooseNpcAction(state, playerIndex, level, rng);
}

/** 2人のNPCを対戦させ、各レベルの勝ち数を返す(引き分けはノーカウント) */
function faceOff(levelA: NpcLevel, levelB: NpcLevel, games: number): [number, number] {
  let winsA = 0;
  let winsB = 0;
  const rolePairs: [RoleId, RoleId][] = [
    ["csirt", "infra"],
    ["dev", "helpdesk"],
    ["infra", "helpdesk"],
    ["csirt", "dev"],
  ];
  for (let i = 0; i < games; i++) {
    // 役割・先手番の偏りを消すため、半分はAとBを入れ替える
    const swap = i % 2 === 1;
    const [r0, r1] = rolePairs[i % rolePairs.length];
    const levels: NpcLevel[] = swap ? [levelB, levelA] : [levelA, levelB];
    const final = playGame(
      initGame(makeConfig(1000 + i, [r0, r1], levels)),
      (idx) => npcPolicy(levels[idx]),
      i * 13 + 5,
    );
    const w = winners(final);
    if (w.length === 1) {
      const winnerLevel = levels[w[0]];
      if (winnerLevel === levelA) winsA++;
      else winsB++;
    }
  }
  return [winsA, winsB];
}

describe("NPC強さの序列", () => {
  it("つよい > 弱い(100戦)", () => {
    const [hard, easy] = faceOff("hard", "easy", 100);
    expect(hard).toBeGreaterThan(easy);
  });

  it("ふつう > 弱い(100戦)", () => {
    const [normal, easy] = faceOff("normal", "easy", 100);
    expect(normal).toBeGreaterThan(easy);
  });

  it("つよい >= ふつう相当(100戦で大負けしない)", () => {
    const [hard, normal] = faceOff("hard", "normal", 100);
    // ヒューリスティック同士なので僅差は許容するが、明確に劣ってはならない
    expect(hard).toBeGreaterThanOrEqual(normal * 0.8);
  });

  it("全難易度が3〜4人戦でも完走できる", () => {
    for (const levels of [
      ["easy", "normal", "hard"] as NpcLevel[],
      ["easy", "normal", "hard", "normal"] as NpcLevel[],
    ]) {
      const roles: RoleId[] = ["csirt", "infra", "dev", "helpdesk"].slice(
        0,
        levels.length,
      ) as RoleId[];
      const final = playGame(
        initGame(makeConfig(555, roles, levels)),
        (idx) => npcPolicy(levels[idx]),
        99,
      );
      expect(final.phase).toBe("finished");
    }
  });
});
