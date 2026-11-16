import { modal, closeModal } from "./modal.js";
import { esc } from "./html.js";
import { icon } from "./icons.js";

/** "2026-08-08" -> "2026/8/8 六" */
export function dayLabel(d) {
  if (!/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(d || "")) return d || "未定日期";
  const [y, m, day] = d.split("-").map(Number);
  return `${y}/${m}/${day} ${"日一二三四五六"[new Date(y, m - 1, day).getDay()]}`;
}

/** Metres -> "120 m" / "1.4 km". */
export function formatDistance(m) {
  return m < 1000 ? `${Math.round(m / 10) * 10 || 5} m` : `${(m / 1000).toFixed(1)} km`;
}

/**
 * "附近" list: the user's own Places first (★), then Google nearby places, each
 * with its distance; the header pin button uses the tapped/located point.
 *
 * @param {object} opts
 * @param {Array<{name:string,d:number}>} opts.known
 * @param {Array<{name:string,d:number}>} opts.google
 * @param {(index:number)=>void} opts.onKnown
 * @param {(index:number)=>void} opts.onGoogle
 * @param {()=>void} opts.onCustom
 */
export function openNearbyPicker({ known, google, onKnown, onGoogle, onCustom }) {
  const row = (attr, name, d, mark) => `<button type="button" class="nb" ${attr}><span class="nbmark">${mark}</span><span class="nbname">${esc(name || "未命名地點")}</span><span class="nbdist">${formatDistance(d)}</span></button>`;
  modal(`
    <div class="ed-head">
      <b class="ed-heading">${icon("locate", 18)} 附近</b>
      <button type="button" class="iconbtn" id="nb_custom" title="用這個位置自訂" aria-label="用這個位置自訂">${icon("pin", 19)}</button>
      <button type="button" class="iconbtn" id="nb_close" title="關閉" aria-label="關閉">${icon("x", 20)}</button>
    </div>
    <div id="nb_list">
      ${known.map((x, i) => row(`data-known="${i}"`, x.name, x.d, "★")).join("")}
      ${google.map((x, i) => row(`data-i="${i}"`, x.name, x.d, "·")).join("")}
      ${known.length || google.length ? "" : `<div class="empty">附近沒有地標，按 ${icon("pin", 14)} 用這個位置</div>`}
    </div>
  `, { className: "dialog" });
  document.getElementById("nb_close").onclick = closeModal;
  document.querySelectorAll("#nb_list [data-known]").forEach((d) => d.onclick = () => { closeModal(); onKnown(+d.dataset.known); });
  document.querySelectorAll("#nb_list [data-i]").forEach((d) => d.onclick = () => { closeModal(); onGoogle(+d.dataset.i); });
  document.getElementById("nb_custom").onclick = () => { closeModal(); onCustom(); };
}
