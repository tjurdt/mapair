import { esc } from "./html.js";

// The 造訪目的 multi-select dropdown beside the search box. Each row shows the
// purpose's count under the other filters; the menu stays open while
// toggling. The button shows the picked icons (or 目的 when none).

/**
 * Wire open/close once per render of the shell.
 * @param {AbortSignal} signal  ends the outside-click listener with the shell
 */
export function wirePurposeDropdown(signal) {
  const wrap = document.getElementById("catDD");
  const button = document.getElementById("fl_cats_btn");
  const menu = document.getElementById("fl_cats");
  const setOpen = (open) => { menu.classList.toggle("open", open); button.setAttribute("aria-expanded", String(open)); };
  button.onclick = (event) => { event.stopPropagation(); setOpen(!menu.classList.contains("open")); };
  document.addEventListener("click", (event) => { if (!wrap.contains(event.target)) setOpen(false); }, { signal });
}

/**
 * @param {object} opts
 * @param {Array<{name:string,icon:string}>} opts.purposes
 * @param {Record<string,number>} opts.counts
 * @param {Set<string>} opts.selected
 * @param {(name:string)=>string} opts.color
 * @param {(name:string)=>void} opts.onToggle
 * @param {()=>void} opts.onClear
 */
export function renderPurposeDropdown({ purposes, counts, selected, color, onToggle, onClear }) {
  const menu = document.getElementById("fl_cats");
  const button = document.getElementById("fl_cats_btn");
  if (!menu || !button) return;
  const picked = purposes.filter((p) => selected.has(p.name));
  menu.innerHTML = purposes.map((p) => {
    const n = counts[p.name] || 0, on = selected.has(p.name);
    return `<button type="button" class="ddrow ${on ? "on" : ""} ${n || on ? "" : "zero"}" data-c="${esc(p.name)}" role="menuitemcheckbox" aria-checked="${on}" style="--pc:${color(p.name)}"><span class="ddcheck">${on ? "✓" : ""}</span><i>${p.icon}</i>${esc(p.name)}<b>${n}</b></button>`;
  }).join("") + (picked.length ? `<button type="button" class="ddrow ddclear" data-cclear>清除</button>` : "");
  menu.querySelectorAll("[data-c]").forEach((row) => row.onclick = (event) => { event.stopPropagation(); onToggle(row.dataset.c); });
  const clear = menu.querySelector("[data-cclear]");
  if (clear) clear.onclick = (event) => { event.stopPropagation(); onClear(); };
  button.textContent = picked.length ? picked.map((p) => p.icon).join("") : "目的";
  button.title = picked.length ? `目的：${picked.map((p) => p.name).join("、")}` : "造訪目的";
  button.classList.toggle("on", picked.length > 0);
}
