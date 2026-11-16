import { modal, closeModal } from "./modal.js";
import { esc } from "./html.js";
import { icon } from "./icons.js";
import { openEmojiPicker } from "./emoji-picker.js";
import { canDeleteTrip, retainCurrentParticipant } from "../no-space/policies.js";
import { TRIP_TYPES } from "../domain/trip-type.js";

/**
 * The create / edit-Trip dialog.
 *
 * @param {object}   opts
 * @param {object?}  opts.trip           existing Trip doc, or null to create
 * @param {string}   opts.type           resolved trip type key (domain/trip-type.js)
 * @param {string}   opts.currentUid     signed-in user's uid
 * @param {string[]} opts.memberUids     participant-chip candidates, ordered
 * @param {(uid:string)=>string} opts.participantName  display name for a uid
 * @param {object}   opts.repo           No-Space repository
 * @param {()=>boolean} opts.isCurrent   still the same runtime session
 * @param {(tripId:string, type:string)=>Promise<void>} opts.onType  stores the per-user type
 * @param {(saved:object)=>void} [opts.onSaved]  called after a successful save
 */
export function openTripEditor({ trip, type, currentUid, memberUids, participantName, repo, isCurrent, onType, onSaved }) {
  let selected = retainCurrentParticipant(trip?.participantUserIds || [currentUid], currentUid);
  let emoji = trip?.emoji || "";
  let tripType = type || "domestic";
  const showCompanions = memberUids.length > 1 || selected.some((id) => id !== currentUid);

  modal(`
    <div class="ed-head" data-title="${trip ? "編輯旅程" : "新增旅程"}">
      <button type="button" class="emojibtn" id="nst_emoji_btn" title="圖示" aria-label="圖示">${esc(emoji) || "🧭"}</button>
      <input id="nst_name" class="ed-title" value="${esc(trip?.name || "")}" placeholder="旅程名稱" aria-label="旅程名稱">
      <button type="button" class="iconbtn primary" id="nst_save" title="儲存" aria-label="儲存">${icon("check", 20)}</button>
      ${trip && canDeleteTrip(currentUid, trip) ? `<button type="button" class="iconbtn danger" id="nst_delete" title="刪除" aria-label="刪除">${icon("trash", 19)}</button>` : ""}
      <button type="button" class="iconbtn" id="nst_cancel" title="取消" aria-label="取消">${icon("x", 20)}</button>
    </div>
    <div class="seg typeseg" id="nst_type" role="radiogroup" aria-label="類型">${TRIP_TYPES.map((t) =>
      `<button type="button" class="${t.key === tripType ? "on" : ""}" data-type="${t.key}" role="radio" aria-checked="${t.key === tripType}">${t.icon} ${t.label}</button>`).join("")}</div>
    <div class="ed-row">
      <input type="date" id="nst_start" value="${trip?.startDate || ""}" aria-label="開始日期">
      <span class="ed-arrow">→</span>
      <input type="date" id="nst_end" value="${trip?.endDate || ""}" aria-label="結束日期">
      <input type="color" id="nst_color" value="${esc(trip?.color || "#3f7d78")}" aria-label="顏色" title="顏色">
    </div>
    ${showCompanions ? `<div class="pick partpick" id="nst_participants">${memberUids.map((memberUid) => `<span class="chip ${selected.includes(memberUid) ? "on" : ""}" data-uid="${esc(memberUid)}" role="button" tabindex="0" ${memberUid === currentUid ? 'aria-disabled="true"' : ""}>${esc(participantName(memberUid))}</span>`).join("")}</div>` : ""}
  `, { className: "dialog" });

  const g = (id) => document.getElementById(id);
  g("nst_cancel").onclick = () => closeModal();

  // Editing one trip date seeds the still-empty other one, so its month picker
  // opens next to the date you just set instead of on today.
  const seedOtherTripDate = (fromId, toId) => { if (g(fromId).value && !g(toId).value) g(toId).value = g(fromId).value; };
  g("nst_start").onchange = () => seedOtherTripDate("nst_start", "nst_end");
  g("nst_end").onchange = () => seedOtherTripDate("nst_end", "nst_start");

  g("nst_emoji_btn").onclick = () => openEmojiPicker({
    current: emoji,
    onPick: (value) => { emoji = value; g("nst_emoji_btn").textContent = value || "🧭"; }
  });

  g("nst_type").querySelectorAll("[data-type]").forEach((button) => button.onclick = () => {
    tripType = button.dataset.type;
    g("nst_type").querySelectorAll("[data-type]").forEach((b) => {
      b.classList.toggle("on", b === button);
      b.setAttribute("aria-checked", String(b === button));
    });
  });

  g("nst_participants")?.querySelectorAll("[data-uid]").forEach((chip) => {
    const toggle = () => {
      const participantUid = chip.dataset.uid;
      if (participantUid === currentUid) return;
      selected = selected.includes(participantUid) ? selected.filter((item) => item !== participantUid) : [...selected, participantUid];
      selected = retainCurrentParticipant(selected, currentUid);
      chip.classList.toggle("on", selected.includes(participantUid));
    };
    chip.onclick = toggle;
    chip.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } };
  });

  const collect = () => ({
    name: g("nst_name").value.trim(), emoji,
    startDate: g("nst_start").value, endDate: g("nst_end").value,
    color: g("nst_color").value,
    participantUserIds: retainCurrentParticipant(selected, currentUid), createdBy: trip?.createdBy || currentUid
  });

  g("nst_save").onclick = async () => {
    if (!isCurrent()) return;
    const data = collect();
    if (!data.name) { alert("請填寫旅程名稱。"); return; }
    try {
      let savedId = trip?.id;
      if (trip) await repo.updateTrip(trip.id, data);
      else { const ref = await repo.createTrip(data); savedId = ref.id; }
      if (onType && (!trip || tripType !== type)) await onType(savedId, tripType);
      if (isCurrent() && onSaved) onSaved({ id: savedId, ...data });
      if (isCurrent()) closeModal();
    } catch (error) { if (isCurrent()) alert(`無法儲存旅程：${error.message}`); }
  };

  const del = g("nst_delete");
  if (del) del.onclick = async () => {
    if (!isCurrent() || !canDeleteTrip(currentUid, trip)) return;
    if (!confirm("刪除這個旅程？造訪紀錄會保留。")) return;
    try { await repo.deleteTrip(trip.id); if (isCurrent()) closeModal(); }
    catch (error) { if (isCurrent()) alert(`無法刪除旅程：${error.message}`); }
  };
}
