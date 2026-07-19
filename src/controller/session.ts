import type { Action, GameState, MatchConfig } from "../core/types";

/**
 * ゲーム画面が対戦を進行するための共通インターフェース。
 * PvE(local)・PvPホスト(host)・PvPゲスト(guest)を同じUIで扱う。
 */
export interface Session {
  readonly kind: "local" | "host" | "guest";
  readonly meIndex: number;
  readonly config: MatchConfig;
  getState(): GameState;
  /** 状態変化の購読。解除関数を返す */
  subscribe(cb: () => void): () => void;
  /** 自分(人間)のアクション */
  act(action: Action): void;
  /** タイマー等の後始末(P2P接続自体は閉じない) */
  dispose(): void;
  /** PvP: 相手切断時に呼ばれる */
  onDisconnect: (() => void) | null;
}

export abstract class BaseSession implements Session {
  abstract readonly kind: "local" | "host" | "guest";
  abstract readonly meIndex: number;
  onDisconnect: (() => void) | null = null;
  protected listeners = new Set<() => void>();
  protected disposed = false;

  constructor(
    readonly config: MatchConfig,
    protected state: GameState,
  ) {}

  getState(): GameState {
    return this.state;
  }

  subscribe(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  protected notify(): void {
    for (const cb of this.listeners) cb();
  }

  abstract act(action: Action): void;

  dispose(): void {
    this.disposed = true;
    this.listeners.clear();
  }
}
