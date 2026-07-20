type Child = Node | string | number | null | undefined | false | Child[];

type Attrs = Record<string, unknown> & {
  class?: string;
  dataset?: Record<string, string>;
};

/** 小さなDOM生成ヘルパー */
export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs?: Attrs | null,
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") {
        el.className = v as string;
      } else if (k === "dataset") {
        Object.assign(el.dataset, v);
      } else if (k.startsWith("on") && typeof v === "function") {
        el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      } else if (v === true) {
        el.setAttribute(k, "");
      } else {
        el.setAttribute(k, String(v));
      }
    }
  }
  appendChildren(el, children);
  return el;
}

function appendChildren(el: HTMLElement, children: Child[]): void {
  for (const c of children) {
    if (c == null || c === false) continue;
    if (Array.isArray(c)) {
      appendChildren(el, c);
    } else {
      el.append(c instanceof Node ? c : String(c));
    }
  }
}

let toastBox: HTMLElement | null = null;

// ---- カットイン(手番・イベント通知) ----

interface CutInRequest {
  title: string;
  sub?: string;
  variant: "turn" | "event";
}

const cutInQueue: CutInRequest[] = [];
let cutInActive = false;

/** 画面中央に大きな帯で通知を出す。連続要求はキューで順番に表示する */
export function cutIn(title: string, sub?: string, variant: "turn" | "event" = "turn"): void {
  cutInQueue.push({ title, sub, variant });
  if (!cutInActive) drainCutIns();
}

function drainCutIns(): void {
  const req = cutInQueue.shift();
  if (!req) {
    cutInActive = false;
    return;
  }
  cutInActive = true;
  const band = h(
    "div",
    { class: `cutin cutin-${req.variant}` },
    h("div", { class: "cutin-title" }, req.title),
    req.sub ? h("div", { class: "cutin-sub" }, req.sub) : null,
  );
  const overlay = h("div", { class: "cutin-overlay" }, band);
  document.body.append(overlay);
  requestAnimationFrame(() => overlay.classList.add("show"));
  setTimeout(() => {
    overlay.classList.add("hide");
    setTimeout(() => {
      overlay.remove();
      drainCutIns();
    }, 250);
  }, req.variant === "event" ? 2000 : 1300);
}

/** 画面上部に一時通知を出す */
export function toast(message: string, ms = 2600): void {
  if (!toastBox || !toastBox.isConnected) {
    toastBox = h("div", { class: "toast-box" });
    document.body.append(toastBox);
  }
  const item = h("div", { class: "toast" }, message);
  toastBox.append(item);
  requestAnimationFrame(() => item.classList.add("show"));
  setTimeout(() => {
    item.classList.remove("show");
    setTimeout(() => item.remove(), 300);
  }, ms);
}

/**
 * ボトムシート。closeで閉じる。バックドロップタップでも閉じる(dismissible時)。
 */
export function openSheet(
  content: HTMLElement,
  opts: { dismissible?: boolean } = {},
): { close: () => void } {
  const dismissible = opts.dismissible !== false;
  const sheet = h("div", { class: "sheet" }, content);
  const backdrop = h("div", { class: "sheet-backdrop" }, sheet);
  const close = () => {
    backdrop.classList.remove("show");
    setTimeout(() => backdrop.remove(), 200);
  };
  if (dismissible) {
    backdrop.addEventListener("click", (e) => {
      if (e.target === backdrop) close();
    });
  }
  document.body.append(backdrop);
  requestAnimationFrame(() => backdrop.classList.add("show"));
  return { close };
}

/** クリップボードへコピー(失敗時は選択フォールバックなしでトースト通知のみ) */
export async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    toast("コピーしました");
  } catch {
    toast("コピーできませんでした。長押しで選択してください");
  }
}

/** Web Share API(非対応ならコピーにフォールバック) */
export async function shareText(text: string): Promise<void> {
  if (navigator.share) {
    try {
      await navigator.share({ text });
      return;
    } catch {
      return; // ユーザーキャンセル等は無視
    }
  }
  await copyText(text);
}
