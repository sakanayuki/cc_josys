import { ROLES } from "../../core/cards";
import type { MatchConfig, NpcLevel, RoleId } from "../../core/types";
import { LocalSession } from "../../controller/local";
import { GuestSession, HostSession, PvpLink } from "../../controller/p2p";
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

  // ---------------- PvP ----------------

  type PvpView =
    | { step: "idle" }
    | { step: "hosting"; waitingLong: boolean }
    | { step: "join-input" }
    | { step: "connecting" }
    | { step: "lobby"; roles: (RoleId | null)[] };

  let pvp: PvpView = { step: "idle" };

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
    setPvp({ step: "idle" });
  }

  function attachHandlers(l: PvpLink): void {
    l.onPeerJoin = () => {
      // helloはPvpLinkが自動送信。相手のhello受信で確定する
    };
    l.onPeerLeave = () => {
      if (started) return;
      if (l.isHost) {
        toast("相手が退出しました");
        setPvp({ step: "hosting", waitingLong: false });
      } else {
        resetPvp("接続が切れました");
      }
    };
    l.handler = (msg: Msg, from: string) => handleLobbyMsg(l, msg, from);
  }

  function handleLobbyMsg(l: PvpLink, msg: Msg, from: string): void {
    if (msg.t === "hello") {
      if (l.peerId !== null && from !== l.peerId) {
        l.room.send({ t: "full" }, from);
        return;
      }
      if (msg.v !== PROTOCOL_VERSION) {
        l.room.send({ t: "full" }, from);
        resetPvp("相手とアプリのバージョンが違います。両方とも再読み込みしてください");
        return;
      }
      if (msg.host === l.isHost) {
        resetPvp(
          l.isHost
            ? "相手も部屋を作っています。どちらかが「部屋に入る」でIDを入力してください"
            : "その部屋にはホストがいません。IDを確認してください",
        );
        return;
      }
      if (l.peerId === null) {
        l.peerId = from;
        l.peerName = msg.name || "相手";
        l.sendHello(from); // 相互に確実にhelloが渡るよう返信
        if (timeoutHandle !== null) clearTimeout(timeoutHandle);
        setPvp({ step: "lobby", roles: [null, null] });
        if (l.isHost) broadcastLobby();
      }
      return;
    }
    if (msg.t === "full") {
      resetPvp("その部屋は満室です");
      return;
    }
    if (pvp.step !== "lobby") return;

    if (msg.t === "pickRole" && l.isHost) {
      if (pvp.roles[0] !== msg.role) {
        pvp.roles[1] = msg.role;
      }
      broadcastLobby();
      render();
      return;
    }
    if (msg.t === "lobby" && !l.isHost) {
      pvp.roles = msg.roles.slice();
      render();
      return;
    }
    if (msg.t === "start" && !l.isHost) {
      startAsGuest(l, msg.config);
    }
  }

  function broadcastLobby(): void {
    if (pvp.step !== "lobby" || !link) return;
    link.send({
      t: "lobby",
      roles: pvp.roles,
      ready: pvp.roles.map((r) => r !== null),
    });
  }

  function createRoom(): void {
    const l = new PvpLink(makeRoomId(), true, getPlayerName());
    link = l;
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

  function startAsHost(): void {
    if (pvp.step !== "lobby" || !link) return;
    const [hostRole, guestRole] = pvp.roles;
    if (!hostRole || !guestRole) return;
    const config: MatchConfig = {
      seed: newSeed(),
      players: [
        { name: link.myName, kind: "human", role: hostRole },
        { name: link.peerName, kind: "remote", role: guestRole },
      ],
    };
    link.send({ t: "start", config });
    started = true;
    const session = new HostSession(link, config);
    show(gameScreen(session));
  }

  function startAsGuest(l: PvpLink, config: MatchConfig): void {
    if (config.players.length !== 2) return;
    started = true;
    const session = new GuestSession(l, config);
    show(gameScreen(session));
  }

  function renderPvp(): HTMLElement {
    if (pvp.step === "idle") {
      return h(
        "div",
        null,
        h("p", { class: "hint" }, "ルームIDを発行して相手に伝えるだけでマッチングできます。通信はP2P(WebRTC)で行われ、サーバーには保存されません。"),
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
      const id = link!.roomId;
      return h(
        "div",
        null,
        h("h2", { class: "section-title" }, "あなたのルームID"),
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
        h(
          "p",
          { class: "hint" },
          pvp.waitingLong
            ? "まだ相手が来ません。IDが正しく伝わっているか確認してください。"
            : "このIDを相手に伝えて、入室を待っています…",
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

    // lobby
    const myIdx = link!.isHost ? 0 : 1;
    const peerIdx = 1 - myIdx;
    const roles = pvp.roles;
    return h(
      "div",
      null,
      h("p", { class: "hint" }, `${link!.peerName} と接続しました。役割を選んでください。`),
      h(
        "div",
        { class: "role-grid" },
        ROLES.map((r) => {
          const takenByPeer = roles[peerIdx] === r.id;
          const mine = roles[myIdx] === r.id;
          return h(
            "button",
            {
              class: `role-btn${mine ? " active" : ""}${takenByPeer ? " taken" : ""}`,
              type: "button",
              disabled: takenByPeer,
              onClick: () => {
                if (pvp.step !== "lobby" || !link) return;
                pvp.roles[myIdx] = r.id;
                if (link.isHost) {
                  broadcastLobby();
                } else {
                  link.send({ t: "pickRole", role: r.id });
                }
                render();
              },
            },
            h("span", { class: "role-name" }, r.name),
            h("span", { class: "role-desc" }, `${r.skillName}: ${r.skillDescription}`),
            takenByPeer ? h("span", { class: "role-taken" }, `${link!.peerName}が選択`) : null,
          );
        }),
      ),
      link!.isHost
        ? h(
            "button",
            {
              class: "btn btn-primary btn-wide",
              type: "button",
              disabled: !(roles[0] && roles[1]),
              onClick: startAsHost,
            },
            roles[0] && roles[1] ? "対戦開始" : "ふたりとも役割を選ぶと開始できます",
          )
        : h(
            "p",
            { class: "hint" },
            roles[0] && roles[1] ? "ホストの開始を待っています…" : "ふたりとも役割を選ぶと開始できます",
          ),
    );
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
