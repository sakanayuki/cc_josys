import type { Category, EventCard, RoleDef, TroubleCard } from "./types";

// カード一覧PDFからの完全転記(トラブル40枚)
export const TROUBLE_CARDS: readonly TroubleCard[] = [
  // ユーザーサポート(黄・9枚)
  { id: "Y1", name: "パスワードを忘れました(3回目)", category: "support", urgent: false, cost: 1, eval: 1 },
  { id: "Y2", name: "Wi-Fiが繋がらない(会議5分前)", category: "support", urgent: true, cost: 1, eval: 1 },
  { id: "Y3", name: "プリンタが動かない(役員会直前)", category: "support", urgent: true, cost: 1, eval: 1 },
  { id: "Y4", name: "Excelが重いんだけど", category: "support", urgent: false, cost: 1, eval: 1 },
  { id: "Y5", name: "メールが消えた(ゴミ箱にある)", category: "support", urgent: false, cost: 1, eval: 1 },
  { id: "Y6", name: "Web会議に入れない偉い人", category: "support", urgent: true, cost: 2, eval: 2 },
  { id: "Y7", name: "新入社員10名分のキッティング", category: "support", urgent: false, cost: 3, eval: 3 },
  { id: "Y8", name: "「なんか変」としか言わない問い合わせ", category: "support", urgent: false, cost: 2, eval: 2 },
  { id: "Y9", name: "全社ITリテラシー研修をやってほしい", category: "support", urgent: false, cost: 3, eval: 3 },
  // インフラ(青・9枚)
  { id: "I1", name: "野良SaaS発覚", category: "infra", urgent: false, cost: 2, eval: 2 },
  { id: "I2", name: "サーバー室のエアコン故障", category: "infra", urgent: true, cost: 3, eval: 3 },
  { id: "I3", name: "基幹サーバーのディスク残量1%", category: "infra", urgent: true, cost: 3, eval: 4 },
  { id: "I4", name: "クラウド利用料が先月の3倍", category: "infra", urgent: false, cost: 2, eval: 2 },
  { id: "I5", name: "VPN混雑で在宅勢が全滅", category: "infra", urgent: true, cost: 2, eval: 2 },
  { id: "I6", name: "スイッチのループでネットワーク全断", category: "infra", urgent: true, cost: 3, eval: 4 },
  { id: "I7", name: "SSL証明書の有効期限切れ", category: "infra", urgent: false, cost: 2, eval: 2 },
  { id: "I8", name: "オンプレからクラウドへ移行検討せよ", category: "infra", urgent: false, cost: 3, eval: 3 },
  { id: "I9", name: "UPSのバッテリー交換時期", category: "infra", urgent: false, cost: 1, eval: 1 },
  // セキュリティ(赤・9枚)
  { id: "S1", name: "不審メール一斉着弾", category: "security", urgent: false, cost: 2, eval: 2 },
  { id: "S2", name: "ランサムウェアの疑い", category: "security", urgent: true, cost: 3, eval: 4 },
  { id: "S3", name: "フィッシング報告(もうクリック済)", category: "security", urgent: true, cost: 2, eval: 3 },
  { id: "S4", name: "退職者のアカウントが残ってた", category: "security", urgent: false, cost: 1, eval: 1 },
  { id: "S5", name: "USBメモリ紛失の報告", category: "security", urgent: true, cost: 2, eval: 3 },
  { id: "S6", name: "深刻な脆弱性(CVSS 9.8)公開", category: "security", urgent: false, cost: 2, eval: 2 },
  { id: "S7", name: "セキュリティ監査の資料づくり", category: "security", urgent: false, cost: 3, eval: 3 },
  { id: "S8", name: "パスワード付きZIP文化の撲滅", category: "security", urgent: false, cost: 2, eval: 2 },
  { id: "S9", name: "標的型メール訓練の実施", category: "security", urgent: false, cost: 2, eval: 2 },
  // アプリ/開発(緑・9枚)
  { id: "A1", name: "マクロが壊れた(作った人は退職済)", category: "dev", urgent: false, cost: 2, eval: 2 },
  { id: "A2", name: "基幹システム改修の要望(仕様は未定)", category: "dev", urgent: false, cost: 3, eval: 3 },
  { id: "A3", name: "本番環境でバグ発覚", category: "dev", urgent: true, cost: 3, eval: 4 },
  { id: "A4", name: "「ちょっとしたツール」の作成依頼", category: "dev", urgent: false, cost: 2, eval: 2 },
  { id: "A5", name: "RPAが朝から止まってる", category: "dev", urgent: true, cost: 2, eval: 2 },
  { id: "A6", name: "勤怠システムが締め日にエラー", category: "dev", urgent: true, cost: 2, eval: 3 },
  { id: "A7", name: "古いブラウザでしか動かない社内システム", category: "dev", urgent: false, cost: 3, eval: 3 },
  { id: "A8", name: "API連携がサイレント仕様変更で死亡", category: "dev", urgent: false, cost: 2, eval: 2 },
  { id: "A9", name: "リリース前日の仕様変更", category: "dev", urgent: false, cost: 2, eval: 2 },
  // 理不尽枠(灰・4枚)
  { id: "G1", name: "役員のスマホ機種変(至急)", category: "unreasonable", urgent: true, cost: 2, eval: 1 },
  { id: "G2", name: "社長が買ってきた謎ガジェットの接続", category: "unreasonable", urgent: false, cost: 2, eval: 1 },
  { id: "G3", name: "「AIでなんかやって」との号令", category: "unreasonable", urgent: false, cost: 3, eval: 2 },
  { id: "G4", name: "隣の部署の引っ越しに伴う配線作業", category: "unreasonable", urgent: true, cost: 2, eval: 1 },
];

export const EVENT_CARDS: readonly EventCard[] = [
  { id: "audit", name: "監査が入る", description: "このラウンド、セキュリティ(赤)カードを解決したときの評価+1" },
  { id: "holiday", name: "大型連休明け", description: "このラウンドの着信で、追加でトラブルカードを2枚公開する" },
  { id: "budget", name: "予算が下りた", description: "全プレイヤー、直ちに工数トークン+1" },
];

export const ROLES: readonly RoleDef[] = [
  {
    id: "csirt",
    name: "CSIRT(セキュリティ担当)",
    specialty: "security",
    skillId: "incidentCommand",
    skillName: "インシデント指揮",
    skillDescription: "【緊急】カードを解決したとき、さらに評価+1",
  },
  {
    id: "infra",
    name: "インフラ担当",
    specialty: "infra",
    skillId: "redundancy",
    skillName: "冗長構成",
    skillDescription: "使わなかった工数を次ラウンドにすべて繰り越せる",
  },
  {
    id: "dev",
    name: "アプリ開発担当",
    specialty: "dev",
    skillId: "autoScript",
    skillName: "自動化スクリプト",
    skillDescription: "直前に自分が解決したのと同カテゴリのカードを工数0で解決",
  },
  {
    id: "helpdesk",
    name: "ヘルプデスク担当",
    specialty: "support",
    skillId: "godResponse",
    skillName: "神対応",
    skillDescription: "コスト1のカードを解決したとき、評価を2倍にする",
  },
];

export const CATEGORY_INFO: Record<Category, { name: string; color: string }> = {
  support: { name: "ユーザーサポート", color: "#b8860b" },
  infra: { name: "インフラ", color: "#1f5fa8" },
  security: { name: "セキュリティ", color: "#c0392b" },
  dev: { name: "アプリ/開発", color: "#1e8449" },
  unreasonable: { name: "理不尽枠", color: "#7f8c8d" },
};

const troubleById = new Map(TROUBLE_CARDS.map((c) => [c.id, c]));
const eventById = new Map(EVENT_CARDS.map((c) => [c.id, c]));
const roleById = new Map(ROLES.map((r) => [r.id, r]));

export function getTrouble(id: string): TroubleCard {
  const c = troubleById.get(id);
  if (!c) throw new Error(`unknown trouble card: ${id}`);
  return c;
}

export function getEvent(id: string): EventCard {
  const c = eventById.get(id as EventCard["id"]);
  if (!c) throw new Error(`unknown event card: ${id}`);
  return c;
}

export function getRole(id: string): RoleDef {
  const r = roleById.get(id as RoleDef["id"]);
  if (!r) throw new Error(`unknown role: ${id}`);
  return r;
}
