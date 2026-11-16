import { modal, closeModal } from "./modal.js";
import { esc } from "./html.js";
import { icon } from "./icons.js";
import { canDeleteVisit, retainCurrentParticipant } from "../no-space/policies.js";
import { visitParticipantsFromTrip } from "../no-space/trips.js";
import { participantContributions, averageSubmittedRating } from "../no-space/contributions.js";
import { PURPOSES, purposeOf, categoryToStore } from "../domain/purposes.js";

// Next rating when star `n` is tapped: n → n-½ → cleared → n …
export function nextStarRating(current, n) {
  if (current === n) return n - 0.5;
  if (current === n - 0.5) return 0;
  return n;
}

function nextDay(date) {
  const d = new Date(date + "T00:00:00");
  if (Number.isNaN(d.getTime())) return "";
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function starsHTML(rating) {
  return [1, 2, 3, 4, 5].map((n) => {
    const state = rating >= n ? "full" : rating >= n - 0.5 ? "half" : "";
    return `<button type="button" class="star ${state}" data-star="${n}" aria-label="${n} 星">★</button>`;
  }).join("");
}

// The create / edit-Visit dialog. main.js resolves its state into `ctx` (the
// initial values, option lists, and collections used by the live pieces) and
// implements onSave / onDelete against the repository; this module owns the
// form and builds the { shared, personal, newPlace } payload.
//
// Fields: place, date (+ optional stay checkout), purpose, trip, rating, note.
// Companions show only when the user has friends. Visit depth is not edited:
// it is derived per area (src/domain/area-depth.js); a stay still writes the
// "住宿" level the schema uses to mark stays.
export function openVisitEditor(ctx) {
  const {
    creating, currentUid, rawVisit, seed, legacyImport,
    initialDate, initialEndDate, initialTripId, initialCategory,
    placeName, tripOptions, missingTripId,
    tripsById, contributions, memberUids, participantName,
    isCurrent, onSave, onDelete, onDitto
  } = ctx;

  let selected = retainCurrentParticipant([...ctx.initialSelected], currentUid);
  const selectedPlaceId = ctx.selectedPlaceId;
  let purpose = purposeOf(initialCategory, rawVisit?.kind);
  // A stay is simply the 住宿 purpose: picking it asks for a checkout date.
  const isStay = () => purpose === "住宿";
  let dirty = false;
  const memberIdSet = new Set(memberUids);
  const mine = contributions[currentUid] || {};
  let rating = Number(mine.rating) || 0;
  const canDelete = !!rawVisit && canDeleteVisit(currentUid, rawVisit);
  const showCompanions = memberUids.length > 1 || selected.some((id) => id !== currentUid);

  const othersHTML = () => {
    const others = Object.entries(participantContributions(contributions, selected)).filter(([uid]) => uid !== currentUid);
    if (!others.length) return "";
    const average = averageSubmittedRating(Object.values(participantContributions(contributions, selected)));
    return `<details class="ed-more"><summary>${icon("users", 14)} 同行者記錄${average == null ? "" : ` · 平均 ★${Math.round(average * 10) / 10}`}</summary>${others.map(([uid, value]) =>
      `<div class="ed-note"><b>${esc(participantName(uid))}</b>${value.rating ? ` ★${value.rating}` : ""}${value.memory ? `<p>${esc(value.memory)}</p>` : ""}</div>`).join("")}</details>`;
  };
  const legacyHTML = legacyImport && (legacyImport.rating != null || legacyImport.review) ? `
    <details class="ed-more legacy-record"><summary>舊版記錄</summary>
      <div class="ed-note">${legacyImport.rating != null ? `★${esc(String(legacyImport.rating))}` : ""}${legacyImport.review ? `<p>${esc(legacyImport.review)}</p>` : ""}</div>
    </details>` : "";

  // Always a plain text field: type to name a new Place or rename this one.
  const placeField = `<input id="ns_place_name" class="ed-title" value="${esc(placeName)}" placeholder="地點名稱" aria-label="地點名稱" data-place-id="${esc(selectedPlaceId || "")}">`;

  modal(`
    <div class="ed-head" data-title="${creating ? "新增造訪" : "編輯造訪"}">
      ${placeField}
      ${!creating && onDitto ? `<button type="button" class="iconbtn" id="ns_ditto" title="這裡再記一筆" aria-label="這裡再記一筆">${icon("copy", 18)}</button>` : ""}
      ${canDelete ? `<button type="button" class="iconbtn danger" id="ns_delete" title="刪除" aria-label="刪除">${icon("trash", 19)}</button>` : ""}
      <button type="button" class="iconbtn primary" id="ns_save" title="儲存並關閉" aria-label="儲存並關閉">${icon("x", 20)}</button>
    </div>
    <div class="ed-row">
      <input type="date" id="ns_date" value="${esc(initialDate)}" aria-label="日期">
      <span class="ed-arrow" id="ns_end_arrow" ${isStay() ? "" : "hidden"}>→</span>
      <input type="date" id="ns_end_date" value="${esc(initialEndDate)}" aria-label="退房日期" title="退房日期" ${isStay() ? "" : "hidden"}>
    </div>
    <div class="purpose-pick" id="ns_purpose" role="radiogroup" aria-label="造訪目的">${PURPOSES.map((p) =>
      `<button type="button" class="pp ${p.name === purpose ? "on" : ""}" data-purpose="${p.name}" style="--pc:${p.color}" role="radio" aria-checked="${p.name === purpose}"><span>${p.icon}</span>${p.name}</button>`).join("")}</div>
    <div class="ed-row">
      <select id="ns_trip" aria-label="旅程"><option value="">🏠 無旅程</option>${missingTripId ? `<option value="${esc(missingTripId)}" selected>已刪除旅程</option>` : ""}${tripOptions.map((t) => `<option value="${esc(t.id)}" ${t.id === initialTripId ? "selected" : ""}>${esc((t.emoji ? t.emoji + " " : "") + (t.name || ""))}</option>`).join("")}</select>
      <span class="stars" id="ns_stars" aria-label="評分">${starsHTML(rating)}</span>
    </div>
    <textarea id="ns_memory" rows="2" placeholder="評語">${esc(mine.memory || "")}</textarea>
    ${showCompanions ? `<div class="pick partpick" id="ns_participants">${memberUids.map((uid) => `<span class="chip ${selected.includes(uid) ? "on" : ""}" data-uid="${esc(uid)}" role="button" tabindex="0" ${uid === currentUid ? 'aria-disabled="true"' : ""}>${esc(participantName(uid))}</span>`).join("")}<span id="ns_participants_hist"></span></div>` : ""}
    <div id="ns_other_contributions">${othersHTML()}</div>
    ${legacyHTML}
  `, { className: "dialog", onDismiss: () => saveAndClose({ onlyIfChanged: true }) });

  const g = (id) => document.getElementById(id);
  const card = g("ns_date").closest(".modal");
  card.addEventListener("input", () => { dirty = true; });
  card.addEventListener("click", (event) => { if (event.target.closest("[data-purpose],[data-star],[data-uid],[data-histdel]")) dirty = true; });

  const endDate = g("ns_end_date");
  const syncStay = () => {
    endDate.hidden = !isStay();
    g("ns_end_arrow").hidden = !isStay();
    if (isStay() && !(endDate.value > g("ns_date").value)) endDate.value = nextDay(g("ns_date").value);
    if (isStay() && !endDate.hidden && creating) endDate.focus();
  };
  // Until a stay is switched on, the checkout simply trails the date by a night;
  // once on, it only moves when the date overtakes it.
  g("ns_date").addEventListener("change", () => {
    const date = g("ns_date").value;
    if (date && (!isStay() || !(endDate.value > date))) endDate.value = nextDay(date);
  });

  g("ns_purpose").querySelectorAll("[data-purpose]").forEach((button) => button.onclick = () => {
    purpose = purpose === button.dataset.purpose ? "" : button.dataset.purpose;
    g("ns_purpose").querySelectorAll("[data-purpose]").forEach((b) => {
      const on = b.dataset.purpose === purpose;
      b.classList.toggle("on", on);
      b.setAttribute("aria-checked", String(on));
    });
    syncStay();
  });

  const starsEl = g("ns_stars");
  starsEl.onclick = (event) => {
    const star = event.target.closest("[data-star]");
    if (!star) return;
    rating = nextStarRating(rating, Number(star.dataset.star));
    starsEl.innerHTML = starsHTML(rating);
  };

  const refreshOthers = () => { const box = g("ns_other_contributions"); if (box) box.innerHTML = othersHTML(); };


  // Participants already on this Visit who are not selectable members (former
  // friends). Kept on save; the creator can prune one, one-way.
  const renderHistoricalParticipants = () => {
    const box = g("ns_participants_hist");
    if (!box) return;
    const hist = selected.filter((id) => id !== currentUid && !memberIdSet.has(id));
    box.innerHTML = hist.map((id) => `<span class="chip histchip">${esc(participantName(id))} <span data-histdel="${esc(id)}" class="histx" role="button" tabindex="0">✕</span></span>`).join("");
    box.querySelectorAll("[data-histdel]").forEach((x) => {
      const drop = () => { selected = selected.filter((item) => item !== x.dataset.histdel); renderHistoricalParticipants(); refreshOthers(); };
      x.onclick = drop;
      x.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); drop(); } };
    });
  };

  const syncChips = () => g("ns_participants")?.querySelectorAll("[data-uid]").forEach((chip) => chip.classList.toggle("on", selected.includes(chip.dataset.uid)));
  g("ns_trip").onchange = () => {
    if (!creating || !g("ns_trip").value || !tripsById[g("ns_trip").value]) return;
    selected = visitParticipantsFromTrip(tripsById[g("ns_trip").value], currentUid);
    syncChips();
    renderHistoricalParticipants();
    refreshOthers();
  };

  g("ns_participants")?.querySelectorAll("[data-uid]").forEach((chip) => {
    const toggle = () => {
      const uid = chip.dataset.uid;
      if (uid === currentUid) return;
      selected = selected.includes(uid) ? selected.filter((item) => item !== uid) : [...selected, uid];
      selected = retainCurrentParticipant(selected, currentUid);
      chip.classList.toggle("on", selected.includes(uid));
      refreshOthers();
    };
    chip.onclick = toggle;
    chip.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } };
  });
  renderHistoricalParticipants();

  // ✕ = save and close. A backdrop tap does the same, but only when something
  // was changed; an untouched editor just closes without writing.
  let saving = false;
  async function saveAndClose({ onlyIfChanged = false } = {}) {
    if (!isCurrent() || saving) return;
    const name = g("ns_place_name").value.trim();
    if (selectedPlaceId && !name) { alert("請填寫地點名稱。"); return; }
    if ((onlyIfChanged || !creating) && !dirty) { closeModal(); return; }
    if (creating && !selectedPlaceId && !name) { closeModal(); return; }
    const date = g("ns_date").value;
    if (!date) { alert("請填寫日期。"); return; }
    const stay = isStay();
    if (stay && !(endDate.value > date)) { alert("退房日期要晚於入住日。"); return; }
    const previousLevel = rawVisit?.level && rawVisit.level !== "住宿" ? rawVisit.level : "旅遊";
    const shared = {
      placeId: selectedPlaceId,
      date,
      category: categoryToStore(purpose, initialCategory),
      participantUserIds: retainCurrentParticipant(selected, currentUid),
      tripId: g("ns_trip").value || null,
      level: stay ? "住宿" : previousLevel,
      kind: stay ? "stay" : "visit",
      endDate: stay ? endDate.value : "",
      createdBy: rawVisit?.createdBy || currentUid
    };
    const personal = { rating: rating > 0 ? rating : null, memory: g("ns_memory").value };
    saving = true;
    try {
      await onSave({
        shared, personal, creating, date,
        newPlace: (!selectedPlaceId && name) ? { ...(seed || {}), name } : null,
        rename: selectedPlaceId && name !== String(placeName || "").trim() ? name : ""
      });
      if (isCurrent()) closeModal();
    } catch (error) { if (isCurrent()) alert(`無法儲存：${error.message}`); }
    finally { saving = false; }
  }
  g("ns_save").onclick = () => saveAndClose();
  const dittoButton = g("ns_ditto");
  if (dittoButton) dittoButton.onclick = () => { closeModal(); onDitto(); };

  const deleteButton = g("ns_delete");
  if (deleteButton) deleteButton.onclick = async () => {
    if (!isCurrent() || !canDeleteVisit(currentUid, rawVisit)) return;
    if (!confirm("刪除這筆造訪？")) return;
    try {
      await onDelete();
      if (isCurrent()) closeModal();
    } catch (error) { if (isCurrent()) alert(`無法刪除：${error.message}`); }
  };
}
