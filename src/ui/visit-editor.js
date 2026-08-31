import { modal, closeModal } from "./modal.js";
import { esc } from "./html.js";
import { canDeleteVisit, retainCurrentParticipant } from "../no-space/policies.js";
import { visitParticipantsFromTrip } from "../no-space/trips.js";
import { participantContributions, averageSubmittedRating } from "../no-space/contributions.js";
import { NO_SPACE_LEVELS } from "../no-space/schema.js";

// The create / edit-Visit modal. main.js resolves its state into `ctx` (all
// the initial values, the option lists, and the collections used by the live
// pieces) and implements onSave / onDelete against the repository; this module
// owns the form: rendering, the interactive participant / stay / "住宿"→depth /
// contributions-preview behaviour, and building the { shared, personal,
// newPlace } payload.
export function openVisitEditor(ctx) {
  const {
    creating, currentUid, rawVisit, seed, legacyImport,
    initialDate, initialEndDate, initialLevel, initialTripId,
    categoryOptionNames, categorySelected, categoryCustomText,
    allowNewPlace, newPlaceName, placeOptions, tripOptions, missingTripId,
    tripsById, contributions, memberUids, participantName,
    isCurrent, onSave, onDelete
  } = ctx;

  let selected = retainCurrentParticipant([...ctx.initialSelected], currentUid);
  let selectedPlaceId = ctx.selectedPlaceId;
  const memberIdSet = new Set(memberUids);
  const mine = contributions[currentUid] || {};
  const canDelete = !!rawVisit && canDeleteVisit(currentUid, rawVisit);
  const scopedContributions = () => participantContributions(contributions, selected);

  const contributionRows = () => {
    const others = Object.entries(scopedContributions()).filter(([uid]) => uid !== currentUid);
    return others.length ? others.map(([uid, value]) => `
      <div class="card compact" style="margin-bottom:8px">
        <div class="cname">${esc(participantName(uid))}${value.rating ? ` · ★ ${value.rating}` : " · 尚未評分"}</div>
        <div class="admin">${esc(value.memory || "尚未留下回憶")}</div>
      </div>`).join("") : `<div class="admin">同行者尚未留下評分或回憶。</div>`;
  };
  const averageText = () => {
    const average = averageSubmittedRating(Object.values(scopedContributions()));
    return `平均評分：${average == null ? "尚未評分" : `★ ${Math.round(average * 100) / 100}`}（只計已提交評分）`;
  };
  const legacyImportHtml = legacyImport ? `
    <div class="editor-section legacy-record">
      <div class="editor-section-head"><div><div class="editor-section-title">舊版共同記錄</div><div class="editor-section-note">從舊版保留下來，僅供閱讀。</div></div></div>
      ${legacyImport.rating != null ? `<div class="legacy-record-row"><span>舊版評分</span><strong>★ ${esc(String(legacyImport.rating))}</strong></div>` : ""}
      ${legacyImport.review ? `<div class="legacy-record-memory"><span>舊版回憶</span><p>${esc(legacyImport.review)}</p></div>` : ""}
      ${legacyImport.level ? `<div class="legacy-record-row"><span>舊版足跡深度</span><strong>${esc(legacyImport.level)}</strong></div>` : ""}
    </div>` : "";

  modal(`
    <h2 style="margin-bottom:3px">${creating ? "新增造訪" : "編輯造訪"}</h2>
    <div class="admin" style="margin-bottom:12px">同一天的足跡，可以在清單調整成你自己的順序。</div>
    <div class="editor-section">
      <div class="editor-section-head"><div><div class="editor-section-title">共同經歷</div><div class="editor-section-note">一起留下這次造訪的基本記錄。</div></div></div>
      ${allowNewPlace
        ? `<div class="field"><label>地點名稱</label><input id="ns_place_name" value="${esc(newPlaceName)}" placeholder="地點名稱"></div>`
        : `<div class="field"><label>地點</label><select id="ns_place">${placeOptions.map((p) => `<option value="${esc(p.id)}" ${p.id === selectedPlaceId ? "selected" : ""}>${esc(p.name || "未命名地點")}</option>`).join("")}</select></div>`}
      <div class="row">
        <div class="field" style="flex:1"><label>日期</label><input type="date" id="ns_date" value="${esc(initialDate)}"></div>
        <div class="field" style="flex:1"><label>做什麼</label>
          <select id="ns_category">
            <option value="" ${categorySelected === "" ? "selected" : ""}>未指定</option>
            ${categoryOptionNames.map((name) => `<option value="${esc(name)}" ${name === categorySelected ? "selected" : ""}>${esc(name)}</option>`).join("")}
            <option value="其他" ${categorySelected === "其他" ? "selected" : ""}>其他</option>
          </select>
          <input id="ns_category_custom" placeholder="描述這個地點的活動" value="${esc(categoryCustomText)}" style="display:${categorySelected === "其他" ? "block" : "none"};margin-top:6px"></div>
      </div>
      <div class="field"><label>同行者</label>
        <div class="pick partpick" id="ns_participants">${memberUids.map((uid) => `<span class="chip ${selected.includes(uid) ? "on" : ""}" data-uid="${esc(uid)}" role="button" tabindex="0" ${uid === currentUid ? 'aria-disabled="true"' : ""}>${esc(participantName(uid))}</span>`).join("")}</div>
        <div id="ns_participants_hist" class="admin" style="margin-top:6px"></div>
      </div>
      <div class="field"><label>旅程</label><select id="ns_trip"><option value="">無</option>${missingTripId ? `<option value="${esc(missingTripId)}" selected>已刪除旅程</option>` : ""}${tripOptions.map((t) => `<option value="${esc(t.id)}" ${t.id === initialTripId ? "selected" : ""}>${esc((t.emoji ? t.emoji + " " : "") + (t.name || ""))}</option>`).join("")}</select></div>
      <div class="row">
        <div class="field" style="flex:1"><label>造訪深度</label><select id="ns_level">${NO_SPACE_LEVELS.map((level) => `<option value="${esc(level)}" ${level === initialLevel ? "selected" : ""}>${esc(level)}</option>`).join("")}</select></div>
        <div class="field" id="ns_end_wrap" style="flex:1"><label>退房日期</label><input type="date" id="ns_end_date" value="${esc(initialEndDate)}"></div>
      </div>
    </div>
    <div class="editor-section">
      <div class="editor-section-head"><div><div class="editor-section-title">我的記錄</div><div class="editor-section-note">這些內容只屬於你。</div></div></div>
      <div class="field"><label>評分</label><div class="row" style="align-items:center"><input type="range" id="ns_rating" min="0" max="5" step="0.5" value="${mine.rating || 0}" style="flex:1"><span id="ns_rating_value" style="width:70px;text-align:right">${mine.rating ? `★ ${mine.rating}` : "尚未評分"}</span></div></div>
      <div class="field"><label>回憶</label><textarea id="ns_memory" style="width:100%;min-height:72px" placeholder="寫下這次造訪的回憶">${esc(mine.memory || "")}</textarea></div>
    </div>
    ${rawVisit ? `<div class="editor-section"><div class="editor-section-head"><div class="editor-section-title">同行者的記錄</div></div><div id="ns_other_contributions">${contributionRows()}</div><div class="admin contribution-average" id="ns_average">${averageText()}</div></div>` : ""}
    ${legacyImportHtml}
    <div class="row"><button class="btn" id="ns_save">完成</button>${canDelete ? `<button class="danger" id="ns_delete">刪除這次造訪</button>` : ""}</div>
  `);

  const g = (id) => document.getElementById(id);
  const endWrap = g("ns_end_wrap");
  const refreshStay = () => { endWrap.style.display = g("ns_level").value === "住宿" ? "block" : "none"; };
  refreshStay();
  g("ns_level").onchange = refreshStay;

  const categoryCustom = g("ns_category_custom");
  // Recording 住宿 as the activity implies a 住宿-depth stay — from the list or
  // the free-text box.
  const applyStayCategoryDepth = (activity) => {
    if (activity === "住宿" && g("ns_level").value !== "住宿") { g("ns_level").value = "住宿"; refreshStay(); }
  };
  g("ns_category").onchange = () => {
    const value = g("ns_category").value;
    const isOther = value === "其他";
    categoryCustom.style.display = isOther ? "block" : "none";
    if (isOther) categoryCustom.focus();
    applyStayCategoryDepth(value);
  };
  categoryCustom.onchange = () => applyStayCategoryDepth(categoryCustom.value.trim());

  g("ns_rating").oninput = () => { const rating = Number(g("ns_rating").value); g("ns_rating_value").textContent = rating ? `★ ${rating}` : "尚未評分"; };

  const refreshContributionVisibility = () => {
    if (g("ns_average")) g("ns_average").textContent = averageText();
    if (g("ns_other_contributions")) g("ns_other_contributions").innerHTML = contributionRows();
  };

  const placeSelect = g("ns_place");
  if (placeSelect) placeSelect.onchange = () => { selectedPlaceId = placeSelect.value; };

  // Participants already on this Visit who are not selectable members (former
  // friends, or people added before an unfriend). Kept on save; the creator can
  // prune one, one-way — it cannot be re-added here.
  const renderHistoricalParticipants = () => {
    const box = g("ns_participants_hist");
    if (!box) return;
    const hist = selected.filter((id) => id !== currentUid && !memberIdSet.has(id));
    box.style.display = hist.length ? "block" : "none";
    box.innerHTML = hist.length
      ? `也在這次造訪：${hist.map((id) => `<span class="chip" style="background:none;border:1px solid var(--line)">${esc(participantName(id))} <span data-histdel="${esc(id)}" role="button" tabindex="0" style="cursor:pointer;color:#b25b6b">✕</span></span>`).join(" ")}`
      : "";
    box.querySelectorAll("[data-histdel]").forEach((x) => {
      const drop = () => { selected = selected.filter((item) => item !== x.dataset.histdel); renderHistoricalParticipants(); refreshContributionVisibility(); };
      x.onclick = drop;
      x.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); drop(); } };
    });
  };

  g("ns_trip").onchange = () => {
    if (!creating || !g("ns_trip").value || !tripsById[g("ns_trip").value]) return;
    selected = visitParticipantsFromTrip(tripsById[g("ns_trip").value], currentUid);
    g("ns_participants").querySelectorAll("[data-uid]").forEach((chip) => chip.classList.toggle("on", selected.includes(chip.dataset.uid)));
    renderHistoricalParticipants();
    refreshContributionVisibility();
  };

  g("ns_participants").querySelectorAll("[data-uid]").forEach((chip) => {
    const toggle = () => {
      const uid = chip.dataset.uid;
      if (uid === currentUid) return;
      selected = selected.includes(uid) ? selected.filter((item) => item !== uid) : [...selected, uid];
      selected = retainCurrentParticipant(selected, currentUid);
      chip.classList.toggle("on", selected.includes(uid));
      refreshContributionVisibility();
    };
    chip.onclick = toggle;
    chip.onkeydown = (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggle(); } };
  });
  renderHistoricalParticipants();

  g("ns_save").onclick = async () => {
    if (!isCurrent()) return;
    const nameInput = g("ns_place_name");
    const name = nameInput ? nameInput.value.trim() : "";
    const date = g("ns_date").value;
    if (!date || (!selectedPlaceId && !name)) { alert("請填寫地點名稱與日期。"); return; }
    const level = g("ns_level").value;
    const stay = level === "住宿";
    if (stay && !(g("ns_end_date").value > date)) { alert("住宿需要一個晚於造訪日的退房日期。"); return; }
    const shared = {
      placeId: selectedPlaceId,
      date,
      category: g("ns_category").value === "其他" ? (g("ns_category_custom").value.trim() || "其他") : g("ns_category").value,
      participantUserIds: retainCurrentParticipant(selected, currentUid),
      tripId: g("ns_trip").value || null,
      level,
      kind: stay ? "stay" : "visit",
      endDate: stay ? g("ns_end_date").value : "",
      createdBy: rawVisit?.createdBy || currentUid
    };
    const personal = {
      rating: Number(g("ns_rating").value) > 0 ? Number(g("ns_rating").value) : null,
      memory: g("ns_memory").value
    };
    try {
      await onSave({ shared, personal, newPlace: (!selectedPlaceId && name) ? { ...(seed || {}), name } : null, creating, date });
      if (isCurrent()) closeModal();
    } catch (error) { if (isCurrent()) alert(`無法儲存造訪：${error.message}`); }
  };

  const deleteButton = g("ns_delete");
  if (deleteButton) deleteButton.onclick = async () => {
    if (!isCurrent() || !canDeleteVisit(currentUid, rawVisit)) return;
    try {
      await onDelete();
      if (isCurrent()) closeModal();
    } catch (error) { if (isCurrent()) alert(`無法完整刪除造訪：${error.message}`); }
  };
}
