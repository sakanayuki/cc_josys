import "./styles/main.css";
import { show } from "./ui/router";
import { titleScreen } from "./ui/screens/title";

const SYMBOLS_FAMILY = "Material Symbols Rounded";

/**
 * アイコンフォントが実際に使えるようになってから .msym を可視化する。
 * FontFaceSet.check() は @font-face 自体が無い場合(読み込み失敗など)でも
 * システムフォントで代替できるとみなして true を返してしまうため、
 * 登録済みフェイスの status を直接見る。
 */
function markSymbolsReady(): void {
  const ready = [...document.fonts].some(
    (f) => f.family.replace(/["']/g, "") === SYMBOLS_FAMILY && f.status === "loaded",
  );
  if (ready) document.documentElement.classList.add("symbols-ready");
}

void document.fonts
  ?.load(`24px "${SYMBOLS_FAMILY}"`)
  .then(markSymbolsReady)
  .catch(() => {});

show(titleScreen());
