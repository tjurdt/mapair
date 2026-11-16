import { modal, closeModal } from "./modal.js";
import { esc } from "./html.js";
import { icon } from "./icons.js";

const MARKER_MODE_OPTIONS = [
  ["cat", "目的"], ["level", "深度"], ["who", "同行者"], ["trip", "旅程"],
  ["rating", "評分"], ["dateFirst", "首次造訪"], ["dateLast", "最近造訪"]
];

// Keep only the colour overrides that differ from the built-in default.
function changedColors(draft, current, defaults, keys) {
  const out = {};
  for (const key of keys) {
    const value = draft[key] || current[key];
    if (value && value.toLowerCase() !== String(defaults[key] || "").toLowerCase()) out[key] = value;
  }
  return out;
}

/**
 * The settings dialog: map colouring, purpose + depth colours, display name,
 * friends, sign-out.
 *
 * @param {object} opts
 * @param {object} opts.values         { showPins, markerMode, choroMetric, choroAlpha, proximityEnabled, displayName }
 * @param {object} opts.catColors      resolved current { purpose: hex }
 * @param {object} opts.levelColors    resolved current { depth: hex }
 * @param {object} opts.catalog        { areaMetrics:[[v,l]], purposes:[{name,icon,color}],
 *                                       purposeColors:{name:hex}, levelOrder:[string], levelDefaults:{level:hex} }
 * @param {(v:string)=>void} opts.onMarkerMode
 * @param {(v:boolean)=>void} opts.onShowPins
 * @param {(v:number)=>void} opts.onAlpha   0..1
 * @param {(v:string)=>void} opts.onMetric
 * @param {()=>void} opts.onOpenFriends
 * @param {()=>void} opts.onLogout
 * @param {(payload:object)=>Promise<void>} opts.onSave  { displayName, categoryColors, levelColors }
 */
export function openSettingsPanel({
  values, catColors, levelColors, catalog,
  onMarkerMode, onShowPins, onAlpha, onMetric, onOpenFriends, onLogout, onSave
}) {
  const metricLocked = values.proximityEnabled;
  const draftCatColors = {};
  const draftLevelColors = {};
  const purposeNames = catalog.purposes.map((p) => p.name);
  const catColorValue = (name) => draftCatColors[name] || catColors[name] || catalog.purposeColors[name] || "#9aa5ad";
  const levelColorValue = (level) => draftLevelColors[level] || levelColors[level] || catalog.levelDefaults[level];

  modal(`
    <div class="ed-head" data-title="設定">
      <input id="ns_name" class="ed-title" value="${esc(values.displayName)}" placeholder="顯示名稱" aria-label="顯示名稱">
      <button type="button" class="iconbtn primary" id="ns_done" title="儲存並關閉" aria-label="儲存並關閉">${icon("x", 20)}</button>
    </div>
    <div class="srow"><span>${icon("pin", 16)} 標記</span>
      <input type="checkbox" id="ns_pins" ${values.showPins ? "checked" : ""} aria-label="顯示地點標記">
      <select id="ns_markermode" class="sselect" aria-label="標記顏色">${MARKER_MODE_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div>
    <div class="srow"><span>${icon("layout", 16)} 區域</span>${metricLocked
      ? `<select class="sselect" disabled title="鄰近圖層沿用標記顏色"><option>同標記</option></select>`
      : `<select id="ns_metric" class="sselect" aria-label="區域上色">${catalog.areaMetrics.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select>`}
      <input type="range" id="ns_alpha" min="10" max="90" value="${Math.round(values.choroAlpha * 100)}" aria-label="透明度"></div>
    <div class="swgrid">${catalog.purposes.map((p) => `
      <label class="swcell" title="${esc(p.name)}"><span>${p.icon}</span><input type="color" class="ns_catcolor" data-cat="${esc(p.name)}" value="${catColorValue(p.name)}" aria-label="${esc(p.name)} 顏色"></label>`).join("")}
    </div>
    <div class="swgrid">${catalog.levelOrder.slice().reverse().map((level) => `
      <label class="swcell wide"><span>${esc(level)}</span><input type="color" class="ns_levelcolor" data-level="${esc(level)}" value="${levelColorValue(level)}" aria-label="${esc(level)} 顏色"></label>`).join("")}
    </div>
    <div class="setactions">
      <button type="button" class="btn grey" id="ns_friends_open">${icon("users", 16)} 好友</button>
      <button type="button" class="btn grey" id="ns_logout">${icon("logout", 16)} 登出</button>
    </div>
  `, { className: "dialog", onDismiss: () => saveAndClose() });

  const mode = document.getElementById("ns_markermode");
  mode.value = values.markerMode;
  mode.onchange = (event) => onMarkerMode(event.target.value);

  const metric = document.getElementById("ns_metric");
  if (metric) {
    metric.value = values.choroMetric;
    metric.onchange = (event) => onMetric(event.target.value);
  }

  document.getElementById("ns_pins").onchange = (event) => onShowPins(event.target.checked);
  document.getElementById("ns_alpha").oninput = (event) => onAlpha((+event.target.value) / 100);
  document.querySelectorAll(".ns_catcolor").forEach((input) => input.oninput = () => { draftCatColors[input.dataset.cat] = input.value; });
  document.querySelectorAll(".ns_levelcolor").forEach((input) => input.oninput = () => { draftLevelColors[input.dataset.level] = input.value; });

  document.getElementById("ns_friends_open").onclick = () => onOpenFriends();
  document.getElementById("ns_logout").onclick = () => { closeModal(); onLogout(); };

  // ✕ (or a backdrop tap) saves and closes.
  async function saveAndClose() {
    await onSave({
      displayName: document.getElementById("ns_name").value,
      categoryColors: changedColors(draftCatColors, catColors, catalog.purposeColors, purposeNames),
      levelColors: changedColors(draftLevelColors, levelColors, catalog.levelDefaults, catalog.levelOrder)
    });
    closeModal();
  }
  document.getElementById("ns_done").onclick = () => saveAndClose();
}
