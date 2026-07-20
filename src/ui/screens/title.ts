import { h, openSheet } from "../dom";
import { show } from "../router";
import { matchingScreen } from "./matching";

const NAME_KEY = "josys.playerName";

export function getPlayerName(): string {
  return localStorage.getItem(NAME_KEY)?.trim() || "あなた";
}

export function titleScreen(): HTMLElement {
  const nameInput = h("input", {
    class: "text-input name-input",
    id: "player-name",
    type: "text",
    maxlength: "10",
    placeholder: "タップして入力",
    value: localStorage.getItem(NAME_KEY) ?? "",
    onInput: () => {
      localStorage.setItem(NAME_KEY, nameInput.value.trim());
    },
  }) as HTMLInputElement;

  return h(
    "div",
    { class: "screen title-screen" },
    h(
      "div",
      { class: "title-hero" },
      h("div", { class: "title-sub" }, "〜5営業日サバイバル・カードゲーム〜"),
      h("h1", { class: "title-logo" }, "情シス、出動。"),
      h("div", { class: "title-desc" }, "降りかかるトラブルを工数で解決し、今期のMVP情シスを目指せ"),
    ),
    h(
      "div",
      { class: "name-card" },
      h("span", { class: "name-avatar" }, "🧑‍💻"),
      h(
        "div",
        { class: "name-card-main" },
        h("label", { class: "name-card-label", for: "player-name" }, "あなたの名前(対戦相手に表示されます)"),
        nameInput,
      ),
      h("span", { class: "name-edit-icon" }, "✏️"),
    ),
    h(
      "div",
      { class: "title-menu" },
      h(
        "button",
        { class: "btn btn-primary", type: "button", onClick: () => show(matchingScreen("pve")) },
        "ひとりで遊ぶ(vs NPC)",
      ),
      h(
        "button",
        { class: "btn btn-primary", type: "button", onClick: () => show(matchingScreen("pvp")) },
        "みんなで遊ぶ(P2P対戦・最大4人)",
      ),
      h("button", { class: "btn", type: "button", onClick: showHowTo }, "あそびかた"),
    ),
  );
}

function showHowTo(): void {
  const { close } = openSheet(
    h(
      "div",
      { class: "howto" },
      h("h2", null, "あそびかた"),
      h("p", null, "あなたは情シス部門のメンバー。5営業日(5ラウンド)のあいだに降ってくるトラブルを工数で解決し、いちばん評価を稼いだ人が「今期のMVP情シス」です。"),
      h("ul", null,
        h("li", null, "毎ラウンド工数3を支給。場のトラブルを「コスト分の工数」で解決すると評価がもらえます。"),
        h("li", null, "自分の専門カテゴリはコスト−1(最低1)・評価+1。"),
        h("li", null, "手番では「1枚解決」か「パス」。全員が連続パスするとその日は終業。"),
        h("li", null, "【緊急】カードを残して終業すると全員の評価−1(枚数分)。"),
        h("li", null, "役割ごとの固有スキルは1ゲームに2回まで使えます。"),
      ),
      h("button", { class: "btn", type: "button", onClick: () => close() }, "とじる"),
    ),
  );
}
