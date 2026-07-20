import { describe, expect, it } from "vitest";
import { TROUBLE_CARDS, getTrouble } from "../src/core/cards";
import {
  applyAction,
  computeResolution,
  IllegalActionError,
  initGame,
  legalActions,
  winners,
} from "../src/core/engine";
import type { GameState } from "../src/core/types";
import { makeConfig } from "./helpers";

/**
 * 山札を差し替えた2人戦の状態を作る。
 * 既定の役割はcsirt+dev(インフラ担当を含めると定時フェイズで冗長構成の
 * 宣言待ちが入り、ラウンド進行のテストが煩雑になるため)。
 */
function stateWithDeck(deck: string[], roles = ["csirt", "dev"] as const): GameState {
  const s = initGame(makeConfig(42, [...roles]));
  s.deck = deck.slice();
  return s;
}

describe("initGame", () => {
  it("2人戦: 未使用2役割の専門カテゴリから各3枚抜き、山札は34+イベント3枚", () => {
    const s = initGame(makeConfig(1, ["csirt", "infra"]));
    const troubles = s.deck.filter((id) => !id.startsWith("E:"));
    const events = s.deck.filter((id) => id.startsWith("E:"));
    expect(troubles).toHaveLength(34);
    expect(events).toHaveLength(4);
    // 未使用: dev(緑9→6), helpdesk(support9→6)
    expect(troubles.filter((id) => getTrouble(id).category === "dev")).toHaveLength(6);
    expect(troubles.filter((id) => getTrouble(id).category === "support")).toHaveLength(6);
    expect(troubles.filter((id) => getTrouble(id).category === "security")).toHaveLength(9);
    expect(troubles.filter((id) => getTrouble(id).category === "unreasonable")).toHaveLength(4);
  });

  it("3人戦: 37枚、4人戦: 40枚", () => {
    const s3 = initGame(makeConfig(1, ["csirt", "infra", "dev"]));
    expect(s3.deck.filter((id) => !id.startsWith("E:"))).toHaveLength(37);
    const s4 = initGame(makeConfig(1, ["csirt", "infra", "dev", "helpdesk"]));
    expect(s4.deck.filter((id) => !id.startsWith("E:"))).toHaveLength(40);
  });

  it("役割重複はエラー", () => {
    expect(() => initGame(makeConfig(1, ["csirt", "csirt"]))).toThrow();
  });
});

describe("着信フェイズ", () => {
  it("人数+2枚を公開して対応フェイズへ", () => {
    const s = stateWithDeck(["Y1", "Y2", "S1", "S2", "I1", "I2"]);
    const s2 = applyAction(s, { type: "ADVANCE" });
    expect(s2.phase).toBe("response");
    expect(s2.field).toEqual(["Y1", "Y2", "S1", "S2"]);
    expect(s2.deck).toEqual(["I1", "I2"]);
  });

  it("イベント: 予算が下りたで全員+1、補充で場は人数+2枚のまま", () => {
    const s = stateWithDeck(["Y1", "E:budget", "Y2", "S1", "S2", "I1"]);
    const s2 = applyAction(s, { type: "ADVANCE" });
    expect(s2.field).toHaveLength(4);
    expect(s2.players.every((p) => p.tokens === 4)).toBe(true);
  });

  it("イベント: 大型連休明けで場が+2枚", () => {
    const s = stateWithDeck(["E:holiday", "Y1", "Y2", "S1", "S2", "I1", "I2", "A1"]);
    const s2 = applyAction(s, { type: "ADVANCE" });
    expect(s2.field).toHaveLength(6);
  });

  it("イベント: 自動化ブームはアプリ開発担当だけ工数+2", () => {
    let s = initGame(makeConfig(7, ["dev", "infra"]));
    s.deck = ["E:automation", "Y1", "Y2", "S1", "S2", "I1"];
    s = applyAction(s, { type: "ADVANCE" });
    expect(s.players[0].tokens).toBe(5); // dev: 3+2
    expect(s.players[1].tokens).toBe(3);

    // アプリ開発担当が不在なら誰も増えない
    let s2 = initGame(makeConfig(7, ["csirt", "infra"]));
    s2.deck = ["E:automation", "Y1", "Y2", "S1", "S2", "I1"];
    s2 = applyAction(s2, { type: "ADVANCE" });
    expect(s2.players.every((p) => p.tokens === 3)).toBe(true);
  });

  it("イベント: 監査が入るはこのラウンドの赤解決を+1", () => {
    const s = stateWithDeck(["E:audit", "S1", "Y1", "Y2", "I1", "I4"]);
    const s2 = applyAction(s, { type: "ADVANCE" });
    expect(s2.activeEvents).toContain("audit");
    // S1(赤 印刷2): csirt専門+1, 監査+1 → 4
    const r = computeResolution(s2, 0, "S1");
    expect(r.gain).toBe(4);
    expect(r.cost).toBe(1);
  });
});

describe("対応フェイズ", () => {
  it("専門割引はコスト−1(最低1)、評価+1", () => {
    const s = stateWithDeck(["S4", "Y1", "I1", "I4"]); // S4: 赤 cost1 eval1
    const s2 = applyAction(s, { type: "ADVANCE" });
    const r = computeResolution(s2, 0, "S4"); // csirt
    expect(r.cost).toBe(1); // 1-1=0だが最低1
    expect(r.gain).toBe(2);
    const rInfra = computeResolution(s2, 1, "S4"); // 専門外
    expect(rInfra.cost).toBe(1);
    expect(rInfra.gain).toBe(1);
  });

  it("解決で工数を払いスコアが増え、手番が移る", () => {
    let s = stateWithDeck(["I1", "Y1", "Y2", "S1"]);
    s.startPlayer = 0;
    s = applyAction(s, { type: "ADVANCE" });
    const before = s.players[0].tokens;
    const s2 = applyAction(s, { type: "RESOLVE", player: 0, cardId: "Y1" });
    expect(s2.players[0].tokens).toBe(before - 1);
    expect(s2.players[0].score).toBe(1);
    expect(s2.players[0].resolved).toEqual(["Y1"]);
    expect(s2.turn).toBe(1);
    expect(s2.field).not.toContain("Y1");
  });

  it("工数不足のカードは取れない", () => {
    let s = stateWithDeck(["I2", "Y1", "Y2", "S1"]);
    s.startPlayer = 0;
    s = applyAction(s, { type: "ADVANCE" });
    s.players[0].tokens = 2; // I2はcsirtにはコスト3
    expect(() => applyAction(s, { type: "RESOLVE", player: 0, cardId: "I2" })).toThrow(
      IllegalActionError,
    );
  });

  it("手番以外のアクションは不正", () => {
    let s = stateWithDeck(["Y1", "Y2", "S1", "I1"]);
    s.startPlayer = 0;
    s = applyAction(s, { type: "ADVANCE" });
    expect(() => applyAction(s, { type: "PASS", player: 1 })).toThrow(IllegalActionError);
  });

  it("場のカードがすべて解決されたら自動でラウンドが終わる", () => {
    let s = stateWithDeck(["Y1", "Y4", "Y5", "I9", "I1"]); // 全てコスト1
    s.startPlayer = 0;
    s = applyAction(s, { type: "ADVANCE" });
    s.players[0].tokens = 4;
    s.players[1].tokens = 4;
    s = applyAction(s, { type: "RESOLVE", player: 0, cardId: "Y1" });
    s = applyAction(s, { type: "RESOLVE", player: 1, cardId: "Y4" });
    s = applyAction(s, { type: "RESOLVE", player: 0, cardId: "Y5" });
    expect(s.round).toBe(1); // まだ1枚残っている
    s = applyAction(s, { type: "RESOLVE", player: 1, cardId: "I9" });
    // 最後の1枚が解決された時点でパス不要で次の日へ
    expect(s.round).toBe(2);
    expect(s.phase).toBe("incoming");
  });

  it("全員連続パスでラウンド終了、間に解決が入るとリセット", () => {
    let s = stateWithDeck(["Y1", "Y2", "S1", "I1"]);
    s.startPlayer = 0;
    s = applyAction(s, { type: "ADVANCE" });
    s = applyAction(s, { type: "PASS", player: 0 });
    expect(s.phase).toBe("response");
    s = applyAction(s, { type: "RESOLVE", player: 1, cardId: "I1" });
    expect(s.consecutivePasses).toBe(0);
    s = applyAction(s, { type: "PASS", player: 0 });
    s = applyAction(s, { type: "PASS", player: 1 });
    // 2人連続パス → 定時フェイズ経由で次ラウンドへ
    expect(s.round).toBe(2);
    expect(s.phase).toBe("incoming");
  });
});

describe("定時フェイズ", () => {
  function passOut(s: GameState): GameState {
    let cur = s;
    let guard = 0;
    while (cur.phase === "response" && guard++ < 10) {
      cur = applyAction(cur, { type: "PASS", player: cur.turn });
    }
    // 冗長構成の宣言待ちが入った場合は「使わない」で流す
    while (cur.phase === "closing") {
      const idx = cur.players.findIndex((p) => p.pendingCarryOverChoice);
      cur = applyAction(cur, { type: "CARRY_OVER", player: idx, use: false });
    }
    return cur;
  }

  it("緊急カード残置で全員に枚数分のペナルティ", () => {
    let s = stateWithDeck(["Y2", "S2", "Y1", "I1"]); // Y2,S2が緊急
    s.startPlayer = 0;
    s = applyAction(s, { type: "ADVANCE" });
    const s2 = passOut(s);
    expect(s2.players[0].score).toBe(-2);
    expect(s2.players[1].score).toBe(-2);
    expect(s2.players[0].penalty).toBe(2);
    expect(s2.round).toBe(2);
  });

  it("工数は毎ラウンド3にリセットされる", () => {
    let s = stateWithDeck(["Y1", "Y4", "Y5", "I9", "I1", "I4", "S1", "S4"]);
    s.startPlayer = 0;
    s = applyAction(s, { type: "ADVANCE" });
    s = applyAction(s, { type: "RESOLVE", player: 0, cardId: "Y1" });
    const s2 = passOut(s);
    expect(s2.round).toBe(2);
    expect(s2.players.every((p) => p.tokens === 3)).toBe(true);
  });

  it("5ラウンド目が終わるとゲーム終了", () => {
    let s = stateWithDeck(
      Array.from({ length: 30 }, (_, i) => ["Y1", "Y4", "Y5", "I1", "I4", "I7"][i % 6]),
    );
    // 重複IDはエンジン上は問題ない(テスト用)
    s.round = 5;
    s = applyAction(s, { type: "ADVANCE" });
    const s2 = passOut(s);
    expect(s2.phase).toBe("finished");
    expect(s2.log.at(-1)?.type).toBe("gameEnd");
  });
});

describe("スキル", () => {
  it("インシデント指揮: 緊急カードで+1、非緊急には使えない", () => {
    let s = stateWithDeck(["S2", "S1", "Y1", "I1"]); // S2緊急
    s.startPlayer = 0;
    s = applyAction(s, { type: "ADVANCE" });
    const r = computeResolution(s, 0, "S2", "incidentCommand");
    expect(r.gain).toBe(4 + 1 + 1); // 印刷4+専門1+指揮1
    expect(() => computeResolution(s, 0, "S1", "incidentCommand")).toThrow(IllegalActionError);
    const s2 = applyAction(s, {
      type: "RESOLVE",
      player: 0,
      cardId: "S2",
      useSkill: "incidentCommand",
    });
    expect(s2.players[0].skillUsesLeft).toBe(1);
  });

  it("神対応: 印刷コスト1のみ対象、加算合計後に2倍", () => {
    let s = initGame(makeConfig(7, ["helpdesk", "infra"]));
    s.deck = ["Y1", "Y6", "S4", "I1"];
    s.startPlayer = 0;
    s = applyAction(s, { type: "ADVANCE" });
    // Y1: 印刷1/1 専門+1 → 2 → 2倍で4
    expect(computeResolution(s, 0, "Y1", "godResponse").gain).toBe(4);
    // Y6: 印刷コスト2 → 不可(専門割引で1になっても対象外)
    expect(() => computeResolution(s, 0, "Y6", "godResponse")).toThrow(IllegalActionError);
    // S4: 専門外の印刷コスト1 → 1×2=2
    expect(computeResolution(s, 0, "S4", "godResponse").gain).toBe(2);
  });

  it("自動化スクリプト: 解決済みカテゴリのカードなら工数0(未解決カテゴリは不可)", () => {
    let s = initGame(makeConfig(7, ["dev", "infra"]));
    s.deck = ["A1", "A4", "Y1", "I1"];
    s.startPlayer = 0;
    s = applyAction(s, { type: "ADVANCE" });
    // まだ何も解決していない → 使えない
    expect(() => computeResolution(s, 0, "A4", "autoScript")).toThrow(IllegalActionError);
    s = applyAction(s, { type: "RESOLVE", player: 0, cardId: "A1" });
    s = applyAction(s, { type: "PASS", player: 1 });
    const r = computeResolution(s, 0, "A4", "autoScript");
    expect(r.cost).toBe(0);
    expect(r.gain).toBe(3); // 印刷2+専門1
    // 解決したことのないカテゴリ(黄)はまだ対象外
    expect(() => computeResolution(s, 0, "Y1", "autoScript")).toThrow(IllegalActionError);

    // 間に別カテゴリの解決を挟んでも、緑の解決実績は残り続ける
    s = applyAction(s, { type: "RESOLVE", player: 0, cardId: "Y1" });
    s = applyAction(s, { type: "PASS", player: 1 });
    expect(computeResolution(s, 0, "A4", "autoScript").cost).toBe(0);

    // 自動化スクリプトでの解決は手番を消費しない(続けて自分が動ける)
    s = applyAction(s, { type: "RESOLVE", player: 0, cardId: "A4", useSkill: "autoScript" });
    expect(s.phase).toBe("response");
    expect(s.turn).toBe(0);
    // 続けての行動(パス)は通常どおり手番を消費する
    s = applyAction(s, { type: "PASS", player: 0 });
    expect(s.turn).toBe(1);
  });

  it("冗長構成: 定時に宣言すると残工数を繰り越す。5ラウンド目は宣言不可", () => {
    let s = initGame(makeConfig(7, ["infra", "csirt"]));
    s.deck = ["Y1", "Y4", "S1", "S4", "I1", "I4", "A1", "A4"];
    s.startPlayer = 0;
    s = applyAction(s, { type: "ADVANCE" });
    s = applyAction(s, { type: "PASS", player: 0 });
    s = applyAction(s, { type: "PASS", player: 1 });
    expect(s.phase).toBe("closing");
    expect(s.players[0].pendingCarryOverChoice).toBe(true);
    const acts = legalActions(s, 0);
    expect(acts).toHaveLength(2);
    s = applyAction(s, { type: "CARRY_OVER", player: 0, use: true });
    expect(s.round).toBe(2);
    expect(s.players[0].tokens).toBe(6); // 3+3繰越
    expect(s.players[0].skillUsesLeft).toBe(1);
    expect(s.players[1].tokens).toBe(3);

    // 5ラウンド目は宣言なしで即終了
    let s5 = initGame(makeConfig(7, ["infra", "csirt"]));
    s5.deck = ["Y1", "Y4", "S1", "S4"];
    s5.round = 5;
    s5.startPlayer = 0;
    s5 = applyAction(s5, { type: "ADVANCE" });
    s5 = applyAction(s5, { type: "PASS", player: 0 });
    s5 = applyAction(s5, { type: "PASS", player: 1 });
    expect(s5.phase).toBe("finished");
  });

  it("スキル残0では使えない", () => {
    let s = stateWithDeck(["S2", "S3", "S5", "Y1"]);
    s.startPlayer = 0;
    s.players[0].skillUsesLeft = 0;
    s = applyAction(s, { type: "ADVANCE" });
    expect(() => computeResolution(s, 0, "S2", "incidentCommand")).toThrow(IllegalActionError);
  });
});

describe("勝敗", () => {
  it("同点は解決枚数で、それも同じなら合同MVP", () => {
    const s = initGame(makeConfig(1, ["csirt", "infra", "dev"]));
    s.phase = "finished";
    s.players[0].score = 10;
    s.players[0].resolved = ["Y1", "Y2"];
    s.players[1].score = 10;
    s.players[1].resolved = ["Y3", "Y4", "Y5"];
    s.players[2].score = 9;
    expect(winners(s)).toEqual([1]);
    s.players[0].resolved = ["Y1", "Y2", "S1"];
    expect(winners(s).sort()).toEqual([0, 1]);
  });
});

describe("カードマスタ", () => {
  it("40枚・カテゴリ内訳・緊急15枚がルールブックと一致", () => {
    expect(TROUBLE_CARDS).toHaveLength(40);
    const byCat = (cat: string) => TROUBLE_CARDS.filter((c) => c.category === cat);
    expect(byCat("support")).toHaveLength(9);
    expect(byCat("infra")).toHaveLength(9);
    expect(byCat("security")).toHaveLength(9);
    expect(byCat("dev")).toHaveLength(9);
    expect(byCat("unreasonable")).toHaveLength(4);
    expect(TROUBLE_CARDS.filter((c) => c.urgent)).toHaveLength(15);
    // インフラは緊急最多の4枚
    expect(byCat("infra").filter((c) => c.urgent)).toHaveLength(4);
  });
});
