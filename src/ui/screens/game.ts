import { CATEGORY_INFO, getEvent, getRole, getTrouble } from "../../core/cards";
import { computeResolution, IllegalActionError } from "../../core/engine";
import type { GameState, LogEntry, SkillId } from "../../core/types";
import type { Session } from "../../controller/session";
import { cutIn, h, openSheet, toast } from "../dom";
import { show } from "../router";
import { cardTile } from "../components/card";
import { resultScreen } from "./result";

const PHASE_LABELS = {
  incoming: "着信中…",
  response: "対応フェイズ",
  closing: "定時フェイズ",
  finished: "終業",
} as const;

export function gameScreen(session: Session): HTMLElement {
  const container = h("div", { class: "screen game-screen" });
  let lastLogLen = 0;
  let carrySheetOpen = false;
  let activeSheet: { close: () => void } | null = null;
  let navigated = false;
  let prevPhase: string | null = null;
  let prevTurn = -1;

  const unsub = session.subscribe(render);
  session.onDisconnect = () => {
    if (navigated) return;
    navigated = true;
    toast("通信が切断されました");
    unsub();
    show(resultScreen(session, { disconnected: true }));
  };

  function me(s: GameState) {
    return s.players[session.meIndex];
  }

  function announce(entry: LogEntry, s: GameState): void {
    switch (entry.type) {
      case "roundStart":
        toast(`${entry.round}日目 スタート(工数支給)`);
        break;
      case "event": {
        const ev = getEvent(entry.eventId);
        cutIn(`イベント「${ev.name}」`, ev.description, "event");
        break;
      }
      case "urgentPenalty":
        toast(`【緊急】${entry.cardIds.length}件を放置! 全員 評価−${entry.cardIds.length}`, 3500);
        break;
      case "resolve":
        if (entry.player !== session.meIndex) {
          const who = s.players[entry.player].config.name;
          const skillNote =
            entry.skill !== null
              ? `〔${getRole(s.players[entry.player].config.role).skillName}〕`
              : "";
          toast(`${who}が「${getTrouble(entry.cardId).name}」を解決 ★${entry.gain}${skillNote}`);
        }
        break;
      default:
        break;
    }
  }

  function render(): void {
    if (navigated) return;
    const s = session.getState();

    for (let i = lastLogLen; i < s.log.length; i++) announce(s.log[i], s);
    lastLogLen = s.log.length;

    if (s.phase === "finished") {
      navigated = true;
      unsub();
      activeSheet?.close();
      setTimeout(() => show(resultScreen(session, {})), 900);
      return;
    }

    const myTurn = s.phase === "response" && s.turn === session.meIndex;

    // 着信直後の配札アニメーションと、自分の手番が来たときのカットイン
    const justDealt = prevPhase === "incoming" && s.phase === "response";
    const becameMyTurn =
      myTurn && !(prevPhase === "response" && prevTurn === session.meIndex);
    prevPhase = s.phase;
    prevTurn = s.turn;
    if (becameMyTurn) {
      cutIn("あなたの番です!", "カードを選ぶかパスしてください", "turn");
    }

    // 場札のスクロール位置を保持したまま再描画する
    const prevField = container.querySelector(".field-scroll");
    const scrollTop = prevField ? prevField.scrollTop : 0;

    container.replaceChildren(
      renderStatusBar(s),
      renderOthers(s),
      renderField(s, myTurn, justDealt),
      renderMyPanel(s, myTurn),
    );

    const newField = container.querySelector(".field-scroll");
    if (newField) newField.scrollTop = scrollTop;

    maybePromptCarryOver(s);
  }

  function renderStatusBar(s: GameState): HTMLElement {
    return h(
      "div",
      { class: "status-bar" },
      h("span", { class: "round-label" }, `${s.round}日目 / 5日`),
      h("span", { class: "phase-label" }, PHASE_LABELS[s.phase]),
      s.activeEvents.includes("audit")
        ? h("span", { class: "event-badge" }, "監査中: 赤+1")
        : null,
    );
  }

  function renderOthers(s: GameState): HTMLElement {
    return h(
      "div",
      { class: "others" },
      s.players.map((p, i) => {
        if (i === session.meIndex) return null;
        const role = getRole(p.config.role);
        const isTurn = s.phase === "response" && s.turn === i;
        return h(
          "button",
          {
            class: `player-chip${isTurn ? " turn" : ""}`,
            type: "button",
            onClick: () => openRoleSheet(i),
          },
          h("span", { class: "p-name" }, p.config.name),
          h("span", { class: "p-role", style: `color:${CATEGORY_INFO[role.specialty].color}` }, role.name.split("(")[0]),
          h("span", { class: "p-stat" }, `★${p.score}`),
          h("span", { class: "p-stat" }, `⚙${p.tokens}`),
          h("span", { class: "p-stat" }, `技${p.skillUsesLeft}`),
          isTurn ? h("span", { class: "turn-marker" }, "考え中") : h("span", { class: "chip-info" }, "ⓘ"),
        );
      }),
    );
  }

  /** 役割・固有スキルの参照シート(プレイヤー行タップでいつでも開ける) */
  function openRoleSheet(idx: number): void {
    const s = session.getState();
    const p = s.players[idx];
    const role = getRole(p.config.role);
    const cat = CATEGORY_INFO[role.specialty];
    openSheet(
      h(
        "div",
        { class: "role-sheet" },
        h("h3", null, `${p.config.name}${idx === session.meIndex ? "(あなた)" : ""}の役割`),
        h(
          "div",
          { class: "detail-head", style: `background:${cat.color}` },
          h("span", null, role.name),
        ),
        h(
          "p",
          { class: "role-line" },
          h("strong", null, "専門分野: "),
          h("span", { style: `color:${cat.color}` }, cat.name),
          h("span", null, " — 同カテゴリはコスト−1(最低1)・評価+1"),
        ),
        h(
          "p",
          { class: "role-line" },
          h("strong", null, `固有スキル「${role.skillName}」`),
          h("span", { class: "skill-uses" }, ` 残り${p.skillUsesLeft}回`),
        ),
        h("p", { class: "hint" }, role.skillDescription),
        h(
          "div",
          { class: "role-sheet-stats" },
          h("span", null, `評価 ★${p.score}`),
          h("span", null, `工数 ⚙${p.tokens}`),
          h("span", null, `解決 ${p.resolved.length}枚`),
        ),
      ),
    );
  }

  function renderField(s: GameState, myTurn: boolean, justDealt: boolean): HTMLElement {
    let inner: HTMLElement;
    if (s.phase === "incoming") {
      inner = h("div", { class: "field-empty" }, "☎ トラブル着信中…");
    } else if (s.field.length === 0) {
      inner = h("div", { class: "field-empty" }, "場のトラブルはすべて対応済み!");
    } else {
      inner = h(
        "div",
        { class: "field-grid" },
        s.field.map((id, i) => {
          const tile = cardTile(id, {
            onClick: () => openCardSheet(id),
            dimmed: myTurn && !isAffordable(s, id),
          });
          if (justDealt) {
            tile.classList.add("deal-in");
            tile.style.animationDelay = `${i * 110}ms`;
          }
          return tile;
        }),
      );
    }
    return h("div", { class: "field-scroll" }, inner);
  }

  function isAffordable(s: GameState, cardId: string): boolean {
    try {
      const { cost } = computeResolution(s, session.meIndex, cardId);
      return me(s).tokens >= cost;
    } catch {
      return false;
    }
  }

  function renderMyPanel(s: GameState, myTurn: boolean): HTMLElement {
    const my = me(s);
    const role = getRole(my.config.role);
    const cat = CATEGORY_INFO[role.specialty];
    return h(
      "div",
      { class: `my-panel${myTurn ? " turn" : ""}` },
      h(
        "div",
        { class: "my-info" },
        h(
          "div",
          { class: "my-name-row" },
          h(
            "span",
            { class: "p-name" },
            my.config.name === "あなた" ? "あなた" : `${my.config.name}(あなた)`,
          ),
          h("span", { class: "p-stat big" }, `★${my.score}`),
          h("span", { class: "p-stat big" }, `⚙${my.tokens}`),
        ),
        h(
          "button",
          {
            class: "my-role-btn",
            type: "button",
            style: `--role-color:${cat.color}`,
            onClick: () => openRoleSheet(session.meIndex),
          },
          h("span", { class: "my-role-name" }, role.name),
          h("span", { class: "my-role-skill" }, `${role.skillName} 残${my.skillUsesLeft}回`),
          h("span", { class: "my-role-chevron" }, "❯"),
        ),
        h(
          "div",
          { class: "turn-note" },
          s.phase === "response"
            ? myTurn
              ? "あなたの番です。カードを選ぶかパスしてください"
              : `${s.players[s.turn].config.name} の番です`
            : "",
        ),
      ),
      h(
        "div",
        { class: "action-bar" },
        h(
          "button",
          {
            class: "btn",
            type: "button",
            disabled: !myTurn,
            onClick: () => {
              try {
                session.act({ type: "PASS", player: session.meIndex });
              } catch (e) {
                if (e instanceof IllegalActionError) toast("今はパスできません");
                else throw e;
              }
            },
          },
          "パス",
        ),
        h("button", { class: "btn", type: "button", onClick: openLogSheet }, "ログ📜"),
      ),
    );
  }

  function openCardSheet(cardId: string): void {
    const s = session.getState();
    const card = getTrouble(cardId);
    const my = me(s);
    const role = getRole(my.config.role);
    const myTurn = s.phase === "response" && s.turn === session.meIndex;
    const cat = CATEGORY_INFO[card.category];

    const base = computeResolution(s, session.meIndex, cardId);
    let skillRes: ReturnType<typeof computeResolution> | null = null;
    const resolveSkill = role.skillId as SkillId;
    if (resolveSkill !== "redundancy" && my.skillUsesLeft > 0) {
      try {
        skillRes = computeResolution(
          s,
          session.meIndex,
          cardId,
          resolveSkill as "incidentCommand" | "autoScript" | "godResponse",
        );
      } catch {
        skillRes = null;
      }
    }

    let useSkill = false;
    const costLine = h("div", { class: "sheet-cost" });
    const resolveBtn = h("button", {
      class: "btn btn-primary btn-wide",
      type: "button",
    }) as HTMLButtonElement;

    const update = () => {
      const r = useSkill && skillRes ? skillRes : base;
      costLine.replaceChildren(
        h("span", null, `支払い ⚙${r.cost}`),
        h("span", null, `獲得 ★${r.gain}`),
      );
      const affordable = my.tokens >= r.cost;
      resolveBtn.disabled = !myTurn || !affordable;
      resolveBtn.textContent = !myTurn
        ? "あなたの番ではありません"
        : affordable
          ? `解決する(⚙${r.cost}払う)`
          : "工数が足りません";
    };

    const content = h(
      "div",
      { class: "card-detail" },
      h(
        "div",
        { class: "detail-head", style: `background:${cat.color}` },
        h("span", null, cat.name),
        h("span", null, card.id),
      ),
      card.urgent ? h("span", { class: "urgent-badge inline" }, "緊急") : null,
      h("h3", { class: "detail-name" }, card.name),
      h(
        "div",
        { class: "detail-stats" },
        h("span", null, `コスト(工数) ${card.cost}`),
        h("span", null, `評価 ${card.eval}`),
        role.specialty === card.category ? h("span", { class: "specialty-note" }, "専門: コスト−1・評価+1") : null,
      ),
      skillRes
        ? h(
            "label",
            { class: "skill-toggle" },
            h("input", {
              type: "checkbox",
              onChange: (e: Event) => {
                useSkill = (e.target as HTMLInputElement).checked;
                update();
              },
            }),
            h("span", null, `${role.skillName}を使う(残${my.skillUsesLeft}回)`),
          )
        : null,
      costLine,
      resolveBtn,
    );

    resolveBtn.addEventListener("click", () => {
      try {
        session.act({
          type: "RESOLVE",
          player: session.meIndex,
          cardId,
          useSkill:
            useSkill && skillRes
              ? (resolveSkill as "incidentCommand" | "autoScript" | "godResponse")
              : undefined,
        });
        sheet.close();
        activeSheet = null;
      } catch (e) {
        if (e instanceof IllegalActionError) toast("いまは解決できません");
        else throw e;
      }
    });

    update();
    const sheet = openSheet(content);
    activeSheet = sheet;
  }

  function maybePromptCarryOver(s: GameState): void {
    const my = me(s);
    if (!my.pendingCarryOverChoice) {
      carrySheetOpen = false;
      return;
    }
    if (carrySheetOpen) return;
    carrySheetOpen = true;
    const role = getRole(my.config.role);
    const sheet = openSheet(
      h(
        "div",
        { class: "carry-sheet" },
        h("h3", null, `${role.skillName}を使いますか?`),
        h("p", { class: "hint" }, `残り工数⚙${my.tokens}を次のラウンドへ繰り越せます(スキル残${my.skillUsesLeft}回)`),
        h(
          "button",
          {
            class: "btn btn-primary btn-wide",
            type: "button",
            onClick: () => {
              session.act({ type: "CARRY_OVER", player: session.meIndex, use: true });
              sheet.close();
            },
          },
          `使う(⚙${my.tokens}繰り越し)`,
        ),
        h(
          "button",
          {
            class: "btn btn-wide",
            type: "button",
            onClick: () => {
              session.act({ type: "CARRY_OVER", player: session.meIndex, use: false });
              sheet.close();
            },
          },
          "使わない(工数は返却)",
        ),
      ),
      { dismissible: false },
    );
  }

  function openLogSheet(): void {
    const s = session.getState();
    const items = s.log
      .map((entry) => formatLog(entry, s))
      .filter((t): t is string => t !== null)
      .map((t) => h("li", null, t));
    openSheet(
      h(
        "div",
        { class: "log-sheet" },
        h("h3", null, "ログ"),
        h("ul", { class: "log-list" }, items.length ? items : h("li", null, "まだ何もありません")),
      ),
    );
  }

  render();
  return container;
}

function formatLog(entry: LogEntry, s: GameState): string | null {
  const name = (i: number) => s.players[i].config.name;
  switch (entry.type) {
    case "roundStart":
      return `―― ${entry.round}日目 ――`;
    case "event": {
      const ev = getEvent(entry.eventId);
      return `イベント「${ev.name}」: ${ev.description}`;
    }
    case "resolve": {
      const skill =
        entry.skill !== null
          ? `〔${getRole(s.players[entry.player].config.role).skillName}〕`
          : "";
      return `${name(entry.player)}: 「${getTrouble(entry.cardId).name}」を解決 ⚙${entry.cost}→★${entry.gain}${skill}`;
    }
    case "pass":
      return `${name(entry.player)}: パス`;
    case "urgentPenalty":
      return `緊急${entry.cardIds.length}件を放置 → 全員 評価−${entry.cardIds.length}`;
    case "carryOver":
      return `${name(entry.player)}: 冗長構成で⚙${entry.amount}を繰り越し`;
    case "gameEnd":
      return "終業。おつかれさまでした!";
    case "reveal":
      return null;
  }
}
