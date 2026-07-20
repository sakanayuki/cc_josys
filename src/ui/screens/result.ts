import { getRole } from "../../core/cards";
import { ranking, winners } from "../../core/engine";
import type { MatchConfig } from "../../core/types";
import { LocalSession } from "../../controller/local";
import { GuestSession, HostSession } from "../../controller/p2p";
import type { Session } from "../../controller/session";
import { h, toast } from "../dom";
import { show } from "../router";
import { titleScreen } from "./title";

function newSeed(): number {
  return (Math.random() * 0x100000000) >>> 0;
}

export function resultScreen(
  session: Session,
  opts: { disconnected?: boolean },
): HTMLElement {
  const s = session.getState();
  const order = ranking(s);
  const tops = winners(s);
  const finished = s.phase === "finished";

  const mvpNames = tops.map((i) => s.players[i].config.name).join(" & ");

  const rows = order.map((idx, rank) => {
    const p = s.players[idx];
    const role = getRole(p.config.role);
    return h(
      "div",
      { class: `result-row${tops.includes(idx) && finished ? " mvp" : ""}` },
      h("span", { class: "rank" }, `${rank + 1}位`),
      h(
        "div",
        { class: "result-who" },
        h(
          "span",
          { class: "p-name" },
          idx !== session.meIndex || p.config.name === "あなた"
            ? p.config.name
            : `${p.config.name}(あなた)`,
        ),
        h("span", { class: "p-role-small" }, role.name),
      ),
      h(
        "div",
        { class: "result-nums" },
        h("span", { class: "result-score" }, `★${p.score}`),
        h("span", { class: "result-detail" }, `${p.resolved.length}枚 / 獲得+${p.gained} 罰−${p.penalty}`),
      ),
    );
  });

  const buttons: HTMLElement[] = [];

  if (!opts.disconnected) {
    if (session.kind === "local") {
      buttons.push(
        h(
          "button",
          {
            class: "btn btn-primary btn-wide",
            type: "button",
            onClick: () => {
              session.dispose();
              const config: MatchConfig = { ...session.config, seed: newSeed() };
              const next = new LocalSession(config);
              void import("./game").then(({ gameScreen }) => show(gameScreen(next)));
            },
          },
          "もう一度(同じメンバー)",
        ),
      );
    } else if (session.kind === "host") {
      const host = session as HostSession;
      host.onRematchRequest = (from) =>
        toast(`${host.link.peerName(from)}が再戦を希望しています!`);
      if (host.allGuestsConnected()) {
        buttons.push(
          h(
            "button",
            {
              class: "btn btn-primary btn-wide",
              type: "button",
              onClick: () => {
                if (!host.allGuestsConnected()) {
                  toast("退出したメンバーがいるため再戦できません");
                  return;
                }
                const config: MatchConfig = { ...session.config, seed: newSeed() };
                host.guestOrder.forEach((id, i) => {
                  host.link.sendTo({ t: "start", config, yourIndex: i + 1 }, id);
                });
                session.dispose();
                const next = new HostSession(host.link, config, host.guestOrder.slice());
                void import("./game").then(({ gameScreen }) => show(gameScreen(next)));
              },
            },
            "もう一度(再戦)",
          ),
        );
      }
    } else if (session.kind === "guest") {
      const guest = session as GuestSession;
      const hostId = guest.link.hostPeerId();
      // ホストからのstartを待ち受けて自動で再戦に入る
      guest.link.handler = (msg, from) => {
        if (msg.t === "start" && from === hostId) {
          session.dispose();
          const next = new GuestSession(guest.link, msg.config, msg.yourIndex);
          void import("./game").then(({ gameScreen }) => show(gameScreen(next)));
        }
      };
      guest.link.onPeerLeave = (peerId) => {
        if (peerId === hostId) toast("ホストが退出しました");
      };
      if (hostId) {
        buttons.push(
          h(
            "button",
            {
              class: "btn btn-primary btn-wide",
              type: "button",
              onClick: () => {
                guest.link.sendTo({ t: "rematch" }, hostId);
                toast("再戦をリクエストしました。ホストの開始を待っています…");
              },
            },
            "再戦をリクエスト",
          ),
        );
      }
    }
  }

  buttons.push(
    h(
      "button",
      {
        class: "btn btn-wide",
        type: "button",
        onClick: () => {
          session.dispose();
          if (session.kind === "host" || session.kind === "guest") {
            (session as HostSession | GuestSession).link.close();
          }
          show(titleScreen());
        },
      },
      "タイトルへ",
    ),
  );

  return h(
    "div",
    { class: "screen result-screen" },
    opts.disconnected
      ? h("div", { class: "result-banner warn" }, "通信が切断されました(参考記録)")
      : h(
          "div",
          { class: "result-banner" },
          h("div", { class: "mvp-label" }, "🏆 今期のMVP情シス"),
          h("div", { class: "mvp-name" }, tops.length > 1 ? `${mvpNames}(合同MVP)` : mvpNames),
        ),
    h("div", { class: "result-list" }, rows),
    h("div", { class: "result-buttons" }, buttons),
  );
}
