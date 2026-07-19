import { describe, expect, it } from "vitest";
import { initGame } from "../src/core/engine";
import { makeConfig, playGame, randomPolicy } from "./helpers";

describe("決定論性", () => {
  it("同一シード+同一アクション列は完全に同じ結果になる", () => {
    for (const seed of [1, 99, 20260719]) {
      const config = makeConfig(seed, ["csirt", "infra", "dev"]);
      const a = playGame(initGame(config), () => randomPolicy, seed * 7 + 1);
      const b = playGame(initGame(config), () => randomPolicy, seed * 7 + 1);
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });
});
