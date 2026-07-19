import { CATEGORY_INFO, getTrouble } from "../../core/cards";
import { h } from "../dom";

/** 場のトラブルカード表示 */
export function cardTile(
  cardId: string,
  opts: { onClick?: () => void; dimmed?: boolean } = {},
): HTMLElement {
  const card = getTrouble(cardId);
  const cat = CATEGORY_INFO[card.category];
  return h(
    "button",
    {
      class: `card-tile cat-${card.category}${opts.dimmed ? " dimmed" : ""}`,
      type: "button",
      onClick: opts.onClick,
    },
    h(
      "div",
      { class: "card-head" },
      h("span", { class: "card-cat" }, cat.name),
      h("span", { class: "card-id" }, card.id),
    ),
    card.urgent ? h("span", { class: "urgent-badge" }, "緊急") : null,
    h("div", { class: "card-name" }, card.name),
    h(
      "div",
      { class: "card-stats" },
      h("span", { class: "stat" }, `⚙${card.cost}`),
      h("span", { class: "stat" }, `★${card.eval}`),
    ),
  );
}
