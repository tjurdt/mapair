import { modal, closeModal } from "./modal.js";
import { esc } from "./html.js";

const MARKER_MODE_OPTIONS = [
  ["cat", "活動"], ["level", "我的足跡深度"], ["who", "參與者"], ["trip", "旅程"],
  ["rating", "我的評分"], ["dateFirst", "首次造訪"], ["dateLast", "最近造訪"]
];

// Keep only the colour overrides that differ from the built-in default
// (case-insensitive, matching the original comparison).
function changedColors(draft, current, defaults, keys) {
  const out = {};
  for (const key of keys) {
    const value = draft[key] || current[key];
    if (value && value.toLowerCase() !== String(defaults[key] || "").toLowerCase()) out[key] = value;
  }
  return out;
}

/**
 * The settings sheet: display toggles, map colouring, "做什麼" picks + colours,
 * depth colours, display name, and the friends link.
 *
 * @param {object} opts
 * @param {object} opts.values         { showPins, markerMode, choroMetric, choroAlpha, proximityEnabled, displayName }
 * @param {string[]} opts.categoryPicks
 * @param {object} opts.catColors      resolved current { name: hex }
 * @param {object} opts.levelColors    resolved current { level: hex }
 * @param {object} opts.catalog        { areaMetrics:[[v,l]], categoryPresets:[[name,hex]],
 *                                       categoryPresetColors, categoryPresetNames,
 *                                       levelOrder:[string], levelDefaults:{level:hex} }
 * @param {(v:string)=>void} opts.onMarkerMode
 * @param {(v:boolean)=>void} opts.onShowPins
 * @param {(v:number)=>void} opts.onAlpha   0..1
 * @param {(v:string)=>void} opts.onMetric
 * @param {()=>void} opts.onOpenFriends
 * @param {(payload:object)=>Promise<void>} opts.onSave  { displayName, categoryPicks, categoryColors, levelColors }
 */
export function openSettingsPanel({
  values, categoryPicks, catColors, levelColors, catalog,
  onMarkerMode, onShowPins, onAlpha, onMetric, onOpenFriends, onSave
}) {
  const metricLocked = values.proximityEnabled;
  const draftPicks = new Set(categoryPicks);
  const draftCatColors = {};
  const draftLevelColors = {};
  const catColorValue = (name) => draftCatColors[name] || catColors[name] || catalog.categoryPresetColors[name] || "#9aa5ad";
  const levelColorValue = (level) => draftLevelColors[level] || levelColors[level] || catalog.levelDefaults[level];

  const categoryRows = catalog.categoryPresets.map(([name]) => {
    const locked = name === "其他";
    return `
    <label class="srow" style="cursor:${locked ? "default" : "pointer"}">
      <span><input type="checkbox" class="ns_catpick" data-cat="${esc(name)}" ${locked || draftPicks.has(name) ? "checked" : ""} ${locked ? "disabled" : ""} style="width:16px;height:16px;margin-right:8px;vertical-align:middle">${esc(name)}${locked ? '<span style="color:var(--ink-soft);font-size:12px"> · 一律顯示</span>' : ""}</span>
      <input type="color" class="ns_catcolor" data-cat="${esc(name)}" value="${catColorValue(name)}" style="width:40px;height:26px;padding:0;border:1px solid var(--line);border-radius:6px">
    </label>`;
  }).join("");
  const levelRows = catalog.levelOrder.slice().reverse().map((level) => `
    <div class="colitem"><span>${esc(level)}</span>
      <input type="color" class="ns_levelcolor" data-level="${esc(level)}" value="${levelColorValue(level)}" style="width:40px;height:26px;padding:0;border:1px solid var(--line);border-radius:6px"></div>`).join("");

  modal(`
    <h2 style="margin-bottom:14px">設定</h2>
    <div class="sethead">顯示</div>
    <div class="srow"><span>顯示地點標記</span><input type="checkbox" id="ns_pins" ${values.showPins ? "checked" : ""} style="width:18px;height:18px"></div>
    <div class="srow"><span>標記顏色</span><select id="ns_markermode" class="sselect">${MARKER_MODE_OPTIONS.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select></div>
    <div class="sethead">地圖上色</div>
    <div class="srow"><span>上色依據</span>${metricLocked
      ? `<select class="sselect" disabled title="鄰近圖層開啟時，範圍會沿用地標顏色"><option>與標記顏色連動（鄰近）</option></select>`
      : `<select id="ns_metric" class="sselect">${catalog.areaMetrics.map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}</select>`}</div>
    ${metricLocked ? `<div class="admin" style="margin:-2px 0 4px">鄰近圖層開啟時，周圍範圍會直接沿用地標的顏色。</div>` : ""}
    <div class="srow"><span>透明度</span><input type="range" id="ns_alpha" min="10" max="90" value="${Math.round(values.choroAlpha * 100)}" style="flex:0 0 55%"></div>
    <div class="sethead">「做什麼」選項</div>
    <div class="admin" style="margin-bottom:4px">勾選的項目會出現在新增造訪的「做什麼」下拉選單；右側可改顏色。</div>
    ${categoryRows}
    <div class="sethead">造訪深度顏色</div>
    <div class="colgrid">${levelRows}</div>
    <div class="sethead">個人資料</div>
    <input id="ns_name" value="${esc(values.displayName)}" placeholder="顯示名稱" style="width:100%;padding:9px;border:1px solid var(--line);border-radius:8px">
    <div class="sethead">好友</div>
    <div class="row" style="margin-top:2px"><button class="btn grey" id="ns_friends_open">管理好友</button></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="ns_done">完成</button></div>
  `);

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
  document.querySelectorAll(".ns_catpick").forEach((box) => box.onchange = () => {
    if (box.checked) draftPicks.add(box.dataset.cat); else draftPicks.delete(box.dataset.cat);
  });
  document.querySelectorAll(".ns_catcolor").forEach((input) => input.oninput = () => { draftCatColors[input.dataset.cat] = input.value; });
  document.querySelectorAll(".ns_levelcolor").forEach((input) => input.oninput = () => { draftLevelColors[input.dataset.level] = input.value; });

  document.getElementById("ns_friends_open").onclick = () => onOpenFriends();

  document.getElementById("ns_done").onclick = async () => {
    await onSave({
      displayName: document.getElementById("ns_name").value,
      categoryPicks: catalog.categoryPresetNames.filter((name) => name === "其他" || draftPicks.has(name)),
      categoryColors: changedColors(draftCatColors, catColors, catalog.categoryPresetColors, catalog.categoryPresetNames),
      levelColors: changedColors(draftLevelColors, levelColors, catalog.levelDefaults, catalog.levelOrder)
    });
    closeModal();
  };
}
