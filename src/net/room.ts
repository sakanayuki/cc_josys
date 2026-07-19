import { joinRoom, selfId } from "trystero/nostr";
import { asMsg, type Msg } from "./protocol";

export { selfId };

/** アプリ固有の名前空間。ルールや状態形式の互換性が壊れる変更をしたら変える */
export const APP_ID = "josys-shutsudo-v1";

/** 紛らわしい文字(0/O, 1/I/L)を除いた英数でルームIDを生成 */
const ID_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_ID_LENGTH = 6;

export function makeRoomId(): string {
  const buf = new Uint32Array(ROOM_ID_LENGTH);
  crypto.getRandomValues(buf);
  return [...buf].map((v) => ID_ALPHABET[v % ID_ALPHABET.length]).join("");
}

export function normalizeRoomId(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function isValidRoomId(id: string): boolean {
  return id.length === ROOM_ID_LENGTH && [...id].every((c) => ID_ALPHABET.includes(c));
}

export interface RoomHandlers {
  onMsg: (msg: Msg, fromPeerId: string) => void;
  onPeerJoin?: (peerId: string) => void;
  onPeerLeave?: (peerId: string) => void;
}

/**
 * Trysteroの薄いラッパー。単一アクション "m" にJSONメッセージを載せる。
 * シグナリングは公開Nostrリレー(Trystero既定セット)経由、確立後はP2P直接。
 */
export class P2PRoom {
  readonly roomId: string;
  private room: ReturnType<typeof joinRoom>;
  private action: { send: (data: unknown, options?: { target?: string }) => Promise<void> };
  private closed = false;

  constructor(roomId: string, handlers: RoomHandlers) {
    this.roomId = roomId;
    this.room = joinRoom({ appId: APP_ID }, roomId);
    const action = this.room.makeAction("m");
    this.action = action as unknown as P2PRoom["action"];
    action.onMessage = (data, ctx) => {
      const msg = asMsg(data);
      if (msg) handlers.onMsg(msg, ctx.peerId);
    };
    this.room.onPeerJoin = (peerId) => handlers.onPeerJoin?.(peerId);
    this.room.onPeerLeave = (peerId) => handlers.onPeerLeave?.(peerId);
  }

  send(msg: Msg, target?: string): void {
    if (this.closed) return;
    void this.action
      .send(msg as unknown, target ? { target } : undefined)
      .catch(() => {
        // 切断中の送信失敗は onPeerLeave 側で扱う
      });
  }

  peerIds(): string[] {
    return Object.keys(this.room.getPeers());
  }

  leave(): void {
    if (this.closed) return;
    this.closed = true;
    void this.room.leave().catch(() => {});
  }
}
