import { ROLES } from "../../core/cards";
import type { MatchConfig, NpcLevel, RoleId } from "../../core/types";
import { LocalSession } from "../../controller/local";
import { GuestSession, HostSession, MAX_GUESTS, PvpLink } from "../../controller/p2p";
import { PROTOCOL_VERSION, type Msg } from "../../net/protocol";
import { isValidRoomId, makeRoomId, normalizeRoomId } from "../../net/room";
import { copyText, h, shareText, toast } from "../dom";
import { show } from "../router";
import { gameScreen } from "./game";
import { getPlayerName, titleScreen } from "./title";

export function newSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}

const NPC_NAMES: Record<NpcLevel, string> = {
  easy: "新人ロボ",
  normal: "中堅ロボ",
  hard: "鬼軍曹ロボ",
};

export const LEVEL_LABELS: Record<NpcLevel, string> = {
  easy: "弱い",
  normal: "ふつう",
  hard: "つよい",
};

export function matchingScreen(initialTab: "pve" | "pvp"): HTMLElement {
  let tab = initialTab;
  let link: PvpLink | null = null;
  let started = false;
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;

  const cleanup = () => {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    timeoutHandle = null;
    if (!started && link) link.close();
  };

  const body = h("div", { class: "matching-body" });
  const container = h(
    "div",
    { class: "screen matching-screen" },
    h(
      "div",
      { class: "screen-header" },
      h(
        "button",
        {
          class: "btn btn-ghost",
          type: "button",
          onClick: () => {
            cleanup();
            show(titleScreen());
          },
        },
        "← もどる",
      ),
      h(
        "div",
        { class: "tab-bar" },
        h(
          "button",
          {
            class: `tab${tab === "pve" ? " active" : ""}`,
            type: "button",
            onClick: () => {
              tab = "pve";
              render();
            },
          },
          "ひとりで",
        ),
        h(
          "button",
          {
            class: `tab${tab === "pvp" ? " active" : ""}`,
            type: "button",
            onClick: () => {
              tab = "pvp";
              render();
            },
          },
          "ふたりで",
        ),
      ),
    ),
    body,
  );

  // ---------------- PvE ----------------

  let npcCount = 1;
  const npcLevels: NpcLevel[] = ["normal", "normal", "normal"];
  let myRole: RoleId | "random" = "random";

  function renderPve(): HTMLElement {
    const levelPicker = (i: number) =>
      h(
        "div",
        { class: "seg-group" },
        (Object.keys(LEVEL_LABELS) as NpcLevel[]).map((lv) =>
          h(
            "button",
            {
              class: `seg${npcLevels[i] === lv ? " active" : ""}`,
              type: "button",
              onClick: () => {
                npcLevels[i] = lv;
                render();
              },
            },
            LEVEL_LABELS[lv],
          ),
        ),
      );

    return h(
      "div",
      null,
      h("h2", { class: "section-title" }, "NPCの人数"),
      h(
        "div",
        { class: "seg-group" },
        [1, 2, 3].map((c) =>
          h(
            "button",
            {
              class: `seg${npcCount === c ? " active" : ""}`,
              type: "button",
              onClick: () => {
                npcCount = c;
                render();
              },
            },
            `${c}体`,
          ),
        ),
      ),
      ...Array.from({ length: npcCount }, (_, i) =>
        h(
          "div",
          { class: "npc-row" },
          h("span", { class: "npc-label" }, `NPC ${i + 1} のつよさ`),
          levelPicker(i),
        ),
      ),
      h("h2", { class: "section-title" }, "じぶんの役割"),
      h(
        "div",
        { class: "role-grid" },
        h(
          "button",
          {
            class: `role-btn${myRole === "random" ? " active" : ""}`,
            type: "button",
            onClick: () => {
              myRole = "random";
              render();
            },
          },
          h("span", { class: "role-name" }, "おまかせ"),
          h("span", { class: "role-desc" }, "ランダムに決める"),
        ),
        ROLES.map((r) =>
          h(
            "button",
            {
              class: `role-btn${myRole === r.id ? " active" : ""}`,
              type: "button",
              onClick: () => {
                myRole = r.id;
                render();
              },
            },
            h("span", { class: "role-name" }, r.name),
            h("span", { class: "role-desc" }, `${r.skillName}: ${r.skillDescription}`),
          ),
        ),
      ),
      h(
        "button",
        { class: "btn btn-primary btn-wide", type: "button", onClick: startPve },
        "対戦開始",
      ),
    );
  }

  function startPve(): void {
    const pool = ROLES.map((r) => r.id);
    const mine =
      myRole === "random" ? pool[Math.floor(Math.random() * pool.length)] : myRole;
    const rest = pool.filter((r) => r !== mine).sort(() => Math.random() - 0.5);
    const usedNames = new Map<string, number>();
    const config: MatchConfig = {
      seed: newSeed(),
      players: [
        { name: getPlayerName(), kind: "human", role: mine },
        ...Array.from({ length: npcCount }, (_, i) => {
          const lv = npcLevels[i];
          const count = (usedNames.get(lv) ?? 0) + 1;
          usedNames.set(lv, count);
          const suffix = npcLevels.slice(0, npcCount).filter((l) => l === lv).length > 1 ? count : "";
          return {
            name: `${NPC_NAMES[lv]}${suffix}`,
            kind: "npc" as const,
            npcLevel: lv,
            role: rest[i],
          };
        }),
      ],
    };
    started = true;
    const session = new LocalSession(config);
    show(gameScreen(session));
  }

  // ---------------- PvP(最大4人) ----------------

  type PvpView =
    | { step: "idle" }
    | { step: "hosting"; waitingLong: boolean }
    | { step: "join-input" }
    | { step: "connecting" }
    | { step: "lobby" };

  let pvp: PvpView = { step: "idle" };
  /** ホスト: 参加ゲスト(参加順=席順。players[1..]に対応) */
  let guestIds: string[] = [];
  /** ロビーの席ごとの役割(席0=ホスト)。ゲストはlobbyメッセージで受信 */
  let roles: (RoleId | null)[] = [null, null, null, null];
  /** ロビーの席ごとの名前 */
  let names: string[] = [];
  /** ゲスト: 自分の席番号(lobby受信で確定) */
  let myIndex = -1;

  function setPvp(v: PvpView): void {
    pvp = v;
    render();
  }

  function armTimeout(ms: number, fn: () => void): void {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    timeoutHandle = setTimeout(fn, ms);
  }

  function resetPvp(message?: string): void {
    if (message) toast(message);
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    timeoutHandle = null;
    link?.close();
    link = null;
    guestIds = [];
    roles = [null, null, null, null];
    names = [];
    myIndex = -1;
    setPvp({ step: "idle" });
  }

  function attachHandlers(l: PvpLink): void {
    l.onPeerLeave = (peerId) => {
      if (started) return;
      if (l.isHost) {
        const seat = guestIds.indexOf(peerId);
        if (seat < 0) return;
        toast(`${names[seat + 1] ?? "相手"}が退出しました`);
        guestIds.splice(seat, 1);
        roles.splice(seat + 1, 1);
        roles.push(null);
        if (guestIds.length === 0) {
          setPvp({ step: "hosting", waitingLong: false });
        } else {
          broadcastLobby();
          render();
        }
      } else {
        if (peerId === l.hostPeerId() || l.hostPeerId() === null) {
          resetPvp("ホストとの接続が切れました");
        }
      }
    };
    l.handler = (msg: Msg, from: string) => handleLobbyMsg(l, msg, from);
  }

  function handleLobbyMsg(l: PvpLink, msg: Msg, from: string): void {
    if (msg.t === "hello") {
      if (msg.v !== PROTOCOL_VERSION) {
        if (l.isHost) l.sendTo({ t: "full" }, from);
        else resetPvp("相手とアプリのバージョンが違います。両方とも再読み込みしてください");
        return;
      }
      if (l.isHost) {
        if (msg.host) {
          resetPvp("同じIDで別の部屋が作られています。部屋を作り直してください");
          return;
        }
        if (guestIds.includes(from)) return;
        if (guestIds.length >= MAX_GUESTS) {
          l.sendTo({ t: "full" }, from);
          return;
        }
        guestIds.push(from);
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        if (pvp.step !== "lobby") setPvp({ step: "lobby" });
        broadcastLobby();
        render();
      } else {
        // ゲスト: ホストのhelloで接続確定。他ゲストのhelloは無視
        if (msg.host && pvp.step === "connecting") {
          if (timeoutHandle !== null) clearTimeout(timeoutHandle);
          setPvp({ step: "lobby" });
        }
      }
      return;
    }
    if (msg.t === "full") {
      resetPvp("その部屋は満室です(最大4人)");
      return;
    }
    if (pvp.step !== "lobby") return;

    if (msg.t === "pickRole" && l.isHost) {
      const seat = guestIds.indexOf(from) + 1;
      if (seat > 0 && !roles.includes(msg.role)) {
        roles[seat] = msg.role;
      }
      broadcastLobby();
      render();
      return;
    }
    if (msg.t === "lobby" && !l.isHost && from === l.hostPeerId()) {
      names = msg.names.slice();
      roles = msg.roles.slice();
      myIndex = msg.yourIndex;
      render();
      return;
    }
    if (msg.t === "start" && !l.isHost && from === l.hostPeerId()) {
      startAsGuest(l, msg.config, msg.yourIndex);
    }
  }

  function broadcastLobby(): void {
    if (!link?.isHost) return;
    names = [link.myName, ...guestIds.map((id) => link!.peerName(id))];
    guestIds.forEach((id, i) => {
      link!.sendTo(
        { t: "lobby", names, roles: roles.slice(0, names.length), yourIndex: i + 1 },
        id,
      );
    });
  }

  function createRoom(): void {
    const l = new PvpLink(makeRoomId(), true, getPlayerName());
    link = l;
    names = [l.myName];
    attachHandlers(l);
    setPvp({ step: "hosting", waitingLong: false });
    armTimeout(90_000, () => {
      if (pvp.step === "hosting") setPvp({ step: "hosting", waitingLong: true });
    });
  }

  function joinRoomWith(id: string): void {
    const l = new PvpLink(id, false, getPlayerName());
    link = l;
    attachHandlers(l);
    setPvp({ step: "connecting" });
    armTimeout(30_000, () => {
      if (pvp.step === "connecting") {
        resetPvp("相手が見つかりませんでした。ルームIDと通信環境を確認してください");
      }
    });
  }

  function canStart(): boolean {
    const count = 1 + guestIds.length;
    if (count < 2) return false;
    return roles.slice(0, count).every((r) => r !== null);
  }

  function startAsHost(): void {
    if (pvp.step !== "lobby" || !link || !canStart()) return;
    const count = 1 + guestIds.length;
    const config: MatchConfig = {
      seed: newSeed(),
      players: Array.from({ length: count }, (_, i) => ({
        name: names[i],
        kind: i === 0 ? ("human" as const) : ("remote" as const),
        role: roles[i]!,
      })),
    };
    guestIds.forEach((id, i) => {
      link!.sendTo({ t: "start", config, yourIndex: i + 1 }, id);
    });
    started = true;
    const session = new HostSession(link, config, guestIds.slice());
    show(gameScreen(session));
  }

  function startAsGuest(l: PvpLink, config: MatchConfig, yourIndex: number): void {
    if (config.players.length < 2 || config.players.length > 4) return;
    if (yourIndex < 1 || yourIndex >= config.players.length) return;
    started = true;
    const session = new GuestSession(l, config, yourIndex);
    show(gameScreen(session));
  }

  function renderRoomIdShare(id: string): HTMLElement {
    return h(
      "div",
      null,
      h("div", { class: "room-id" }, ...[...id].map((c) => h("span", null, c))),
      h(
        "div",
        { class: "btn-row" },
        h("button", { class: "btn", type: "button", onClick: () => copyText(id) }, "コピー"),
        h(
          "button",
          {
            class: "btn",
            type: "button",
            onClick: () => shareText(`「情シス、出動。」で対戦しよう! ルームID: ${id}\n${location.href}`),
          },
          "共有",
        ),
      ),
    );
  }

  function renderLobby(l: PvpLink): HTMLElement {
    const isHost = l.isHost;
    const mySeat = isHost ? 0 : myIndex;
    const count = names.length;
    const capacityLeft = 4 - count;

    const memberList = h(
      "div",
      { class: "member-list" },
      names.map((name, i) => {
        const role = roles[i] ? ROLES.find((r) => r.id === roles[i]) : null;
        return h(
          "div",
          { class: "member-row" },
          h("span", { class: "member-badge" }, i === 0 ? "👑" : "🧑"),
          h("span", { class: "p-name" }, `${name}${i === mySeat ? "(あなた)" : ""}`),
          h(
            "span",
            { class: `member-role${role ? " picked" : ""}` },
            role ? role.name.split("(")[0] : "役割を選択中…",
          ),
        );
      }),
    );

    return h(
      "div",
      null,
      h("h2", { class: "section-title" }, `メンバー(${count}/4人)`),
      memberList,
      isHost && capacityLeft > 0
        ? h(
            "div",
            { class: "lobby-share" },
            h("p", { class: "hint" }, `あと${capacityLeft}人入れます。ルームIDを伝えれば途中参加できます`),
            renderRoomIdShare(l.roomId),
          )
        : null,
      h("h2", { class: "section-title" }, "じぶんの役割"),
      h(
        "div",
        { class: "role-grid" },
        ROLES.map((r) => {
          const takenBy = roles.findIndex((x) => x === r.id);
          const mine = takenBy === mySeat && mySeat >= 0;
          const takenByOther = takenBy >= 0 && !mine;
          return h(
            "button",
            {
              class: `role-btn${mine ? " active" : ""}${takenByOther ? " taken" : ""}`,
              type: "button",
              disabled: takenByOther,
              onClick: () => {
                if (pvp.step !== "lobby" || !link) return;
                if (isHost) {
                  roles[0] = r.id;
                  broadcastLobby();
                  render();
                } else {
                  const hostId = link.hostPeerId();
                  if (hostId) link.sendTo({ t: "pickRole", role: r.id }, hostId);
                }
              },
            },
            h("span", { class: "role-name" }, r.name),
            h("span", { class: "role-desc" }, `${r.skillName}: ${r.skillDescription}`),
            takenByOther ? h("span", { class: "role-taken" }, `${names[takenBy]}が選択`) : null,
          );
        }),
      ),
      isHost
        ? h(
            "button",
            {
              class: "btn btn-primary btn-wide",
              type: "button",
              disabled: !canStart(),
              onClick: startAsHost,
            },
            canStart()
              ? `対戦開始(${count}人)`
              : count < 2
                ? "相手の入室を待っています…"
                : "全員が役割を選ぶと開始できます",
          )
        : h(
            "p",
            { class: "hint" },
            canStart() ? "ホストの開始を待っています…" : "全員が役割を選ぶと開始できます",
          ),
    );
  }

  function renderPvp(): HTMLElement {
    if (pvp.step === "idle") {
      return h(
        "div",
        null,
        h("p", { class: "hint" }, "ルームIDを発行して相手に伝えるだけでマッチングできます(最大4人)。通信はP2P(WebRTC)で行われ、サーバーには保存されません。"),
        h(
          "button",
          { class: "btn btn-primary btn-wide", type: "button", onClick: createRoom },
          "部屋を作る(IDを発行)",
        ),
        h(
          "button",
          {
            class: "btn btn-wide",
            type: "button",
            onClick: () => setPvp({ step: "join-input" }),
          },
          "部屋に入る(IDを入力)",
        ),
      );
    }

    if (pvp.step === "hosting") {
      return h(
        "div",
        null,
        h("h2", { class: "section-title" }, "あなたのルームID"),
        renderRoomIdShare(link!.roomId),
        h(
          "p",
          { class: "hint" },
          pvp.waitingLong
            ? "まだ相手が来ません。IDが正しく伝わっているか確認してください。"
            : "このIDを相手(最大3人)に伝えて、入室を待っています…",
        ),
        h("div", { class: "spinner" }),
        h(
          "button",
          { class: "btn btn-ghost btn-wide", type: "button", onClick: () => resetPvp() },
          "部屋を閉じる",
        ),
      );
    }

    if (pvp.step === "join-input") {
      const input = h("input", {
        class: "text-input room-input",
        type: "text",
        maxlength: "6",
        placeholder: "ABC123",
        autocapitalize: "characters",
        autocomplete: "off",
      }) as HTMLInputElement;
      return h(
        "div",
        null,
        h("h2", { class: "section-title" }, "相手から聞いたルームID"),
        input,
        h(
          "button",
          {
            class: "btn btn-primary btn-wide",
            type: "button",
            onClick: () => {
              const id = normalizeRoomId(input.value);
              if (!isValidRoomId(id)) {
                toast("ルームIDは英数6文字です");
                return;
              }
              joinRoomWith(id);
            },
          },
          "入室する",
        ),
        h(
          "button",
          { class: "btn btn-ghost btn-wide", type: "button", onClick: () => setPvp({ step: "idle" }) },
          "もどる",
        ),
      );
    }

    if (pvp.step === "connecting") {
      return h(
        "div",
        null,
        h("p", { class: "hint" }, "接続しています…"),
        h("div", { class: "spinner" }),
        h(
          "button",
          { class: "btn btn-ghost btn-wide", type: "button", onClick: () => resetPvp() },
          "やめる",
        ),
      );
    }

    return renderLobby(link!);
  }

  function render(): void {
    for (const t of container.querySelectorAll(".tab")) {
      t.classList.toggle(
        "active",
        (t.textContent === "ひとりで") === (tab === "pve"),
      );
    }
    body.replaceChildren(tab === "pve" ? renderPve() : renderPvp());
  }

  render();
  return container;
}
