import { applyAction, initGame } from "../core/engine";
import { P2PRoom } from "../net/room";
import { PROTOCOL_VERSION, type Msg } from "../net/protocol";
import type { Action, MatchConfig } from "../core/types";
import { BaseSession } from "./session";

const ADVANCE_DELAY = 900;

/**
 * PvP接続の生存期間を通してP2PRoomを保持し、メッセージを
 * その時々の画面/セッションへ振り分けるルータ。
 */
export class PvpLink {
  room: P2PRoom;
  readonly roomId: string;
  readonly isHost: boolean;
  readonly myName: string;
  peerId: string | null = null;
  peerName = "相手";
  /** 現在の受信ハンドラ(ロビー画面・対戦セッション等が差し替える) */
  handler: (msg: Msg, from: string) => void = () => {};
  onPeerJoin: (peerId: string) => void = () => {};
  onPeerLeave: () => void = () => {};

  constructor(roomId: string, isHost: boolean, myName: string) {
    this.roomId = roomId;
    this.isHost = isHost;
    this.myName = myName;
    this.room = new P2PRoom(roomId, {
      onMsg: (msg, from) => {
        // 2人目以降のピアからのメッセージは相手確定後は無視(満室通知はロビー側で対応)
        if (this.peerId !== null && from !== this.peerId && msg.t !== "hello") return;
        this.handler(msg, from);
      },
      onPeerJoin: (peerId) => {
        this.sendHello(peerId);
        this.onPeerJoin(peerId);
      },
      onPeerLeave: (peerId) => {
        if (peerId === this.peerId) {
          this.peerId = null;
          this.onPeerLeave();
        }
      },
    });
  }

  sendHello(to: string): void {
    this.room.send(
      { t: "hello", v: PROTOCOL_VERSION, name: this.myName, host: this.isHost },
      to,
    );
  }

  send(msg: Msg): void {
    if (this.peerId) this.room.send(msg, this.peerId);
  }

  close(): void {
    this.room.leave();
  }
}

/** PvPホスト: エンジンを実行する側。ゲストのアクションを検証して状態を配信する */
export class HostSession extends BaseSession {
  readonly kind = "host" as const;
  readonly meIndex = 0;
  private ver = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** リザルト画面で相手の再戦リクエストを受けるためのフック */
  onRematchRequest: (() => void) | null = null;

  constructor(readonly link: PvpLink, config: MatchConfig) {
    super(config, initGame(config));
    link.handler = (msg) => this.handleMsg(msg);
    link.onPeerLeave = () => this.onDisconnect?.();
    this.broadcast();
    this.schedule();
  }

  act(action: Action): void {
    this.applyAndBroadcast(action);
  }

  private handleMsg(msg: Msg): void {
    if (msg.t === "action") {
      const a = msg.a;
      // ゲストは自分(index 1)の手しか打てない
      if (!("player" in a) || a.player !== 1) {
        this.broadcast();
        return;
      }
      try {
        this.applyAndBroadcast(a);
      } catch {
        this.broadcast(); // 不正手: 現状態を再送してゲストUIを巻き戻す
      }
    } else if (msg.t === "rematch") {
      this.onRematchRequest?.();
    }
  }

  private applyAndBroadcast(action: Action): void {
    this.state = applyAction(this.state, action);
    this.broadcast();
    this.notify();
    this.schedule();
  }

  private broadcast(): void {
    this.link.send({ t: "state", ver: ++this.ver, s: this.state });
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    if (this.disposed) return;
    if (this.state.phase === "incoming") {
      this.timer = setTimeout(() => {
        this.timer = null;
        this.applyAndBroadcast({ type: "ADVANCE" });
      }, ADVANCE_DELAY);
    }
  }

  dispose(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    super.dispose();
  }
}

/** PvPゲスト: 手はホストへ送信し、状態はスナップショット受信で更新する */
export class GuestSession extends BaseSession {
  readonly kind = "guest" as const;
  readonly meIndex = 1;
  private lastVer = 0;

  constructor(readonly link: PvpLink, config: MatchConfig) {
    // エンジンは決定論的なので、初期状態はゲスト側でも同一に再現できる
    super(config, initGame(config));
    link.handler = (msg) => this.handleMsg(msg);
    link.onPeerLeave = () => this.onDisconnect?.();
  }

  act(action: Action): void {
    this.link.send({ t: "action", a: action });
  }

  private handleMsg(msg: Msg): void {
    if (msg.t === "state") {
      if (msg.ver <= this.lastVer) return; // 古いスナップショットは破棄
      this.lastVer = msg.ver;
      this.state = msg.s;
      this.notify();
    }
  }
}
