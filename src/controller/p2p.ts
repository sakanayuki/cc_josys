import { applyAction, initGame } from "../core/engine";
import { P2PRoom } from "../net/room";
import { PROTOCOL_VERSION, type Msg } from "../net/protocol";
import type { Action, MatchConfig } from "../core/types";
import { BaseSession } from "./session";

const ADVANCE_DELAY = 900;
/** ホスト以外の最大参加人数(ホスト込みで4人) */
export const MAX_GUESTS = 3;

export interface PeerInfo {
  id: string;
  name: string;
  isHost: boolean;
}

/**
 * PvP接続の生存期間を通してP2PRoomを保持し、メッセージを
 * その時々の画面/セッションへ振り分けるルータ。
 * Trysteroの部屋はメッシュ接続のため、ゲスト同士も繋がる。
 * helloを受けた相手をpeersに登録し、役割(ホスト/ゲスト)を識別する。
 */
export class PvpLink {
  room: P2PRoom;
  readonly roomId: string;
  readonly isHost: boolean;
  readonly myName: string;
  /** helloを受信済みの相手 */
  readonly peers = new Map<string, PeerInfo>();
  /** 現在の受信ハンドラ(ロビー画面・対戦セッション等が差し替える) */
  handler: (msg: Msg, from: string) => void = () => {};
  onPeerLeave: (peerId: string) => void = () => {};

  constructor(roomId: string, isHost: boolean, myName: string) {
    this.roomId = roomId;
    this.isHost = isHost;
    this.myName = myName;
    this.room = new P2PRoom(roomId, {
      onMsg: (msg, from) => {
        if (msg.t === "hello" && msg.v === PROTOCOL_VERSION) {
          this.peers.set(from, { id: from, name: msg.name || "相手", isHost: msg.host });
        }
        this.handler(msg, from);
      },
      onPeerJoin: (peerId) => this.sendHello(peerId),
      onPeerLeave: (peerId) => {
        if (this.peers.delete(peerId)) this.onPeerLeave(peerId);
      },
    });
  }

  sendHello(to: string): void {
    this.room.send(
      { t: "hello", v: PROTOCOL_VERSION, name: this.myName, host: this.isHost },
      to,
    );
  }

  /** ゲスト視点: ホストのpeerId(未確定ならnull) */
  hostPeerId(): string | null {
    for (const p of this.peers.values()) if (p.isHost) return p.id;
    return null;
  }

  peerName(peerId: string): string {
    return this.peers.get(peerId)?.name ?? "相手";
  }

  sendTo(msg: Msg, peerId: string): void {
    this.room.send(msg, peerId);
  }

  close(): void {
    this.room.leave();
  }
}

/**
 * PvPホスト: エンジンを実行する側。各ゲストのアクションを検証して状態を配信する。
 * guestOrder はロビーでの参加順のpeerId列で、players[1..] に対応する。
 */
export class HostSession extends BaseSession {
  readonly kind = "host" as const;
  readonly meIndex = 0;
  private ver = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** リザルト画面で相手の再戦リクエストを受けるためのフック */
  onRematchRequest: ((from: string) => void) | null = null;

  constructor(
    readonly link: PvpLink,
    config: MatchConfig,
    readonly guestOrder: string[],
  ) {
    super(config, initGame(config));
    link.handler = (msg, from) => this.handleMsg(msg, from);
    link.onPeerLeave = (peerId) => {
      // 対戦メンバーの切断のみゲーム終了扱い(部外者の出入りは無視)
      if (this.guestOrder.includes(peerId)) {
        for (const id of this.guestOrder) {
          if (id !== peerId && this.link.peers.has(id)) {
            this.link.sendTo({ t: "abort" }, id);
          }
        }
        this.onDisconnect?.();
      }
    };
    this.broadcast();
    this.schedule();
  }

  act(action: Action): void {
    this.applyAndBroadcast(action);
  }

  /** 全ゲストがまだ接続しているか(リザルトの再戦可否判定に使う) */
  allGuestsConnected(): boolean {
    return this.guestOrder.every((id) => this.link.peers.has(id));
  }

  private playerIndexOf(peerId: string): number {
    const i = this.guestOrder.indexOf(peerId);
    return i < 0 ? -1 : i + 1;
  }

  private handleMsg(msg: Msg, from: string): void {
    if (msg.t === "action") {
      const idx = this.playerIndexOf(from);
      const a = msg.a;
      // ゲストは自分の席の手しか打てない
      if (idx < 0 || !("player" in a) || a.player !== idx) {
        if (idx > 0) this.sendState(from);
        return;
      }
      try {
        this.applyAndBroadcast(a);
      } catch {
        this.sendState(from); // 不正手: 現状態を再送してゲストUIを巻き戻す
      }
    } else if (msg.t === "rematch") {
      if (this.playerIndexOf(from) > 0) this.onRematchRequest?.(from);
    }
  }

  private applyAndBroadcast(action: Action): void {
    this.state = applyAction(this.state, action);
    this.broadcast();
    this.notify();
    this.schedule();
  }

  private sendState(peerId: string): void {
    this.link.sendTo({ t: "state", ver: this.ver, s: this.state }, peerId);
  }

  private broadcast(): void {
    this.ver += 1;
    for (const id of this.guestOrder) this.sendState(id);
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
  readonly meIndex: number;
  private lastVer = 0;
  private readonly hostId: string;

  constructor(readonly link: PvpLink, config: MatchConfig, meIndex: number) {
    // エンジンは決定論的なので、初期状態はゲスト側でも同一に再現できる
    super(config, initGame(config));
    this.meIndex = meIndex;
    this.hostId = link.hostPeerId() ?? "";
    link.handler = (msg, from) => this.handleMsg(msg, from);
    link.onPeerLeave = (peerId) => {
      // ホストが落ちたら続行不能。他ゲストの切断はホストが検知して知らせる
      if (peerId === this.hostId) this.onDisconnect?.();
    };
  }

  act(action: Action): void {
    if (this.hostId) this.link.sendTo({ t: "action", a: action }, this.hostId);
  }

  private handleMsg(msg: Msg, from: string): void {
    if (from !== this.hostId) return;
    if (msg.t === "state") {
      if (msg.ver <= this.lastVer) return; // 古いスナップショットは破棄
      this.lastVer = msg.ver;
      this.state = msg.s;
      this.notify();
    } else if (msg.t === "abort") {
      this.onDisconnect?.();
    }
  }
}
