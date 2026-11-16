// Regenerates src/data/emoji.json from emojibase-data (dev dependency).
//
//   node scripts/build-emoji-data.mjs
//
// The output is a compact list the emoji picker lazy-loads when opened:
//   { groups: [[icon, name], ...], list: [[emoji, groupIndex, keywords], ...] }
// `keywords` is one lower-cased string of the zh-Hant + English label and tags,
// so a keyword search is a single substring test. Skin-tone variants and the
// "component" group are dropped to keep the file small.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const zh = require("emojibase-data/zh-hant/compact.json");
const en = require("emojibase-data/en/compact.json");
const zhMessages = JSON.parse(readFileSync(require.resolve("emojibase-data/zh-hant/messages.json"), "utf8"));

const COMPONENT_GROUP = 2;
const GROUP_ICONS = ["😀", "🧑", "", "🐻", "🍜", "✈️", "⚽", "💡", "🔣", "🏳️"];

// Everyday Taiwanese words that emojibase's zh-Hant annotations miss.
const EXTRA_KEYWORDS = {
  "🍜": "拉麵 牛肉麵 麵店", "🍲": "火鍋 鍋物 麻辣鍋", "🧋": "珍奶 珍珠奶茶 手搖 飲料",
  "🍱": "便當", "🍢": "關東煮 黑輪", "🍧": "剉冰 刨冰", "🥟": "水餃 小籠包 餃子",
  "🍚": "滷肉飯 白飯", "🍙": "飯糰", "🦪": "蚵仔 生蠔", "🍺": "啤酒 居酒屋", "🍵": "抹茶 茶館",
  "☕": "咖啡廳 咖啡店", "🍰": "甜點 蛋糕", "🌃": "夜市 夜景", "🏮": "燈籠 夜市 元宵",
  "♨️": "溫泉 泡湯", "⛩️": "神社 鳥居", "🛕": "廟 寺廟 宮廟", "🏯": "城堡 天守閣",
  "🚄": "高鐵 新幹線", "🚇": "捷運 地鐵", "🚆": "火車 台鐵", "🚌": "公車 客運", "🛵": "機車",
  "🏝️": "離島 小島", "🏖️": "海灘 沙灘", "🏕️": "露營", "🥾": "登山 健行 爬山", "⛰️": "登山 高山",
  "🎢": "樂園 遊樂園", "🛍️": "購物 逛街", "🎤": "唱歌 ktv", "🧳": "行李 出國 旅行",
  "🏠": "日常 家", "🌏": "國外 海外", "🎓": "畢業 學校 校園", "🏫": "學校 校園", "🏥": "醫院 看病",
  "💼": "出差 工作", "🔍": "考察 調查"
};
const enByHex = new Map(en.map((item) => [item.hexcode, item]));
const groupOrder = [];
const groupIndex = new Map();
for (const group of zhMessages.groups) {
  if (group.order === COMPONENT_GROUP) continue;
  groupIndex.set(group.order, groupOrder.length);
  groupOrder.push([GROUP_ICONS[group.order] || "•", group.message]);
}

const list = zh
  .filter((item) => item.group !== undefined && item.group !== COMPONENT_GROUP && groupIndex.has(item.group))
  .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
  .map((item) => {
    const english = enByHex.get(item.hexcode) || {};
    const words = new Set(
      [EXTRA_KEYWORDS[item.unicode], item.label, ...(item.tags || []), english.label, ...(english.tags || [])]
        .filter(Boolean)
        .flatMap((word) => String(word).toLowerCase().split(/[，,\s]+/))
        .map((word) => word.trim())
        .filter(Boolean),
    );
    return [item.unicode, groupIndex.get(item.group), [...words].join(" ")];
  });

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../src/data/emoji.json");
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ groups: groupOrder, list }));
console.log(`wrote ${list.length} emoji to ${out}`);
