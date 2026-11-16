import { esc } from "./html.js";
import { icon } from "./icons.js";

// Full emoji picker with keyword search (中文 or English). The dataset
// (src/data/emoji.js, built by scripts/build-emoji-data.mjs) is loaded on
// first open, so it never weighs on app start-up.

let dataPromise = null;
function loadEmojiData() {
  dataPromise ||= import("../data/emoji.js").then((mod) => mod.default);
  return dataPromise;
}

const DEFAULT_GROUP = 4; // 旅遊和地點

/** Whether every whitespace-separated term of `query` occurs in `keywords`. */
export function emojiMatches(keywords, query) {
  const terms = String(query || "").trim().toLowerCase().split(/\s+/).filter(Boolean);
  return terms.every((term) => keywords.includes(term));
}

/**
 * Search rows ([emoji, group, keywords]). Every term must match; if nothing
 * does, fall back to rows sharing the most CJK characters with the query (so
 * 「拉麵」 still finds 麵 dishes even where the annotation says 湯麵).
 */
export function searchEmoji(list, query, limit = 400) {
  const exact = list.filter(([, , keywords]) => emojiMatches(keywords, query));
  if (exact.length) return exact.slice(0, limit);
  const chars = [...new Set(String(query || "").replace(/[^㐀-鿿]/g, ""))];
  if (!chars.length) return [];
  return list
    .map((row) => [row, chars.filter((c) => row[2].includes(c)).length])
    .filter(([, score]) => score > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([row]) => row);
}

/**
 * Open the picker as a small centred card over everything else.
 * @param {{ current?:string, onPick:(emoji:string)=>void }} opts  onPick("") = 無圖示
 */
export function openEmojiPicker({ current = "", onPick }) {
  const layer = document.createElement("div");
  layer.className = "emoji-layer";
  layer.innerHTML = `
    <div class="emoji-card" role="dialog" aria-label="選擇圖示">
      <div class="emoji-head">
        <span class="emoji-searchbox">${icon("search", 16)}<input id="emojiSearch" type="search" placeholder="搜尋：拉麵、山、plane…" autocomplete="off"></span>
        <button type="button" class="iconbtn" data-emoji-none title="不使用圖示" aria-label="不使用圖示">∅</button>
        <button type="button" class="iconbtn" data-emoji-close title="關閉" aria-label="關閉">${icon("x")}</button>
      </div>
      <div class="emoji-groups" id="emojiGroups"></div>
      <div class="emoji-grid" id="emojiGrid"><div class="emoji-empty">載入中…</div></div>
    </div>`;
  document.body.appendChild(layer);

  const close = () => layer.remove();
  const pick = (value) => { close(); onPick(value); };
  layer.addEventListener("click", (event) => {
    if (event.target === layer) close();
    const cell = event.target.closest("[data-emoji]");
    if (cell) pick(cell.dataset.emoji);
    if (event.target.closest("[data-emoji-none]")) pick("");
    if (event.target.closest("[data-emoji-close]")) close();
  });
  layer.addEventListener("keydown", (event) => { if (event.key === "Escape") close(); });

  const search = layer.querySelector("#emojiSearch");
  const grid = layer.querySelector("#emojiGrid");
  const groupsEl = layer.querySelector("#emojiGroups");
  let group = DEFAULT_GROUP;

  loadEmojiData().then((data) => {
    if (!layer.isConnected) return;
    const render = () => {
      const query = search.value.trim();
      groupsEl.innerHTML = data.groups.map(([emoji, name], i) =>
        `<button type="button" class="${!query && i === group ? "on" : ""}" data-group="${i}" title="${esc(name)}">${emoji}</button>`).join("");
      const rows = query ? searchEmoji(data.list, query) : data.list.filter(([, g]) => g === group);
      grid.innerHTML = rows.length
        ? rows.map(([emoji]) => `<button type="button" class="${emoji === current ? "on" : ""}" data-emoji="${emoji}">${emoji}</button>`).join("")
        : `<div class="emoji-empty">找不到</div>`;
    };
    groupsEl.addEventListener("click", (event) => {
      const button = event.target.closest("[data-group]");
      if (!button) return;
      group = Number(button.dataset.group);
      search.value = "";
      render();
      grid.scrollTop = 0;
    });
    search.addEventListener("input", render);
    render();
  }).catch(() => { grid.innerHTML = `<div class="emoji-empty">圖示載入失敗</div>`; });

  // Only auto-focus with a real keyboard; on phones it would pop the keyboard
  // over the grid before the user decides to search.
  if (window.matchMedia?.("(pointer: fine)").matches) setTimeout(() => search.focus(), 0);
  return { close };
}
