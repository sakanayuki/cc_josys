// mulberry32: 32bit状態のシード付きPRNG。状態を数値で持ち回り、決定論的進行を保証する。

export function seedFrom(n: number): number {
  return n >>> 0;
}

/** [0,1) の乱数と次状態を返す */
export function next(state: number): [number, number] {
  let t = (state + 0x6d2b79f5) >>> 0;
  const newState = t;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return [value, newState];
}

/** [0,max) の整数と次状態を返す */
export function nextInt(state: number, max: number): [number, number] {
  const [v, s] = next(state);
  return [Math.floor(v * max), s];
}

/** Fisher-Yates シャッフル(非破壊)。シャッフル済み配列と次状態を返す */
export function shuffle<T>(state: number, arr: readonly T[]): [T[], number] {
  const out = arr.slice();
  let s = state;
  for (let i = out.length - 1; i > 0; i--) {
    let j: number;
    [j, s] = nextInt(s, i + 1);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return [out, s];
}
