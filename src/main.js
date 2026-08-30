import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithCustomToken, signOut, onAuthStateChanged, connectAuthEmulator }
  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
         getDoc, getDocs, onSnapshot, query, where, serverTimestamp, runTransaction, writeBatch, connectFirestoreEmulator }
  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { resolveRuntimeConfig } from "./config.js";
import {
  classifyParticipants,
  formatParticipantSummary,
  isUsableUid,
  participantColorIndex,
  resolvePlaceCompatParticipants,
  resolveVisitParticipants
} from "./participants.js";
import {
  formatFriendCode,
  looksLikeFriendCode,
  mergeFriendIdsIntoDirectory,
  normalizeFriendDoc,
  orderMembersForPicker,
  validateFriendInput
} from "./friends.js";
import {
  MAP_SURFACE_Z_INDEX,
  hasFinitePlaceCoordinates,
  isVisitReorderAvailable,
  layoutViewState,
  ordinaryOccurrences,
  resolveVisitMoveTarget,
  shouldShowReorderControls,
  shouldAutoFitViewport,
  shouldFitFilterViewport,
  shouldRenderAdministrativeThematicFill,
  shouldShowAdministrativeLegend,
  shouldShowRegionBlackout,
  transitionMapSurfaceState,
  visitMatchesReorderScope
} from "./ux-policies.js";
import {
  PROXIMITY_RADIUS_MAX,
  PROXIMITY_RADIUS_MIN,
  buildProximityFeatureCollection,
  createMaskIndex,
  formatProximityRadius,
  normalizeProximityRadius,
  parseProximityRadius,
  readProximityPreferences,
  resolveProximityMaskMode,
  selectEligibleProximitySeeds,
  selectRegionMaskCandidates,
  writeProximityPreferences
} from "./proximity-geometry.js";
import { aggregatePlaceVisitAreaMetrics } from "./visit-area-metrics.js";
import {
  VISIT_DATE_RAINBOW,
  deepestLevel,
  lerpHex,
  multiStopColor,
  positiveExtrema,
  quantitativeColor
} from "./map-color-scales.js";
import { createNoSpaceRepository } from "./no-space/repository.js";
import { averageSubmittedRating, participantContributions } from "./no-space/contributions.js";
import { normalizeDayOrder, reorderDayVisitIds } from "./no-space/day-order.js";
import { canDeleteTrip, canDeleteVisit, retainCurrentParticipant } from "./no-space/policies.js";
import { tripReferenceState, visitParticipantsFromTrip } from "./no-space/trips.js";
import { knownParticipantUserIds, projectNoSpaceRuntime } from "./no-space/visits.js";

/* ============================================================
   1) 設定
   ============================================================ */
let runtimeConfig = null, localFailure = false;

function isLocalTest(){ return runtimeConfig?.mode === "local"; }
function localBadge(){ return isLocalTest() ? `<span class="localtest-badge">LOCAL TEST</span>` : ""; }
const LOCAL_TEST_IDENTITIES = Object.freeze({
  a: Object.freeze({ uid:"test-user-a", email:"test-user-a@example.invalid", name:"測試使用者甲" }),
  b: Object.freeze({ uid:"test-user-b", email:"test-user-b@example.invalid", name:"測試使用者乙" })
});
function encodeLocalTestTokenPart(value){
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function createLocalTestCustomToken(identityKey){
  if (!isLocalTest() || runtimeConfig.firebase.projectId !== "demo-mapair-local"){
    throw new Error("Local test identities are unavailable outside LOCAL TEST mode.");
  }
  const identity = LOCAL_TEST_IDENTITIES[identityKey];
  if (!identity) throw new Error("Unknown local test identity.");
  const now = Math.floor(Date.now() / 1000);
  const header = { alg:"none", typ:"JWT" };
  const issuer = "firebase-adminsdk-local@demo-mapair-local.iam.gserviceaccount.com";
  const payload = {
    aud:"https://identitytoolkit.googleapis.com/google.identity.identitytoolkit.v1.IdentityToolkit",
    iss:issuer,
    sub:issuer,
    uid:identity.uid,
    claims:{ email:identity.email, name:identity.name },
    iat:now,
    exp:now + 3600
  };
  return `${encodeLocalTestTokenPart(header)}.${encodeLocalTestTokenPart(payload)}.`;
}
async function signInAsLocalTestIdentity(identityKey){
  const expectedUid = LOCAL_TEST_IDENTITIES[identityKey]?.uid;
  const credential = await signInWithCustomToken(auth, createLocalTestCustomToken(identityKey));
  if (credential.user.uid !== expectedUid){
    await signOut(auth);
    throw new Error(`Auth Emulator returned unexpected UID: ${credential.user.uid}`);
  }
}
function showRuntimeFatal(message, showLocalBadge=false){
  window.__fatal(message);
  if (showLocalBadge || isLocalTest()){
    const panel = document.querySelector("#app > div");
    if (panel) panel.insertAdjacentHTML("afterbegin", `<div style="margin-bottom:12px"><span class="localtest-badge">LOCAL TEST</span></div>`);
  }
}
function failLocal(area, error){
  if (!isLocalTest()) return;
  localFailure = true;
  showRuntimeFatal(`LOCAL TEST ${area} failed. No production fallback was attempted.\n${error?.message || error}`, true);
}
function handleFirestoreError(area, error){
  if (isLocalTest()) failLocal(`Firestore ${area}`, error);
  else console.error(`Firestore ${area} listener failed:`, error);
}

let spaceCats = [];

/* 造訪深度:由淺到深(index 越大越深),染色時每個行政區取「最深」 */
const LEVEL_ORDER  = ["經過","接地","旅遊","住宿","居住"];
const LEVEL_COLORS = { "居住":"#7b2d3a","住宿":"#b25b6b","旅遊":"#d98b3f","接地":"#6f9c94","經過":"#c3d0cb" };

/* 旅程圖示可選清單 */
const EMOJIS = ["🧭","✈️","🚗","🚕","🚌","🚆","🚄","🚢","⛵","🚲","🏍️","🛵",
  "🏔️","⛰️","🌋","🏕️","🏖️","🏝️","🏜️","🏞️","🌅","🌄","🌊","🗻","🗾",
  "⛩️","🏯","🏰","🗼","🎡","🎢","🎑","🌸","🍁","🌺","🌴","🌲",
  "🍜","🍣","🍶","🍵","☕","🍺","🍷","🍦","🍧","🧋","🍡","🍢",
  "🎏","🎿","🏂","🏄","🚠","♨️","🦌","🐧","🐟","🦭","🐢","🦋",
  "📷","🎒","🗺️","💕","❤️","🌈","⭐","🎉","🏡","🌇"];

/* 「做什麼」系統預設選項(name -> 預設顏色)。使用者可在設定勾選常用項目與改色。
   「其他」永遠可選(不可取消),選「其他」時會出現自訂敘述框。 */
const CATEGORY_PRESETS = [
  ["餐飲","#d98b3f"],["咖啡","#a9724a"],["購物","#b25b6b"],["娛樂","#8f6bb2"],
  ["文化","#6b6bb2"],["景點","#3f7d78"],["自然","#4f9d5f"],["戶外","#7a9c3f"],
  ["住宿","#b2506b"],["交通","#5f7fb2"],["教育","#3f6bb2"],["醫療","#c2513f"],
  ["宗教","#b2953f"],["運動","#5fa38a"],["工作","#6b8296"],["社交","#c2603f"],
  ["生活","#7a7a7a"],["住家","#5f8a6b"],["慶祝","#b23f7a"],["其他","#9aa5ad"]
];
const CATEGORY_PRESET_NAMES = CATEGORY_PRESETS.map(([name])=>name);
const CATEGORY_PRESET_COLORS = Object.fromEntries(CATEGORY_PRESETS);
const CATEGORY_DEFAULT_PICKS = ["餐飲","咖啡","購物","娛樂","景點","自然","交通","其他"];
// 沒有選擇「做什麼」時,標記/範圍的預設顏色。
const CATEGORY_NONE_COLOR = "#9aa5ad";

function renderSetup(){
  document.getElementById("app").innerHTML = `
    <div class="center"><div class="setup">
      <h1>設定尚未完成</h1>
      <p>啟動 Mapair 前，請先設定 Firebase 與 Google Maps 憑證。</p>
    </div></div>`;
}

/* ============================================================
   2) State
   ============================================================ */
let db, auth, user;
let participantMembers = [];
let runtimeSession = {};
let searchReqSeq = 0;
let noSpaceRepository = null;
const noSpaceState = {
  visits:{}, places:{}, trips:{}, contributions:{}, dayOrders:{}, profiles:{}, legacyImports:{}, defaults:{},
  friends:{}, incomingRequests:{}, outgoingRequests:{},
  placeUnsubs:new Map(), legacyImportUnsubs:new Map(), contributionUnsubs:new Map(), profileUnsubs:new Map()
};
let map, geocoder, AdvMarker, Pin, AutocompleteSuggestion, AutocompleteSessionToken, PlaceClass;
let markers = [], sessionToken = null;
let selfMarker = null;                       // "你的位置" dot from the locate button
let focusedPlaceId = null, focusedPlaceTimer = null; // highlighted marker after a list tap
let places = {}, trips = {}, tab = "visited";
let adminLevel = "off", adminLayer = null, adminContextLayer = null, geoCache = {};
let showPins = true, choroAlpha = 0.7, choroMetric = "level", numberPins = false;
let catColors = {}, markerMode = "cat", lastMarkerClick = 0;
let levelColors = { ...LEVEL_COLORS }, addMode = false;
// Per-user "做什麼" preferences: which presets appear in the picker, plus colour overrides.
let categoryPicks = [...CATEGORY_DEFAULT_PICKS];
let adminLayerLevel = null, adminContextLevel = null, adminRenderVersion = 0, legendCollapsed = false;
let proximityStorage = null;
try { proximityStorage = globalThis.localStorage; } catch(e) {}
const initialProximityPreferences = readProximityPreferences(proximityStorage);
let proximityRadius = initialProximityPreferences.radius;
let proximityMaskTaiwan = initialProximityPreferences.maskToTaiwan;
let proximityEnabled = false;
let proximityLayer = null, proximityLayerKey = "", proximityMaskIndex = null, proximityRenderVersion = 0;
let selectedRegionMaskCache = { identity:"", maskIndex:null };
let proximitySeedCount = 0, proximityRadiusTimer = null;
const proximityGeometryCache = new Map();
const CAT_PALETTE = ["#d98b3f","#3f7d78","#b25b6b","#6b8fb2","#8f6bb2","#b2a03f","#5fa38a","#c2603f","#4f9d5f","#b23f7a","#3f6bb2","#7a7a7a"];
const MAP_AREA_METRIC_OPTIONS = [["level","造訪深度"],["count","地標數"],["visitCount","造訪次數"],["first","最早造訪日期"],["last","最後造訪日期"],["categoryMode","造訪目的（眾數）"]];
function catColor(c){ return catColors[c] || CAT_PALETTE[Math.max(0, spaceCats.indexOf(c)) % CAT_PALETTE.length]; }
function textOn(hex){
  const h=(hex||"#888").replace("#",""); if(h.length<6) return "#152230";
  const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return (0.299*r+0.587*g+0.114*b) > 150 ? "#152230" : "#ffffff";
}
let members = {};
const runtimeUnsubscribes = new Map();
function memberById(uid){ return participantMembers.find(member => member.userId === uid) || null; }
// Members offered in the companion pickers: valid, active, and selectable
// (self or a linked friend). Historical / former-friend members are excluded
// here but still resolve for display via memberById / participantName.
function activeParticipantMembers(){ return participantMembers.filter(member => member.valid === true && member.status === "active" && member.selectable !== false); }
// Friend address book (users/{me}/friends). A friend only makes a person
// selectable; `pending_out` entries (Batch 3) are held out of the pickers.
function friendEntries(){ return Object.values(noSpaceState.friends || {}); }
function friendEntryOf(uid){ return (noSpaceState.friends || {})[uid] || null; }
function friendUserIds(){ return friendEntries().filter(f => f.state === "linked").map(f => f.friendUid); }
function friendPinnedUids(){ return friendEntries().filter(f => f.pinned && f.state === "linked").map(f => f.friendUid); }
let filter = { who:"all", tripId:"all", cats:new Set(), from:"", to:"", regions:[], placeId:"" };
let regionMulti = false;
let layoutState = { map:false, filter:false, list:false };   // false=顯示，true=收合
let layoutDismissController = null;
let dateScope = "month";   // month / lastmonth / pickedMonth / today / custom / all
let pickedMonth = new Date().toISOString().slice(0,7);
let regionLegendState = null;

function monthBounds(ym){
  if (!/^\d{4}-\d{2}$/.test(ym||"")) return null;
  const [y,m]=ym.split("-").map(Number), pad=n=>String(n).padStart(2,"0");
  const last=new Date(y,m,0).getDate();
  return { from:`${y}-${pad(m)}-01`, to:`${y}-${pad(m)}-${pad(last)}` };
}
function currentMonth(offset=0){
  const d=new Date(); d.setDate(1); d.setMonth(d.getMonth()+offset);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}`;
}
function applyDateScope(){
  const now = new Date(), y = now.getFullYear(), m = now.getMonth(), pad = n => String(n).padStart(2,"0");
  const today = `${y}-${pad(m+1)}-${pad(now.getDate())}`;
  if (dateScope === "today"){ filter.from = today; filter.to = today; }
  else if (dateScope === "month"){
    pickedMonth=currentMonth(0); const b=monthBounds(pickedMonth); filter.from=b.from; filter.to=b.to;
  }
  else if (dateScope === "lastmonth"){
    pickedMonth=currentMonth(-1); const b=monthBounds(pickedMonth); filter.from=b.from; filter.to=b.to;
  }
  else if (dateScope === "pickedMonth"){
    const b=monthBounds(pickedMonth); if(b){ filter.from=b.from; filter.to=b.to; }
  }
  else if (dateScope === "all"){ filter.from = ""; filter.to = ""; }
  // custom: 由使用者的起訖輸入決定
}
function defaultDateForNewVisit(){
  // 明確旅程優先於任何月份篩選。
  if (filter.tripId!=="all" && filter.tripId!=="daily" && trips[filter.tripId]?.startDate) return trips[filter.tripId].startDate;
  if (singleDayDate()) return singleDayDate();
  const today=new Date().toISOString().slice(0,10);
  if (dateScope === "month") return today; // 本月新增預設今天
  if (["lastmonth","pickedMonth"].includes(dateScope) && filter.from) return filter.from;
  return today;
}
const CODEKEY = { county:"countyCode", town:"townCode", village:"villCode" };
const REGION_GEO = {
  countyCode:{ url:"geo/county.json", codeProperty:"COUNTYCODE" },
  townCode:{ url:"geo/town.json", codeProperty:"TOWNCODE" }
};
// Participant compatibility remains available for projected legacy records.
function legacyParticipantContext(){
  return { legacyMemberIds: Object.keys(members || {}) };
}
function activeMemberIds(){ return activeParticipantMembers().map(m => m.userId); }
// Active Members ordered for display: the authenticated User first, then the
// rest by display name (Phase 2 §9).
function orderedActiveMembers(){
  return orderMembersForPicker(activeParticipantMembers(), {
    selfUid:user?.uid || "",
    pinnedUids:friendPinnedUids()
  });
}
function orderedActiveMemberIds(){ return orderedActiveMembers().map(m => m.userId); }
// Human name for a participant UID. Never exposes a raw UID.
//  - authenticated User      -> "真實名稱（我）" (or "我" when no name is known)
//  - active Member           -> display name
//  - known removed Member    -> "真實名稱（已離開）"
//  - unknown historical UID  -> "未知成員"
//  A private friend nickname, when set, wins over the profile name for
//  everyone except the authenticated User.
function participantName(uid){
  const member = memberById(uid);
  const isSelf = !!uid && !!user && uid === user.uid;
  if (!isSelf){
    const friend = friendEntryOf(uid);
    if (friend && friend.nickname) return friend.nickname;
  }
  let name = "";
  if (member && member.displayName && member.displayName !== "Member") name = member.displayName;
  else if (isSelf) name = members[uid] || "";
  if (!name){
    if (isSelf) return "我";
    return member ? "同行者" : "未知同行者";
  }
  if (isSelf) return `${name}（我）`;
  if (member && member.status === "removed") return `${name}（已離開）`;
  return name;
}
function participantSummaryText(ids){
  return formatParticipantSummary(ids, participantName, { empty:"未記錄" });
}
// 舊資料的「誰去」保留在地點層級作相容摘要；新資料以每次 visit.participantIds 為準
function whoUids(p){ return resolvePlaceCompatParticipants(p, legacyParticipantContext()); }
// Historical (removed / unknown) participant UIDs referenced by currently
// loaded Place / Visit data. Recomputed on data or Membership change so the
// filter and legend can resolve them without listing every removed Membership.
let referencedHistoricalIds = [];
function recomputeReferencedParticipants(){
  const activeSet = new Set(activeMemberIds());
  const seen = new Set();
  const add = uid => { if (isUsableUid(uid) && !activeSet.has(uid)) seen.add(uid); };
  for (const place of Object.values(places)){
    if (!hasVisitHistory(place)) continue;
    whoUids(place).forEach(add);
    placeVisits(place).forEach(v => visitWhoUids(place, v).forEach(add));
  }
  referencedHistoricalIds = [...seen];
}
// Valid participant-filter values: active Members + historical participants
// still referenced by loaded data (Phase 2 §3, §8).
function participantFilterCandidateIds(){
  return [...orderedActiveMemberIds(), ...referencedHistoricalIds];
}
function sanitizeParticipantFilter(){
  if (filter.who !== "all" && !participantFilterCandidateIds().includes(filter.who)){
    filter.who = "all";
  }
}
function normalizedVisit(p,v,i=0){
  const fallbackCat=(p.categories||[])[0]||"";
  const kind=v?.kind || ((v?.endDate && v.endDate>v.date) ? "stay" : "visit");
  const out={
    id:v?.id || `legacy_${i}`,
    kind,
    date:v?.date||"",
    endDate:v?.endDate||"",
    tripId:v?.tripId||"",
    category:v?.category || (v?.categories||[])[0] || fallbackCat,
    ...(Number.isFinite(Number(v?.order)) ? {order:Number(v.order)} : {})
  };
  // Preserve the raw participant representation exactly; never synthesize or
  // collapse it during normalization (APPROVED PHASE 2 CONTRACT §1, §8).
  if (v && Object.hasOwn(v, "participantIds")) out.participantIds = Array.isArray(v.participantIds) ? [...v.participantIds] : v.participantIds;
  if (v && Object.hasOwn(v, "who")) out.who = Array.isArray(v.who) ? [...v.who] : v.who;
  // Carry the No-Space projection's runtime fields through unchanged so the
  // shared visit doc, contributions, depth, and creator stay reachable from a
  // normalized occurrence (edit / delete / per-visit colour all need them).
  if (v && v.level) out.level = v.level;
  if (v && v.createdBy) out.createdBy = v.createdBy;
  if (v && v._shared) out._shared = v._shared;
  if (v && v._contributions) out._contributions = v._contributions;
  if (v && Object.hasOwn(v, "_averageRating")) out._averageRating = v._averageRating;
  return out;
}
// 一個 place 是共享地點；visits 是獨立造訪事件。舊資料會即時以相容格式讀取。
function placeVisits(p){
  if (p.visits && p.visits.length) return p.visits.map((v,i)=>normalizedVisit(p,v,i));
  if (p.visitedOn) return [normalizedVisit(p,{ date:p.visitedOn, tripId:p.tripId||"", category:(p.categories||[])[0]||"" },0)];
  return [];
}
// A Place exists in the active product ONLY because it has actual Visit
// history — modern embedded `visits`, or a legacy `visitedOn` date. The old
// `status` field (incl. dormant `status:"wishlist"` documents with no Visits) is
// never consulted for this. Such dormant records are ignored everywhere in the
// normal product; a separately approved migration may clean them up later.
function hasVisitHistory(p){
  return !!p && ((Array.isArray(p.visits) && p.visits.length > 0) || !!p.visitedOn);
}
function visitCategory(p,v){ return v?.category || (p.categories||[])[0] || ""; }
function visitWhoUids(p,v){ return resolveVisitParticipants(v, p, legacyParticipantContext()).participantIds; }
function visitWhoText(p,v){ return participantSummaryText(visitWhoUids(p,v)); }
function visitKind(v){ return v?.kind === "stay" ? "stay" : "visit"; }
function stayCheckout(v){ return (visitKind(v)==="stay" && v.endDate && v.endDate>v.date) ? v.endDate : ""; }
function stayNights(v){
  if (!v?.date || !stayCheckout(v)) return 1;
  return Math.max(1, Math.round((new Date(stayCheckout(v)+"T00:00:00")-new Date(v.date+"T00:00:00"))/86400000));
}
function visitIntersects(v,from,to){
  if (!v?.date) return false;
  if (visitKind(v)!=="stay"){
    if (from && v.date<from) return false;
    if (to && v.date>to) return false;
    return true;
  }
  const co=stayCheckout(v)||v.date;
  if (from && co<from) return false;
  if (to && v.date>to) return false;
  return true;
}
const placeTrips = p => [...new Set(placeVisits(p).map(v=>v.tripId).filter(Boolean))];
const singleDayDate = () => (filter.from && filter.to && filter.from === filter.to) ? filter.from : "";
function specificTripId(){ return (filter.tripId!=="all" && filter.tripId!=="daily" && trips[filter.tripId]) ? filter.tripId : ""; }
function visitMatchesTrip(v){
  if (filter.tripId === "all") return true;
  if (filter.tripId === "daily") return !v.tripId;
  return v.tripId === filter.tripId;
}
function visitMatchesCategory(p,v){
  return !filter.cats.size || filter.cats.has(visitCategory(p,v));
}
function visitMatchesWho(p,v){
  return filter.who === "all" || visitWhoUids(p,v).includes(filter.who);
}
function placeStaticFilter(p){
  const f=filter;
  if (f.regions.length && !f.regions.some(r => p[r.key] === r.code)) return false;
  return true;
}
function visitPassFilter(p,v){
  return placeStaticFilter(p) && visitMatchesWho(p,v) && visitMatchesTrip(v) && visitMatchesCategory(p,v) && visitIntersects(v,filter.from,filter.to);
}
function passFilter(p){
  // Only Places with real Visit history exist in the active product; dormant
  // legacy wishlist-only records are invisible everywhere.
  if (!hasVisitHistory(p)) return false;
  if (!placeStaticFilter(p)) return false;
  const vv=placeVisits(p);
  const hasVisitConstraint=filter.who!=="all" || filter.tripId!=="all" || !!filter.from || !!filter.to || !!filter.cats.size;
  return !hasVisitConstraint || vv.some(v=>visitPassFilter(p,v));
}
function occurrenceDate(o){ return o?.seqDate || o?.v?.date || ""; }
function occurrenceKey(o){ return `${o?.p?.id||""}:${o?.visitIndex??""}:${occurrenceDate(o)}:${o?.stayAnchor||""}`; }
function stayAnchorRank(o){ return o?.stayAnchor==="morning" ? 0 : o?.stayAnchor==="night" ? 2 : 1; }
function sortOccurrences(a,b){
  const ad=occurrenceDate(a), bd=occurrenceDate(b);
  if(ad!==bd) return ad.localeCompare(bd);
  const ar=stayAnchorRank(a), br=stayAnchorRank(b); if(ar!==br) return ar-br;
  const ao=Number.isFinite(Number(a.v.order)) ? Number(a.v.order) : 1e9;
  const bo=Number.isFinite(Number(b.v.order)) ? Number(b.v.order) : 1e9;
  if(ao!==bo) return ao-bo;
  const eo=effOrd(a.p)-effOrd(b.p); if(eo) return eo;
  return a.visitIndex-b.visitIndex;
}
function getDayOccurrences(date){
  if(!date) return [];
  const out=[];
  Object.values(places).forEach(p=>{
    if(!hasVisitHistory(p) || !placeStaticFilter(p)) return;
    placeVisits(p).forEach((v,visitIndex)=>{
      if(!visitMatchesWho(p,v) || !visitMatchesTrip(v) || !visitMatchesCategory(p,v)) return;
      if(visitKind(v)!=="stay"){
        if(v.date===date) out.push({p,v,visitIndex,seqDate:date,stayAnchor:"",fixed:false});
        return;
      }
      const co=stayCheckout(v);
      if(!co){
        if(v.date===date) out.push({p,v,visitIndex,seqDate:date,stayAnchor:"night",fixed:true});
        return;
      }
      // 每一晚：飯店是當天最後一站；隔天早上：同一飯店是第一站。
      if(date>v.date && date<=co) out.push({p,v,visitIndex,seqDate:date,stayAnchor:"morning",fixed:true});
      if(date>=v.date && date<co) out.push({p,v,visitIndex,seqDate:date,stayAnchor:"night",fixed:true});
    });
  });
  return out.sort(sortOccurrences);
}
function getFilteredVisitOccurrences(){
  const out=[];
  Object.values(places).forEach(p=>{
    if(!hasVisitHistory(p) || !placeStaticFilter(p)) return;
    if(filter.placeId && p.id!==filter.placeId) return;  // tapping a marker narrows the list to that Place
    placeVisits(p).forEach((v,visitIndex)=>{ if(visitPassFilter(p,v)) out.push({p,v,visitIndex,seqDate:v.date,stayAnchor:"",fixed:false}); });
  });
  return out.sort(sortOccurrences);
}
function enumerateDates(from,to){
  if(!from||!to||from>to) return [];
  const out=[]; let d=from, guard=0;
  while(d<=to && guard++<3700){ out.push(d); d=addDays(d,1); }
  return out;
}
function tripSequenceBounds(tripId){
  const t=trips[tripId]||{};
  const related=[];
  Object.values(places).forEach(p=>placeVisits(p).forEach(v=>{
    if(v.tripId!==tripId || !v.date) return;
    related.push(v.date); if(visitKind(v)==="stay" && stayCheckout(v)) related.push(stayCheckout(v));
  }));
  related.sort();
  let from=t.startDate||related[0]||"", to=t.endDate||related[related.length-1]||from;
  if(filter.from && (!from || filter.from>from)) from=filter.from;
  if(filter.to && (!to || filter.to<to)) to=filter.to;
  return {from,to};
}
function tripDayNoByDate(date,tripId,all=[]){
  const t=trips[tripId];
  let start=t?.startDate||"";
  if(!start){ const ds=all.map(occurrenceDate).filter(Boolean).sort(); start=ds[0]||date; }
  if(!start||!date) return 1;
  return Math.max(1,Math.round((new Date(date+"T00:00:00")-new Date(start+"T00:00:00"))/86400000)+1);
}
function sequenceContext(){
  const tid=specificTripId();
  if(tid) return {type:"trip",tripId:tid};
  const d=singleDayDate();
  if(d) return {type:"day",date:d};
  return null;
}
function sequenceOccurrences(){
  const ctx=sequenceContext(); if(!ctx) return [];
  if(ctx.type==="day") return getDayOccurrences(ctx.date);
  const b=tripSequenceBounds(ctx.tripId);
  return enumerateDates(b.from,b.to).flatMap(d=>getDayOccurrences(d)).filter(o=>o.v.tripId===ctx.tripId).sort(sortOccurrences);
}
function sequenceLabels(){
  const ctx=sequenceContext(), occ=sequenceOccurrences();
  if(!ctx) return [];
  if(ctx.type==="day") return occ.map((o,i)=>({o,label:String(i+1)}));
  const byDay={};
  return occ.map(o=>{
    const key=occurrenceDate(o), d=tripDayNoByDate(key,ctx.tripId,occ);
    byDay[key]=(byDay[key]||0)+1;
    return {o,label:`D${d}-${byDay[key]}`};
  });
}

function visitReorderScope(){
  const tripId=specificTripId();
  const available=isVisitReorderAvailable({
    categoryCount:filter.cats.size,
    regionCount:filter.regions.length,
    textSearch:"",
    tripId:filter.tripId,
    hasSpecificTrip:!!tripId
  });
  if(!available) return null;
  return {
    tripId,
    participantId:filter.who==="all"?"":filter.who
  };
}

function fullDayOrdinaryOccurrences(date){
  const out=[];
  Object.values(places).forEach(p=>{
    if(!hasVisitHistory(p)) return;
    placeVisits(p).forEach((v,visitIndex)=>{
      if(visitKind(v)==="visit" && v.date===date) out.push({p,v,visitIndex,seqDate:date,stayAnchor:"",fixed:false});
    });
  });
  return ordinaryOccurrences(out.sort(sortOccurrences));
}

function reorderableDayOccurrences(date,scope=visitReorderScope()){
  if(!scope) return [];
  const full=fullDayOrdinaryOccurrences(date);
  return full.filter(o=>visitMatchesReorderScope({
    tripId:o.v.tripId,
    participants:visitWhoUids(o.p,o.v)
  },scope));
}

function boot(){
  document.getElementById("app").innerHTML =
    `<div class="center"><div class="gate">${localBadge()}<p style="color:var(--ink-soft)">連線中…</p></div></div>`;
  try {
    const app = initializeApp(runtimeConfig.firebase);
    auth = getAuth(app);
    db = getFirestore(app);
    if (isLocalTest()){
      try {
        connectAuthEmulator(auth, runtimeConfig.emulators.auth.url, { disableWarnings:true });
        connectFirestoreEmulator(db, runtimeConfig.emulators.firestore.host, runtimeConfig.emulators.firestore.port);
      } catch(e){ failLocal("emulator connection setup", e); return; }
    }
    onAuthStateChanged(auth, u => {
      runtimeSession = {};
      searchReqSeq++;
      clearTimeout(searchTimer);
      closeAllModals();
      cancelAddMode();
      clearSearchSuggestions();
      unsubscribeRuntimeListeners();
      resetRuntimeState();
      user = u;
      u ? renderApp() : renderGate();
    },
      err => isLocalTest() ? failLocal("Auth", err) : window.__fatal("Firebase Auth 錯誤:" + err.message));
  } catch(e){ isLocalTest() ? failLocal("Firebase initialization", e) : window.__fatal("Firebase 初始化失敗:" + e.message); }
}

function renderGate(){
  document.getElementById("app").innerHTML = `
  <div class="center"><div class="gate">
    ${localBadge()}
    <h1>我們去過的地方</h1>
    <p>一起記錄去過哪、在那邊做了什麼、彼此的感想,<br>再規劃下一趟。</p>
    <button class="btn" id="login" style="margin-top:16px;padding:12px 22px">用 Google 登入</button>
  </div></div>`;
  if (isLocalTest()){
    const providerLogin = document.getElementById("login");
    providerLogin.textContent = "Google 登入（模擬器）";
    providerLogin.classList.add("ghost");
    providerLogin.insertAdjacentHTML("beforebegin", `
      <div style="display:grid;gap:10px;margin-top:16px">
        <button class="btn" id="login-test-a" style="padding:12px 22px">測試使用者甲</button>
        <button class="btn" id="login-test-b" style="padding:12px 22px">測試使用者乙</button>
      </div>`);
    document.getElementById("login-test-a").onclick = () =>
      signInAsLocalTestIdentity("a").catch(e=>failLocal("test-user-a sign-in", e));
    document.getElementById("login-test-b").onclick = () =>
      signInAsLocalTestIdentity("b").catch(e=>failLocal("test-user-b sign-in", e));
  }
  document.getElementById("login").onclick = () =>
    signInWithPopup(auth, new GoogleAuthProvider()).catch(e=>isLocalTest() ? failLocal("Auth sign-in", e) : alert(e.message));
}

/* ============================================================
   3) 主畫面
   ============================================================ */
async function renderApp(){
  adminRenderVersion++;
  proximityRenderVersion++;
  removeAdministrativeLayer();
  removeProximityLayer();
  document.getElementById("app").innerHTML = `
    <header>
      <span class="title">我的足跡</span>
      ${localBadge()}
      <span class="spacer"></span>
      <span class="who">${user.displayName||user.email}</span>
      <button class="btn ghost mini" id="logout">登出</button>
    </header>
    <div class="wrap">
      <div class="mapcol">
        <div id="map"></div>
        <div id="maptop">
          <div id="mapctl">
            <button data-l="off" class="on">地標</button>
            <button data-l="county">縣市</button>
            <button data-l="town">鄉鎮</button>
            <button data-l="village">村里</button>
            <button data-l="proximity">鄰近</button>
          </div>
          <button id="addBtn" title="新增地點模式">＋</button>
          <button id="locBtn" title="定位到我的位置">📍</button>
          <button id="friendsBtn" title="好友">👥</button>
          <button id="setBtn">設定</button>
        </div>
        <button id="multiBtn" title="複選行政區" style="display:none">複選</button>
        <div id="proximityCtl" style="display:none">
          <label for="proximityRadius">半徑</label>
          <input id="proximityRadius" type="number" min="${PROXIMITY_RADIUS_MIN}" max="${PROXIMITY_RADIUS_MAX}" step="any" inputmode="decimal" value="${formatProximityRadius(proximityRadius)}" aria-label="鄰近涵蓋半徑（公里）">
          <span>km</span>
          <label class="proximity-mask" id="proximityMaskLabel"><input id="proximityMask" type="checkbox" ${proximityMaskTaiwan?'checked':''}> 僅限台灣陸地</label>
          <span class="proximity-region-status" id="proximityRegionStatus" style="display:none"></span>
        </div>
        <div id="maplegend" style="display:none"></div>
      </div>
      <div class="side">
        <div class="layoutctl" id="layoutCtl">
          <button class="layoutfab" id="layoutBtn" title="調整畫面空間" aria-controls="layoutMenu" aria-expanded="false">版面</button>
          <div class="layoutmenu" id="layoutMenu">
            <button id="toggleMap">地圖：顯示</button>
            <button id="toggleFilter">篩選：顯示</button>
            <button id="toggleList">清單：顯示</button>
          </div>
        </div>
        <div class="tabs">
          <button class="tab" data-t="visited">去過</button>
          <button class="tab" data-t="trips">行程</button>
        </div>
        <div id="filterbar">
          <div class="filter-heading">回看我的足跡 <span>日期 · 旅程 · 同行者 · 分類 · 地區</span></div>
          <div class="frow">
            <select id="fl_scope" class="fmini" aria-label="日期"></select>
            <select id="fl_trip" class="fmini" aria-label="旅程"></select>
            <select id="fl_who" class="fmini" aria-label="同行者"></select>
            <button id="fl_more" class="btn grey mini">更多 ▾</button>
          </div>
          <div class="filtermeta"><span id="filterChips"></span><button id="fl_clear" class="btn grey mini" style="display:none">取消篩選</button></div>
          <div class="monthquick" id="monthQuick"><input type="month" id="fl_month" aria-label="選擇月份"><span style="font-size:11px;color:var(--ink-soft)">整月</span></div>
          <div id="filterPanel" style="display:none">
            <div class="ff"><label>日期範圍</label>
              <div class="ffgrid"><input type="date" id="fl_from"><input type="date" id="fl_to"></div>
            </div>
            <div class="ff"><label>分類</label><div class="pick" id="fl_cats"></div></div>
          </div>
        </div>
        <div class="search" id="searchWrap">
          <input id="search" placeholder="搜尋地點加入…(例:台北101、直島)" autocomplete="off"/>
          <div class="results" id="results" style="display:none"></div>
        </div>
        <div class="list" id="list"></div>
      </div>
    </div>`;

  document.getElementById("logout").onclick = () => signOut(auth);
  document.querySelectorAll(".tab").forEach(b => b.onclick = () => { tab = b.dataset.t; renderList(); });

  // 版面收合不佔固定高度：地圖 / 篩選 / 清單可各自開關
  const wrapEl = document.querySelector(".wrap");
  const layoutCtl = document.getElementById("layoutCtl");
  const layoutMenu = document.getElementById("layoutMenu");
  const layoutBtn = document.getElementById("layoutBtn");
  const resizeVisibleMap = () => {
    if(map&&!layoutState.map) setTimeout(()=>google.maps.event.trigger(map,"resize"),50);
  };
  const applyLayoutState = () => {
    const view=layoutViewState(layoutState,layoutMenu.classList.contains("open"));
    wrapEl.classList.toggle("map-hidden",view.mapHidden);
    wrapEl.classList.toggle("filter-hidden",view.filterHidden);
    wrapEl.classList.toggle("list-hidden",view.listHidden);
    wrapEl.classList.toggle("content-hidden",view.contentHidden);
    wrapEl.classList.toggle("layout-menu-open",view.menuOpen);
    wrapEl.classList.toggle("layout-compact",view.compactSidebar);
    [["toggleMap","map","地圖"],["toggleFilter","filter","篩選"],["toggleList","list","清單"]].forEach(([id,key,label])=>{
      const b=document.getElementById(id); if(!b) return;
      b.textContent = (layoutState[key] ? "○ " : "✓ ") + label;
      b.classList.toggle("off", layoutState[key]);
    });
    resizeVisibleMap();
  };
  const setLayoutMenuOpen = open => {
    layoutMenu.classList.toggle("open",open);
    layoutBtn.setAttribute("aria-expanded",String(open));
    applyLayoutState();
  };
  layoutBtn.onclick = e => {
    e.stopPropagation();
    setLayoutMenuOpen(!layoutMenu.classList.contains("open"));
  };
  document.getElementById("toggleMap").onclick = () => { layoutState.map=!layoutState.map; applyLayoutState(); };
  document.getElementById("toggleFilter").onclick = () => { layoutState.filter=!layoutState.filter; applyLayoutState(); };
  document.getElementById("toggleList").onclick = () => { layoutState.list=!layoutState.list; applyLayoutState(); };
  layoutDismissController?.abort();
  layoutDismissController=new AbortController();
  document.addEventListener("click",e=>{
    if(layoutMenu.classList.contains("open")&&!layoutCtl.contains(e.target)) setLayoutMenuOpen(false);
  },{signal:layoutDismissController.signal});
  document.addEventListener("keydown",e=>{
    if(e.key==="Escape"&&layoutMenu.classList.contains("open")){
      setLayoutMenuOpen(false); layoutBtn.focus();
    }
  },{signal:layoutDismissController.signal});
  applyLayoutState();

  try { await initMap(); } catch(e){ alert("Google Maps 載入失敗,請檢查 API key / 已啟用的 API:\n"+e.message); }
  wireSearch();
  subscribeNoSpace();
  document.querySelectorAll("#mapctl button").forEach(b => b.onclick = () => {
    toggleMapSurface(b.dataset.l);
    renderMarkers();
  });
  document.getElementById("addBtn").onclick = e => {
    if (!runtimeReady()) return;
    addMode = !addMode;
    e.target.classList.toggle("on", addMode);
    document.getElementById("map").style.cursor = addMode ? "crosshair" : "";
  };
  document.getElementById("locBtn").onclick = () => {
    if (!navigator.geolocation) return alert("此裝置不支援定位");
    navigator.geolocation.getCurrentPosition(
      pos => {
        const at = { lat:pos.coords.latitude, lng:pos.coords.longitude };
        map.setCenter(at); map.setZoom(16);
        showSelfMarker(at);
      },
      err => alert("定位失敗:" + err.message),
      { enableHighAccuracy:true, timeout:8000 }
    );
  };
  document.getElementById("setBtn").onclick = openSettings;
  document.getElementById("friendsBtn").onclick = openFriendsManager;
  document.getElementById("multiBtn").onclick = e => {
    regionMulti = !regionMulti;
    e.target.classList.toggle("on", regionMulti);
  };
  const proximityRadiusInput = document.getElementById("proximityRadius");
  const saveProximityPreferences = () => writeProximityPreferences(proximityStorage, {
    radius:proximityRadius,
    maskToTaiwan:proximityMaskTaiwan
  });
  const applyProximityRadius = next => {
    if (next === proximityRadius) return;
    proximityRadius = next;
    saveProximityPreferences();
    if (proximityEnabled) refreshProximityLayer();
  };
  const finalizeProximityRadius = () => {
    clearTimeout(proximityRadiusTimer);
    const parsed = parseProximityRadius(proximityRadiusInput.value);
    const next = parsed == null ? proximityRadius : normalizeProximityRadius(parsed, proximityRadius);
    proximityRadiusInput.value = formatProximityRadius(next);
    applyProximityRadius(next);
  };
  proximityRadiusInput.oninput = () => {
    clearTimeout(proximityRadiusTimer);
    const parsed = parseProximityRadius(proximityRadiusInput.value);
    if (parsed == null || parsed < PROXIMITY_RADIUS_MIN || parsed > PROXIMITY_RADIUS_MAX) return;
    proximityRadiusTimer = setTimeout(()=>applyProximityRadius(parsed), 280);
  };
  proximityRadiusInput.onchange = finalizeProximityRadius;
  proximityRadiusInput.onblur = finalizeProximityRadius;
  proximityRadiusInput.onkeydown = e => {
    if(e.key!=="Enter") return;
    finalizeProximityRadius();
    proximityRadiusInput.blur();
  };
  document.getElementById("proximityMask").onchange = e => {
    proximityMaskTaiwan = e.target.checked;
    saveProximityPreferences();
    if (proximityEnabled) refreshProximityLayer();
  };

  document.getElementById("fl_more").onclick = e => {
    const p = document.getElementById("filterPanel");
    const opening = p.style.display === "none";
    p.style.display = opening ? "block" : "none";
    e.currentTarget.textContent = opening ? "更多 ▴" : "更多 ▾";
  };
  document.getElementById("fl_scope").onchange = e => {
    dateScope = e.target.value;
    if (dateScope === "pickedMonth" && !pickedMonth) pickedMonth=currentMonth(0);
    applyDateScope();
    if (dateScope === "custom"){ document.getElementById("filterPanel").style.display = "block"; document.getElementById("fl_more").textContent="更多 ▴"; }
    refreshFilterUI(); applyFilter();
    if (dateScope === "pickedMonth"){
      const mi=document.getElementById("fl_month");
      setTimeout(()=>{ try{ mi.showPicker?.(); }catch(e){} mi.focus(); },0);
    }
  };
  document.getElementById("fl_month").onchange = e => {
    if(!e.target.value) return;
    pickedMonth=e.target.value; dateScope="pickedMonth"; applyDateScope(); refreshFilterUI(); applyFilter();
  };
  document.getElementById("fl_trip").onchange = e => { filter.tripId = e.target.value; applyFilter(); };
  document.getElementById("fl_who").onchange  = e => { filter.who = e.target.value; applyFilter(); };
  document.getElementById("fl_from").onchange = e => { filter.from = e.target.value; dateScope="custom"; refreshFilterUI(); applyFilter(); };
  document.getElementById("fl_to").onchange   = e => { filter.to = e.target.value; dateScope="custom"; refreshFilterUI(); applyFilter(); };
  document.getElementById("fl_clear").onclick = () => {
    filter = { who:"all", tripId:"all", cats:new Set(), from:"", to:"", regions:[], placeId:"" };
    dateScope = "all";
    document.getElementById("filterPanel").style.display = "none";
    document.getElementById("fl_more").textContent="更多 ▾";
    refreshFilterUI(); applyFilter();
  };
  applyDateScope();
  refreshFilterUI();
}

/* ---------- 設定頁(整合顯示/顏色/綽號) ---------- */
function openSettings(){
  if (!runtimeReady()) return;
  openNoSpaceSettings();
}

/* ---------- Filters ---------- */
let filterFitTimer=null;
function fitMapToCurrentFilter(){
  if(!map || layoutState.map || tab==="trips") return;
  if(!shouldAutoFitViewport({tripId:filter.tripId,regionCount:filter.regions.length})) return;
  const pts=Object.values(places).filter(p=>passFilter(p) && Number.isFinite(p.lat) && Number.isFinite(p.lng));
  if(!pts.length) return;
  const uniq=[]; const seen=new Set();
  pts.forEach(p=>{ const k=`${p.lat.toFixed(6)},${p.lng.toFixed(6)}`; if(!seen.has(k)){seen.add(k);uniq.push(p);} });
  if(uniq.length===1){
    map.setCenter({lat:uniq[0].lat,lng:uniq[0].lng});
    map.setZoom(14); return;
  }
  const bounds=new google.maps.LatLngBounds();
  uniq.forEach(p=>bounds.extend({lat:p.lat,lng:p.lng}));
  map.fitBounds(bounds,48);
  google.maps.event.addListenerOnce(map,"idle",()=>{ if(map.getZoom()>15) map.setZoom(15); });
}
function focusMapOnPlace(p){
  if(!map || !Number.isFinite(p?.lat) || !Number.isFinite(p?.lng)) return;
  map.setCenter({lat:p.lat,lng:p.lng});
  map.setZoom(15);
  setFocusedPlace(p.id);
}
// Briefly highlight one Place's marker (a pulsing ring) so a marker tapped from
// the list stands out among nearby pins. Clears itself after a few seconds.
function setFocusedPlace(id){
  focusedPlaceId = id || null;
  clearTimeout(focusedPlaceTimer);
  if(focusedPlaceId){
    focusedPlaceTimer = setTimeout(() => { focusedPlaceId = null; renderMarkers(); }, 20000);
  }
  renderMarkers();
}
function clearPlaceFilter(){
  if(!filter.placeId && !focusedPlaceId) return;
  filter.placeId = "";
  focusedPlaceId = null; clearTimeout(focusedPlaceTimer);
  applyFilter({ fitViewport:false });
}
function showSelfMarker(at){
  if(!AdvMarker || !map) return;
  if(!selfMarker){
    const dot = document.createElement("div");
    dot.className = "selfdot";
    selfMarker = new AdvMarker({ map, position:at, content:dot, title:"你的位置", zIndex:10000 });
  } else {
    selfMarker.position = at;
    selfMarker.map = map;
  }
}
function scheduleFilterFit(){
  clearTimeout(filterFitTimer);
  filterFitTimer=setTimeout(fitMapToCurrentFilter,80);
}
function applyFilter({fitViewport=true}={}){
  focusedPlaceId = null; clearTimeout(focusedPlaceTimer);
  renderList(); renderMarkers();
  refreshMapSurfaces();
  renderFilterChips();
  const shouldFit=shouldFitFilterViewport({
    requested:fitViewport,
    tripId:filter.tripId,
    regionCount:filter.regions.length
  });
  if(shouldFit) scheduleFilterFit();
  else {
    clearTimeout(filterFitTimer);
    filterFitTimer=null;
  }
}
function refreshFilterUI(){
  const trip = document.getElementById("fl_trip"); if (!trip) return;
  const scope = document.getElementById("fl_scope");
  scope.innerHTML = [
    ["month","本月"],["lastmonth","上個月"],["pickedMonth","選月份…"],
    ["today","今天"],["custom","自訂期間"],["all","全部"]
  ].map(o=>`<option value="${o[0]}">${o[1]}</option>`).join("");
  scope.value = dateScope;
  trip.innerHTML = `<option value="all">全部旅程</option><option value="daily">日常</option>` +
    Object.values(trips).map(t=>`<option value="${t.id}">${esc((t.emoji?t.emoji+" ":"")+t.name)}</option>`).join("");
  trip.value = filter.tripId;
  const who = document.getElementById("fl_who");
  // Active Members (self first, then by name) + only the historical participants
  // that actually appear in loaded data (Phase 2 §8, §9). If the current
  // selection is no longer a valid candidate, drop back to "all" (§3).
  sanitizeParticipantFilter();
  const whoUidsList = participantFilterCandidateIds();
  who.innerHTML = `<option value="all">所有同行者</option>` +
    whoUidsList.map(uid=>`<option value="${esc(uid)}">${esc(participantName(uid))}</option>`).join("");
  who.value = filter.who;
  document.getElementById("fl_from").value = filter.from;
  document.getElementById("fl_to").value = filter.to;
  const mq=document.getElementById("monthQuick"), mi=document.getElementById("fl_month");
  if(mq){ mq.classList.toggle("show",dateScope==="pickedMonth"); }
  if(mi) mi.value=pickedMonth||currentMonth(0);
  const fc = document.getElementById("fl_cats");
  fc.innerHTML = spaceCats.length
    ? spaceCats.map(c=>`<span class="chip ${filter.cats.has(c)?'on':''}" data-c="${esc(c)}">${esc(c)}</span>`).join("")
    : `<span style="font-size:12px;color:var(--ink-soft)">尚無分類</span>`;
  fc.querySelectorAll(".chip").forEach(ch => ch.onclick = () => {
    const k = ch.dataset.c; filter.cats.has(k)?filter.cats.delete(k):filter.cats.add(k);
    ch.classList.toggle("on"); applyFilter();
  });
  renderFilterChips();
}
function renderFilterChips(){
  const el = document.getElementById("filterChips"); if (!el) return;
  updateProximityMaskControl();
  const active = filter.who!=="all"||filter.tripId!=="all"||filter.cats.size||filter.from||filter.to||filter.regions.length||filter.placeId;
  const clr = document.getElementById("fl_clear"); if (clr) clr.style.display = active ? "inline-block" : "none";
  const n = tab==="visited" ? getFilteredVisitOccurrences().length : Object.values(places).filter(p => hasVisitHistory(p) && passFilter(p)).length;
  let html = active ? `<span class="fchip active">篩選中 · ${n}</span>` : "";
  if (["month","lastmonth","pickedMonth"].includes(dateScope) && filter.from){
    html += `<span class="fchip">${esc(filter.from.slice(0,7).replace("-","/"))}</span>`;
  }
  const seq=sequenceContext();
  if (tab==="visited" && seq){
    const label=seq.type==="trip" ? "D1-1 順序" : "1·2·3 順序";
    html += `<button class="fchip ${numberPins?'active':''}" id="orderPinToggle" title="地圖依造訪順序編號">${numberPins?'●':'○'} ${label}</button>`;
  }
  filter.regions.forEach((r,i) => html += `<span class="fchip">${esc(r.name)} <b data-rx="${i}">✕</b></span>`);
  if (filter.placeId){
    const fp = places[filter.placeId];
    html += `<span class="fchip active">📍 ${esc(fp?.name || "這個地標")} <b data-clearplace="1">✕</b></span>`;
  }
  el.innerHTML = html;
  const op = document.getElementById("orderPinToggle");
  if (op) op.onclick = () => { numberPins=!numberPins; renderFilterChips(); renderMarkers(); };
  el.querySelectorAll('[data-rx]').forEach(x => x.onclick = () => {
    filter.regions.splice(+x.dataset.rx, 1); applyFilter();
  });
  const cp = el.querySelector('[data-clearplace]');
  if (cp) cp.onclick = clearPlaceFilter;
}

/* ---------- Google Maps 載入 ---------- */
function loadGoogleBootstrap(){
  if (window.google?.maps?.importLibrary) return;
  /* eslint-disable */
  // Google's official inline Maps JS API loader, verbatim. Do not reformat.
  ((g)=>{let h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",
    m=document,b=window;b=b[c]||(b[c]={});let d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,
    u=()=>h||(h=new Promise(async(f,n)=>{await(a=m.createElement("script"));e.set("libraries",[...r]+"");
    for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);
    a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));
    m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})
    ({key:runtimeConfig.google.apiKey, v:"weekly", language:"zh-TW", region:"TW"});
  /* eslint-enable */
}

async function initMap(){
  loadGoogleBootstrap();
  const [{Map},{AdvancedMarkerElement,PinElement},placesLib,{Geocoder}] = await Promise.all([
    google.maps.importLibrary("maps"),
    google.maps.importLibrary("marker"),
    google.maps.importLibrary("places"),
    google.maps.importLibrary("geocoding"),
  ]);
  AdvMarker = AdvancedMarkerElement; Pin = PinElement;
  AutocompleteSuggestion = placesLib.AutocompleteSuggestion;
  AutocompleteSessionToken = placesLib.AutocompleteSessionToken;
  PlaceClass = placesLib.Place;
  geocoder = new Geocoder();

  map = new Map(document.getElementById("map"), {
    center:{lat:23.7,lng:120.9}, zoom:7, mapId:runtimeConfig.google.mapId||"DEMO_MAP_ID",
    mapTypeControl:false, streetViewControl:false, fullscreenControl:false,
    clickableIcons:false, gestureHandling:"greedy"      // 單指即可拖動,避免手機卡住
  });
  map.addListener("click", async e => {
    if (!addMode) return;                              // 只有開啟新增模式才加點
    if (!runtimeReady()) return;
    if (Date.now() - lastMarkerClick < 500) return;
    const lat=e.latLng.lat(), lng=e.latLng.lng();
    nearbyPicker(lat, lng);                            // 先列出附近地標供選
  });
}

/* ---------- Firestore 即時同步 ---------- */
// True while a queued current-Space callback still belongs to the Space that
// was active when its listener was attached (§16). Any listener whose captured
// session is no longer current must ignore its data.
function openNoSpaceSettings(){
  const markerOpts = [["cat","活動"],["level","我的足跡深度"],["who","參與者"],["trip","旅程"],["rating","我的評分"],["dateFirst","首次造訪"],["dateLast","最近造訪"]];
  const metricLocked = proximityEnabled;
  const draftPicks = new Set(categoryPicks);
  const draftCatColors = {};
  const draftLevelColors = {};
  const catColorValue = name => draftCatColors[name] || catColors[name] || CATEGORY_PRESET_COLORS[name] || "#9aa5ad";
  const levelColorValue = level => draftLevelColors[level] || levelColors[level] || LEVEL_COLORS[level];
  const categoryRows = CATEGORY_PRESETS.map(([name])=>{
    const locked = name === "其他";
    return `
    <label class="srow" style="cursor:${locked?'default':'pointer'}">
      <span><input type="checkbox" class="ns_catpick" data-cat="${esc(name)}" ${locked||draftPicks.has(name)?'checked':''} ${locked?'disabled':''} style="width:16px;height:16px;margin-right:8px;vertical-align:middle">${esc(name)}${locked?'<span style="color:var(--ink-soft);font-size:12px"> · 一律顯示</span>':''}</span>
      <input type="color" class="ns_catcolor" data-cat="${esc(name)}" value="${catColorValue(name)}" style="width:40px;height:26px;padding:0;border:1px solid var(--line);border-radius:6px">
    </label>`;
  }).join("");
  const levelRows = LEVEL_ORDER.slice().reverse().map(level=>`
    <div class="colitem"><span>${esc(level)}</span>
      <input type="color" class="ns_levelcolor" data-level="${esc(level)}" value="${levelColorValue(level)}" style="width:40px;height:26px;padding:0;border:1px solid var(--line);border-radius:6px"></div>`).join("");
  modal(`
    <h2 style="margin-bottom:14px">設定</h2>
    <div class="sethead">顯示</div>
    <div class="srow"><span>顯示地點標記</span><input type="checkbox" id="ns_pins" ${showPins?'checked':''} style="width:18px;height:18px"></div>
    <div class="srow"><span>標記顏色</span><select id="ns_markermode" class="sselect">${markerOpts.map(([value,label])=>`<option value="${value}">${label}</option>`).join("")}</select></div>
    <div class="sethead">地圖上色</div>
    <div class="srow"><span>上色依據</span>${metricLocked
      ? `<select class="sselect" disabled title="鄰近圖層開啟時，範圍會沿用地標顏色"><option>與標記顏色連動（鄰近）</option></select>`
      : `<select id="ns_metric" class="sselect">${MAP_AREA_METRIC_OPTIONS.map(([value,label])=>`<option value="${value}">${label}</option>`).join("")}</select>`}</div>
    ${metricLocked?`<div class="admin" style="margin:-2px 0 4px">鄰近圖層開啟時，周圍範圍會直接沿用地標的顏色。</div>`:""}
    <div class="srow"><span>透明度</span><input type="range" id="ns_alpha" min="10" max="90" value="${Math.round(choroAlpha*100)}" style="flex:0 0 55%"></div>
    <div class="sethead">「做什麼」選項</div>
    <div class="admin" style="margin-bottom:4px">勾選的項目會出現在新增造訪的「做什麼」下拉選單；右側可改顏色。</div>
    ${categoryRows}
    <div class="sethead">造訪深度顏色</div>
    <div class="colgrid">${levelRows}</div>
    <div class="sethead">個人資料</div>
    <input id="ns_name" value="${esc(noSpaceState.profiles[user.uid]?.displayName || me())}" placeholder="顯示名稱" style="width:100%;padding:9px;border:1px solid var(--line);border-radius:8px">
    <div class="sethead">好友</div>
    <div class="row" style="margin-top:2px"><button class="btn grey" id="ns_friends_open">管理好友</button></div>
    <div class="row" style="margin-top:12px"><button class="btn" id="ns_done">完成</button></div>
  `);
  const mode = document.getElementById("ns_markermode");
  mode.value = markerMode;
  mode.onchange = event => { markerMode=event.target.value; renderMarkers(); };
  const metric = document.getElementById("ns_metric");
  if (metric){
    metric.value = choroMetric;
    metric.onchange = event => setMapAreaMetric(event.target.value);
  }
  document.getElementById("ns_pins").onchange = event => { showPins=event.target.checked; renderMarkers(); };
  document.getElementById("ns_alpha").oninput = event => { choroAlpha=(+event.target.value)/100; refreshMapSurfaces(); };
  document.querySelectorAll(".ns_catpick").forEach(box => box.onchange = () => {
    if (box.checked) draftPicks.add(box.dataset.cat); else draftPicks.delete(box.dataset.cat);
  });
  document.querySelectorAll(".ns_catcolor").forEach(input => input.oninput = () => { draftCatColors[input.dataset.cat] = input.value; });
  document.querySelectorAll(".ns_levelcolor").forEach(input => input.oninput = () => { draftLevelColors[input.dataset.level] = input.value; });

  document.getElementById("ns_friends_open").onclick = () => openFriendsManager();

  document.getElementById("ns_done").onclick = async() => {
    const repo = noSpaceRepository, session = runtimeSession, uid = user.uid;
    const nextPicks = CATEGORY_PRESET_NAMES.filter(name => name === "其他" || draftPicks.has(name));
    const nextCatColors = {};
    for (const name of CATEGORY_PRESET_NAMES){
      const value = draftCatColors[name] || catColors[name];
      if (value && value.toLowerCase() !== String(CATEGORY_PRESET_COLORS[name] || "").toLowerCase()) nextCatColors[name] = value;
    }
    const nextLevelColors = {};
    for (const level of LEVEL_ORDER){
      const value = draftLevelColors[level] || levelColors[level];
      if (value && value.toLowerCase() !== LEVEL_COLORS[level].toLowerCase()) nextLevelColors[level] = value;
    }
    if (repo && runtimeSessionIsCurrent(session,uid)){
      await repo.updateOwnProfile({ displayName:document.getElementById("ns_name").value, photoURL:user.photoURL || "" });
      await repo.updateOwnPreferences({ categoryPicks:nextPicks, categoryColors:nextCatColors, levelColors:nextLevelColors });
      noSpaceState.profiles[uid] = { ...(noSpaceState.profiles[uid] || {}), categoryPicks:nextPicks, categoryColors:nextCatColors, levelColors:nextLevelColors };
      refreshNoSpaceProjection();
    }
    closeModal();
  };
}

/* ---------- 好友管理 ---------- */
const FRIEND_INPUT_ERRORS = { empty:"請先輸入使用者 ID", invalid:"這個 ID 格式不正確", self:"這是你自己的 ID", duplicate:"這位好友已經在清單裡了" };

// Pending friend invitations addressed to me (docs/FRIENDS.md handshake).
function incomingFriendRequests(){
  return Object.values(noSpaceState.incomingRequests || {}).filter(r => r.state === "pending" && isUsableUid(r.from));
}
function pendingIncomingFrom(fromUid){
  return incomingFriendRequests().some(r => r.from === fromUid);
}

// My outgoing request has been answered: promote the pending_out marker to a
// real friend, or clear it. Runs from the outgoing-request listener; guarded so
// a burst of snapshots does not fire the same write repeatedly.
const reconcilingRequests = new Set();
function reconcileFriendRequests(session, uid){
  if (!runtimeSessionIsCurrent(session, uid) || !noSpaceRepository) return;
  for (const req of Object.values(noSpaceState.outgoingRequests || {})){
    if ((req.state !== "accepted" && req.state !== "declined") || !isUsableUid(req.to)) continue;
    if (reconcilingRequests.has(req.id)) continue;
    reconcilingRequests.add(req.id);
    const done = () => reconcilingRequests.delete(req.id);
    const action = req.state === "accepted"
      ? noSpaceRepository.finalizeAcceptedRequest(req.to)
      : noSpaceRepository.discardOutgoingRequest(req.to);
    action.then(done, e => { done(); console.warn("friend request reconcile failed", e); });
  }
}

function updateFriendsBadge(){
  const btn = document.getElementById("friendsBtn");
  if (!btn) return;
  const n = incomingFriendRequests().length;
  btn.dataset.badge = n ? String(n) : "";
  btn.classList.toggle("badged", n > 0);
  btn.title = n ? `好友（${n} 則邀請）` : "好友";
}

let friendsManagerRefresh = null;
function openFriendsManager(){
  if (!runtimeReady()) return;
  const session = runtimeSession, uid = user.uid;
  const live = () => noSpaceRepository && runtimeSessionIsCurrent(session, uid);
  const myCode0 = noSpaceState.profiles[uid]?.friendCode || "";
  modal(`
    <h2 style="margin-bottom:4px">好友</h2>
    <div class="admin" style="margin-bottom:10px">送出邀請、對方接受後，「同行者」選單就能直接選到他。<br>
      你的好友碼：<code id="fm_mycode" style="user-select:all;font-size:14px;letter-spacing:1px">${esc(formatFriendCode(myCode0) || "產生中…")}</code>
      <span style="opacity:.6"> · ID：<code id="fm_myid" style="user-select:all;word-break:break-all">${esc(uid)}</code></span></div>
    <div class="row" style="gap:6px">
      <input id="fm_uid" placeholder="輸入好友碼（例：ABC-D23）或使用者 ID" style="flex:1;min-width:0;padding:9px;border:1px solid var(--line);border-radius:8px">
      <button class="btn grey" id="fm_add">送出邀請</button>
    </div>
    <div id="fm_err" class="admin" style="color:#b25b6b;margin-top:4px"></div>
    <div id="fm_incoming_wrap" style="display:none">
      <div class="sethead">好友邀請</div>
      <div id="fm_incoming"></div>
    </div>
    <div class="sethead">我的好友</div>
    <div id="fm_list"></div>
    <div id="fm_outgoing_wrap" style="display:none">
      <div class="sethead">邀請中（待對方確認）</div>
      <div id="fm_outgoing"></div>
    </div>
    <div id="fm_suggest_wrap" style="display:none">
      <div class="sethead">曾一起記錄、還沒加好友</div>
      <div id="fm_suggest"></div>
    </div>
    <div class="row" style="margin-top:12px"><button class="btn" id="fm_done">完成</button></div>
  `);
  const g = id => document.getElementById(id);
  const err = g("fm_err");

  async function run(op, optimistic){
    if (!live()) return;
    if (typeof optimistic === "function") optimistic();
    render();
    try { await op(noSpaceRepository); err.textContent = ""; }
    catch(e){ err.textContent = "操作失敗：" + (e?.message || e); }
    refreshNoSpaceProjection();
  }

  async function addOrAccept(raw){
    err.textContent = "";
    let value = typeof raw === "string" ? raw.trim() : "";
    // A 6-char short code (never a 28-char UID) → resolve it to a UID first.
    if (looksLikeFriendCode(value)){
      if (!live()) return;
      let resolved = null;
      try { resolved = await noSpaceRepository.uidForFriendCode(value); }
      catch(e){ err.textContent = "查詢好友碼失敗：" + (e?.message || e); return; }
      if (!resolved){ err.textContent = "找不到這個好友碼"; return; }
      value = resolved;
    }
    const existing = noSpaceState.friends[value];
    if (value === uid){ err.textContent = "這是你自己"; return; }
    if (existing?.state === "linked"){ err.textContent = "你們已經是好友了"; return; }
    if (existing?.state === "pending_out"){ err.textContent = "已送出邀請，等待對方確認"; return; }
    if (pendingIncomingFrom(value)){
      if (g("fm_uid")) g("fm_uid").value = "";
      run(repo => repo.acceptFriendRequest(value), () => {
        noSpaceState.friends[value] = { friendUid:value, nickname:"", pinned:false, state:"linked" };
        delete noSpaceState.incomingRequests[`${value}__${uid}`];
      });
      return;
    }
    const check = validateFriendInput(value, { selfUid:uid, existingUids:friendEntries().map(f => f.friendUid) });
    if (!check.ok){ err.textContent = FRIEND_INPUT_ERRORS[check.reason] || "無法送出"; return; }
    if (g("fm_uid")) g("fm_uid").value = "";
    run(repo => repo.sendFriendRequest(check.friendUid), () => {
      noSpaceState.friends[check.friendUid] = { friendUid:check.friendUid, nickname:"", pinned:false, state:"pending_out" };
    });
  }

  function suggestionIds(){
    const known = knownParticipantUserIds(uid, Object.values(noSpaceState.visits), Object.values(noSpaceState.trips));
    const excluded = new Set(friendEntries().map(f => f.friendUid));
    incomingFriendRequests().forEach(r => excluded.add(r.from));
    return known.filter(id => id !== uid && !excluded.has(id));
  }
  function personCell(name, id){
    return `<span style="flex:1 1 130px;min-width:0">
      <strong style="word-break:break-all">${esc(name || "（尚未載入名稱）")}</strong>
      <span class="admin" style="display:block;word-break:break-all">${esc(id)}</span></span>`;
  }
  function render(){
    if (!g("fm_list")){ friendsManagerRefresh = null; return; }

    const code = noSpaceState.profiles[uid]?.friendCode || "";
    if (g("fm_mycode") && code) g("fm_mycode").textContent = formatFriendCode(code);

    const incoming = incomingFriendRequests();
    g("fm_incoming_wrap").style.display = incoming.length ? "block" : "none";
    g("fm_incoming").innerHTML = incoming.map(r => `
      <div class="srow" style="align-items:center;gap:6px;flex-wrap:wrap">
        ${personCell(noSpaceState.profiles[r.from]?.displayName, r.from)}
        <button class="fm_accept btn grey" data-uid="${esc(r.from)}" style="flex:0 0 auto">接受</button>
        <button class="fm_decline" data-uid="${esc(r.from)}" style="flex:0 0 auto;background:none;border:0;color:#b25b6b;cursor:pointer">婉拒</button>
      </div>`).join("");
    g("fm_incoming").querySelectorAll(".fm_accept").forEach(b => b.onclick = () =>
      run(repo => repo.acceptFriendRequest(b.dataset.uid), () => {
        noSpaceState.friends[b.dataset.uid] = { friendUid:b.dataset.uid, nickname:"", pinned:false, state:"linked" };
        delete noSpaceState.incomingRequests[`${b.dataset.uid}__${uid}`];
      }));
    g("fm_incoming").querySelectorAll(".fm_decline").forEach(b => b.onclick = () =>
      run(repo => repo.declineFriendRequest(b.dataset.uid), () => {
        delete noSpaceState.incomingRequests[`${b.dataset.uid}__${uid}`];
      }));

    const linked = friendEntries().filter(f => f.state === "linked").sort((a,b) =>
      Number(b.pinned) - Number(a.pinned) || participantName(a.friendUid).localeCompare(participantName(b.friendUid)));
    g("fm_list").innerHTML = linked.length ? linked.map(f => `
      <div class="srow" style="align-items:center;gap:6px;flex-wrap:wrap">
        ${personCell(noSpaceState.profiles[f.friendUid]?.displayName, f.friendUid)}
        <input class="fm_nick" data-uid="${esc(f.friendUid)}" value="${esc(f.nickname)}" placeholder="綽號" style="flex:0 0 92px;padding:6px;border:1px solid var(--line);border-radius:6px">
        <label style="flex:0 0 auto;font-size:12px;color:var(--ink-soft)"><input type="checkbox" class="fm_pin" data-uid="${esc(f.friendUid)}" ${f.pinned?'checked':''} style="vertical-align:middle"> 置頂</label>
        <button class="fm_del" data-uid="${esc(f.friendUid)}" style="flex:0 0 auto;background:none;border:0;color:#b25b6b;cursor:pointer">移除</button>
      </div>`).join("") : `<div class="admin">還沒有好友。</div>`;
    g("fm_list").querySelectorAll(".fm_nick").forEach(i => i.onchange = () =>
      run(repo => repo.setFriendNickname(i.dataset.uid, i.value), () => {
        if (noSpaceState.friends[i.dataset.uid]) noSpaceState.friends[i.dataset.uid].nickname = i.value.trim().slice(0,60);
      }));
    g("fm_list").querySelectorAll(".fm_pin").forEach(b => b.onchange = () =>
      run(repo => repo.setFriendPinned(b.dataset.uid, b.checked), () => {
        if (noSpaceState.friends[b.dataset.uid]) noSpaceState.friends[b.dataset.uid].pinned = b.checked;
      }));
    g("fm_list").querySelectorAll(".fm_del").forEach(b => b.onclick = () =>
      run(repo => repo.removeFriend(b.dataset.uid), () => { delete noSpaceState.friends[b.dataset.uid]; }));

    const outgoing = friendEntries().filter(f => f.state === "pending_out");
    g("fm_outgoing_wrap").style.display = outgoing.length ? "block" : "none";
    g("fm_outgoing").innerHTML = outgoing.map(f => `
      <div class="srow" style="align-items:center;gap:6px">
        ${personCell(noSpaceState.profiles[f.friendUid]?.displayName, f.friendUid)}
        <button class="fm_cancel" data-uid="${esc(f.friendUid)}" style="flex:0 0 auto;background:none;border:0;color:#b25b6b;cursor:pointer">取消邀請</button>
      </div>`).join("");
    g("fm_outgoing").querySelectorAll(".fm_cancel").forEach(b => b.onclick = () =>
      run(repo => repo.discardOutgoingRequest(b.dataset.uid), () => { delete noSpaceState.friends[b.dataset.uid]; }));

    const suggestions = suggestionIds();
    g("fm_suggest_wrap").style.display = suggestions.length ? "block" : "none";
    g("fm_suggest").innerHTML = suggestions.map(id => `
      <div class="srow" style="align-items:center;gap:6px">
        ${personCell(noSpaceState.profiles[id]?.displayName, id)}
        <button class="fm_addsug btn grey" data-uid="${esc(id)}" style="flex:0 0 auto">送出邀請</button>
      </div>`).join("");
    g("fm_suggest").querySelectorAll(".fm_addsug").forEach(b => b.onclick = () => addOrAccept(b.dataset.uid));
  }

  g("fm_add").onclick = () => addOrAccept(g("fm_uid").value);
  g("fm_uid").onkeydown = event => { if (event.key === "Enter"){ event.preventDefault(); addOrAccept(g("fm_uid").value); } };
  g("fm_done").onclick = () => { friendsManagerRefresh = null; closeModal(); };
  friendsManagerRefresh = render;
  render();

  // Make sure this user has a shareable short code (generates one on first open).
  if (!myCode0 && live()){
    noSpaceRepository.ensureFriendCode().then(code => {
      if (!runtimeSessionIsCurrent(session, uid)) return;
      const profile = noSpaceState.profiles[uid] || {};
      noSpaceState.profiles[uid] = { ...profile, friendCode:code };
      if (g("fm_mycode")) g("fm_mycode").textContent = formatFriendCode(code);
    }).catch(e => { if (g("fm_err")) g("fm_err").textContent = "無法產生好友碼：" + (e?.message || e); });
  }
}

function runtimeSessionIsCurrent(session, uid){
  return !localFailure && user?.uid === uid && session === runtimeSession;
}

function resetNoSpaceState(){
  for (const group of [noSpaceState.placeUnsubs, noSpaceState.legacyImportUnsubs, noSpaceState.contributionUnsubs, noSpaceState.profileUnsubs]){
    for (const unsubscribe of group.values()) try { unsubscribe(); } catch(e) {}
    group.clear();
  }
  noSpaceState.visits = {};
  noSpaceState.places = {};
  noSpaceState.trips = {};
  noSpaceState.contributions = {};
  noSpaceState.dayOrders = {};
  noSpaceState.profiles = {};
  noSpaceState.legacyImports = {};
  noSpaceState.defaults = {};
  noSpaceState.friends = {};
  noSpaceState.incomingRequests = {};
  noSpaceState.outgoingRequests = {};
  noSpaceRepository = null;
}

function subscribeNoSpace(){
  unsubscribeRuntimeListeners();
  resetNoSpaceState();
  const session = runtimeSession;
  const uid = user.uid;
  const current = () => runtimeSessionIsCurrent(session, uid);
  const error = area => problem => { if (current()) handleFirestoreError(`No-Space ${area}`, problem); };
  noSpaceRepository = createNoSpaceRepository({
    db,
    uid,
    firestore:{ addDoc, collection, deleteDoc, doc, getDoc, getDocs, onSnapshot, query, runTransaction, serverTimestamp, setDoc, updateDoc, where, writeBatch }
  });

  runtimeUnsubscribes.set("visits", noSpaceRepository.listenVisibleVisits(snapshot => {
    if (!current()) return;
    noSpaceState.visits = {};
    snapshot.forEach(item => noSpaceState.visits[item.id] = { id:item.id, ...item.data() });
    syncNoSpaceReferenceListeners(session, uid);
    refreshNoSpaceProjection();
  }, error("visits")));
  runtimeUnsubscribes.set("trips", noSpaceRepository.listenVisibleTrips(snapshot => {
    if (!current()) return;
    noSpaceState.trips = {};
    snapshot.forEach(item => noSpaceState.trips[item.id] = { id:item.id, ...item.data() });
    syncNoSpaceReferenceListeners(session, uid);
    refreshNoSpaceProjection();
  }, error("trips")));
  runtimeUnsubscribes.set("day-orders", noSpaceRepository.listenDayOrders(snapshot => {
    if (!current()) return;
    noSpaceState.dayOrders = {};
    snapshot.forEach(item => noSpaceState.dayOrders[item.id] = { id:item.id, ...item.data() });
    refreshNoSpaceProjection();
  }, error("day orders")));
  runtimeUnsubscribes.set("defaults", noSpaceRepository.listenDefaults(snapshot => {
    if (!current()) return;
    noSpaceState.defaults = snapshot.exists() ? snapshot.data() : {};
    refreshNoSpaceProjection();
  }, error("display defaults")));
  runtimeUnsubscribes.set("friends", noSpaceRepository.listenFriends(snapshot => {
    if (!current()) return;
    const friends = {};
    snapshot.forEach(item => {
      const normalized = normalizeFriendDoc(item.id, item.data());
      if (normalized) friends[normalized.friendUid] = normalized;
    });
    noSpaceState.friends = friends;
    syncNoSpaceReferenceListeners(session, uid);
    refreshNoSpaceProjection();
  }, error("friends")));
  runtimeUnsubscribes.set("friend-requests-in", noSpaceRepository.listenIncomingFriendRequests(snapshot => {
    if (!current()) return;
    const map = {};
    snapshot.forEach(item => map[item.id] = { id:item.id, ...item.data() });
    noSpaceState.incomingRequests = map;
    syncNoSpaceReferenceListeners(session, uid);
    refreshNoSpaceProjection();
  }, error("incoming friend requests")));
  runtimeUnsubscribes.set("friend-requests-out", noSpaceRepository.listenOutgoingFriendRequests(snapshot => {
    if (!current()) return;
    const map = {};
    snapshot.forEach(item => map[item.id] = { id:item.id, ...item.data() });
    noSpaceState.outgoingRequests = map;
    reconcileFriendRequests(session, uid);
    refreshNoSpaceProjection();
  }, error("outgoing friend requests")));
  syncNoSpaceReferenceListeners(session, uid);
}

function syncNoSpaceReferenceGroup(group, desiredIds, subscribe, onRemove){
  for (const [id, unsubscribe] of group){
    if (desiredIds.has(id)) continue;
    try { unsubscribe(); } catch(e) {}
    group.delete(id);
    onRemove(id);
  }
  for (const id of desiredIds){
    if (!group.has(id)) group.set(id, subscribe(id));
  }
}

function syncNoSpaceReferenceListeners(session, uid){
  if (!runtimeSessionIsCurrent(session, uid) || !noSpaceRepository) return;
  const visitsList = Object.values(noSpaceState.visits);
  const tripsList = Object.values(noSpaceState.trips);
  const placeIds = new Set(visitsList.map(visit => visit.placeId).filter(Boolean));
  const visitIds = new Set(visitsList.map(visit => visit.id));
  const profileIds = new Set(mergeFriendIdsIntoDirectory(
    knownParticipantUserIds(uid, visitsList, tripsList), friendEntries().map(f => f.friendUid)));
  for (const req of incomingFriendRequests()) profileIds.add(req.from);
  const guard = callback => (...args) => { if (runtimeSessionIsCurrent(session, uid)) callback(...args); };
  const error = area => guard(problem => handleFirestoreError(`No-Space ${area}`, problem));
  const legacyImportError = placeId => guard(problem => {
    if(problem?.code === "permission-denied"){
      delete noSpaceState.legacyImports[placeId];
      refreshNoSpaceProjection();
      return;
    }
    handleFirestoreError(`No-Space legacy record ${placeId}`,problem);
  });

  syncNoSpaceReferenceGroup(noSpaceState.placeUnsubs, placeIds, placeId =>
    noSpaceRepository.listenPlace(placeId, guard(snapshot => {
      if (snapshot.exists()) noSpaceState.places[placeId] = { id:placeId, ...snapshot.data() };
      else delete noSpaceState.places[placeId];
      refreshNoSpaceProjection();
    }), error(`Place ${placeId}`)), id => delete noSpaceState.places[id]);

  syncNoSpaceReferenceGroup(noSpaceState.legacyImportUnsubs, placeIds, placeId =>
    noSpaceRepository.listenLegacyImport(placeId, guard(snapshot => {
      if (snapshot.exists()) noSpaceState.legacyImports[placeId] = snapshot.data();
      else delete noSpaceState.legacyImports[placeId];
      refreshNoSpaceProjection();
    }), legacyImportError(placeId)), id => delete noSpaceState.legacyImports[id]);

  syncNoSpaceReferenceGroup(noSpaceState.contributionUnsubs, visitIds, visitId =>
    noSpaceRepository.listenContributions(visitId, guard(snapshot => {
      const contributions = {};
      snapshot.forEach(item => contributions[item.id] = { id:item.id, ...item.data() });
      noSpaceState.contributions[visitId] = contributions;
      refreshNoSpaceProjection();
    }), error(`contributions ${visitId}`)), id => delete noSpaceState.contributions[id]);

  syncNoSpaceReferenceGroup(noSpaceState.profileUnsubs, profileIds, profileUid =>
    noSpaceRepository.listenUser(profileUid, guard(snapshot => {
      noSpaceState.profiles[profileUid] = snapshot.exists()
        ? { id:profileUid, ...snapshot.data() }
        : { id:profileUid, displayName:profileUid === uid ? me() : "Participant" };
      refreshNoSpaceProjection();
    }), error(`User ${profileUid}`)), id => delete noSpaceState.profiles[id]);
}

// Firestore delivers many per-document snapshots in quick succession (one per
// referenced Place / contribution set / profile). Coalesce them: a single
// re-projection + re-render runs shortly after a burst instead of once per
// snapshot, which is the main cause of slow initial load.
let noSpaceProjectionTimer = null;
function refreshNoSpaceProjection(){
  if (noSpaceProjectionTimer) return;
  noSpaceProjectionTimer = setTimeout(() => {
    noSpaceProjectionTimer = null;
    applyNoSpaceProjection();
  }, 24);
}
function cancelPendingProjection(){
  if (noSpaceProjectionTimer){ clearTimeout(noSpaceProjectionTimer); noSpaceProjectionTimer = null; }
}

function applyNoSpaceProjection(){
  if (!user || !noSpaceRepository) return;
  const visitList = Object.values(noSpaceState.visits);
  places = projectNoSpaceRuntime({
    currentUserId:user.uid,
    visits:visitList,
    placesById:noSpaceState.places,
    contributionsByVisitId:noSpaceState.contributions,
    dayOrdersByDate:noSpaceState.dayOrders
  });
  Object.values(places).forEach(place => {
    if (noSpaceState.legacyImports[place.id]) place._legacyImport = noSpaceState.legacyImports[place.id];
  });
  trips = Object.fromEntries(Object.values(noSpaceState.trips).map(trip => [trip.id, {
    ...trip,
    participantIds:[...(trip.participantUserIds || [])]
  }]));
  const ownProfile = noSpaceState.profiles[user.uid] || {};
  categoryPicks = Array.isArray(ownProfile.categoryPicks) && ownProfile.categoryPicks.length
    ? ownProfile.categoryPicks.filter(category => typeof category === "string" && category.trim())
    : [...CATEGORY_DEFAULT_PICKS];
  // Filter chips / legends reflect categories actually in use (plus any shared
  // defaults); the personal `categoryPicks` only drive the editor's dropdown.
  spaceCats = [...new Set([...(noSpaceState.defaults.categories || []), ...visitList.map(visit => visit.category)].filter(Boolean))].sort((a,b)=>a.localeCompare(b));
  catColors = { ...CATEGORY_PRESET_COLORS, ...(noSpaceState.defaults.catColors || {}), ...(ownProfile.categoryColors || {}) };
  levelColors = { ...LEVEL_COLORS, ...(noSpaceState.defaults.levelColors || {}), ...(ownProfile.levelColors || {}) };
  // A person is *selectable* (picker candidate for new records) only if they are
  // the current user or a currently-linked friend. Everyone else who appears on
  // visible Visits/Trips — including a former friend after an unfriend — is kept
  // as a non-selectable historical member: their name still resolves and they
  // stay on the records they are already on, but they can't be added to new
  // ones. See docs/FRIENDS.md#unfriending.
  const linkedFriendIds = new Set(friendUserIds());
  const directoryIds = mergeFriendIdsIntoDirectory(
    knownParticipantUserIds(user.uid, visitList, Object.values(noSpaceState.trips)), friendUserIds());
  participantMembers = directoryIds.map(uid => {
    const selectable = uid === user.uid || linkedFriendIds.has(uid);
    return {
      userId:uid,
      role:null,
      status:"active",
      selectable,
      displayName:noSpaceState.profiles[uid]?.displayName || (uid === user.uid ? me() : "Participant"),
      photoURL:noSpaceState.profiles[uid]?.photoURL || "",
      source:uid === user.uid ? "self" : (friendEntryOf(uid) ? "friend" : "history"),
      valid:true,
      issues:[]
    };
  });
  members = Object.fromEntries(participantMembers.map(member => [member.userId, member.displayName]));
  recomputeReferencedParticipants();
  updateFriendsBadge();
  if (friendsManagerRefresh) friendsManagerRefresh();
  if (!document.getElementById("fl_trip")) return;
  refreshFilterUI();
  renderList();
  renderMarkers();
  refreshMapSurfaces();
}
function unsubscribeRuntimeListeners(){
  for (const unsubscribe of runtimeUnsubscribes.values()){
    try { unsubscribe(); } catch(error){ console.warn("Firestore listener cleanup failed:", error); }
  }
  runtimeUnsubscribes.clear();
}

function runtimeReady(){
  return !!user && !!noSpaceRepository;
}

function resetRuntimeState(){
  cancelPendingProjection();
  resetNoSpaceState();
  friendsManagerRefresh = null;
  reconcilingRequests.clear();
  places = {};
  trips = {};
  spaceCats = [];
  members = {};
  catColors = {};
  categoryPicks = [...CATEGORY_DEFAULT_PICKS];
  levelColors = { ...LEVEL_COLORS };
  participantMembers = [];
  referencedHistoricalIds = [];
  markers.forEach(marker => { try { marker.map = null; } catch(e){} });
  markers = [];
  if (selfMarker){ try { selfMarker.map = null; } catch(e){} selfMarker = null; }
  focusedPlaceId = null; clearTimeout(focusedPlaceTimer);
  removeAdministrativeLayer();
  removeProximityLayer();
  adminLevel = "off";
  proximityEnabled = false;
  regionLegendState = null;
  regionMulti = false;
  proximityMaskIndex = null;
  selectedRegionMaskCache = { identity:"", maskIndex:null };
  proximityGeometryCache.clear();
  proximitySeedCount = 0;
}

function showLoadingState(){
  const list = document.getElementById("list");
  if (list) list.innerHTML = `<div class="empty">載入中…</div>`;
  const legend = document.getElementById("maplegend");
  if (legend){ legend.innerHTML = ""; legend.style.display = "none"; }
}

function cancelAddMode(){
  addMode = false;
  const btn = document.getElementById("addBtn");
  if (btn) btn.classList.remove("on");
  const mapEl = document.getElementById("map");
  if (mapEl) mapEl.style.cursor = "";
}
function clearSearchSuggestions(){
  const box = document.getElementById("results");
  if (box){ box.style.display = "none"; box.innerHTML = ""; }
  sessionToken = null;
}
function closeAllModals(){
  document.querySelectorAll(".modal-bg").forEach(m => m.remove());
}

/* ---------- Map markers ---------- */
const PARTICIPANT_GROUP_COLOR = "#b25b6b";
const PARTICIPANT_NONE_COLOR = "#9aa5ad";
function participantColor(uid){ return CAT_PALETTE[participantColorIndex(uid, CAT_PALETTE.length)]; }
function participantsColor(ids){
  const c = classifyParticipants(ids);
  if (c.kind === "none") return PARTICIPANT_NONE_COLOR;
  if (c.kind === "group") return PARTICIPANT_GROUP_COLOR;
  return participantColor(c.ids[0]);
}
function whoColor(p){ return participantsColor(whoUids(p)); }
function visitWhoColor(p,v){ return participantsColor(visitWhoUids(p,v)); }
function ratingColor(r){ return lerpHex("#e9d8c0","#8f4f18",(Math.max(1,Math.min(5,r))-1)/4); }
function dayDiff(a,b){ return Math.round((new Date(b+"T00:00:00")-new Date(a+"T00:00:00"))/86400000); }
function markerDateBounds(){
  // 顏色時間軸以「目前 Filter 真正有效的日期範圍」為準。
  // 若同時套旅程與月份/日期，採兩者交集；因此旅程 8/8–8/11 會固定由紅走到紫。
  const tid=specificTripId();
  if(tid){
    const b=tripSequenceBounds(tid);
    if(b.from&&b.to&&b.from<=b.to) return b;
  }
  if(filter.from && filter.to) return {from:filter.from,to:filter.to};
  const ds=getFilteredVisitOccurrences().map(occurrenceDate).filter(Boolean).sort();
  const today=new Date().toISOString().slice(0,10);
  return {from:filter.from||ds[0]||today,to:filter.to||ds[ds.length-1]||ds[0]||today};
}
function dateBaseColor(date,bounds=markerDateBounds()){
  const total=Math.max(1,dayDiff(bounds.from,bounds.to)), pos=Math.max(0,Math.min(total,dayDiff(bounds.from,date)));
  return multiStopColor(VISIT_DATE_RAINBOW,pos/total);
}
function dateOccurrenceColor(o,bounds=markerDateBounds()){
  const date=occurrenceDate(o), base=dateBaseColor(date,bounds);
  const day=getDayOccurrences(date), same=day.filter(x=>occurrenceDate(x)===date);
  const idx=Math.max(0,same.findIndex(x=>x.p.id===o.p.id && x.visitIndex===o.visitIndex && (x.stayAnchor||"")===(o.stayAnchor||"")));
  const frac=same.length<=1?0.55:idx/(same.length-1);
  // 同一天由淺到深；第一站仍保留足夠飽和度，最後一站接近基準色（單一色相，不跨彩虹）。
  return lerpHex("#ffffff",base,0.48+0.50*frac);
}
function representativeDateOccurrence(p,mode){
  const arr=[];
  placeVisits(p).forEach((v,visitIndex)=>{
    if(!placeStaticFilter(p)||!visitMatchesWho(p,v)||!visitMatchesTrip(v)||!visitMatchesCategory(p,v)) return;
    if(visitKind(v)!=="stay"){
      if(visitPassFilter(p,v)) arr.push({p,v,visitIndex,seqDate:v.date,stayAnchor:"",fixed:false});
      return;
    }
    const co=stayCheckout(v); if(!co) return;
    let from=v.date,to=co;
    if(filter.from&&filter.from>from) from=filter.from;
    if(filter.to&&filter.to<to) to=filter.to;
    enumerateDates(from,to).forEach(d=>{
      if(d>v.date&&d<=co) arr.push({p,v,visitIndex,seqDate:d,stayAnchor:"morning",fixed:true});
      if(d>=v.date&&d<co) arr.push({p,v,visitIndex,seqDate:d,stayAnchor:"night",fixed:true});
    });
  });
  if(!arr.length) return null;
  arr.sort(sortOccurrences);
  return mode==="dateFirst"?arr[0]:arr[arr.length-1];
}
function markerColor(p){
  if (markerMode === "cat"){ const c=(p.categories||[])[0]; return c ? catColor(c) : CATEGORY_NONE_COLOR; }
  else if (markerMode === "level" && p.level) return levelColors[p.level];
  else if (markerMode === "who") return whoColor(p);
  else if (markerMode === "trip" && p.tripId && trips[p.tripId]?.color) return trips[p.tripId].color;
  else if (markerMode === "rating" && p.rating) return ratingColor(p.rating);
  return getCSS("--visited");
}
function markerColorForVisit(p,v){
  if (markerMode === "cat"){
    const c=visitCategory(p,v); return c ? catColor(c) : CATEGORY_NONE_COLOR;
  }
  const personal=v?._contributions?.[user?.uid]||{};
  if (markerMode === "level" && v?.level) return levelColors[v.level] || markerColor(p);
  if (markerMode === "rating" && personal.rating) return ratingColor(personal.rating);
  if (markerMode === "who") return visitWhoColor(p,v);
  if (markerMode === "trip" && v?.tripId && trips[v.tripId]?.color) return trips[v.tripId].color;
  return markerColor(p);
}
function markerColorForOccurrence(o){
  if(markerMode==="dateFirst" || markerMode==="dateLast") return dateOccurrenceColor(o);
  return markerColorForVisit(o.p,o.v);
}
function effectiveMarkerColor(p){
  let color=markerColor(p);
  if(!hasVisitHistory(p)) return color;
  if(markerMode==="dateFirst" || markerMode==="dateLast"){
    const occurrence=representativeDateOccurrence(p,markerMode);
    return occurrence ? dateOccurrenceColor(occurrence) : color;
  }
  const visits=placeVisits(p)
    .map((v,visitIndex)=>({p,v,visitIndex,seqDate:v.date,stayAnchor:visitKind(v)==="stay"?"night":""}))
    .filter(o=>visitPassFilter(p,o.v))
    .sort(sortOccurrences);
  const occurrence=visits[visits.length-1];
  return occurrence ? markerColorForVisit(p,occurrence.v) : color;
}
function renderMarkers(){
  if (!AdvMarker) return;
  markers.forEach(m => m.map = null); markers = [];
  if (!runtimeReady()){
    const legend = document.getElementById("maplegend");
    if (legend){ legend.innerHTML = ""; legend.style.display = "none"; }
    return;
  }
  renderMarkerLegend();
  restyleProximityLayer();
  if (!showPins) return;

  const seq=sequenceContext();
  if (seq && numberPins){
    const labelled=sequenceLabels();
    const totals={}; labelled.forEach(x=>totals[x.o.p.id]=(totals[x.o.p.id]||0)+1);
    const seen={};
    labelled.forEach((x,i)=>{
      const {o,label}=x, p=o.p, col=markerColorForOccurrence(o), idx=seen[p.id]||0; seen[p.id]=idx+1;
      if (!hasFinitePlaceCoordinates(p)) return;
      const bubble=document.createElement("div"); bubble.className="seqpin"; bubble.textContent=label;
      if(label.length>2){ bubble.style.width="34px"; bubble.style.borderRadius="12px"; bubble.style.fontSize="9px"; }
      bubble.style.background=col; bubble.style.color=textOn(col);
      if(totals[p.id]>1){ const offset=(idx-(totals[p.id]-1)/2)*22; bubble.style.transform=`translateX(${offset}px)`; }
      const stayTxt=o.stayAnchor==="morning"?" · 住宿後出發":o.stayAnchor==="night"?" · 夜宿":"";
      const m=new AdvMarker({ map, position:{lat:p.lat,lng:p.lng}, content:bubble,
        title:`${label} ${p.name}${stayTxt}`, gmpClickable:true, zIndex:1000+i });
      m.addListener("gmp-click",()=>{ lastMarkerClick=Date.now(); openEditor(p.id,null,{focusVisitIndex:o.visitIndex}); });
      markers.push(m);
    });
    return;
  }

  Object.values(places).forEach(p => {
    if (!hasFinitePlaceCoordinates(p)) return;
    if (!passFilter(p)) return;
    const col=effectiveMarkerColor(p);
    // Repeated Visits to one Place are a single marker; when there is more than
    // one (matching the current filter) the pin shows the count as its glyph.
    const count=placeVisits(p).filter(v=>visitPassFilter(p,v)).length;
    const title=count>1?`${p.name} · 造訪 ${count} 次`:p.name;
    let content, extra={};
    if (p.id===focusedPlaceId){
      const dot=document.createElement("div");
      dot.className="focuspin";
      dot.style.background=col;
      dot.textContent=count>1?String(count):"";
      content=dot; extra={zIndex:9999};
    } else {
      const pinOpts = { background:col, borderColor:"#ffffff", glyphColor:"#ffffff", scale:count>1?0.85:0.6 };
      if (count>1) pinOpts.glyph = String(count);
      const pin = new Pin(pinOpts);
      pin.style.cursor = "pointer";
      content = pin;
    }
    const m = new AdvMarker({ map, position:{lat:p.lat,lng:p.lng}, content, title, gmpClickable:true, ...extra });
    // Tapping a marker narrows the list to that Place and highlights the pin
    // (a specific Visit is then opened from the list). Tapping it again, or the
    // 📍 chip's ✕, clears it.
    m.addListener("gmp-click", () => {
      lastMarkerClick = Date.now();
      if (filter.placeId === p.id){ clearPlaceFilter(); return; }
      filter.placeId = p.id;
      if (tab !== "visited") tab = "visited";
      applyFilter({ fitViewport:false });
      setFocusedPlace(p.id);
    });
    markers.push(m);
  });
}
function dateMarkerLegendBody(){
  const b=markerDateBounds(), grad=VISIT_DATE_RAINBOW.join(",");
  if(b.from && b.from===b.to){
    const base=dateBaseColor(b.from,b), lite=lerpHex("#ffffff",base,0.48);
    return `<div class="legendsection"><div class="legendtitle">地標 · ${esc(b.from.replaceAll("-","/"))} 造訪順序</div>`+
      `<div style="height:8px;width:108px;border-radius:3px;background:linear-gradient(90deg,${lite},${base})"></div>`+
      `<div style="display:flex;justify-content:space-between;width:108px;font-size:11px"><span>第一站</span><span>最後一站</span></div></div>`;
  }
  return `<div class="legendsection"><div class="legendtitle">地標 · ${markerMode==="dateFirst"?"最早造訪":"最後造訪"}</div>`+
    `<div style="height:8px;width:108px;border-radius:3px;background:linear-gradient(90deg,${grad})"></div>`+
    `<div style="display:flex;justify-content:space-between;width:108px;font-size:11px"><span>${esc((b.from||"").slice(5)||"早")}</span><span>${esc((b.to||"").slice(5)||"晚")}</span></div>`+
    `<div style="font-size:11px;margin-top:2px">同日：淺 → 深 = 第一站 → 最後一站</div></div>`;
}
function markerLegendBody(){
  if (!showPins) return "";
  const titles = { cat:"在這裡做什麼", level:"造訪深度", who:"誰去的", trip:"哪趟旅程", rating:"評分", dateFirst:"最早造訪", dateLast:"最後造訪" };
  const seq=sequenceContext(), orderMode=tab==="visited" && !!seq && numberPins;
  let order="";
  if(orderMode){
    const txt=seq.type==="trip" ? "D1-1 = 第1天第1站" : "數字 = 當日造訪順序";
    order=`<div class="legendsection"><div class="legendtitle">地標 · 順序</div><div style="font-size:11px">${txt}</div></div>`;
  }
  if(markerMode==="dateFirst" || markerMode==="dateLast") return order+dateMarkerLegendBody();
  if(orderMode) return order+`<div style="font-size:11px;margin-top:3px">顏色沿用目前地標配色</div>`;
  if (markerMode === "rating"){
    return `<div class="legendsection"><div class="legendtitle">地標 · 評分</div>`+
      `<div style="height:8px;width:92px;border-radius:3px;background:linear-gradient(90deg,#e9d8c0,#8f4f18)"></div>`+
      `<div style="display:flex;justify-content:space-between;width:92px;font-size:11px"><span>1</span><span>5</span></div></div>`;
  }
  let rows=[];
  if (markerMode === "who"){
    const uids=[...orderedActiveMemberIds(), ...referencedHistoricalIds];
    rows = uids.map(uid=>[participantColor(uid), participantName(uid)]);
    if (uids.length>=2) rows.push([PARTICIPANT_GROUP_COLOR,"多人同行"]);
  }
  else if (markerMode === "level") rows = LEVEL_ORDER.slice().reverse().map(l=>[levelColors[l], l]);
  else if (markerMode === "cat") rows = spaceCats.map(c=>[catColor(c), c]);
  else if (markerMode === "trip") rows = Object.values(trips).map(t=>[t.color||"#3f7d78", (t.emoji?t.emoji+" ":"")+t.name]);
  const body=rows.length ? rows.map(r=>`<div class="lg"><span class="sw" style="background:${r[0]}"></span>${esc(r[1])}</div>`).join("") : `<div style="font-size:11px">尚無項目</div>`;
  return `<div class="legendsection"><div class="legendtitle">地標 · ${titles[markerMode]||"地標"}</div>${body}</div>`;
}

function areaMetricLegendBody(surface,metric,ctx={}){
  if(metric==="first"||metric==="last"){
    const grad=VISIT_DATE_RAINBOW.join(",");
    const singleDay=ctx.dmin && ctx.dmin===ctx.dmax;
    const lab=singleDay
      ? `${esc(ctx.dmin.replaceAll("-","/"))} ${metric==="first"?"首次進入":"最後停留"}順序`
      : (metric==="first"?"最早造訪日期":"最後造訪日期");
    const ends=singleDay
      ? `<span>第一站</span><span>最後一站</span>`
      : `<span>${esc((ctx.dmin||"").slice(5)||"早")}</span><span>${esc((ctx.dmax||"").slice(5)||"晚")}</span>`;
    const ramp=singleDay
      ? `${lerpHex("#ffffff",VISIT_DATE_RAINBOW[0],0.48)},${VISIT_DATE_RAINBOW[0]}`
      : grad;
    return `<div class="legendsection"><div class="legendtitle">${surface} · ${lab}</div>`+
      `<div style="height:8px;width:108px;border-radius:3px;background:linear-gradient(90deg,${ramp})"></div>`+
      `<div style="display:flex;justify-content:space-between;width:108px;font-size:11px">${ends}</div></div>`;
  }
  if(metric==="categoryMode"){
    const observed=new Set();
    for(const place of Object.values(places)){
      if(!mapAreaPlacePassFilter(place)) continue;
      for(const visit of areaVisitsForPlace(place)) if(areaVisitPassFilter(place,visit) && visit.category) observed.add(visit.category);
    }
    const categories=[...spaceCats,...[...observed].filter(category=>!spaceCats.includes(category)).sort()];
    const rows=categories.map(category=>[catColor(category),category]);
    const body=rows.length ? rows.map(([color,label])=>`<div class="lg"><span class="sw" style="background:${color}"></span>${esc(label)}</div>`).join("") : `<div style="font-size:11px">尚無造訪目的</div>`;
    return `<div class="legendsection"><div class="legendtitle">${surface} · 造訪目的（眾數）</div>${body}</div>`;
  }
  if(metric==="count" || metric==="visitCount"){
    const title=metric==="count"?"地標數":"造訪次數";
    if(!Number.isFinite(ctx.min) || !Number.isFinite(ctx.max)){
      return `<div class="legendsection"><div class="legendtitle">${surface} · ${title}</div><div style="font-size:11px">目前無資料</div></div>`;
    }
    const gradient=ctx.min===ctx.max
      ? quantitativeColor(COUNT_SHADES,ctx.min,{min:ctx.min,max:ctx.max})
      : `linear-gradient(90deg,${COUNT_SHADES.join(",")})`;
    return `<div class="legendsection"><div class="legendtitle">${surface} · ${title}</div>`+
      `<div style="height:8px;width:108px;border-radius:3px;background:${gradient}"></div>`+
      `<div style="display:flex;justify-content:space-between;width:108px;font-size:11px"><span>${ctx.min}</span><span>${ctx.max}</span></div></div>`;
  }
  const rows=[[levelColors["居住"],"居住"],[levelColors["住宿"],"住宿"],[levelColors["旅遊"],"旅遊"],[levelColors["接地"],"接地"],[levelColors["經過"],"經過"],["#e5e0d6","未到"]];
  return `<div class="legendsection"><div class="legendtitle">${surface} · 造訪深度</div>`+
    rows.map(r=>`<div class="lg"><span class="sw" style="background:${r[0]}"></span>${r[1]}</div>`).join("")+`</div>`;
}
function regionLegendBody(){
  if(!regionLegendState || !shouldShowAdministrativeLegend({adminLevel,proximityEnabled})) return "";
  return areaMetricLegendBody("行政區",regionLegendState.metric,regionLegendState.ctx);
}
function proximityLegendBody(){
  if(!proximityEnabled) return "";
  const maskMode=resolveProximityMaskMode(filter.regions,proximityMaskTaiwan);
  const landText=maskMode.type==="regions" ? `已選行政區 × ${maskMode.count}`
    : maskMode.type==="taiwan" ? "臺灣陸地" : "無遮罩";
  const seedText=proximitySeedCount ? `${proximitySeedCount} 個造訪地點` : "目前篩選下沒有造訪地點";
  return `<div class="legendsection"><div class="legendtitle">鄰近涵蓋 · ${formatProximityRadius(proximityRadius)} km</div>`+
    `<div class="legendnote">${seedText}<br>${landText}<br>重疊範圍歸最近的造訪地點；顏色沿用地標配色。</div></div>`;
}
function renderUnifiedLegend(){
  const el=document.getElementById("maplegend"); if(!el) return;
  const hasMarker=showPins;
  const hasRegion=!!regionLegendState && shouldShowAdministrativeLegend({adminLevel,proximityEnabled});
  const hasProximity=proximityEnabled;
  if(!hasMarker && !hasRegion && !hasProximity){ el.style.display="none"; return; }
  el.style.display="block";
  const head=`<div class="legendhead" id="legendHead"><span>圖例</span><span>${legendCollapsed?"▸":"▾"}</span></div>`;
  el.innerHTML=head+(legendCollapsed?"":markerLegendBody()+regionLegendBody()+proximityLegendBody());
  document.getElementById("legendHead").onclick=()=>{ legendCollapsed=!legendCollapsed; renderUnifiedLegend(); };
}
function renderMarkerLegend(){ renderUnifiedLegend(); }

const getCSS = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

/* ============================================================
   足跡染色(choropleth):載入 geo → turf 點判 → 依深度上色
   ============================================================ */
async function loadGeo(url){
  if (geoCache[url]) return geoCache[url];
  const r = await fetch(url);
  if (!r.ok) throw new Error(url + " 讀取失敗(" + r.status + ")");
  const j = await r.json();
  geoCache[url] = j;
  return j;
}
function pip(lat, lng, features, codeProp){
  const pt = turf.point([lng, lat]);
  for (const f of features){
    try { if (turf.booleanPointInPolygon(pt, f)) return f.properties[codeProp]; } catch(e){}
  }
  return null;
}

function updatePlaceGeographyCache(_originContextId, placeId, fields){
  return noSpaceRepository?.updatePlaceCache(placeId, fields) || Promise.resolve();
}

// 確保每個地點都有該級的行政區代碼(算一次就寫回 Firestore 快取)。快取寫回
// 綁定啟動時的 Space;若期間切換 Space 就停止寫入 (§17)。
async function ensureCounty(){
  const geoSession = runtimeSession;
  const geo = await loadGeo("geo/county.json");
  if (geoSession !== runtimeSession) return geo;
  for (const p of Object.values(places)){
    if (geoSession !== runtimeSession) break;
    if (!hasVisitHistory(p)) continue;
    if (p.countyCode) continue;
    const code = pip(p.lat, p.lng, geo.features, "COUNTYCODE");
    if (code){ p.countyCode = code; updatePlaceGeographyCache(null, p.id, { countyCode: code }); }
  }
  return geo;
}
async function ensureTown(){
  const geoSession = runtimeSession;
  const geo = await loadGeo("geo/town.json");
  if (geoSession !== runtimeSession) return geo;
  for (const p of Object.values(places)){
    if (geoSession !== runtimeSession) break;
    if (!hasVisitHistory(p)) continue;
    if (p.townCode) continue;
    const code = pip(p.lat, p.lng, geo.features, "TOWNCODE");
    if (code){ p.townCode = code; updatePlaceGeographyCache(null, p.id, { townCode: code }); }
  }
  return geo;
}
async function ensureVillage(){
  const geoSession = runtimeSession;
  const county = await ensureCounty();                       // 先確保 countyCode
  const codes = county.features.map(f => f.properties.COUNTYCODE);
  const byCounty = {}; let feats = [];
  for (const c of codes){
    if (geoSession !== runtimeSession) break;
    let geo; try { geo = await loadGeo("geo/village/" + c + ".json"); } catch(e){ continue; }
    byCounty[c] = geo.features; feats = feats.concat(geo.features);
  }
  if (geoSession === runtimeSession){
    for (const p of Object.values(places)){
      if (geoSession !== runtimeSession) break;
      if (!hasVisitHistory(p)) continue;
      if (p.villCode || !p.countyCode) continue;
      const gf = byCounty[p.countyCode]; if (!gf) continue;
      const code = pip(p.lat, p.lng, gf, "VILLCODE");
      if (code){ p.villCode = code; updatePlaceGeographyCache(null, p.id, { villCode: code }); }
    }
  }
  return { type:"FeatureCollection", features: feats };
}
// 每個行政區代碼 → 符合篩選、已造訪的地點清單
function regionPlaces(codeOf){
  const m = {};
  for (const p of Object.values(places)){
    if (!mapAreaPlacePassFilter(p)) continue;
    const code = codeOf(p); if (!code) continue;
    (m[code] = m[code] || []).push(p);
  }
  return m;
}
function areaVisitsForPlace(place){
  return Array.isArray(place?.visits) ? place.visits : [];
}
function areaVisitPassFilter(place,visit){
  const category=typeof visit?.category==="string" ? visit.category.trim() : "";
  return placeStaticFilter(place) && visitMatchesWho(place,visit) && visitMatchesTrip(visit)
    && (!filter.cats.size || filter.cats.has(category)) && visitIntersects(visit,filter.from,filter.to);
}
function mapAreaPlacePassFilter(place){
  return areaVisitsForPlace(place).some(visit=>areaVisitPassFilter(place,visit));
}
function visitAreaMetrics(pls){
  return aggregatePlaceVisitAreaMetrics(pls,{
    categoryOrder:noSpaceState.defaults.categories||[],
    selectVisits:areaVisitsForPlace,
    visitFilter:(visit,place)=>areaVisitPassFilter(place,visit)
  });
}
// Per-visit shared "造訪深度" (未設定的當作「旅遊」), so area surfaces reflect the
// same depths the per-visit markers show.
function filteredVisitLevel(visit){
  return visit?.level || "旅遊";
}
// Deepest such level across the filter-passing visits of a Place set — the
// value the choropleth / proximity "造訪深度" fill should use.
function deepestFilteredLevel(placeList){
  const levels=[];
  for(const place of placeList||[]){
    for(const visit of areaVisitsForPlace(place)){
      if(areaVisitPassFilter(place,visit)) levels.push(filteredVisitLevel(visit));
    }
  }
  return deepestLevel(levels,LEVEL_ORDER);
}
// When the active date window is a single day, colour a Place set by where its
// first / last visit that day sits in the whole day's ordered sequence, so
// same-day order is distinguishable on area surfaces (not just markers).
// `daySequence` is the shared getDayOccurrences(date) result.
function singleDayOrderColor(placeList,mode,daySequence){
  if(!daySequence || !daySequence.length) return null;
  const ids=new Set((placeList||[]).map(place=>place.id));
  let slot=-1;
  daySequence.forEach((occurrence,index)=>{
    if(!ids.has(occurrence.p.id)) return;
    if(mode==="first"){ if(slot<0) slot=index; }
    else slot=index;
  });
  if(slot<0) return null;
  // Single hue, light -> dark by position in the day's sequence (no rainbow).
  const frac=daySequence.length<=1?0.55:slot/(daySequence.length-1);
  return lerpHex("#ffffff",VISIT_DATE_RAINBOW[0],0.48+0.50*frac);
}
const COUNT_SHADES = ["#f0dcc0","#e6bd86","#d98b3f","#b96a24","#8f4f18"];
function countColor(value,bounds){ return quantitativeColor(COUNT_SHADES,value,bounds); }
function countMetricBounds(metricsByKey,metric){
  const field=metric==="visitCount"?"visitCount":"placeCount";
  return positiveExtrema(Object.values(metricsByKey||{}).map(metrics=>metrics?.[field]));
}
function dateColor(d,min,max){
  if(!d) return null;
  if(!min||!max||min===max) return VISIT_DATE_RAINBOW[0];
  const total=Math.max(1,dayDiff(min,max)), pos=Math.max(0,Math.min(total,dayDiff(min,d)));
  return multiStopColor(VISIT_DATE_RAINBOW,pos/total);
}
function renderLegend(metric,ctx){
  regionLegendState={metric,ctx};
  renderUnifiedLegend();
}

function updateSurfaceControls(){
  document.querySelectorAll("#mapctl button").forEach(b => {
    const active=b.dataset.l==="proximity" ? proximityEnabled : b.dataset.l===adminLevel;
    b.classList.toggle("on",active);
  });
  const administrative=adminLevel!=="off";
  const multi=document.getElementById("multiBtn");
  const proximity=document.getElementById("proximityCtl");
  if(multi) multi.style.display=administrative ? "block" : "none";
  if(proximity) proximity.style.display=proximityEnabled ? "flex" : "none";
  updateProximityMaskControl();
}
function updateProximityMaskControl(){
  const maskLabel=document.getElementById("proximityMaskLabel");
  const regionStatus=document.getElementById("proximityRegionStatus");
  if(!maskLabel || !regionStatus) return;
  const mode=resolveProximityMaskMode(filter.regions,proximityMaskTaiwan);
  maskLabel.style.display=mode.type==="regions" ? "none" : "flex";
  regionStatus.style.display=mode.type==="regions" ? "inline" : "none";
  regionStatus.textContent=mode.type==="regions" ? `限制於已選 ${mode.count} 個行政區` : "";
}
function removeAdministrativeLayer(){
  if(adminLayer) adminLayer.setMap(null);
  if(adminContextLayer) adminContextLayer.setMap(null);
  adminLayer=null;
  adminContextLayer=null;
  adminLayerLevel=null;
  adminContextLevel=null;
}
function removeProximityLayer(){
  if(proximityLayer){
    proximityLayer.setMap(null);
    proximityLayer=null;
    proximityLayerKey="";
  }
}
function restyleProximityLayer(){
  if(!proximityLayer) return;
  proximityLayer.setStyle(feature=>{
    // Each coverage territory takes its seed Place's own marker colour, so the
    // area around a pin always matches the pin (no separate metric selector).
    const place=places[String(feature.getProperty("seedId"))];
    const color=place ? effectiveMarkerColor(place) : getCSS("--visited");
    return {
      fillColor:color,
      fillOpacity:choroAlpha,
      strokeColor:color,
      strokeOpacity:0.28,
      strokeWeight:0.35,
      zIndex:MAP_SURFACE_Z_INDEX.proximity,
      clickable:false
    };
  });
}
async function selectedRegionFeatures(regions){
  const candidates=[];
  for(const key of ["countyCode","townCode"]){
    if(!regions.some(region=>region.key===key)) continue;
    const spec=REGION_GEO[key], geo=await loadGeo(spec.url);
    geo.features.forEach(feature=>candidates.push({
      key,
      code:String(feature.properties?.[spec.codeProperty] ?? ""),
      feature
    }));
  }
  const villageRegions=regions.filter(region=>region.key==="villCode");
  if(villageRegions.length){
    const urls=new Set(villageRegions.map(region=>region.countyCode ? `geo/village/${region.countyCode}.json` : "").filter(Boolean));
    if(villageRegions.some(region=>!region.countyCode)){
      const countyGeo=await loadGeo("geo/county.json");
      countyGeo.features.forEach(feature=>urls.add(`geo/village/${feature.properties.COUNTYCODE}.json`));
    }
    for(const url of urls){
      let geo; try { geo=await loadGeo(url); } catch(e){ continue; }
      geo.features.forEach(feature=>candidates.push({
        key:"villCode",
        code:String(feature.properties?.VILLCODE ?? ""),
        feature
      }));
    }
  }
  return selectRegionMaskCandidates(candidates,regions).map(candidate=>candidate.feature);
}
async function selectedRegionMask(mode,regions){
  if(selectedRegionMaskCache.identity===mode.identity) return selectedRegionMaskCache;
  const selectedFeatures=await selectedRegionFeatures(regions);
  let maskFeatures=selectedFeatures;
  if(selectedFeatures.length>1){
    try {
      const combined=turf.union(turf.featureCollection(selectedFeatures),{properties:{mask:"selected-regions"}});
      if(combined) maskFeatures=[combined];
    } catch(e) {}
  }
  selectedRegionMaskCache={
    identity:mode.identity,
    maskIndex:createMaskIndex(turf,maskFeatures)
  };
  return selectedRegionMaskCache;
}
function proximityGeometryKey(seeds,maskMode){
  const seedKey=seeds.map(seed=>`${seed.id}:${seed.lat.toFixed(7)},${seed.lng.toFixed(7)}`).join("|");
  return `${formatProximityRadius(proximityRadius)}:${maskMode.identity}:${seedKey}`;
}
async function renderProximityCoverage(requestVersion){
  const selectedRegions=filter.regions.map(region=>({...region}));
  const seeds=selectEligibleProximitySeeds(places, mapAreaPlacePassFilter);
  const maskMode=resolveProximityMaskMode(selectedRegions,proximityMaskTaiwan);
  proximitySeedCount=seeds.length;
  updateProximityMaskControl();
  renderUnifiedLegend();
  let maskIndex=null;
  if(maskMode.type==="regions"){
    const selectedMask=await selectedRegionMask(maskMode,selectedRegions);
    maskIndex=selectedMask.maskIndex;
  }else if(maskMode.type==="taiwan" && seeds.length){
    if(!proximityMaskIndex){
      const townGeo=await loadGeo("geo/town.json");
      proximityMaskIndex=createMaskIndex(turf,townGeo.features);
    }
    maskIndex=proximityMaskIndex;
  }
  if(requestVersion!==proximityRenderVersion || !proximityEnabled) return;
  const key=proximityGeometryKey(seeds,maskMode);
  let featureCollection=proximityGeometryCache.get(key);
  if(!featureCollection){
    if(!seeds.length){
      featureCollection=turf.featureCollection([]);
    }else{
      featureCollection=buildProximityFeatureCollection({
        turfApi:turf,
        seeds,
        radiusKm:proximityRadius,
        maskIndex
      });
    }
    proximityGeometryCache.set(key,featureCollection);
    while(proximityGeometryCache.size>6) proximityGeometryCache.delete(proximityGeometryCache.keys().next().value);
  }
  if(requestVersion!==proximityRenderVersion || !proximityEnabled) return;
  if(proximityLayer && proximityLayerKey===key){
    restyleProximityLayer();
    renderUnifiedLegend();
    return;
  }
  if(proximityLayer) proximityLayer.setMap(null);
  proximityLayer=new google.maps.Data({map});
  proximityLayer.addGeoJson(featureCollection);
  proximityLayerKey=key;
  restyleProximityLayer();
  renderUnifiedLegend();
}

function handleAdministrativeRegionClick(ev,level,codeProp){
  const f=ev.feature;
  const parts=level==="county" ? [f.getProperty("COUNTYNAME")]
    : level==="town" ? [f.getProperty("COUNTYNAME"),f.getProperty("TOWNNAME")]
    : [f.getProperty("COUNTYNAME"),f.getProperty("TOWNNAME"),f.getProperty("VILLNAME")];
  const entry={
    key:CODEKEY[level],
    code:f.getProperty(codeProp),
    name:parts.filter(Boolean).join(""),
    ...(level==="village" ? {countyCode:f.getProperty("COUNTYCODE")} : {})
  };
  const idx=filter.regions.findIndex(region=>region.key===entry.key && region.code===entry.code);
  if(regionMulti){
    if(idx>=0) filter.regions.splice(idx,1); else filter.regions.push(entry);
  }else{
    filter.regions=(idx>=0 && filter.regions.length===1) ? [] : [entry];
  }
  tab="visited";
  document.querySelectorAll(".tab").forEach(button=>button.classList.toggle("on",button.dataset.t==="visited"));
  applyFilter({fitViewport:false});
}

async function renderAdministrativeLayer(){
  const level=adminLevel;
  const requestVersion=++adminRenderVersion;
  updateSurfaceControls();
  if(level==="off"){
    removeAdministrativeLayer();
    regionLegendState=null;
    renderUnifiedLegend();
    return;
  }

  let fc,codeProp,codeOf;
  try {
    if(level==="county"){ fc=await ensureCounty(); codeProp="COUNTYCODE"; codeOf=p=>p.countyCode; }
    else if(level==="town"){ fc=await ensureTown(); codeProp="TOWNCODE"; codeOf=p=>p.townCode; }
    else { fc=await ensureVillage(); codeProp="VILLCODE"; codeOf=p=>p.villCode; }
  }catch(e){
    if(requestVersion!==adminRenderVersion || adminLevel!==level) return;
    alert("行政區圖資載入失敗，請確認 geo/ 圖資已包含在 repo：\n"+e.message);
    adminLevel="off";
    filter.regions=[];
    removeAdministrativeLayer();
    updateSurfaceControls();
    renderList();
    renderMarkers();
    renderFilterChips();
    if(proximityEnabled) refreshProximityLayer();
    renderUnifiedLegend();
    return;
  }
  if(requestVersion!==adminRenderVersion || adminLevel!==level) return;

  const byRegion=regionPlaces(codeOf);
  const metricsByRegion=Object.fromEntries(Object.entries(byRegion).map(([code,regionPlacesList])=>[code,visitAreaMetrics(regionPlacesList)]));
  let dmin,dmax;
  const countBounds=(choroMetric==="count" || choroMetric==="visitCount") ? countMetricBounds(metricsByRegion,choroMetric) : null;
  if(choroMetric==="first" || choroMetric==="last"){
    const bounds=markerDateBounds(); dmin=bounds.from; dmax=bounds.to;
  }
  const singleDay=dmin && dmin===dmax ? dmin : "";
  const singleDaySeq=singleDay ? getDayOccurrences(singleDay) : null;
  const colorOf=code=>{
    const regionPlacesList=byRegion[code];
    if(!regionPlacesList || !regionPlacesList.length) return null;
    if(choroMetric==="level"){
      const deepest=deepestFilteredLevel(regionPlacesList);
      return deepest ? (levelColors[deepest] || null) : null;
    }
    const metrics=metricsByRegion[code];
    if(choroMetric==="count") return countColor(metrics.placeCount,countBounds);
    if(choroMetric==="visitCount") return countColor(metrics.visitCount,countBounds);
    if(choroMetric==="categoryMode") return metrics.categoryMode ? catColor(metrics.categoryMode) : null;
    if(choroMetric==="first" || choroMetric==="last"){
      if(singleDay) return singleDayOrderColor(regionPlacesList,choroMetric,singleDaySeq);
      const date=choroMetric==="first" ? metrics.earliest : metrics.latest;
      return date ? dateColor(date,dmin,dmax) : null;
    }
    return null;
  };
  const selectedCodes=new Set(filter.regions
    .filter(region=>region.key===CODEKEY[level])
    .map(region=>String(region.code)));
  const hasBlackout=shouldShowRegionBlackout({adminLevel:level,regionCount:selectedCodes.size});

  if(!adminLayer || adminLayerLevel!==level || !adminContextLayer || adminContextLevel!==level){
    removeAdministrativeLayer();
    adminLayer=new google.maps.Data({map});
    adminLayer.addGeoJson(fc);
    adminContextLayer=new google.maps.Data({map});
    adminContextLayer.addGeoJson(fc);
    adminContextLayer.addListener("click",ev=>handleAdministrativeRegionClick(ev,level,codeProp));
    adminLayerLevel=level;
    adminContextLevel=level;
  }
  adminLayer.setStyle(feature=>{
    const color=colorOf(String(feature.getProperty(codeProp)));
    const showThematicFill=shouldRenderAdministrativeThematicFill({adminLevel:level,proximityEnabled});
    return {
      fillColor:color || "#e5e0d6",
      fillOpacity:showThematicFill ? (color ? choroAlpha : 0.12) : 0,
      strokeWeight:0,
      zIndex:MAP_SURFACE_Z_INDEX.adminFill,
      clickable:false
    };
  });
  adminContextLayer.setStyle(feature=>{
    const code=String(feature.getProperty(codeProp));
    const selected=selectedCodes.has(code);
    if(hasBlackout && !selected){
      return {
        fillColor:"#12202e",
        fillOpacity:0.55,
        strokeWeight:0,
        zIndex:MAP_SURFACE_Z_INDEX.adminContext,
        clickable:true
      };
    }
    return {
      fillOpacity:0,
      strokeColor:selected ? "#152230" : "#ffffff",
      strokeOpacity:selected ? 0.78 : 0.75,
      strokeWeight:selected ? 1.6 : 0.6,
      zIndex:MAP_SURFACE_Z_INDEX.adminContext,
      clickable:true
    };
  });
  renderLegend(choroMetric,{dmin,dmax,...countBounds});
}

async function refreshProximityLayer(){
  const requestVersion=++proximityRenderVersion;
  updateSurfaceControls();
  if(!proximityEnabled){
    removeProximityLayer();
    renderUnifiedLegend();
    return;
  }
  try {
    await renderProximityCoverage(requestVersion);
  }catch(e){
    if(requestVersion!==proximityRenderVersion || !proximityEnabled) return;
    alert("鄰近範圍載入失敗：\n"+e.message);
    proximityEnabled=false;
    removeProximityLayer();
    if(adminLevel!=="off") renderAdministrativeLayer();
    updateSurfaceControls();
    renderUnifiedLegend();
  }
}

function refreshMapSurfaces(){
  if(adminLevel!=="off") renderAdministrativeLayer();
  else {
    adminRenderVersion++;
    removeAdministrativeLayer();
    regionLegendState=null;
  }
  if(proximityEnabled) refreshProximityLayer();
  else {
    proximityRenderVersion++;
    removeProximityLayer();
  }
  updateSurfaceControls();
  renderUnifiedLegend();
}

function setMapAreaMetric(metric){
  choroMetric=metric;
  refreshMapSurfaces();
}

function toggleMapSurface(control){
  if (!runtimeReady()) return;
  const action=control==="proximity" ? {type:"proximity"} : {type:"admin",level:control};
  const next=transitionMapSurfaceState({adminLevel,proximityEnabled},action);
  if(action.type==="proximity"){
    proximityEnabled=next.proximityEnabled;
    if(adminLevel!=="off") renderAdministrativeLayer();
    refreshProximityLayer();
    return;
  }

  const changed=next.adminLevel!==adminLevel;
  adminLevel=next.adminLevel;
  if(filter.regions.length && (changed || adminLevel==="off")){
    filter.regions=[];
    renderList();
    renderFilterChips();
  }
  renderAdministrativeLayer();
  if(proximityEnabled) refreshProximityLayer();
}

/* ============================================================
   4) 清單
   ============================================================ */
const effOrd = p => (p.ord != null ? p.ord : (p.createdAt?.seconds || 0));
function renderList(){
  if (!runtimeReady()){ showLoadingState(); return; }
  if (filter.placeId && !places[filter.placeId]) filter.placeId = "";  // Place gone (last Visit deleted)
  if (tab !== "visited" && tab !== "trips") tab = "visited";
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.t === tab));
  document.getElementById("searchWrap").style.display = tab === "trips" ? "none" : "block";
  const el = document.getElementById("list");
  if (tab === "trips"){ renderTrips(el); return; }

  const reorderScope=visitReorderScope();
  const oneDay=singleDayDate();
  if(oneDay){ renderDayVisitList(el,oneDay); renderFilterChips(); return; }

  const tripId=specificTripId();
  let occ=tripId ? sequenceOccurrences() : getFilteredVisitOccurrences();
  if(filter.placeId) occ=occ.filter(o=>o.p.id===filter.placeId);
  if(!tripId){
    occ.sort((a,b)=>{
      const d=occurrenceDate(b).localeCompare(occurrenceDate(a)); if(d) return d;
      const ao=Number.isFinite(Number(a.v.order))?Number(a.v.order):1e9, bo=Number.isFinite(Number(b.v.order))?Number(b.v.order):1e9;
      if(ao!==bo) return ao-bo;
      return effOrd(a.p)-effOrd(b.p);
    });
  }
  if(!occ.length){
    // A Space with no actual Visit history at all is simply empty — regardless
    // of the default month filter, and regardless of dormant legacy wishlist
    // documents (§8, §21).
    const emptySpace = !Object.values(places).some(hasVisitHistory);
    el.innerHTML=`<div class="empty">${emptySpace?"這張地圖還沒有造訪紀錄。用上方搜尋或地圖上的「＋」開始記錄。":"沒有符合的造訪紀錄。"}</div>`;
    renderFilterChips(); return;
  }
  const labels=tripId ? new Map(sequenceLabels().map(x=>[occurrenceKey(x.o),x.label])) : null;
  let html="", lastDate=null, dayIdx=0;
  occ.forEach(o=>{
    const d=occurrenceDate(o)||"未定日期";
    if(d!==lastDate){ html+=`<div class="daysep">${tripId?`D${tripDayNoByDate(d,tripId,occ)} · `:""}${esc(d)}</div>`; lastDate=d; dayIdx=0; }
    dayIdx++;
    const label=labels?.get(occurrenceKey(o))||String(dayIdx);
    const reorderable=reorderScope && visitKind(o.v)==="visit" ? reorderableDayOccurrences(d,reorderScope) : [];
    const position=reorderable.findIndex(x=>x.p.id===o.p.id&&x.visitIndex===o.visitIndex)+1;
    html+=o.fixed ? stayAnchorCardHTML(o,label,d) : visitCardHTML(o,label,d,position&&shouldShowReorderControls(reorderable.length)?{position,total:reorderable.length}:null);
  });
  el.innerHTML=html; wireVisitCards(el);
  renderFilterChips();
}

function visitCardHTML(o,label,date,orderInfo=null){
  const p=o.p,v=o.v,cat=visitCategory(p,v),col=cat?catColor(cat):"#9aa5ad";
  const whoTxt=visitWhoText(p,v);
  const tripRef=tripReferenceState(v.tripId,trips),t=tripRef.trip,stay=visitKind(v)==="stay",nights=stayNights(v);
  const personalRating=v?._contributions?.[user?.uid]?.rating;
  const tags=[
    stay?`<span class="ptag" style="background:#e6efe9">住宿 ${nights}晚 · ${esc(v.date)} → ${esc(stayCheckout(v)||v.date)}</span>`:"",
    cat?`<span class="ptag" style="background:${col};color:${textOn(col)}">${esc(cat)}</span>`:"",
    `<span class="ptag" style="background:#efe9df">${esc(whoTxt)}</span>`,
    t?`<span class="ptag" style="background:${(t.color||'#3f7d78')}22">${t.emoji||'🧭'} ${esc(t.name)}</span>`:tripRef.kind==="missing"?`<span class="ptag" style="background:#f2f0eb">已刪除旅程</span>`:`<span class="ptag" style="background:#f2f0eb">日常</span>`,
    personalRating?`<span class="ptag" style="background:#f3e7d3">★${personalRating}</span>`:""
  ].filter(Boolean).join("");
  const key=`${p.id}:${o.visitIndex}`;
  return `<div class="card compact" id="vc_${p.id}_${o.visitIndex}" data-visit-key="${key}" data-date="${esc(date)}" data-pid="${p.id}" data-vidx="${o.visitIndex}" style="background:${col}14"><div style="display:flex;align-items:center;gap:8px">
    <span class="dot" style="background:${col};flex:0 0 auto"></span><div style="flex:1;min-width:0"><div class="cname">${esc(p.name)}</div><div class="ptags">${tags}</div></div>
    <span class="daynum" style="${String(label).length>2?'width:auto;min-width:32px;padding:0 5px;border-radius:10px;font-size:11px':''}">${esc(String(label))}</span>
    ${orderInfo?`<div class="visitorder" aria-label="我的同日順序"><div class="ordcol"><button class="ordbtn" data-vmove="up" data-vkey="${key}" data-date="${esc(date)}" title="在我的順序往前一站" ${orderInfo.position===1?'disabled':''}>▲</button><button class="ordbtn" data-vmove="down" data-vkey="${key}" data-date="${esc(date)}" title="在我的順序往後一站" ${orderInfo.position===orderInfo.total?'disabled':''}>▼</button></div><select class="ordselect" data-vposition="${key}" data-date="${esc(date)}" aria-label="調整我的同日順序" title="移動到我的指定位置"><option value="">移至</option><option value="first">最前</option>${Array.from({length:orderInfo.total},(_,i)=>`<option value="${i+1}">第 ${i+1}</option>`).join("")}<option value="last">最後</option></select></div>`:""}
    ${canDeleteVisit(user?.uid, v._shared || v) ? `<button class="delx" data-vdel="${key}" title="刪除此造訪">✕</button>` : ""}</div></div>`;
}
function stayAnchorCardHTML(o,label,date){
  const p=o.p,v=o.v,cat=visitCategory(p,v),col=cat?catColor(cat):levelColors["住宿"];
  const nights=stayNights(v), n=o.stayAnchor==="morning"?Math.max(1,dayDiff(v.date,date)):Math.max(1,dayDiff(v.date,date)+1);
  const edge=o.stayAnchor==="morning"?`住宿後出發 · 第 ${Math.min(n,nights)}/${nights} 晚後`:`夜宿 · 第 ${Math.min(n,nights)}/${nights} 晚`;
  const tripRef=tripReferenceState(v.tripId,trips),t=tripRef.trip;
  return `<div class="card compact stayanchor" data-stay-anchor="1" data-date="${esc(date)}" data-pid="${p.id}" data-vidx="${o.visitIndex}" style="background:${col}10"><div style="display:flex;align-items:center;gap:8px">
    <span style="font-size:15px">🏨</span><div style="flex:1;min-width:0"><div class="cname">${esc(p.name)}</div><div class="ptags"><span class="stayedge">${edge}</span><span class="ptag" style="background:#efe9df">${esc(visitWhoText(p,v))}</span>${t?`<span class="ptag" style="background:${(t.color||'#3f7d78')}22">${t.emoji||'🧭'} ${esc(t.name)}</span>`:tripRef.kind==="missing"?`<span class="ptag" style="background:#f2f0eb">已刪除旅程</span>`:""}</div></div>
    <span class="daynum" style="${String(label).length>2?'width:auto;min-width:32px;padding:0 5px;border-radius:10px;font-size:11px':''}">${esc(String(label))}</span>
  </div></div>`;
}
function renderDayVisitList(el,date){
  let seq=getDayOccurrences(date);
  if(filter.placeId) seq=seq.filter(o=>o.p.id===filter.placeId);
  if(!seq.length){ el.innerHTML=`<div class="empty">這一天沒有符合的造訪紀錄。</div>`; return; }
  const tripId=specificTripId(), labels=new Map(sequenceLabels().map(x=>[occurrenceKey(x.o),x.label]));
  let html=`<div class="daysep">${tripId?`D${tripDayNoByDate(date,tripId,seq)} · `:""}${esc(date)}</div>`;
  const reorderable=reorderableDayOccurrences(date);
  html+=seq.map((o,i)=>{
    const position=reorderable.findIndex(x=>x.p.id===o.p.id&&x.visitIndex===o.visitIndex)+1;
    return o.fixed?stayAnchorCardHTML(o,labels.get(occurrenceKey(o))||String(i+1),date):visitCardHTML(o,labels.get(occurrenceKey(o))||String(i+1),date,position&&shouldShowReorderControls(reorderable.length)?{position,total:reorderable.length}:null);
  }).join("");
  el.innerHTML=html; wireVisitCards(el);
}
function wireVisitCards(el){
  el.querySelectorAll('[data-pid][data-vidx]').forEach(c=>c.onclick=ev=>{
    if(ev.target.closest("[data-vdel]")||ev.target.closest("[data-vmove]")||ev.target.closest("[data-vposition]")) return;
    focusMapOnPlace(places[c.dataset.pid]);
    openEditor(c.dataset.pid,null,{focusVisitIndex:+c.dataset.vidx});
  });
  el.querySelectorAll("[data-vdel]").forEach(b=>b.onclick=ev=>{
    ev.stopPropagation();
    deleteVisitOccurrence(b.dataset.vdel).catch(error=>alert(`無法完整刪除造訪：${error.message}`));
  });
  el.querySelectorAll("[data-vmove]").forEach(b=>b.onclick=ev=>{ev.stopPropagation();moveVisitOccurrence(b.dataset.vkey,b.dataset.date,b.dataset.vmove);});
  el.querySelectorAll("[data-vposition]").forEach(s=>s.onchange=ev=>{ev.stopPropagation();if(s.value) moveVisitOccurrence(s.dataset.vposition,s.dataset.date,s.value);s.value="";});
}
async function moveVisitOccurrence(key,date,action){
  const [pid,idxRaw]=key.split(":"), idx=+idxRaw;
  const scope=visitReorderScope(); if(!scope) return;
  const regular=fullDayOrdinaryOccurrences(date);
  const movable=o=>visitMatchesReorderScope({
    tripId:o.v.tripId,
    participants:visitWhoUids(o.p,o.v)
  },scope);
  const candidates=regular.filter(movable);
  const i=candidates.findIndex(o=>o.p.id===pid && o.visitIndex===idx);
  const j=resolveVisitMoveTarget(action,i,candidates.length);
  if(i<0 || j<0 || i===j) return;
  const repo=noSpaceRepository, session=runtimeSession, uid=user.uid;
  const stored=noSpaceState.dayOrders[date]?.visitIds || [];
  const normalized=normalizeDayOrder(date,Object.values(noSpaceState.visits),stored);
  const candidateIds=candidates.map(item=>item.v.id);
  const reorderedCandidates=reorderDayVisitIds(candidateIds,candidates[i].v.id,j);
  let nextIndex=0;
  const candidateSet=new Set(candidateIds);
  const next=normalized.map(id=>candidateSet.has(id)?reorderedCandidates[nextIndex++]:id);
  noSpaceState.dayOrders[date]={id:date,visitIds:next};
  refreshNoSpaceProjection();
  if(repo && runtimeSessionIsCurrent(session,uid)) await repo.setDayOrder(date,next);
}

async function deleteVisitOccurrence(key){
  const [pid,idxRaw]=key.split(":"),p=places[pid],idx=+idxRaw; if(!p) return;
  const visit=placeVisits(p)[idx];
  if (!visit || !canDeleteVisit(user.uid, visit._shared || visit)) return;
  const repo=noSpaceRepository, session=runtimeSession, uid=user.uid;
  if (repo && runtimeSessionIsCurrent(session,uid)) await repo.deleteVisit(visit.id);
}

/* ============================================================
   5) Search
   ============================================================ */
let searchTimer;
function normPlaceName(x){ return (x||"").trim().toLowerCase().replace(/\s+/g,""); }
function geoDistanceM(aLat,aLng,bLat,bLng){
  const R=6371000, rad=x=>x*Math.PI/180, dLat=rad(bLat-aLat), dLng=rad(bLng-aLng);
  const q=Math.sin(dLat/2)**2+Math.cos(rad(aLat))*Math.cos(rad(bLat))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(q));
}
function findExistingPlace(seed){
  const vals=Object.values(places);
  if(seed?.extId){ const exact=vals.find(p=>p.extId&&p.extId===seed.extId); if(exact) return exact; }
  if(seed?.name && Number.isFinite(seed.lat) && Number.isFinite(seed.lng)){
    const n=normPlaceName(seed.name);
    return vals.find(p=>normPlaceName(p.name)===n && geoDistanceM(p.lat,p.lng,seed.lat,seed.lng)<=80) || null;
  }
  return null;
}
function openSeed(seed){
  if (!runtimeReady()) return;
  // Explicitly searching/selecting a Place records a Visit. An existing Place —
  // including a legacy wishlist-only document detected by extId/name/location —
  // is reused and gains its first real Visit through this explicit action
  // (§17, §22). A brand-new Place is created with a Visit.
  const existing=findExistingPlace(seed);
  if(existing) openEditor(existing.id,null,{addVisit:true});
  else openEditor(null,seed);
}
function wireSearch(){
  const input = document.getElementById("search");
  const box = document.getElementById("results");
  input.oninput = () => {
    clearTimeout(searchTimer);
    if (!runtimeReady()){ clearSearchSuggestions(); return; }
    const q = input.value.trim();
    if (q.length < 2){ box.style.display="none"; return; }
    searchTimer = setTimeout(async () => {
      // Capture the authenticated runtime and request generation before lookup.
      const reqSession = runtimeSession;
      const reqSeq = ++searchReqSeq;
      const reqCurrent = () => reqSeq === searchReqSeq && reqSession === runtimeSession;
      let rs = [];
      try { rs = await searchPlace(q); } catch(e){ console.warn(e); }
      if (!reqCurrent()){ box.style.display = "none"; return; }
      box.innerHTML = rs.map((r,i)=>`<div data-i="${i}">${esc(r.name)}</div>`).join("") || `<div>找不到</div>`;
      box.style.display = "block";
      box.querySelectorAll("div[data-i]").forEach(d => d.onclick = async () => {
        const r = rs[+d.dataset.i]; box.style.display="none"; input.value="";
        if (!reqCurrent()) return;   // suggestions belonged to a superseded request
        try {
          const place = r.prediction.toPlace();
          await place.fetchFields({ fields:["displayName","location","formattedAddress"] });
          sessionToken = null;                       // 選定後結束 session(計費最佳化)
          const lat = place.location.lat(), lng = place.location.lng();
          const admin = await reverseGeocode(lat, lng);
          if (!reqCurrent()) return;   // switched Space mid-selection (§5)
          openSeed({ name:place.displayName||r.name, lat, lng, admin, source:"google", extId:r.prediction.placeId });
        } catch(e){ alert("取得地點失敗:"+e.message); }
      });
    }, 350);
  };
  document.addEventListener("click", e => { if(!e.target.closest(".search")) box.style.display="none"; });
}

async function searchPlace(q){
  if (!sessionToken) sessionToken = new AutocompleteSessionToken();
  const { suggestions } = await AutocompleteSuggestion.fetchAutocompleteSuggestions({
    input:q, sessionToken, language:"zh-TW"
    // 想只限台日:includedRegionCodes:["tw","jp"]
  });
  return (suggestions||[]).filter(s=>s.placePrediction).map(s => ({
    name: s.placePrediction.text?.text || s.placePrediction.mainText?.text || "",
    prediction: s.placePrediction
  }));
}
function reverseGeocode(lat,lng){
  return new Promise(res => {
    geocoder.geocode({ location:{lat,lng}, language:"zh-TW" }, (r,status) => {
      if (status==="OK" && r[0]) res(parseAdmin(r[0].address_components));
      else res({});
    });
  });
}
function parseAdmin(comps){
  const get = t => (comps.find(c=>c.types.includes(t))||{}).long_name || "";
  return {
    country: get("country"),
    county:  get("administrative_area_level_1"),
    city:    get("administrative_area_level_2") || get("locality") || get("sublocality") || ""
  };
}

/* ============================================================
   6) 新增 / 編輯地點
   ============================================================ */
async function nearbyPicker(lat, lng){
  if (!runtimeReady()) return;
  const pickerSession = runtimeSession;
  let results = [];
  try {
    if (PlaceClass && PlaceClass.searchNearby){
      const resp = await PlaceClass.searchNearby({
        locationRestriction: { center: { lat, lng }, radius: 160 },
        fields: ["displayName","location","id","formattedAddress"],
        maxResultCount: 8, language: "zh-TW"
      });
      results = resp.places || [];
    }
  } catch(e){ console.warn("nearby search failed", e); }
  if (pickerSession !== runtimeSession) return;
  const rows = results.map((pl,i)=>`<div class="nb" data-i="${i}">${esc(pl.displayName||"(未命名地點)")}</div>`).join("");
  modal(`
    <h2 style="margin-bottom:6px">附近地標</h2>
    <div style="font-size:12px;color:var(--ink-soft);margin-bottom:10px">選一個附近的地標,或用你點的位置自訂。</div>
    <div id="nb_list">${rows || `<div style="font-size:13px;color:var(--ink-soft)">附近沒有找到地標</div>`}</div>
    <div class="row" style="margin-top:10px"><button class="btn grey" id="nb_custom">用這個位置自訂</button></div>
  `);
  document.querySelectorAll("#nb_list .nb").forEach(d => d.onclick = async () => {
    const pl = results[+d.dataset.i]; closeModal();
    const la = pl.location.lat(), ln = pl.location.lng();
    const admin = await reverseGeocode(la, ln);
    if (pickerSession !== runtimeSession) return;
    openSeed({ name: pl.displayName||"", lat: la, lng: ln, admin, source:"google", extId: pl.id });
  });
  document.getElementById("nb_custom").onclick = async () => {
    closeModal();
    const admin = await reverseGeocode(lat, lng);
    if (pickerSession !== runtimeSession) return;
    openEditor(null, { name:"", lat, lng, admin, source:"map" });
  };
}

function addDays(date,n){
  if(!date) return ""; const d=new Date(date+"T00:00:00"); d.setDate(d.getDate()+n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
function openNoSpaceVisitEditor(id, seed, opts={}){
  const repo=noSpaceRepository, editorSession=runtimeSession, editorUid=user.uid;
  if (!repo || !runtimeSessionIsCurrent(editorSession,editorUid)) return;
  const runtimePlace=id?places[id]:null;
  const existingVisits=runtimePlace?placeVisits(runtimePlace):[];
  const focusIndex=Number.isFinite(Number(opts.focusVisitIndex))?Number(opts.focusVisitIndex):0;
  const existingVisit=!opts.addVisit&&id?existingVisits[focusIndex]||existingVisits[0]||null:null;
  const rawVisit=existingVisit?existingVisit._shared || noSpaceState.visits[existingVisit.id] || existingVisit:null;
  const creating=!rawVisit;
  let selected=retainCurrentParticipant(rawVisit?.participantUserIds || [editorUid],editorUid);
  let selectedPlaceId=rawVisit?.placeId || id || "";
  const initialPlace=selectedPlaceId?noSpaceState.places[selectedPlaceId] || runtimePlace:seed || {};
  const initialTripId=rawVisit?.tripId || specificTripId() || "";
  if (creating && initialTripId && trips[initialTripId]) selected=visitParticipantsFromTrip(trips[initialTripId],editorUid);
  const allContributions=rawVisit?noSpaceState.contributions[rawVisit.id]||{}:{};
  const scopedContributions=()=>participantContributions(allContributions,selected);
  const mine=scopedContributions()[editorUid]||{};
  // 造訪深度 is a shared Visit fact and decides whether the Visit is a stay.
  const initialLevel=LEVEL_ORDER.includes(rawVisit?.level) ? rawVisit.level : (rawVisit?.kind==="stay" ? "住宿" : "旅遊");
  const legacyImport=selectedPlaceId?noSpaceState.legacyImports[selectedPlaceId]||null:null;
  const live=()=>runtimeSessionIsCurrent(editorSession,editorUid)&&repo===noSpaceRepository;
  const allowNewPlace=creating&&!selectedPlaceId;
  const memberList=orderedActiveMembers();
  const selectablePlaces={...noSpaceState.places};
  if(selectedPlaceId&&!selectablePlaces[selectedPlaceId]) selectablePlaces[selectedPlaceId]={id:selectedPlaceId,name:runtimePlace?.name||"Unknown place"};
  const placeOptions=Object.values(selectablePlaces).sort((a,b)=>(a.name||"").localeCompare(b.name||"")).map(place=>
    `<option value="${esc(place.id)}" ${place.id===selectedPlaceId?'selected':''}>${esc(place.name||"未命名地點")}</option>`
  ).join("");
  const tripOptions=Object.values(trips).sort((a,b)=>(a.name||"").localeCompare(b.name||"")).map(trip=>
    `<option value="${esc(trip.id)}" ${trip.id===initialTripId?'selected':''}>${esc((trip.emoji?trip.emoji+" ":"")+(trip.name||""))}</option>`
  ).join("");
  const missingTripOption=rawVisit?.tripId&&!trips[rawVisit.tripId]
    ?`<option value="${esc(rawVisit.tripId)}" selected>已刪除旅程</option>`:"";
  const contributionRows=()=>{
    const others=Object.entries(scopedContributions()).filter(([uid])=>uid!==editorUid);
    return others.length?others.map(([uid,value])=>`
      <div class="card compact" style="margin-bottom:8px">
        <div class="cname">${esc(participantName(uid))}${value.rating?` · ★ ${value.rating}`:" · 尚未評分"}</div>
        <div class="admin">${esc(value.memory||"尚未留下回憶")}</div>
      </div>`).join(""):`<div class="admin">同行者尚未留下評分或回憶。</div>`;
  };
  const averageText=()=>{
    const average=averageSubmittedRating(Object.values(scopedContributions()));
    return `平均評分：${average==null?"尚未評分":`★ ${Math.round(average*100)/100}`}（只計已提交評分）`;
  };
  // 「做什麼」下拉：使用者勾選的預設 + 這筆造訪原本的預設值，「其他」永遠在最後，
  // 選「其他」時打開自訂敘述框。非預設字串一律歸「其他」並帶入敘述框。
  const currentCategory=rawVisit?.category||"";
  const categoryIsPreset=CATEGORY_PRESET_NAMES.includes(currentCategory)&&currentCategory!=="其他";
  const categoryOptionNames=[...new Set([
    ...CATEGORY_PRESET_NAMES.filter(name=>categoryPicks.includes(name)&&name!=="其他"),
    ...(categoryIsPreset?[currentCategory]:[])
  ])];
  const categorySelected=categoryIsPreset?currentCategory:(currentCategory?"其他":"");
  const categoryCustomText=(!categoryIsPreset&&currentCategory&&currentCategory!=="其他")?currentCategory:"";
  const legacyImportHtml=legacyImport?`
    <div class="editor-section legacy-record">
      <div class="editor-section-head"><div><div class="editor-section-title">舊版共同記錄</div><div class="editor-section-note">從舊版保留下來，僅供閱讀。</div></div></div>
      ${legacyImport.rating!=null?`<div class="legacy-record-row"><span>舊版評分</span><strong>★ ${esc(String(legacyImport.rating))}</strong></div>`:""}
      ${legacyImport.review?`<div class="legacy-record-memory"><span>舊版回憶</span><p>${esc(legacyImport.review)}</p></div>`:""}
      ${legacyImport.level?`<div class="legacy-record-row"><span>舊版足跡深度</span><strong>${esc(legacyImport.level)}</strong></div>`:""}
    </div>`:"";

  modal(`
    <h2 style="margin-bottom:3px">${creating?"新增造訪":"編輯造訪"}</h2>
    <div class="admin" style="margin-bottom:12px">同一天的足跡，可以在清單調整成你自己的順序。</div>
    <div class="editor-section">
      <div class="editor-section-head"><div><div class="editor-section-title">共同經歷</div><div class="editor-section-note">一起留下這次造訪的基本記錄。</div></div></div>
      ${allowNewPlace
        ? `<div class="field"><label>地點名稱</label><input id="ns_place_name" value="${esc(initialPlace?.name||seed?.name||"")}" placeholder="地點名稱"></div>`
        : `<div class="field"><label>地點</label><select id="ns_place">${placeOptions}</select></div>`}
      <div class="row">
        <div class="field" style="flex:1"><label>日期</label><input type="date" id="ns_date" value="${rawVisit?.date||defaultDateForNewVisit()}"></div>
        <div class="field" style="flex:1"><label>做什麼</label>
          <select id="ns_category">
            <option value="" ${categorySelected===""?'selected':''}>未指定</option>
            ${categoryOptionNames.map(name=>`<option value="${esc(name)}" ${name===categorySelected?'selected':''}>${esc(name)}</option>`).join("")}
            <option value="其他" ${categorySelected==="其他"?'selected':''}>其他</option>
          </select>
          <input id="ns_category_custom" placeholder="描述這個地點的活動" value="${esc(categoryCustomText)}" style="display:${categorySelected==="其他"?'block':'none'};margin-top:6px"></div>
      </div>
      <div class="field"><label>同行者</label>
        <div class="pick partpick" id="ns_participants">${memberList.map(member=>`<span class="chip ${selected.includes(member.userId)?'on':''}" data-uid="${esc(member.userId)}" role="button" tabindex="0" ${member.userId===editorUid?'aria-disabled="true"':''}>${esc(participantName(member.userId))}</span>`).join("")}</div>
        <div id="ns_participants_hist" class="admin" style="margin-top:6px"></div>
      </div>
      <div class="field"><label>旅程</label><select id="ns_trip"><option value="">無</option>${missingTripOption}${tripOptions}</select></div>
      <div class="row">
        <div class="field" style="flex:1"><label>造訪深度</label><select id="ns_level">${LEVEL_ORDER.map(level=>`<option value="${esc(level)}" ${level===initialLevel?'selected':''}>${esc(level)}</option>`).join("")}</select></div>
        <div class="field" id="ns_end_wrap" style="flex:1"><label>退房日期</label><input type="date" id="ns_end_date" value="${rawVisit?.endDate||addDays(rawVisit?.date||defaultDateForNewVisit(),1)}"></div>
      </div>
    </div>
    <div class="editor-section">
      <div class="editor-section-head"><div><div class="editor-section-title">我的記錄</div><div class="editor-section-note">這些內容只屬於你。</div></div></div>
      <div class="field"><label>評分</label><div class="row" style="align-items:center"><input type="range" id="ns_rating" min="0" max="5" step="0.5" value="${mine.rating||0}" style="flex:1"><span id="ns_rating_value" style="width:70px;text-align:right">${mine.rating?`★ ${mine.rating}`:"尚未評分"}</span></div></div>
      <div class="field"><label>回憶</label><textarea id="ns_memory" style="width:100%;min-height:72px" placeholder="寫下這次造訪的回憶">${esc(mine.memory||"")}</textarea></div>
    </div>
    ${rawVisit?`<div class="editor-section"><div class="editor-section-head"><div class="editor-section-title">同行者的記錄</div></div><div id="ns_other_contributions">${contributionRows()}</div><div class="admin contribution-average" id="ns_average">${averageText()}</div></div>`:""}
    ${legacyImportHtml}
    <div class="row"><button class="btn" id="ns_save">完成</button>${rawVisit&&canDeleteVisit(editorUid,rawVisit)?`<button class="danger" id="ns_delete">刪除這次造訪</button>`:""}</div>
  `);
  const g=id=>document.getElementById(id);
  const endWrap=g("ns_end_wrap");
  const refreshStay=()=>{ endWrap.style.display=g("ns_level").value==="住宿"?"block":"none"; };
  refreshStay();
  g("ns_level").onchange=refreshStay;
  const categoryCustom=g("ns_category_custom");
  g("ns_category").onchange=()=>{
    const isOther=g("ns_category").value==="其他";
    categoryCustom.style.display=isOther?"block":"none";
    if(isOther) categoryCustom.focus();
  };
  g("ns_rating").oninput=()=>{ const rating=Number(g("ns_rating").value); g("ns_rating_value").textContent=rating?`★ ${rating}`:"尚未評分"; };
  const refreshContributionVisibility=()=>{
    if(g("ns_average")) g("ns_average").textContent=averageText();
    if(g("ns_other_contributions")) g("ns_other_contributions").innerHTML=contributionRows();
  };
  const placeSelect=g("ns_place");
  if(placeSelect) placeSelect.onchange=()=>{ selectedPlaceId=placeSelect.value; };
  // Participants already on this Visit who are not selectable members
  // (former friends, or people added before an unfriend). Kept on save; the
  // creator can prune one, one-way — it cannot be re-added here.
  const memberIdSet=new Set(memberList.map(m=>m.userId));
  const renderHistoricalParticipants=()=>{
    const box=g("ns_participants_hist"); if(!box) return;
    const hist=selected.filter(id=>id!==editorUid && !memberIdSet.has(id));
    box.style.display=hist.length?"block":"none";
    box.innerHTML=hist.length
      ?`也在這次造訪：${hist.map(id=>`<span class="chip" style="background:none;border:1px solid var(--line)">${esc(participantName(id))} <span data-histdel="${esc(id)}" role="button" tabindex="0" style="cursor:pointer;color:#b25b6b">✕</span></span>`).join(" ")}`
      :"";
    box.querySelectorAll("[data-histdel]").forEach(x=>{
      const drop=()=>{ selected=selected.filter(item=>item!==x.dataset.histdel); renderHistoricalParticipants(); refreshContributionVisibility(); };
      x.onclick=drop;
      x.onkeydown=event=>{ if(event.key==="Enter"||event.key===" "){ event.preventDefault(); drop(); } };
    });
  };
  g("ns_trip").onchange=()=>{
    if(!creating||!g("ns_trip").value||!trips[g("ns_trip").value]) return;
    selected=visitParticipantsFromTrip(trips[g("ns_trip").value],editorUid);
    g("ns_participants").querySelectorAll("[data-uid]").forEach(chip=>chip.classList.toggle("on",selected.includes(chip.dataset.uid)));
    renderHistoricalParticipants();
    refreshContributionVisibility();
  };
  g("ns_participants").querySelectorAll("[data-uid]").forEach(chip=>{
    const toggle=()=>{
      const uid=chip.dataset.uid;
      if(uid===editorUid) return;
      selected=selected.includes(uid)?selected.filter(item=>item!==uid):[...selected,uid];
      selected=retainCurrentParticipant(selected,editorUid);
      chip.classList.toggle("on",selected.includes(uid));
      refreshContributionVisibility();
    };
    chip.onclick=toggle;
    chip.onkeydown=event=>{ if(event.key==="Enter"||event.key===" "){ event.preventDefault(); toggle(); } };
  });
  renderHistoricalParticipants();
  g("ns_save").onclick=async()=>{
    if(!live()) return;
    const nameInput=g("ns_place_name");
    const name=nameInput?nameInput.value.trim():"";
    const date=g("ns_date").value;
    if(!date||(!selectedPlaceId&&!name)){ alert("請填寫地點名稱與日期。"); return; }
    const level=g("ns_level").value;
    const stay=level==="住宿";
    if(stay && !(g("ns_end_date").value>date)){ alert("住宿需要一個晚於造訪日的退房日期。"); return; }
    const targetPlace=selectedPlaceId?noSpaceState.places[selectedPlaceId]:seed||initialPlace;
    const shared={
      placeId:selectedPlaceId,
      date,
      category:g("ns_category").value==="其他"?(g("ns_category_custom").value.trim()||"其他"):g("ns_category").value,
      participantUserIds:retainCurrentParticipant(selected,editorUid),
      tripId:g("ns_trip").value||null,
      level,
      kind:stay?"stay":"visit",
      endDate:stay?g("ns_end_date").value:"",
      createdBy:rawVisit?.createdBy||editorUid
    };
    const personal={
      rating:Number(g("ns_rating").value)>0?Number(g("ns_rating").value):null,
      memory:g("ns_memory").value
    };
    let savedVisitId=rawVisit?.id||"";
    try{
      if(rawVisit){
        await repo.updateVisit(rawVisit.id,shared);
      }else if(selectedPlaceId){
        const ref=await repo.createVisit(shared); savedVisitId=ref.id;
      }else{
        const created=await repo.createPlaceAndVisit({...(targetPlace||{}),name},shared);
        savedVisitId=created.visitId; shared.placeId=created.placeId;
      }
      if(!live()) return;
      await repo.setContribution(savedVisitId,personal);
      if(creating){
        const visible=[...Object.values(noSpaceState.visits),{...shared,id:savedVisitId}];
        const order=normalizeDayOrder(date,visible,noSpaceState.dayOrders[date]?.visitIds||[]);
        await repo.setDayOrder(date,order);
      }
      if(live()) closeModal();
    }catch(error){ if(live()) alert(`無法儲存造訪：${error.message}`); }
  };
  const deleteButton=g("ns_delete");
  if(deleteButton) deleteButton.onclick=async()=>{
    if(!live()||!canDeleteVisit(editorUid,rawVisit)) return;
    try{
      await repo.deleteVisit(rawVisit.id);
      if(live()) closeModal();
    }catch(error){if(live())alert(`無法完整刪除造訪：${error.message}`);}
  };
}

function openEditor(id, seed, opts={}){
  if (!runtimeReady()){ showLoadingState(); return; }
  openNoSpaceVisitEditor(id,seed,opts);
}

/* ============================================================
   7) Trips
   ============================================================ */
function renderTrips(el){
  const list = Object.values(trips).sort((a,b)=>(b.startDate||"0000-00-00").localeCompare(a.startDate||"0000-00-00"));
  const placeCount = id => Object.values(places).filter(p => placeTrips(p).includes(id)).length;
  const visitCount = id => Object.values(places).reduce((n,p)=>n+placeVisits(p).filter(v=>v.tripId===id).length,0);
  el.innerHTML = `<button class="btn" id="newtrip" style="width:100%;margin-bottom:12px">＋ 新旅程</button>` +
    (list.length ? list.map(t=>`
      <div class="card triprow" id="t_${t.id}">
        <span style="font-size:20px;width:26px;text-align:center">${t.emoji||"🧭"}</span>
        <div style="flex:1">
          <h3>${esc(t.name)}</h3>
          <div class="admin">${t.startDate||""}${t.endDate?" → "+t.endDate:""} · ${visitCount(t.id)} 次造訪 / ${placeCount(t.id)} 個地點</div>
        </div>
        <span style="width:12px;height:12px;border-radius:3px;background:${t.color||'#3f7d78'}"></span>
        <button class="btn mini grey" data-edit="${t.id}">編輯</button>
        ${canDeleteTrip(user?.uid,t) ? `<button class="delx" data-del="${t.id}" title="刪除">✕</button>` : ""}
      </div>`).join("") : `<div class="empty">還沒有旅程。建立一個,再到地點的「哪趟旅程」把地點歸進來。</div>`);
  document.getElementById("newtrip").onclick = () => editTrip();
  list.forEach(t => document.getElementById("t_"+t.id).onclick = ev => {
    if (ev.target.dataset.edit || ev.target.dataset.del) return;
    filter.tripId = t.id; tab = "visited";
    dateScope = "all"; filter.from=""; filter.to="";   // 從旅程卡進入時預設看完整旅程
    document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.t==="visited"));
    refreshFilterUI(); applyFilter();
  });
  el.querySelectorAll("[data-edit]").forEach(b => b.onclick = () => editTrip(b.dataset.edit));
  el.querySelectorAll("[data-del]").forEach(b => b.onclick = ev => {
    ev.stopPropagation();
    if (!runtimeReady()) return;
    const trip=noSpaceState.trips[b.dataset.del];
    if (trip&&canDeleteTrip(user.uid,trip)) noSpaceRepository.deleteTrip(trip.id).catch(error=>alert(`無法刪除旅程：${error.message}`));
  });
}

function openNoSpaceTripEditor(id,onDone){
  const repo=noSpaceRepository, session=runtimeSession, uid=user.uid;
  if(!repo||!runtimeSessionIsCurrent(session,uid)) return;
  const trip=id?noSpaceState.trips[id]||trips[id]:null;
  let selected=retainCurrentParticipant(trip?.participantUserIds||[uid],uid);
  const live=()=>repo===noSpaceRepository&&runtimeSessionIsCurrent(session,uid);
  modal(`
    <h2 style="margin-bottom:3px">${trip?"編輯旅程":"新增旅程"}</h2>
    <div class="admin" style="margin-bottom:12px">新增這趟旅程的造訪時，會自動帶入這些同行者。既有造訪不會改變。</div>
    <div class="field"><label>圖示 + 名稱</label>
      <div class="row" style="gap:8px;position:relative;align-items:stretch">
        <button type="button" id="nst_emoji_btn" style="flex:0 0 52px;font-size:22px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer">${esc(trip?.emoji||"")||"➕"}</button>
        <input id="nst_name" value="${esc(trip?.name||"")}" placeholder="例如：2026 夏日旅行" style="flex:1">
        <input type="hidden" id="nst_emoji" value="${esc(trip?.emoji||"")}">
        <div id="nst_emoji_pop" style="display:none;position:absolute;top:52px;left:0;z-index:30;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:8px;grid-template-columns:repeat(7,1fr);gap:2px;width:264px;max-height:220px;overflow:auto">
          <button type="button" class="nst-emojibtn" data-e="" style="font-size:14px;border:none;background:none;cursor:pointer;padding:4px">無</button>
          ${EMOJIS.map(e=>`<button type="button" class="nst-emojibtn" data-e="${e}" style="font-size:20px;border:none;background:none;cursor:pointer;padding:4px">${e}</button>`).join("")}
        </div>
      </div>
    </div>
    <div class="row">
      <div class="field" style="flex:1"><label>開始日期</label><input type="date" id="nst_start" value="${trip?.startDate||""}"></div>
      <div class="field" style="flex:1"><label>結束日期</label><input type="date" id="nst_end" value="${trip?.endDate||""}"></div>
    </div>
    <div class="field"><label>旅程顏色</label><input type="color" id="nst_color" value="${esc(trip?.color||'#3f7d78')}" style="width:100%;height:42px;padding:4px"></div>
    <div class="field"><label>同行者</label><div class="pick partpick" id="nst_participants">${orderedActiveMembers().map(member=>`<span class="chip ${selected.includes(member.userId)?'on':''}" data-uid="${esc(member.userId)}" role="button" tabindex="0" ${member.userId===uid?'aria-disabled="true"':''}>${esc(participantName(member.userId))}</span>`).join("")}</div></div>
    <div class="row"><button class="btn" id="nst_save">完成</button>${trip&&canDeleteTrip(uid,trip)?`<button class="danger" id="nst_delete">刪除旅程</button>`:""}</div>
  `);
  const g=id=>document.getElementById(id);
  const emojiBtn=g("nst_emoji_btn"), emojiPop=g("nst_emoji_pop");
  emojiBtn.onclick=()=>{ emojiPop.style.display=emojiPop.style.display==="none"?"grid":"none"; };
  emojiPop.querySelectorAll(".nst-emojibtn").forEach(btn=>btn.onclick=()=>{
    g("nst_emoji").value=btn.dataset.e;
    emojiBtn.textContent=btn.dataset.e||"➕";
    emojiPop.style.display="none";
  });
  g("nst_participants").querySelectorAll("[data-uid]").forEach(chip=>{
    const toggle=()=>{
      const participantUid=chip.dataset.uid;
      if(participantUid===uid) return;
      selected=selected.includes(participantUid)?selected.filter(item=>item!==participantUid):[...selected,participantUid];
      selected=retainCurrentParticipant(selected,uid);
      chip.classList.toggle("on",selected.includes(participantUid));
    };
    chip.onclick=toggle;
    chip.onkeydown=event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();toggle();}};
  });
  const collect=()=>({
    name:g("nst_name").value.trim(), emoji:g("nst_emoji").value.trim(),
    startDate:g("nst_start").value, endDate:g("nst_end").value,
    color:g("nst_color").value,
    participantUserIds:retainCurrentParticipant(selected,uid), createdBy:trip?.createdBy||uid
  });
  g("nst_save").onclick=async()=>{
    if(!live()) return;
    const data=collect(); if(!data.name){alert("請填寫旅程名稱。");return;}
    try{
      let savedId=id;
      if(trip) await repo.updateTrip(trip.id,data);
      else { const ref=await repo.createTrip(data); savedId=ref.id; }
      if(live()&&onDone) onDone({id:savedId,...data});
      if(live()) closeModal();
    }catch(error){if(live())alert(`無法儲存旅程：${error.message}`);}
  };
  const del=g("nst_delete");
  if(del) del.onclick=async()=>{
    if(!live()||!canDeleteTrip(uid,trip)) return;
    try{await repo.deleteTrip(trip.id);if(live())closeModal();}
    catch(error){if(live())alert(`無法刪除旅程：${error.message}`);}
  };
}

function editTrip(id, onDone){
  if (!runtimeReady()){ showLoadingState(); return; }
  openNoSpaceTripEditor(id,onDone);
}

/* ============================================================
   Helpers
   ============================================================ */
function modal(html){
  const bg = document.createElement("div");
  bg.className="modal-bg"; bg.innerHTML=`<div class="modal">${html}</div>`;
  bg.onclick = e => { if(e.target===bg) closeModal(); };
  document.body.appendChild(bg);
}
function closeModal(){ const ms=document.querySelectorAll(".modal-bg"); if(ms.length) ms[ms.length-1].remove(); }
function me(){ return user.displayName || user.email || "我"; }
function esc(s){ return (s||"").replace(/[&<>"]/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c])); }

/* ---------- 進入點(放最後,確保上面的 let 都宣告完) ---------- */
try {
  runtimeConfig = resolveRuntimeConfig();
  if (!runtimeConfig.firebase.projectId || !runtimeConfig.google.apiKey) renderSetup();
  else boot();
} catch(e){
  showRuntimeFatal(`Firebase environment safety check failed.\n${e.message}`, true);
}
