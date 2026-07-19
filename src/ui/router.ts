let onLeave: (() => void) | null = null;

/** 画面を切り替える。前画面のonLeave(後始末)を呼んでから差し替える */
export function show(el: HTMLElement, leave?: () => void): void {
  onLeave?.();
  onLeave = leave ?? null;
  const root = document.getElementById("app")!;
  root.replaceChildren(el);
  window.scrollTo(0, 0);
}
