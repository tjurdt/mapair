// The eight visit purposes ("造訪目的"), and the read-time mapping that folds
// every older category (the 20 former presets plus free-text "其他" entries)
// onto them.
//
// Stored Visit `category` strings are never rewritten just because the app
// opens: old values stay in Firestore and are mapped here whenever they are
// read for display, filtering, colouring or area metrics. A Visit only gets a
// new-style value when someone explicitly saves it with a purpose.

export const PURPOSES = Object.freeze([
  Object.freeze({ name: "交通", icon: "🚉", color: "#5f7fb2" }),
  Object.freeze({ name: "文史", icon: "🏛️", color: "#8f6bb2" }),
  Object.freeze({ name: "自然", icon: "🌿", color: "#4f9d5f" }),
  Object.freeze({ name: "考察", icon: "🔍", color: "#3f7d78" }),
  Object.freeze({ name: "娛樂", icon: "🎡", color: "#c2603f" }),
  Object.freeze({ name: "飲食", icon: "🍜", color: "#d98b3f" }),
  Object.freeze({ name: "住宿", icon: "🛏️", color: "#b25b6b" }),
  Object.freeze({ name: "其他", icon: "📍", color: "#9aa5ad" })
]);

export const PURPOSE_NAMES = Object.freeze(PURPOSES.map((p) => p.name));
export const PURPOSE_COLORS = Object.freeze(Object.fromEntries(PURPOSES.map((p) => [p.name, p.color])));
export const PURPOSE_ICONS = Object.freeze(Object.fromEntries(PURPOSES.map((p) => [p.name, p.icon])));
export const PURPOSE_FALLBACK = "其他";

// Former preset names -> purpose.
export const LEGACY_CATEGORY_MAP = Object.freeze({
  餐飲: "飲食", 咖啡: "飲食",
  購物: "娛樂", 娛樂: "娛樂", 運動: "娛樂", 社交: "娛樂", 慶祝: "娛樂",
  文化: "文史", 景點: "文史", 宗教: "文史",
  自然: "自然", 戶外: "自然",
  交通: "交通",
  教育: "考察", 工作: "考察",
  住宿: "住宿", 醫療: "其他", 生活: "其他", 住家: "其他", 其他: "其他"
});

// Free-text categories: first keyword group that matches wins.
const KEYWORD_RULES = [
  ["住宿", /住宿|旅館|飯店|酒店|民宿|旅店|青旅|hotel|hostel|\binn\b|airbnb/i],
  ["飲食", /餐|食|吃|飯|麵|咖啡|茶|酒|小吃|甜點|早午|夜市|bar|cafe|food|restaurant/i],
  ["交通", /車站|機場|港|捷運|高鐵|火車|巴士|客運|轉乘|渡輪|station|airport/i],
  ["文史", /寺|廟|宮|教堂|古蹟|老街|博物|美術|紀念|歷史|文化|展覽|遺址|城|museum|temple|shrine/i],
  ["自然", /山|海|湖|溪|河|瀑布|公園|步道|森林|島|海灘|溫泉|花|nature|park|beach|trail/i],
  ["考察", /考察|研究|調查|工作|會議|開會|上課|學|研討|出差|田野/],
  ["娛樂", /玩|遊樂|樂園|購物|逛|電影|演唱|表演|球|運動|派對|生日|唱歌|ktv|shopping|concert/i]
];

/**
 * Purpose for any stored category value ("" stays "" — no purpose chosen).
 * A stay (`kind === "stay"`) always reads as 住宿.
 */
export function purposeOf(raw, kind) {
  if (kind === "stay") return "住宿";
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!value) return "";
  if (PURPOSE_COLORS[value]) return value;
  if (LEGACY_CATEGORY_MAP[value]) return LEGACY_CATEGORY_MAP[value];
  for (const [purpose, pattern] of KEYWORD_RULES) if (pattern.test(value)) return purpose;
  return PURPOSE_FALLBACK;
}

/**
 * The category string to store when an editor saves `picked`. If the user kept
 * the purpose that `original` already maps to, the original text is preserved,
 * so opening and saving an old Visit never silently discards its wording.
 */
export function categoryToStore(picked, original) {
  const choice = typeof picked === "string" ? picked.trim() : "";
  const before = typeof original === "string" ? original.trim() : "";
  if (!choice) return "";
  return before && purposeOf(before) === choice ? before : choice;
}
