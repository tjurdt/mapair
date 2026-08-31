import { modal, closeModal } from "./modal.js";
import { esc } from "./html.js";
import { canDeleteTrip, retainCurrentParticipant } from "../no-space/policies.js";

// Trip icons offered in the editor's picker.
const TRIP_EMOJIS = ["🧭","✈️","🚗","🚕","🚌","🚆","🚄","🚢","⛵","🚲","🏍️","🛵",
  "🏔️","⛰️","🌋","🏕️","🏖️","🏝️","🏜️","🏞️","🌅","🌄","🌊","🗻","🗾",
  "⛩️","🏯","🏰","🗼","🎡","🎢","🎑","🌸","🍁","🌺","🌴","🌲",
  "🍜","🍣","🍶","🍵","☕","🍺","🍷","🍦","🍧","🧋","🍡","🍢",
  "🎏","🎿","🏂","🏄","🚠","♨️","🦌","🐧","🐟","🦭","🐢","🦋",
  "📷","🎒","🗺️","💕","❤️","🌈","⭐","🎉","🏡","🌇"];

/**
 * The create / edit-Trip modal.
 *
 * @param {object}   opts
 * @param {object?}  opts.trip           existing Trip doc, or null to create
 * @param {string}   opts.currentUid     signed-in user's uid
 * @param {string[]} opts.memberUids     participant-chip candidates, ordered
 * @param {(uid:string)=>string} opts.participantName  display name for a uid
 * @param {object}   opts.repo           No-Space repository
 * @param {()=>boolean} opts.isCurrent   still the same runtime session
 * @param {(saved:object)=>void} [opts.onSaved]  called after a successful save
 */
export function openTripEditor({ trip, currentUid, memberUids, participantName, repo, isCurrent, onSaved }) {
  let selected = retainCurrentParticipant(trip?.participantUserIds || [currentUid], currentUid);

  modal(`
    <h2 style="margin-bottom:3px">${trip ? "編輯旅程" : "新增旅程"}</h2>
    <div class="admin" style="margin-bottom:12px">新增這趟旅程的造訪時，會自動帶入這些同行者。既有造訪不會改變。</div>
    <div class="field"><label>圖示 + 名稱</label>
      <div class="row" style="gap:8px;position:relative;align-items:stretch">
        <button type="button" id="nst_emoji_btn" style="flex:0 0 52px;font-size:22px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer">${esc(trip?.emoji || "") || "➕"}</button>
        <input id="nst_name" value="${esc(trip?.name || "")}" placeholder="例如：2026 夏日旅行" style="flex:1">
        <input type="hidden" id="nst_emoji" value="${esc(trip?.emoji || "")}">
        <div id="nst_emoji_pop" style="display:none;position:absolute;top:52px;left:0;z-index:30;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:8px;grid-template-columns:repeat(7,1fr);gap:2px;width:264px;max-height:220px;overflow:auto">
          <button type="button" class="nst-emojibtn" data-e="" style="font-size:14px;border:none;background:none;cursor:pointer;padding:4px">無</button>
          ${TRIP_EMOJIS.map((e) => `<button type="button" class="nst-emojibtn" data-e="${e}" style="font-size:20px;border:none;background:none;cursor:pointer;padding:4px">${e}</button>`).join("")}
        </div>
      </div>
    </div>
    <div class="row">
      <div class="field" style="flex:1"><label>開始日期</label><input type="date" id="nst_start" value="${trip?.startDate || ""}"></div>
      <div class="field" style="flex:1"><label>結束日期</label><input type="date" id="nst_end" value="${trip?.endDate || ""}"></div>
    </div>
    <div class="field"><label>旅程顏色</label><input type="color" id="nst_color" value="${esc(trip?.color || "#3f7d78")}" style="width:100%;height:42px;padding:4px"></div>
    <div class="field"><label>同行者</label><div class="pick partpick" id="nst_participants">${memberUids.map((memberUid) => `<span class="chip ${selected.includes(memberUid) ? "on" : ""}" data-uid="${esc(memberUid)}" role="button" tabindex="0" ${memberUid === currentUid ? 'aria-disabled="true"' : ""}>${esc(participantName(memberUid))}</span>`).join("")}</div></div>
    <div class="row"><button class="btn" id="nst_save">完成</button>${trip && canDeleteTrip(currentUid, trip) ? `<button class="danger" id="nst_delete">刪除旅程</button>` : ""}</div>
  `);

  const g = (id) => document.getElementById(id);

  // Editing one trip date seeds the still-empty other one, so its month picker
  // opens next to the date you just set instead of on today.
  const seedOtherTripDate = (fromId, toId) => { if (g(fromId).value && !g(toId).value) g(toId).value = g(fromId).value; };
  g("nst_start").onchange = () => seedOtherTripDate("nst_start", "nst_end");
  g("nst_end").onchange = () => seedOtherTripDate("nst_end", "nst_start");

  const emojiBtn = g("nst_emoji_btn");
  const emojiPop = g("nst_emoji_pop");
  emojiBtn.onclick = () => { emojiPop.style.display = emojiPop.style.display === "none" ? "grid" : "none"; };
  emojiPop.querySelectorAll(".nst-emojibtn").forEach((btn) => btn.onclick = () => {
    g("nst_emoji").value = btn.dataset.e;
    emojiBtn.textContent = btn.dataset.e || "➕";
    emojiPop.style.display = "none";
  });

  g("nst_participants").querySelectorAll("[data-uid]").forEach((chip) => {
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
    name: g("nst_name").value.trim(), emoji: g("nst_emoji").value.trim(),
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
      if (isCurrent() && onSaved) onSaved({ id: savedId, ...data });
      if (isCurrent()) closeModal();
    } catch (error) { if (isCurrent()) alert(`無法儲存旅程：${error.message}`); }
  };

  const del = g("nst_delete");
  if (del) del.onclick = async () => {
    if (!isCurrent() || !canDeleteTrip(currentUid, trip)) return;
    try { await repo.deleteTrip(trip.id); if (isCurrent()) closeModal(); }
    catch (error) { if (isCurrent()) alert(`無法刪除旅程：${error.message}`); }
  };
}
