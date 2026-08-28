import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithCustomToken, signOut, onAuthStateChanged, connectAuthEmulator }
  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, collection, collectionGroup, doc, addDoc, updateDoc, deleteDoc, setDoc,
         getDoc, onSnapshot, query, where, orderBy, arrayUnion, serverTimestamp, runTransaction, connectFirestoreEmulator }
  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { resolveRuntimeConfig } from "./config.js";
import {
  createMemberDirectory,
  resolveSpaceMembershipFoundation
} from "./space-membership.js";
import {
  PERSONAL_SPACE_NAME,
  chooseInitialActiveSpace,
  createSpaceSession,
  discoveryDiagnostics,
  isCurrentSpaceSession,
  nextSpaceSession,
  normalizeDiscoveredSpace,
  orderSpacesForSwitcher,
  personalSpaceId,
  personalSpaceResolution,
  readActiveSpacePreference,
  resolveSpaceMembershipPath,
  spaceDisplayName,
  spaceTypeLabel,
  validateActiveSpacePreference,
  writeActiveSpacePreference
} from "./spaces.js";
import {
  classifyParticipants,
  deriveLegacyWhoMode,
  detectParticipantMismatch,
  formatParticipantSummary,
  isUsableUid,
  nextVisitParticipantFields,
  orderParticipantSelection,
  participantColorIndex,
  resolvePlaceCompatParticipants,
  resolveVisitParticipants,
  sanitizeParticipantsForNewSelection
} from "./participants.js";
import {
  MAP_SURFACE_Z_INDEX,
  isVisitReorderAvailable,
  layoutViewState,
  ordinaryOccurrences,
  placeSharedFields,
  reorderWithinSlots,
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
const LEVELS_UI    = ["居住","住宿","旅遊","接地","經過","無"];
const EMOJIS = ["🧭","✈️","🚗","🚕","🚌","🚆","🚄","🚢","⛵","🚲","🏍️","🛵",
  "🏔️","⛰️","🌋","🏕️","🏖️","🏝️","🏜️","🏞️","🌅","🌄","🌊","🗻","🗾",
  "⛩️","🏯","🏰","🗼","🎡","🎢","🎑","🌸","🍁","🌺","🌴","🌲",
  "🍜","🍣","🍶","🍵","☕","🍺","🍷","🍦","🍧","🧋","🍡","🍢",
  "🎏","🎿","🏂","🏄","🚠","♨️","🦌","🐧","🐟","🦭","🐢","🦋",
  "📷","🎒","🗺️","💕","❤️","🌈","⭐","🎉","🏡","🌇"];

function renderSetup(){
  document.getElementById("app").innerHTML = `
  <div class="center"><div class="setup">
    <h1>設定(約 10 分鐘)</h1>

    <h3>A. Google Maps Platform</h3>
    <ol>
      <li>到 <code>console.cloud.google.com</code> 建專案,<b>啟用帳單</b>(需綁卡,但你們的量會落在免費額度,實際 $0)</li>
      <li>APIs &amp; Services → 啟用這三個:<br>
        <b>Maps JavaScript API</b>、<b>Places API (New)</b>、<b>Geocoding API</b></li>
      <li>Credentials → 建立 <b>API key</b>,填入下方 <code>CONFIG.google.apiKey</code></li>
      <li>金鑰是公開在前端的,務必做 <b>Application restrictions → HTTP referrers</b>,只允許你的 Pages 網址
        (例:<code>https://你的帳號.github.io/*</code>),並在 API restrictions 只勾上面三個 API</li>
      <li>(選)Map management → 建 Map ID 填入 <code>CONFIG.google.mapId</code>;先用 <code>DEMO_MAP_ID</code> 也行</li>
    </ol>

    <h3>B. Firebase</h3>
    <ol>
      <li>到 <code>console.firebase.google.com</code> 建專案(可沿用同一個 Google Cloud 專案)</li>
      <li>Authentication → 啟用 <b>Google</b> 登入</li>
      <li>Firestore Database → 建立(production mode)</li>
      <li>專案設定 → Web app → 把 <code>firebaseConfig</code> 貼進 <code>CONFIG.firebase</code></li>
      <li>Firestore → Rules 貼上(兩人登入後在 Authentication 分頁看 UID,填進去):
        <pre>rules_version = '2';
service cloud.firestore {
  match /databases/{db}/documents {
    match /spaces/{spaceId}/{doc=**} {
      allow read, write: if request.auth != null
        &amp;&amp; request.auth.uid in ['UID_A','UID_B'];
    }
  }
}</pre>
      </li>
    </ol>

    <h3>C. 部署</h3>
    <ol>
      <li>把本檔 push 到 GitHub → 開 GitHub Pages。兩人用同一網址、同一 <code>spaceId</code> 即共享。</li>
    </ol>
  </div></div>`;
}

/* ============================================================
   2) 啟動
   ============================================================ */
let db, auth, user;
let currentSpaceId = "";
let currentSpace = null, currentMembership = null, spaceMembers = [];
let removedSpaceMembers = [], membershipSource = "pending", ownershipValidation = null;
let memberDirectory = createMemberDirectory([]);
// Phase 3 (LOCAL-only, behind ?firebaseEnv=local&multiSpace=1): Personal Space +
// Space switcher. `spaceSession` is a fresh object on every switch so queued
// callbacks from a prior Space become inert (§16).
let spaceSession = createSpaceSession("");
let spaceSwitchInFlight = false;
const phase3 = {
  active: false,
  started: false,
  discoveryUnsub: null,
  discoveryGen: 0,        // bumped when a new discovery listener is attached / torn down
  discoveryReq: 0,        // bumped per snapshot; only the newest request may apply (§1)
  discoveryUid: "",       // the authenticated UID the discovery listener belongs to
  discoveredSpaces: [],
  initialSelectionPending: false,
  provisioningInFlight: false,
  personalSpaceId: "",
  switcherOpen: false
};
let searchReqSeq = 0;     // Google autocomplete request sequence (§5)
function isMultiSpace(){ return isLocalTest() && runtimeConfig?.multiSpace === true; }
let map, geocoder, MapCtor, AdvMarker, Pin, AutocompleteSuggestion, AutocompleteSessionToken, PlaceClass;
let markers = [], tripLine = null, sessionToken = null;
let places = {}, trips = {}, tab = "visited";
let adminLevel = "off", adminLayer = null, adminContextLayer = null, geoCache = {};
let showPins = true, choroAlpha = 0.7, choroMetric = "level", numberPins = false;
let catColors = {}, markerMode = "cat", lastMarkerClick = 0;
let nicknames = {}, levelColors = { ...LEVEL_COLORS }, addMode = false;
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
function catColor(c){ return catColors[c] || CAT_PALETTE[Math.max(0, spaceCats.indexOf(c)) % CAT_PALETTE.length]; }
function textOn(hex){
  const h=(hex||"#888").replace("#",""); if(h.length<6) return "#152230";
  const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return (0.299*r+0.587*g+0.114*b) > 150 ? "#152230" : "#ffffff";
}
let members = {};   // uid -> 顯示名稱(兩人)
let spaceFoundationReads = {
  spaceReady:false,
  membersReady:false,
  metaReady:false,
  formalReadFailed:false,
  spaceDocument:null,
  formalMemberships:[]
};
const currentSpaceUnsubscribes = new Map();
let lastLocalMembershipDiagnostic = "";
function memberById(uid){ return memberDirectory.memberById(uid); }
function memberDisplayName(uid){ return memberDirectory.memberDisplayName(uid); }
function activeSpaceMembers(){ return memberDirectory.activeSpaceMembers(); }
function historicalSpaceMember(uid){ return memberDirectory.historicalSpaceMember(uid); }
let filter = { who:"all", tripId:"all", cats:new Set(), from:"", to:"", regions:[] };
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
const NAMEKEY = { county:"COUNTYNAME", town:"TOWNNAME", village:"VILLNAME" };
const REGION_GEO = {
  countyCode:{ url:"geo/county.json", codeProperty:"COUNTYCODE" },
  townCode:{ url:"geo/town.json", codeProperty:"TOWNCODE" }
};
// Phase 2: participants are arbitrary Space Members. `who` (Visit + Place)
// and Place `whoMode` remain as legacy serialization / compatibility fallbacks.
// The legacy universe is `meta/config.members`; the legacy `whoMode` anchor is
// always a record's own `createdBy`, never the current viewer.
function legacyParticipantContext(){
  return { legacyMemberIds: Object.keys(members || {}) };
}
function activeMemberIds(){ return activeSpaceMembers().map(m => m.userId); }
function isActiveMember(uid){ return !!uid && activeMemberIds().includes(uid); }
// Active Members ordered for display: the authenticated User first, then the
// rest by display name (Phase 2 §9).
function orderedActiveMembers(){
  const selfUid = user?.uid || "";
  return activeSpaceMembers().slice().sort((a,b) => {
    if (a.userId === selfUid) return -1;
    if (b.userId === selfUid) return 1;
    return String(a.displayName||"").localeCompare(String(b.displayName||""));
  });
}
function orderedActiveMemberIds(){ return orderedActiveMembers().map(m => m.userId); }
// Human name for a participant UID. Never exposes a raw UID.
//  - authenticated User      -> "真實名稱（我）" (or "我" when no name is known)
//  - active Member           -> display name
//  - known removed Member    -> "真實名稱（已離開）"
//  - unknown historical UID  -> "未知成員"
function participantName(uid){
  const member = memberById(uid);
  const isSelf = !!uid && !!user && uid === user.uid;
  let name = "";
  if (member && member.displayName && member.displayName !== "Member") name = member.displayName;
  else if (isSelf) name = nicknames[uid] || members[uid] || "";
  if (!name){
    if (isSelf) return "我";
    return member ? "成員" : "未知成員";
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
// New-Visit / new-record default: the authenticated User, but ONLY when that
// User is an active valid Member. Fail closed otherwise (Phase 2 §3).
function defaultParticipants(){
  const uid = user?.uid || "";
  return isActiveMember(uid) ? [uid] : [];
}
// Historical (removed / unknown) participant UIDs referenced by currently
// loaded Place / Visit data. Recomputed on data or Membership change so the
// filter and legend can resolve them without listing every removed Membership.
let referencedHistoricalIds = [];
function recomputeReferencedParticipants(){
  const activeSet = new Set(activeMemberIds());
  const seen = new Set();
  const add = uid => { if (isUsableUid(uid) && !activeSet.has(uid)) seen.add(uid); };
  for (const place of Object.values(places)){
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
function newVisitId(){
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch(e){}
  return `v_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
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
function latestVisit(p){
  return placeVisits(p).filter(v=>v.date).slice().sort((a,b)=>{
    const d=a.date.localeCompare(b.date); if(d) return d;
    const ao=Number.isFinite(Number(a.order))?Number(a.order):1e9;
    const bo=Number.isFinite(Number(b.order))?Number(b.order):1e9;
    return ao-bo;
  }).pop() || null;
}
function latestVisitCategory(p){ return visitCategory(p,latestVisit(p)); }
function visitKind(v){ return v?.kind === "stay" ? "stay" : "visit"; }
function stayCheckout(v){ return (visitKind(v)==="stay" && v.endDate && v.endDate>v.date) ? v.endDate : ""; }
function stayNights(v){
  if (!v?.date || !stayCheckout(v)) return 1;
  return Math.max(1, Math.round((new Date(stayCheckout(v)+"T00:00:00")-new Date(v.date+"T00:00:00"))/86400000));
}
function visitEnd(v){ return visitKind(v)==="stay" ? (stayCheckout(v)||v.date||"") : (v.date||""); }
function visitCoversDate(v,d){
  if (!v?.date || !d) return false;
  if (visitKind(v)!=="stay") return v.date===d;
  const co=stayCheckout(v); return co ? (v.date<=d && d<co) : v.date===d; // 退房日不算住宿夜
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
const placeDates = p => placeVisits(p).flatMap(v=>visitKind(v)==="stay" ? [v.date,stayCheckout(v)].filter(Boolean) : [v.date]).filter(Boolean);
const placeTrips = p => [...new Set(placeVisits(p).map(v=>v.tripId).filter(Boolean))];
const primaryDate = p => latestVisit(p)?.date || "";
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
function tripDayNo(v,tripId,all){ return tripDayNoByDate(v?.date||"",tripId,all); }
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
      // Sign-out or a change of authenticated User: invalidate the Space session
      // FIRST so any queued callback from the previous User/Space becomes inert
      // (§4), then tear down BOTH the current-Space listeners and the Phase 3
      // Space-discovery listener (§8).
      spaceSession = nextSpaceSession(spaceSession, "");
      spaceSwitchInFlight = false;
      searchReqSeq++;
      teardownPhase3();
      unsubscribeCurrentSpaceListeners();
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
  if (isMultiSpace()){
    // Phase 3: no active Space until Membership discovery + initial selection.
    spaceSession = createSpaceSession("");
    currentSpaceId = "";
  }
  document.getElementById("app").innerHTML = `
    <header>
      <span class="title">我們去過的地方</span>
      ${localBadge()}
      ${isMultiSpace() ? `<div class="spaceswitch" id="spaceSwitch">
        <button class="spaceswitchbtn" id="spaceSwitchBtn" aria-haspopup="true" aria-expanded="false"><span id="spaceSwitchName">${esc(PERSONAL_SPACE_NAME)}</span> <span class="spaceswitchcaret">▾</span></button>
        <div class="spaceswitchmenu" id="spaceSwitchMenu" role="menu"></div>
      </div>` : ""}
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
          <div class="frow">
            <select id="fl_scope" class="fmini"></select>
            <select id="fl_trip" class="fmini"></select>
            <select id="fl_who" class="fmini"></select>
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
  if (isMultiSpace()){
    wireSpaceSwitcher();
    renderSpaceSwitcher();
    const listEl = document.getElementById("list");
    if (listEl) listEl.innerHTML = `<div class="empty">尋找你的地圖…</div>`;
    startPhase3();
  } else {
    subscribe();
  }
  document.querySelectorAll("#mapctl button").forEach(b => b.onclick = () => {
    toggleMapSurface(b.dataset.l);
    renderMarkers();
  });
  document.getElementById("addBtn").onclick = e => {
    addMode = !addMode;
    e.target.classList.toggle("on", addMode);
    document.getElementById("map").style.cursor = addMode ? "crosshair" : "";
  };
  document.getElementById("locBtn").onclick = () => {
    if (!navigator.geolocation) return alert("此裝置不支援定位");
    navigator.geolocation.getCurrentPosition(
      pos => { map.setCenter({lat:pos.coords.latitude, lng:pos.coords.longitude}); map.setZoom(15); },
      err => alert("定位失敗:" + err.message),
      { enableHighAccuracy:true, timeout:8000 }
    );
  };
  document.getElementById("setBtn").onclick = openSettings;
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
    filter = { who:"all", tripId:"all", cats:new Set(), from:"", to:"", regions:[] };
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
  const settingsSpaceId = currentSpaceId;
  const settingsSession = spaceSession;
  const settingsLive = () => isCurrentSpaceSession(settingsSession, spaceSession);
  const markerOpts = [["cat","在這裡做什麼"],["level","造訪深度"],["who","誰去的"],["trip","哪趟旅程"],["rating","評分"],["dateFirst","造訪日期（最早一次）"],["dateLast","造訪日期（最後一次）"]];
  const metricOpts = [["level","造訪深度"],["count","地標數"],["first","初次造訪"],["last","最後造訪"]];
  const sw = (val,attrs) => `<input type="color" ${attrs} value="${val}" style="width:40px;height:28px;padding:0;border:1px solid var(--line);border-radius:6px">`;
  const colorItem = (label,val,attrs) => `<div class="colitem"><span>${esc(label)}</span>${sw(val,attrs)}</div>`;
  modal(`
    <h2 style="margin-bottom:14px">設定</h2>

    <div class="sethead">你的綽號</div>
    <input id="s_nick" value="${esc(nicknames[user.uid]||"")}" placeholder="例:小明" style="width:100%;padding:9px;border:1px solid var(--line);border-radius:8px">

    <div class="sethead">顯示</div>
    <div class="srow"><span>顯示地標</span><input type="checkbox" id="s_pins" ${showPins?'checked':''} style="width:18px;height:18px"></div>
    <div class="srow"><span>地標配色</span><select id="s_markermode" class="sselect">${markerOpts.map(o=>`<option value="${o[0]}">${o[1]}</option>`).join("")}</select></div>

    <div class="sethead">行政區上色</div>
    <div class="srow"><span>透明度</span><input type="range" id="s_alpha" min="10" max="90" value="${Math.round(choroAlpha*100)}" style="flex:0 0 55%"></div>
    <div class="srow"><span>上色依據</span><select id="s_metric" class="sselect">${metricOpts.map(o=>`<option value="${o[0]}">${o[1]}</option>`).join("")}</select></div>

    <div class="sethead">造訪深度顏色</div>
    <div class="colgrid">${["居住","住宿","旅遊","接地","經過"].map(l=>colorItem(l, levelColors[l], `data-lv="${l}"`)).join("")}</div>

    <div class="sethead">分類</div>
    <div id="s_cats">${spaceCats.length ? spaceCats.map(c=>`
      <div class="catrow">
        <input class="catname" data-old="${esc(c)}" value="${esc(c)}">
        ${sw(catColors[c]||"#d98b3f", `data-cat="${esc(c)}"`)}
        <button class="delx" data-catdel="${esc(c)}" title="刪除分類">✕</button>
      </div>`).join("") : `<div style="font-size:12px;color:var(--ink-soft)">還沒有分類。到地點編輯裡用「＋自訂」新增。</div>`}</div>

    <div class="sethead">旅程顏色</div>
    <div class="colgrid">${Object.values(trips).length ? Object.values(trips).map(t=>colorItem((t.emoji?t.emoji+" ":"")+t.name, t.color||"#3f7d78", `data-trip="${t.id}"`)).join("") : `<div style="font-size:12px;color:var(--ink-soft)">尚無旅程</div>`}</div>

    <div class="row" style="margin-top:8px"><button class="btn" id="s_done">完成</button></div>
  `);
  const g = x => document.getElementById(x);
  g("s_markermode").value = markerMode;
  g("s_metric").value = choroMetric;
  g("s_pins").onchange = e => { showPins = e.target.checked; renderMarkers(); };
  g("s_markermode").onchange = e => { markerMode = e.target.value; renderMarkers(); };
  g("s_alpha").oninput = e => { choroAlpha = (+e.target.value)/100; refreshMapSurfaces(); };
  g("s_metric").onchange = e => { choroMetric = e.target.value; if(adminLevel!=="off") renderAdministrativeLayer(); };
  const saveNick = () => {
    if (!settingsLive()) return;
    nicknames[user.uid] = g("s_nick").value.trim();
    setDoc(metaDocFor(settingsSpaceId), { nicknames: { [user.uid]: nicknames[user.uid] } }, { merge:true });
    refreshFilterUI();
  };
  g("s_nick").addEventListener("change", saveNick); g("s_nick").addEventListener("blur", saveNick);
  document.querySelectorAll("input[data-lv]").forEach(inp => inp.onchange = () => {
    levelColors[inp.dataset.lv] = inp.value;
    if (settingsLive()) setDoc(metaDocFor(settingsSpaceId), { levelColors: { [inp.dataset.lv]: inp.value } }, { merge:true });
    renderMarkers(); if(adminLevel!=="off") renderAdministrativeLayer();
  });
  document.querySelectorAll("input[data-cat]").forEach(inp => inp.onchange = () => {
    catColors[inp.dataset.cat] = inp.value;
    if (settingsLive()) setDoc(metaDocFor(settingsSpaceId), { catColors: { [inp.dataset.cat]: inp.value } }, { merge:true });
    renderMarkers();
  });
  document.querySelectorAll("input[data-trip]").forEach(inp => inp.onchange = () => {
    if (settingsLive()) updateDoc(tripDocFor(settingsSpaceId, inp.dataset.trip), { color: inp.value }); renderMarkers();
  });
  document.querySelectorAll(".catname").forEach(inp => inp.addEventListener("change", () => renameCat(settingsSpaceId, inp.dataset.old, inp.value)));
  document.querySelectorAll("[data-catdel]").forEach(b => b.onclick = () => deleteCat(settingsSpaceId, b.dataset.catdel));
  g("s_done").onclick = closeModal;
}
async function renameCat(spaceId, oldN, newN){
  if (spaceId !== currentSpaceId) return;   // a Space switch invalidated Settings
  newN = (newN||"").trim();
  if (!newN || newN === oldN || spaceCats.includes(newN)) return;
  const i = spaceCats.indexOf(oldN); if (i < 0) return;
  spaceCats[i] = newN;
  const cc = { ...catColors }; if (cc[oldN] !== undefined){ cc[newN] = cc[oldN]; delete cc[oldN]; }
  catColors = cc;
  await setDoc(metaDocFor(spaceId), { categories: spaceCats, catColors: cc }, { merge:true });
  if (spaceId !== currentSpaceId) return;
  for (const p of Object.values(places)){
    if ((p.categories||[]).includes(oldN)) updateDoc(placeDocFor(spaceId, p.id), { categories: p.categories.map(x=>x===oldN?newN:x) });
  }
  openSettings();  // 重繪
}
async function deleteCat(spaceId, c){
  if (spaceId !== currentSpaceId) return;
  spaceCats = spaceCats.filter(x => x !== c);
  const cc = { ...catColors }; delete cc[c]; catColors = cc;
  await setDoc(metaDocFor(spaceId), { categories: spaceCats, catColors: cc }, { merge:true });
  if (spaceId !== currentSpaceId) return;
  for (const p of Object.values(places)){
    if ((p.categories||[]).includes(c)) updateDoc(placeDocFor(spaceId, p.id), { categories: p.categories.filter(x=>x!==c) });
  }
  closeModal(); openSettings();
}

/* ---------- 篩選 UI ---------- */
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
  map.setZoom(14);
}
function scheduleFilterFit(){
  clearTimeout(filterFitTimer);
  filterFitTimer=setTimeout(fitMapToCurrentFilter,80);
}
function applyFilter({fitViewport=true}={}){
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
  const active = filter.who!=="all"||filter.tripId!=="all"||filter.cats.size||filter.from||filter.to||filter.regions.length;
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
  el.innerHTML = html;
  const op = document.getElementById("orderPinToggle");
  if (op) op.onclick = () => { numberPins=!numberPins; renderFilterChips(); renderMarkers(); };
  el.querySelectorAll('[data-rx]').forEach(x => x.onclick = () => {
    filter.regions.splice(+x.dataset.rx, 1); applyFilter();
  });
}

/* ---------- Google Maps 載入 ---------- */
function loadGoogleBootstrap(){
  if (window.google?.maps?.importLibrary) return;
  ((g)=>{let h,a,k,p="The Google Maps JavaScript API",c="google",l="importLibrary",q="__ib__",
    m=document,b=window;b=b[c]||(b[c]={});let d=b.maps||(b.maps={}),r=new Set,e=new URLSearchParams,
    u=()=>h||(h=new Promise(async(f,n)=>{await(a=m.createElement("script"));e.set("libraries",[...r]+"");
    for(k in g)e.set(k.replace(/[A-Z]/g,t=>"_"+t[0].toLowerCase()),g[k]);e.set("callback",c+".maps."+q);
    a.src=`https://maps.${c}apis.com/maps/api/js?`+e;d[q]=f;a.onerror=()=>h=n(Error(p+" could not load."));
    m.head.append(a)}));d[l]?console.warn(p+" only loads once. Ignoring:",g):d[l]=(f,...n)=>r.add(f)&&u().then(()=>d[l](f,...n))})
    ({key:runtimeConfig.google.apiKey, v:"weekly", language:"zh-TW", region:"TW"});
}

async function initMap(){
  loadGoogleBootstrap();
  const [{Map},{AdvancedMarkerElement,PinElement},placesLib,{Geocoder}] = await Promise.all([
    google.maps.importLibrary("maps"),
    google.maps.importLibrary("marker"),
    google.maps.importLibrary("places"),
    google.maps.importLibrary("geocoding"),
  ]);
  MapCtor = Map; AdvMarker = AdvancedMarkerElement; Pin = PinElement;
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
    if (Date.now() - lastMarkerClick < 500) return;
    const lat=e.latLng.lat(), lng=e.latLng.lng();
    nearbyPicker(lat, lng);                            // 先列出附近地標供選
  });
}

/* ---------- Firestore 即時同步 ---------- */
// True while a queued current-Space callback still belongs to the Space that
// was active when its listener was attached (§16). Any listener whose captured
// session is no longer current must ignore its data.
function isStaleSpaceCallback(session){ return localFailure || session !== spaceSession; }

function subscribe(){
  unsubscribeCurrentSpaceListeners();
  resetSpaceFoundationReads();
  const session = spaceSession;              // captured for stale-snapshot protection

  // A queued error from a listener whose Space session is no longer current
  // (e.g. Space A error arriving after an A→B switch) must not fail B's session (§4).
  const guardedError = handler => error => { if (isStaleSpaceCallback(session)) return; handler(error); };

  currentSpaceUnsubscribes.set("space", onSnapshot(spaceDoc(), snapshot => {
    if (isStaleSpaceCallback(session)) return;
    spaceFoundationReads.spaceReady = true;
    spaceFoundationReads.spaceDocument = snapshot.exists() ? snapshot.data() : null;
    reconcileSpaceMembershipFoundation();
  }, guardedError(error => handleOptionalFoundationReadError("Space root", "space", error))));

  currentSpaceUnsubscribes.set("members", onSnapshot(membersCol(), snapshot => {
    if (isStaleSpaceCallback(session)) return;
    spaceFoundationReads.membersReady = true;
    spaceFoundationReads.formalMemberships = snapshot.docs.map(member => ({ ...member.data(), id:member.id }));
    reconcileSpaceMembershipFoundation();
  }, guardedError(error => handleOptionalFoundationReadError("Memberships", "members", error))));

  currentSpaceUnsubscribes.set("places", onSnapshot(query(placesCol(), orderBy("createdAt","desc")), snap => {
    if (isStaleSpaceCallback(session)) return;
    places = {}; snap.forEach(d => places[d.id] = { id:d.id, ...d.data() });
    recomputeReferencedParticipants();
    auditParticipantData();
    refreshFilterUI();
    renderList(); renderMarkers();
    refreshMapSurfaces();
  }, guardedError(error => handleFirestoreError("places", error))));
  currentSpaceUnsubscribes.set("trips", onSnapshot(query(tripsCol(), orderBy("createdAt","desc")), snap => {
    if (isStaleSpaceCallback(session)) return;
    trips = {}; snap.forEach(d => trips[d.id] = { id:d.id, ...d.data() });
    renderList(); renderMarkers();
    refreshFilterUI();
    refreshMapSurfaces();
  }, guardedError(error => handleFirestoreError("trips", error))));
  currentSpaceUnsubscribes.set("meta", onSnapshot(metaDoc(), s => {
    if (isStaleSpaceCallback(session)) return;
    const d = s.data() || {};
    spaceCats = d.categories || [];
    members   = d.members || {};
    catColors = d.catColors || {};
    nicknames = d.nicknames || {};
    levelColors = { ...LEVEL_COLORS, ...(d.levelColors||{}) };
    spaceFoundationReads.metaReady = true;
    reconcileSpaceMembershipFoundation();
    refreshFilterUI();
    renderList(); renderMarkers(); renderMarkerLegend();
    refreshMapSurfaces();
  }, guardedError(error => handleFirestoreError("meta/config", error))));

  // Record the authenticated User in this Space's legacy meta (participant
  // filter self entry + two-person `whoMode` compatibility). Targets the Space
  // captured now, never a later switched-to Space.
  const metaSpaceId = currentSpaceId;
  setDoc(metaDocFor(metaSpaceId), { members: { [user.uid]: me() } }, { merge:true })
    .catch(e => isLocalTest() ? failLocal("initial member write", e) : undefined);
}
function resetSpaceFoundationReads(){
  spaceFoundationReads = {
    spaceReady:false,
    membersReady:false,
    metaReady:false,
    formalReadFailed:false,
    spaceDocument:null,
    formalMemberships:[]
  };
  currentSpace = null;
  currentMembership = null;
  spaceMembers = [];
  removedSpaceMembers = [];
  membershipSource = "pending";
  ownershipValidation = null;
  memberDirectory = createMemberDirectory([]);
  lastLocalMembershipDiagnostic = "";
  lastMembershipRenderSignature = "";
  referencedHistoricalIds = [];
}
function unsubscribeCurrentSpaceListeners(){
  for (const unsubscribe of currentSpaceUnsubscribes.values()){
    try { unsubscribe(); } catch(error){ console.warn("Firestore listener cleanup failed:", error); }
  }
  currentSpaceUnsubscribes.clear();
}
function handleOptionalFoundationReadError(area, readKey, error){
  if (isLocalTest()){
    failLocal(`Firestore ${area}`, error);
    return;
  }
  console.warn(`Optional Firestore ${area} read failed; continuing with legacy meta compatibility.`, error);
  spaceFoundationReads.formalReadFailed = true;
  if (readKey === "space"){
    spaceFoundationReads.spaceReady = true;
    spaceFoundationReads.spaceDocument = null;
  } else {
    spaceFoundationReads.membersReady = true;
    spaceFoundationReads.formalMemberships = [];
  }
  reconcileSpaceMembershipFoundation();
}
let lastMembershipRenderSignature = "";
function reconcileSpaceMembershipFoundation(){
  if (!spaceFoundationReads.spaceReady || !spaceFoundationReads.membersReady || !spaceFoundationReads.metaReady) return;
  const foundation = resolveSpaceMembershipFoundation({
    spaceId:currentSpaceId,
    spaceDocument:spaceFoundationReads.formalReadFailed ? null : spaceFoundationReads.spaceDocument,
    formalMemberships:spaceFoundationReads.formalReadFailed ? [] : spaceFoundationReads.formalMemberships,
    legacyMembers:members,
    legacyNicknames:nicknames,
    currentUserId:user?.uid || ""
  });
  currentSpace = foundation.currentSpace;
  currentMembership = foundation.currentMembership;
  spaceMembers = foundation.spaceMembers;
  removedSpaceMembers = foundation.removedMembers;
  membershipSource = foundation.membershipSource;
  ownershipValidation = foundation.ownership;
  memberDirectory = foundation.directory;
  reportSpaceMembershipDiagnostic(foundation);

  // Phase 2 §4: participant-dependent UI depends on formal Membership data.
  // Whenever the resolved directory / active / removed Members / names change,
  // refresh that UI once — regardless of whether this listener arrived before
  // or after meta/places/trips. A signature guard prevents render loops.
  const signature = JSON.stringify({
    source:foundation.membershipSource,
    active:foundation.activeMembers.map(m=>`${m.userId}:${m.displayName}`),
    removed:foundation.removedMembers.map(m=>`${m.userId}:${m.displayName}`),
    current:foundation.currentMembership?.userId || null
  });
  if (signature !== lastMembershipRenderSignature){
    lastMembershipRenderSignature = signature;
    recomputeReferencedParticipants();
    refreshParticipantDependentUI();
  }
}
// Re-render the participant-dependent surfaces. Guarded so it is inert until the
// app shell + map exist; creates no Firestore listeners or writes.
function refreshParticipantDependentUI(){
  if (!document.getElementById("app") || !document.getElementById("fl_trip")) return;
  refreshFilterUI();
  renderList();
  renderMarkers();
}
function reportSpaceMembershipDiagnostic(foundation){
  const diagnostic = {
    currentSpaceId,
    membershipSource:foundation.membershipSource,
    members:foundation.spaceMembers.length,
    activeMembers:foundation.activeMembers.length,
    removedMembers:foundation.removedMembers.length,
    currentRole:foundation.currentMembership?.role || null,
    currentStatus:foundation.currentMembership?.status || null,
    currentMembershipAccessible:foundation.currentMembershipAccessible,
    ownershipInvariant:foundation.ownership.code
  };
  if (isLocalTest()){
    const key = JSON.stringify(diagnostic);
    if (key !== lastLocalMembershipDiagnostic){
      lastLocalMembershipDiagnostic = key;
      console.info("Mapair LOCAL TEST membership foundation", diagnostic);
    }
  }
  if (foundation.membershipSource === "formal" && !foundation.ownership.valid){
    console.warn("Invalid formal Space ownership state detected; no repair or authorization change was attempted.", foundation.ownership);
  }
  if (foundation.membershipSource === "formal" && foundation.currentMembership?.status === "removed"){
    console.warn("The authenticated User has a removed formal Membership. Phase 1 records this as inaccessible but does not enforce authorization in the UI.");
  }
}
const loggedParticipantWarnings = new Set();
// LOCAL TEST only: surface Visits whose `who` and `participantIds` disagree or
// whose `participantIds` is malformed. Diagnostic only — nothing is normalized
// or written (APPROVED PHASE 2 CONTRACT §2).
function auditParticipantData(){
  if (!isLocalTest()) return;
  for (const p of Object.values(places)){
    for (const v of (Array.isArray(p.visits) ? p.visits : [])){
      const key = `${p.id}:${v?.id||""}`;
      const mismatch = detectParticipantMismatch(v);
      if (mismatch?.mismatch && !loggedParticipantWarnings.has(`mismatch:${key}`)){
        loggedParticipantWarnings.add(`mismatch:${key}`);
        console.warn("Mapair LOCAL TEST participant mismatch", { place:p.id, visit:v?.id, who:mismatch.who, participantIds:mismatch.participantIds });
      }
      const issues = resolveVisitParticipants(v, p, legacyParticipantContext()).issues;
      for (const issue of issues){
        const issueKey = `${issue.code}:${key}`;
        if (loggedParticipantWarnings.has(issueKey)) continue;
        loggedParticipantWarnings.add(issueKey);
        console.warn("Mapair LOCAL TEST participant data issue", { place:p.id, visit:v?.id, ...issue });
      }
    }
  }
}
// Space-scoped Firestore path helpers. The `*For(spaceId)` forms bind an
// explicit Space; any deferred / queued / async write MUST use a `*For` helper
// with the Space ID captured before a possible switch (§17). The bare helpers
// resolve `currentSpaceId` and are for the live current-Space subscription and
// synchronous handlers only.
const spaceDocFor   = spaceId => doc(db, "spaces", spaceId);
const membersColFor = spaceId => collection(db, "spaces", spaceId, "members");
const memberDocFor  = (spaceId, uid) => doc(db, "spaces", spaceId, "members", uid);
const metaDocFor    = spaceId => doc(db, "spaces", spaceId, "meta", "config");
const placesColFor  = spaceId => collection(db, "spaces", spaceId, "places");
const placeDocFor   = (spaceId, id) => doc(db, "spaces", spaceId, "places", id);
const tripsColFor   = spaceId => collection(db, "spaces", spaceId, "trips");
const tripDocFor    = (spaceId, id) => doc(db, "spaces", spaceId, "trips", id);

const spaceDoc   = () => spaceDocFor(currentSpaceId);
const membersCol = () => membersColFor(currentSpaceId);
const memberDoc  = uid => memberDocFor(currentSpaceId, uid);
const metaDoc    = () => metaDocFor(currentSpaceId);
const placesCol  = () => placesColFor(currentSpaceId);
const placeDoc   = id => placeDocFor(currentSpaceId, id);
const tripsCol   = () => tripsColFor(currentSpaceId);
const tripDoc    = id => tripDocFor(currentSpaceId, id);

/* ============================================================
   Phase 3 — Personal Space + Space switcher (LOCAL only, gated by
   ?firebaseEnv=local&multiSpace=1). Membership is the discovery and
   permission relationship; participation is never consulted.
   ============================================================ */
function phase3Diag(area, detail){
  if (isLocalTest()) console.info(`Mapair Phase 3 · ${area}`, detail);
}
function spacePrefStorage(){ try { return globalThis.localStorage; } catch(e){ return null; } }
function safeSelfDisplayName(){ return user?.displayName || user?.email || "地圖擁有者"; }
function safeSelfPhotoURL(){ return typeof user?.photoURL === "string" ? user.photoURL : ""; }

function teardownPhase3(){
  if (phase3.discoveryUnsub){ try { phase3.discoveryUnsub(); } catch(e){} }
  phase3.discoveryUnsub = null;
  phase3.discoveryGen++;
  phase3.discoveryReq++;
  phase3.discoveryUid = "";
  phase3.discoveredSpaces = [];
  phase3.started = false;
  phase3.initialSelectionPending = false;
  phase3.provisioningInFlight = false;
  phase3.personalSpaceId = "";
  phase3.switcherOpen = false;
}

function startPhase3(){
  if (!isMultiSpace() || !user?.uid) return;
  phase3.active = true;
  phase3.started = true;
  phase3.initialSelectionPending = true;
  phase3.personalSpaceId = personalSpaceId(user.uid);
  startSpaceDiscovery();
}

// ONE authenticated-User discovery listener over the collection group. It lives
// across Space switches and is torn down only on logout / auth change (§8).
function startSpaceDiscovery(){
  const uid = user?.uid || "";
  if (!uid) return;
  phase3.discoveryGen++;
  phase3.discoveryUid = uid;
  const gen = phase3.discoveryGen;
  try {
    const q = query(collectionGroup(db, "members"), where("userId", "==", uid), where("status", "==", "active"));
    phase3.discoveryUnsub = onSnapshot(q,
      snap => {
        // Each snapshot gets a monotonically increasing request version; only the
        // newest may apply its async result (§1).
        const req = ++phase3.discoveryReq;
        handleDiscoverySnapshot(gen, req, uid, snap).catch(err => { phase3Diag("discovery-callback", err?.message || String(err)); });
      },
      err => {
        // Ignore a queued error from a superseded / torn-down discovery listener (§4).
        if (localFailure || gen !== phase3.discoveryGen || uid !== (user?.uid || "")) return;
        failLocal("Space discovery", err);
      }
    );
  } catch(err){
    failLocal("Space discovery setup", err);
  }
}

// `gen` = discovery listener generation; `req` = per-snapshot request version;
// `snapUid` = the UID the listener belongs to. A result applies only if all three
// are still current after the awaits (§1, §2, §4).
async function handleDiscoverySnapshot(gen, req, snapUid, snapshot){
  const stillCurrent = () => !localFailure && gen === phase3.discoveryGen && req === phase3.discoveryReq && snapUid === (user?.uid || "") && snapUid === phase3.discoveryUid;
  if (!stillCurrent()) return;

  const rows = snapshot.docs.map(d => ({ path: d.ref.path, id: d.id, ...d.data() }));

  // §3 — trust a Membership only when its document path is exactly
  // spaces/{spaceId}/members/{uid}; never map another "members" collection's
  // grandparent ID into spaces/{id}.
  const mine = [];
  const rejected = [];
  for (const row of rows){
    const parsed = resolveSpaceMembershipPath(row.path, snapUid);
    const validRow = parsed.valid
      && row.id === snapUid && row.userId === snapUid
      && row.status === "active" && ["owner", "member"].includes(row.role);
    if (validRow) mine.push({ ...row, spaceId: parsed.spaceId });
    else rejected.push({ path: row.path, reason: parsed.valid ? "membership-fields" : parsed.reason, role: row.role, status: row.status });
  }
  if (rejected.length) phase3Diag("discovery-rejected-rows", rejected);

  // §2 — a Firestore READ FAILURE is not evidence that a Space root is missing.
  // Distinguish read error (fail closed) from a successful "does not exist" read.
  const settled = await Promise.allSettled(mine.map(m => getDoc(spaceDocFor(m.spaceId))));
  if (!stillCurrent()) return;   // a newer request / listener / User superseded this one

  const readFailures = settled
    .map((s, i) => ({ s, spaceId: mine[i].spaceId }))
    .filter(({ s }) => s.status === "rejected");
  if (readFailures.length){
    phase3Diag("discovery-root-read-failed", readFailures.map(({ spaceId, s }) => ({ spaceId, error: s.reason?.message || String(s.reason) })));
    failLocal("Space discovery", new Error(`${readFailures.length} Space root read(s) failed; refusing to update discovery or provision a Personal Space while root reads are uncertain.`));
    return;
  }

  phase3.discoveredSpaces = mine.map((m, i) => {
    const snap = settled[i].value;
    return normalizeDiscoveredSpace({
      spaceId: m.spaceId,
      membership: m,
      spaceDoc: snap.exists() ? snap.data() : null
    });
  });
  const diags = discoveryDiagnostics(phase3.discoveredSpaces);
  if (diags.length) phase3Diag("discovered-space-issues", diags);
  onDiscoveryUpdate();
}

function accessibleSpaceIds(){ return phase3.discoveredSpaces.filter(s => s.valid).map(s => s.id); }
function discoveredSpaceById(id){ return phase3.discoveredSpaces.find(s => s.id === id && s.valid) || null; }
function currentPersonalSpaceId(){
  const uid = user?.uid || "";
  const owned = phase3.discoveredSpaces.filter(s => s.valid && s.isPersonal && s.ownerId === uid && s.userId === uid && s.status === "active");
  return owned.length === 1 ? owned[0].id : "";
}

function onDiscoveryUpdate(){
  if (localFailure) return;
  if (phase3.initialSelectionPending) resolveInitialSpaceSelection();
  else reconcileActiveSpaceAgainstDiscovery();
  renderSpaceSwitcher();
}

function resolveInitialSpaceSelection(){
  if (!phase3.initialSelectionPending || phase3.provisioningInFlight || spaceSwitchInFlight) return;
  const uid = user?.uid || "";
  const resolution = personalSpaceResolution(phase3.discoveredSpaces, uid, phase3.personalSpaceId);

  if (resolution.action === "conflict"){
    phase3.initialSelectionPending = false;
    failLocal("Personal Space", new Error(`More than one valid Personal Space for this User (${resolution.spaceIds.join(", ")}). Refusing to guess a canonical one; not deleting or merging anything.`));
    return;
  }

  if (resolution.action === "provision"){
    phase3.provisioningInFlight = true;
    phase3Diag("personal-space", { action:"provision", spaceId: resolution.spaceId });
    ensurePersonalSpace(uid).then(async pid => {
      phase3.personalSpaceId = pid;
      if (uid !== (user?.uid || "")) { phase3.provisioningInFlight = false; return; }   // auth changed
      // Authoritatively confirm the freshly-provisioned Space with a read that
      // fails closed rather than being interpreted as "missing".
      let spaceSnap, memberSnap;
      try {
        [spaceSnap, memberSnap] = await Promise.all([getDoc(spaceDocFor(pid)), getDoc(memberDocFor(pid, uid))]);
      } catch(e){
        phase3.provisioningInFlight = false;
        phase3.initialSelectionPending = false;
        failLocal("Personal Space confirmation", e);
        return;
      }
      if (uid !== (user?.uid || "")) { phase3.provisioningInFlight = false; return; }
      const entry = normalizeDiscoveredSpace({
        spaceId: pid,
        membership: memberSnap.exists() ? { path: `spaces/${pid}/members/${uid}`, id: uid, ...memberSnap.data() } : null,
        spaceDoc: spaceSnap.exists() ? spaceSnap.data() : null
      });
      if (entry.valid) phase3.discoveredSpaces = [...phase3.discoveredSpaces.filter(s => s.id !== pid), entry];
      else phase3Diag("personal-space-invalid-after-provision", entry.issues);
      phase3.provisioningInFlight = false;
      onDiscoveryUpdate();   // re-run selection with the confirmed Personal Space
    }).catch(err => {
      phase3.provisioningInFlight = false;
      phase3.initialSelectionPending = false;
      failLocal("Personal Space provisioning", err);
    });
    return;
  }

  // reuse
  phase3.personalSpaceId = resolution.spaceId;
  phase3.initialSelectionPending = false;

  const accessible = accessibleSpaceIds();
  const savedPref = validateActiveSpacePreference(
    readActiveSpacePreference(spacePrefStorage(), runtimeConfig.firebase.projectId, uid),
    accessible
  );
  const choice = chooseInitialActiveSpace({
    explicitRequested: !!runtimeConfig.explicitTestSpace,
    explicitTestSpaceId: runtimeConfig.explicitTestSpaceId,
    savedPreferenceId: savedPref,
    personalSpaceId: resolution.spaceId,
    accessibleSpaceIds: accessible
  });

  if (choice.error === "explicit-inaccessible"){
    failLocal("initial Space", new Error(`testSpace=${runtimeConfig.explicitTestSpace} was requested but the authenticated User is not an active Member of that fixture Space. Not selecting another Space.`));
    return;
  }
  if (!choice.spaceId){
    failLocal("initial Space", new Error("Personal Space provisioning produced no accessible Space; failing closed rather than choosing arbitrary data."));
    return;
  }
  phase3Diag("initial-space", { spaceId: choice.spaceId, source: choice.source });
  switchActiveSpace(choice.spaceId, { initial:true, reason: choice.source });
}

function reconcileActiveSpaceAgainstDiscovery(){
  if (!currentSpaceId || spaceSwitchInFlight) return;
  const accessible = accessibleSpaceIds();
  if (accessible.includes(currentSpaceId)) return;
  phase3Diag("membership-lost", { space: currentSpaceId });
  const personal = currentPersonalSpaceId();
  if (personal && personal !== currentSpaceId && accessible.includes(personal)){
    switchActiveSpace(personal, { reason:"membership-lost" });
    return;
  }
  failLocal("active Space access", new Error(`Current Space ${currentSpaceId} is no longer accessible and no Personal Space fallback is available.`));
}

// Retry-safe, idempotent, concurrent-tab-safe (§4, §5). One Firestore
// transaction; never overwrites a Shared Space, never "repairs" an ambiguous
// ownership state, never uses merge to paper over a conflict.
async function ensurePersonalSpace(uid){
  const pid = personalSpaceId(uid);
  const spaceRef = spaceDocFor(pid);
  const memberRef = memberDocFor(pid, uid);
  const displayName = safeSelfDisplayName();
  const photoURL = safeSelfPhotoURL();
  await runTransaction(db, async tx => {
    const spaceSnap = await tx.get(spaceRef);
    const memberSnap = await tx.get(memberRef);
    const spaceExists = spaceSnap.exists();
    const memberExists = memberSnap.exists();

    if (spaceExists){
      const s = spaceSnap.data() || {};
      if (s.type !== "personal" || s.ownerId !== uid){
        throw new Error(`spaces/${pid} already exists and is NOT this User's Personal Space (type=${s.type ?? "?"}, ownerId=${s.ownerId ?? "?"}). Not overwriting.`);
      }
    }
    if (memberExists){
      const m = memberSnap.data() || {};
      if (m.userId !== uid || m.role !== "owner" || m.status !== "active"){
        throw new Error(`spaces/${pid}/members/${uid} already exists and is NOT a valid active owner Membership (userId=${m.userId ?? "?"}, role=${m.role ?? "?"}, status=${m.status ?? "?"}). Not repairing.`);
      }
    }
    if (spaceExists && memberExists) return;   // already provisioned and valid — no-op

    if (!spaceExists){
      tx.set(spaceRef, {
        name: PERSONAL_SPACE_NAME,
        type: "personal",
        ownerId: uid,
        createdBy: uid,
        createdAt: serverTimestamp()
      });
    }
    if (!memberExists){
      const memberData = {
        userId: uid,
        role: "owner",
        status: "active",
        displayNameSnapshot: displayName,
        joinedAt: serverTimestamp()
      };
      if (photoURL) memberData.photoURLSnapshot = photoURL;
      tx.set(memberRef, memberData);
    }
  });
  phase3Diag("personal-space", { spaceId: pid, ensured: true });
  return pid;
}

async function createSharedSpace(name){
  const uid = user?.uid || "";
  if (!uid) throw new Error("Not authenticated.");
  const trimmed = (name || "").trim();
  if (!trimmed) throw new Error("A Shared Space needs a name.");
  const ref = doc(collection(db, "spaces"));   // cryptographic auto ID
  const newId = ref.id;
  const memberRef = memberDocFor(newId, uid);
  const displayName = safeSelfDisplayName();
  await runTransaction(db, async tx => {
    const existing = await tx.get(ref);
    if (existing.exists()) throw new Error("Generated Space ID collided; please retry.");
    tx.set(ref, {
      name: trimmed,
      type: "shared",
      ownerId: uid,
      createdBy: uid,
      createdAt: serverTimestamp()
    });
    tx.set(memberRef, {
      userId: uid, role: "owner", status: "active",
      displayNameSnapshot: displayName, joinedAt: serverTimestamp()
    });
  });
  // Optimistic entry so the immediate switch can validate the new Space; the
  // discovery listener reconciles it on its next fire.
  phase3.discoveredSpaces = [
    ...phase3.discoveredSpaces.filter(s => s.id !== newId),
    normalizeDiscoveredSpace({
      spaceId: newId,
      membership: { id: uid, userId: uid, role: "owner", status: "active" },
      spaceDoc: { name: trimmed, type: "shared", ownerId: uid }
    })
  ];
  phase3Diag("shared-space", { spaceId: newId, created: true });
  return newId;
}

// The single controlled Space activation (§14). Tears down everything bound to
// the previous Space BEFORE any new snapshot can arrive.
function switchActiveSpace(spaceId, opts = {}){
  if (!isMultiSpace()) return;
  const target = discoveredSpaceById(spaceId);
  if (!target){
    phase3Diag("switch-rejected", { spaceId, reason:"not-accessible" });
    if (!opts.initial) alert("這張地圖目前無法開啟。");
    return;
  }
  if (spaceId === currentSpaceId && spaceSession.spaceId === spaceId && !opts.initial){
    closeSpaceSwitcherMenu();
    return;
  }

  spaceSwitchInFlight = true;
  closeSpaceSwitcherMenu();

  // 1) tear down interaction bound to the old Space
  closeAllModals();
  cancelAddMode();
  clearSearchSuggestions();
  clearTimeout(searchTimer);
  searchReqSeq++;   // invalidate any in-flight Google autocomplete request (§5)
  clearTimeout(filterFitTimer); filterFitTimer = null;

  // 2) drop the old Space's live listeners and mint a new session token so any
  //    queued callback from the old Space becomes inert
  unsubscribeCurrentSpaceListeners();
  spaceSession = nextSpaceSession(spaceSession, spaceId);
  adminRenderVersion++;
  proximityRenderVersion++;

  // 3) clear every Space-scoped domain + view slice
  clearSpaceScopedState();

  // 4) reset data-bound filters (§15)
  resetFiltersForSpaceSwitch();

  // 5) activate the new Space
  currentSpaceId = spaceId;
  writeActiveSpacePreference(spacePrefStorage(), runtimeConfig.firebase.projectId, user?.uid || "", spaceId);
  renderSpaceSwitcher();
  showSpaceLoadingState();
  refreshMapSurfaces();

  subscribe();
  spaceSwitchInFlight = false;
  phase3Diag("switch", { to: spaceId, reason: opts.reason || "user" });
  renderSpaceSwitcher();
}

function clearSpaceScopedState(){
  places = {}; trips = {}; spaceCats = [];
  members = {}; nicknames = {}; catColors = {};
  levelColors = { ...LEVEL_COLORS };
  currentSpace = null; currentMembership = null;
  spaceMembers = []; removedSpaceMembers = [];
  membershipSource = "pending"; ownershipValidation = null;
  memberDirectory = createMemberDirectory([]);
  referencedHistoricalIds = [];
  lastMembershipRenderSignature = "";
  lastLocalMembershipDiagnostic = "";
  loggedParticipantWarnings.clear();
  dayVisitItems = [];
  markers.forEach(m => { try { m.map = null; } catch(e){} }); markers = [];
  if (tripLine){ try { tripLine.setMap(null); } catch(e){} tripLine = null; }
  removeAdministrativeLayer();
  removeProximityLayer();
  adminLevel = "off"; proximityEnabled = false;
  regionLegendState = null; regionMulti = false;
  proximityMaskIndex = null;
  selectedRegionMaskCache = { identity:"", maskIndex:null };
  proximityGeometryCache.clear();
  proximitySeedCount = 0;
  // NOTE: `placeEditorWriteQueues` is intentionally NOT cleared here (§6).
  // Clearing the Map would forget still-running Promise chains without
  // cancelling them; a returned-to Space must keep serializing behind any
  // unresolved write for the same `${spaceId}:${placeId}` key. Each entry
  // removes itself via its own `.finally`. New editors are session-invalidated.
}

function resetFiltersForSpaceSwitch(){
  filter = { who:"all", tripId:"all", cats:new Set(), from:"", to:"", regions:[] };
  dateScope = "month";
  pickedMonth = currentMonth(0);
  applyDateScope();
  tab = "visited";
  numberPins = false;
}

function showSpaceLoadingState(){
  const list = document.getElementById("list");
  if (list) list.innerHTML = `<div class="empty">地圖載入中…</div>`;
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.t === "visited"));
  document.getElementById("searchWrap") && (document.getElementById("searchWrap").style.display = "block");
  if (document.getElementById("fl_trip")) refreshFilterUI();
  renderFilterChips();
  renderMarkerLegend();
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

/* ---------- Space switcher UI (§11–§13) ---------- */
function wireSpaceSwitcher(){
  const btn = document.getElementById("spaceSwitchBtn");
  if (!btn) return;
  btn.onclick = e => { e.stopPropagation(); toggleSpaceSwitcherMenu(); };
  const signal = layoutDismissController?.signal;
  document.addEventListener("click", e => {
    const sw = document.getElementById("spaceSwitch");
    if (phase3.switcherOpen && sw && !sw.contains(e.target)) closeSpaceSwitcherMenu();
  }, signal ? { signal } : undefined);
  document.addEventListener("keydown", e => {
    if (e.key === "Escape" && phase3.switcherOpen){
      closeSpaceSwitcherMenu();
      document.getElementById("spaceSwitchBtn")?.focus();
    }
  }, signal ? { signal } : undefined);
}
function toggleSpaceSwitcherMenu(){ phase3.switcherOpen ? closeSpaceSwitcherMenu() : openSpaceSwitcherMenu(); }
function openSpaceSwitcherMenu(){
  phase3.switcherOpen = true;
  document.getElementById("spaceSwitchMenu")?.classList.add("open");
  document.getElementById("spaceSwitchBtn")?.setAttribute("aria-expanded", "true");
  renderSpaceSwitcher();
}
function closeSpaceSwitcherMenu(){
  phase3.switcherOpen = false;
  document.getElementById("spaceSwitchMenu")?.classList.remove("open");
  document.getElementById("spaceSwitchBtn")?.setAttribute("aria-expanded", "false");
}
function renderSpaceSwitcher(){
  const nameEl = document.getElementById("spaceSwitchName");
  const menu = document.getElementById("spaceSwitchMenu");
  if (!nameEl || !menu) return;
  const uid = user?.uid || "";
  const ordered = orderSpacesForSwitcher(phase3.discoveredSpaces, uid);
  const active = ordered.find(s => s.id === currentSpaceId);
  nameEl.textContent = active ? spaceDisplayName(active) : (currentSpaceId ? "載入中…" : "選擇地圖…");

  const rows = ordered.map(s => `<button class="spacerow${s.id === currentSpaceId ? " on" : ""}" role="menuitem" data-space="${esc(s.id)}">
      <span class="spacerow-check">${s.id === currentSpaceId ? "✓" : ""}</span>
      <span class="spacerow-name">${esc(spaceDisplayName(s))}</span>
      <span class="spacerow-type">${esc(spaceTypeLabel(s))}</span>
    </button>`).join("");
  const empty = ordered.length ? "" : `<div class="spacerow-empty">尋找你的地圖中…</div>`;
  menu.innerHTML = `${rows}${empty}<button class="spacerow spacerow-new" role="menuitem" id="spaceNewShared">＋ 新共享地圖</button>`;

  menu.querySelectorAll("[data-space]").forEach(b => b.onclick = () => {
    closeSpaceSwitcherMenu();
    switchActiveSpace(b.dataset.space, { reason:"user" });
  });
  const newBtn = document.getElementById("spaceNewShared");
  if (newBtn) newBtn.onclick = () => { closeSpaceSwitcherMenu(); promptNewSharedSpace(); };
}
function promptNewSharedSpace(){
  modal(`
    <h2 style="margin-bottom:4px">新共享地圖</h2>
    <div style="font-size:12px;color:var(--ink-soft);margin-bottom:12px">先取個名字，之後可邀請其他人加入。</div>
    <input id="newSpaceName" placeholder="例:大學朋友、家庭旅行" style="width:100%;padding:9px;border:1px solid var(--line);border-radius:9px;background:#fff">
    <div class="row" style="margin-top:12px"><button class="btn" id="newSpaceCreate">建立</button></div>
  `);
  const input = document.getElementById("newSpaceName");
  const create = document.getElementById("newSpaceCreate");
  input.focus();
  create.onclick = async () => {
    const name = (input.value || "").trim();
    if (!name){ input.focus(); return; }
    create.disabled = true;
    try {
      const newId = await createSharedSpace(name);
      closeModal();
      switchActiveSpace(newId, { reason:"created" });
    } catch(err){
      create.disabled = false;
      failLocal("Shared Space creation", err);
    }
  };
  input.onkeydown = e => { if (e.key === "Enter"){ e.preventDefault(); create.click(); } };
}

/* ---------- 地圖標記(AdvancedMarker + 彩色 PinElement) ---------- */
// Participant marker colouring for arbitrary Member sets: each UID maps to a
// stable palette colour by deterministic hash (independent of Member count or
// order); any multi-person Visit shares one "group" colour; exactly two people
// carries no special meaning (Phase 2 §7).
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
const VISIT_DATE_RAINBOW=["#d94b4b","#e98a32","#e0bd34","#4a9f63","#3f78b5","#7756b3"];
function dayDiff(a,b){ return Math.round((new Date(b+"T00:00:00")-new Date(a+"T00:00:00"))/86400000); }
function multiStopColor(colors,t){
  t=Math.max(0,Math.min(1,Number.isFinite(t)?t:0));
  if(colors.length===1) return colors[0];
  const pos=t*(colors.length-1), i=Math.min(colors.length-2,Math.floor(pos)), local=pos-i;
  return lerpHex(colors[i],colors[i+1],local);
}
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
  // 同一天由淺到深；第一站仍保留足夠飽和度，最後一站接近基準色。
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
  if (markerMode === "cat"){ const c=(p.categories||[])[0]; if(c) return catColor(c); }
  else if (markerMode === "level" && p.level) return levelColors[p.level];
  else if (markerMode === "who") return whoColor(p);
  else if (markerMode === "trip" && p.tripId && trips[p.tripId]?.color) return trips[p.tripId].color;
  else if (markerMode === "rating" && p.rating) return ratingColor(p.rating);
  return getCSS("--visited");
}
function markerColorForVisit(p,v){
  if (markerMode === "cat"){
    const c=visitCategory(p,v); if(c) return catColor(c);
  }
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
    if (!passFilter(p)) return;
    const col=effectiveMarkerColor(p);
    const pin = new Pin({ background:col, borderColor:"#ffffff", glyphColor:"#ffffff", scale:0.6 });
    pin.element.style.cursor = "pointer";
    const m = new AdvMarker({ map, position:{lat:p.lat,lng:p.lng}, content:pin.element, title:p.name, gmpClickable:true });
    m.addListener("gmp-click", () => { lastMarkerClick = Date.now(); openEditor(p.id); });
    markers.push(m);
  });
}
function dateMarkerLegendBody(){
  const b=markerDateBounds(), grad=VISIT_DATE_RAINBOW.join(",");
  return `<div class="legendsection"><div class="legendtitle">地標 · ${markerMode==="dateFirst"?"最早造訪":"最後造訪"}</div>`+
    `<div style="height:8px;width:108px;border-radius:3px;background:linear-gradient(90deg,${grad})"></div>`+
    `<div style="display:flex;justify-content:space-between;width:108px;font-size:11px"><span>${esc((b.from||"").slice(5)||"早")}</span><span>${esc((b.to||"").slice(5)||"晚")}</span></div>`+
    `<div style="font-size:11px;margin-top:2px">同日：淺 → 深 = 第一站 → 最後一站</div></div>`;
}
function markerLegendBody(){
  if (!showPins && !proximityEnabled) return "";
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

function regionLegendBody(){
  if(!regionLegendState || !shouldShowAdministrativeLegend({adminLevel,proximityEnabled})) return "";
  const {metric,ctx}=regionLegendState;
  if(metric==="first"||metric==="last"){
    const lab=metric==="first"?"初次造訪":"最後造訪", grad=VISIT_DATE_RAINBOW.join(",");
    return `<div class="legendsection"><div class="legendtitle">行政區 · ${lab}</div>`+
      `<div style="height:8px;width:108px;border-radius:3px;background:linear-gradient(90deg,${grad})"></div>`+
      `<div style="display:flex;justify-content:space-between;width:108px;font-size:11px"><span>${esc((ctx.dmin||"").slice(5)||"早")}</span><span>${esc((ctx.dmax||"").slice(5)||"晚")}</span></div></div>`;
  }
  let rows=metric==="count"
    ? [[COUNT_SHADES[0],"1"],[COUNT_SHADES[1],"2"],[COUNT_SHADES[2],"3–4"],[COUNT_SHADES[3],"5–9"],[COUNT_SHADES[4],"10+"]]
    : [[levelColors["居住"],"居住"],[levelColors["住宿"],"住宿"],[levelColors["旅遊"],"旅遊"],[levelColors["接地"],"接地"],[levelColors["經過"],"經過"],["#e5e0d6","未到"]];
  return `<div class="legendsection"><div class="legendtitle">行政區 · ${metric==="count"?"地標數":"造訪深度"}</div>`+
    rows.map(r=>`<div class="lg"><span class="sw" style="background:${r[0]}"></span>${r[1]}</div>`).join("")+`</div>`;
}
function proximityLegendBody(){
  if(!proximityEnabled) return "";
  const maskMode=resolveProximityMaskMode(filter.regions,proximityMaskTaiwan);
  const landText=maskMode.type==="regions" ? `已選行政區 × ${maskMode.count}`
    : maskMode.type==="taiwan" ? "臺灣陸地" : "無遮罩";
  const seedText=proximitySeedCount ? `${proximitySeedCount} 個造訪地點` : "目前篩選下沒有造訪地點";
  return `<div class="legendsection"><div class="legendtitle">最近造訪涵蓋 · ${formatProximityRadius(proximityRadius)} km</div>`+
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
// 造訪深度:沒設 level 的地點預設當作「旅遊」。
function effLevel(p){ return p.level || "旅遊"; }

// 確保每個地點都有該級的行政區代碼(算一次就寫回 Firestore 快取)。快取寫回
// 綁定啟動時的 Space;若期間切換 Space 就停止寫入 (§17)。
async function ensureCounty(){
  const geoSpaceId = currentSpaceId;
  const geo = await loadGeo("geo/county.json");
  if (geoSpaceId !== currentSpaceId) return geo;
  for (const p of Object.values(places)){
    if (geoSpaceId !== currentSpaceId) break;
    if (p.countyCode) continue;
    const code = pip(p.lat, p.lng, geo.features, "COUNTYCODE");
    if (code){ p.countyCode = code; updateDoc(placeDocFor(geoSpaceId, p.id), { countyCode: code }); }
  }
  return geo;
}
async function ensureTown(){
  const geoSpaceId = currentSpaceId;
  const geo = await loadGeo("geo/town.json");
  if (geoSpaceId !== currentSpaceId) return geo;
  for (const p of Object.values(places)){
    if (geoSpaceId !== currentSpaceId) break;
    if (p.townCode) continue;
    const code = pip(p.lat, p.lng, geo.features, "TOWNCODE");
    if (code){ p.townCode = code; updateDoc(placeDocFor(geoSpaceId, p.id), { townCode: code }); }
  }
  return geo;
}
async function ensureVillage(){
  const geoSpaceId = currentSpaceId;
  const county = await ensureCounty();                       // 先確保 countyCode
  const codes = county.features.map(f => f.properties.COUNTYCODE);
  const byCounty = {}; let feats = [];
  for (const c of codes){
    let geo; try { geo = await loadGeo("geo/village/" + c + ".json"); } catch(e){ continue; }
    byCounty[c] = geo.features; feats = feats.concat(geo.features);
  }
  if (geoSpaceId === currentSpaceId){
    for (const p of Object.values(places)){
      if (geoSpaceId !== currentSpaceId) break;
      if (p.villCode || !p.countyCode) continue;
      const gf = byCounty[p.countyCode]; if (!gf) continue;
      const code = pip(p.lat, p.lng, gf, "VILLCODE");
      if (code){ p.villCode = code; updateDoc(placeDocFor(geoSpaceId, p.id), { villCode: code }); }
    }
  }
  return { type:"FeatureCollection", features: feats };
}
// 每個行政區代碼 → 符合篩選、已造訪的地點清單
function regionPlaces(codeOf){
  const m = {};
  for (const p of Object.values(places)){
    if (!passFilter(p)) continue;
    const code = codeOf(p); if (!code) continue;
    (m[code] = m[code] || []).push(p);
  }
  return m;
}
function regionDate(pls, which){
  const mode=which==="first"?"dateFirst":"dateLast";
  const ds=pls.map(p=>representativeDateOccurrence(p,mode)).filter(Boolean).map(occurrenceDate).filter(Boolean).sort();
  return which === "first" ? ds[0] : ds[ds.length-1];
}
const COUNT_SHADES = ["#f0dcc0","#e6bd86","#d98b3f","#b96a24","#8f4f18"];
function countColor(n){ return COUNT_SHADES[n>=10?4:n>=5?3:n>=3?2:n>=2?1:0]; }
function lerpHex(a,b,t){
  const p=h=>[parseInt(h.slice(1,3),16),parseInt(h.slice(3,5),16),parseInt(h.slice(5,7),16)];
  const [r1,g1,b1]=p(a),[r2,g2,b2]=p(b);
  const c=(x,y)=>Math.round(x+(y-x)*t).toString(16).padStart(2,"0");
  return "#"+c(r1,r2)+c(g1,g2)+c(b1,b2);
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
  const seeds=selectEligibleProximitySeeds(places, passFilter);
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
  if(proximityLayer && proximityLayerKey===key){ restyleProximityLayer(); return; }
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
  let dmin,dmax;
  if(choroMetric==="first" || choroMetric==="last"){
    const bounds=markerDateBounds(); dmin=bounds.from; dmax=bounds.to;
  }
  const colorOf=code=>{
    const regionPlacesList=byRegion[code];
    if(!regionPlacesList || !regionPlacesList.length) return null;
    if(choroMetric==="level"){
      let best=-1;
      for(const place of regionPlacesList){
        const index=LEVEL_ORDER.indexOf(effLevel(place));
        if(index>best) best=index;
      }
      return best<0 ? null : levelColors[LEVEL_ORDER[best]];
    }
    if(choroMetric==="count") return countColor(regionPlacesList.length);
    const date=regionDate(regionPlacesList,choroMetric);
    return date ? dateColor(date,dmin,dmax) : null;
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
  renderLegend(choroMetric,{dmin,dmax});
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

function toggleMapSurface(control){
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
let dayVisitItems = [];
const effOrd = p => (p.ord != null ? p.ord : (p.createdAt?.seconds || 0));
function renderList(){
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
  if(!tripId){
    occ.sort((a,b)=>{
      const d=occurrenceDate(b).localeCompare(occurrenceDate(a)); if(d) return d;
      const ao=Number.isFinite(Number(a.v.order))?Number(a.v.order):1e9, bo=Number.isFinite(Number(b.v.order))?Number(b.v.order):1e9;
      if(ao!==bo) return ao-bo;
      return effOrd(a.p)-effOrd(b.p);
    });
  }
  dayVisitItems=occ;
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
  const t=v.tripId?trips[v.tripId]:null, stay=visitKind(v)==="stay", nights=stayNights(v);
  const tags=[
    stay?`<span class="ptag" style="background:#e6efe9">住宿 ${nights}晚 · ${esc(v.date)} → ${esc(stayCheckout(v)||v.date)}</span>`:"",
    cat?`<span class="ptag" style="background:${col};color:${textOn(col)}">${esc(cat)}</span>`:"",
    `<span class="ptag" style="background:#efe9df">${esc(whoTxt)}</span>`,
    t?`<span class="ptag" style="background:${(t.color||'#3f7d78')}22">${t.emoji||'🧭'} ${esc(t.name)}</span>`:`<span class="ptag" style="background:#f2f0eb">日常</span>`,
    p.rating?`<span class="ptag" style="background:#f3e7d3">★${p.rating}</span>`:""
  ].filter(Boolean).join("");
  const key=`${p.id}:${o.visitIndex}`;
  return `<div class="card compact" id="vc_${p.id}_${o.visitIndex}" data-visit-key="${key}" data-date="${esc(date)}" data-pid="${p.id}" data-vidx="${o.visitIndex}" style="background:${col}14"><div style="display:flex;align-items:center;gap:8px">
    <span class="dot" style="background:${col};flex:0 0 auto"></span><div style="flex:1;min-width:0"><div class="cname">${esc(p.name)}</div><div class="ptags">${tags}</div></div>
    <span class="daynum" style="${String(label).length>2?'width:auto;min-width:32px;padding:0 5px;border-radius:10px;font-size:11px':''}">${esc(String(label))}</span>
    ${orderInfo?`<div class="visitorder"><div class="ordcol"><button class="ordbtn" data-vmove="up" data-vkey="${key}" data-date="${esc(date)}" title="往前一站" ${orderInfo.position===1?'disabled':''}>▲</button><button class="ordbtn" data-vmove="down" data-vkey="${key}" data-date="${esc(date)}" title="往後一站" ${orderInfo.position===orderInfo.total?'disabled':''}>▼</button></div><select class="ordselect" data-vposition="${key}" data-date="${esc(date)}" aria-label="移動造訪位置" title="移動到指定位置"><option value="">移至</option><option value="first">最前</option>${Array.from({length:orderInfo.total},(_,i)=>`<option value="${i+1}">第 ${i+1}</option>`).join("")}<option value="last">最後</option></select></div>`:""}
    <button class="delx" data-vdel="${key}" title="刪除此造訪">✕</button></div></div>`;
}
function stayAnchorCardHTML(o,label,date){
  const p=o.p,v=o.v,cat=visitCategory(p,v),col=cat?catColor(cat):levelColors["住宿"];
  const nights=stayNights(v), n=o.stayAnchor==="morning"?Math.max(1,dayDiff(v.date,date)):Math.max(1,dayDiff(v.date,date)+1);
  const edge=o.stayAnchor==="morning"?`住宿後出發 · 第 ${Math.min(n,nights)}/${nights} 晚後`:`夜宿 · 第 ${Math.min(n,nights)}/${nights} 晚`;
  const t=v.tripId?trips[v.tripId]:null;
  return `<div class="card compact stayanchor" data-stay-anchor="1" data-date="${esc(date)}" data-pid="${p.id}" data-vidx="${o.visitIndex}" style="background:${col}10"><div style="display:flex;align-items:center;gap:8px">
    <span style="font-size:15px">🏨</span><div style="flex:1;min-width:0"><div class="cname">${esc(p.name)}</div><div class="ptags"><span class="stayedge">${edge}</span><span class="ptag" style="background:#efe9df">${esc(visitWhoText(p,v))}</span>${t?`<span class="ptag" style="background:${(t.color||'#3f7d78')}22">${t.emoji||'🧭'} ${esc(t.name)}</span>`:""}</div></div>
    <span class="daynum" style="${String(label).length>2?'width:auto;min-width:32px;padding:0 5px;border-radius:10px;font-size:11px':''}">${esc(String(label))}</span>
  </div></div>`;
}
function renderDayVisitList(el,date){
  const seq=getDayOccurrences(date);
  dayVisitItems=seq;
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
  el.querySelectorAll("[data-vdel]").forEach(b=>b.onclick=ev=>{ev.stopPropagation();deleteVisitOccurrence(b.dataset.vdel);});
  el.querySelectorAll("[data-vmove]").forEach(b=>b.onclick=ev=>{ev.stopPropagation();moveVisitOccurrence(b.dataset.vkey,b.dataset.date,b.dataset.vmove);});
  el.querySelectorAll("[data-vposition]").forEach(s=>s.onchange=ev=>{ev.stopPropagation();if(s.value) moveVisitOccurrence(s.dataset.vposition,s.dataset.date,s.value);s.value="";});
}
async function moveVisitOccurrence(key,date,action){
  const opSpaceId=currentSpaceId;
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
  const reordered=reorderWithinSlots(regular,movable,i,j);
  const byPlace=new Map();
  reordered.forEach((o,pos)=>{
    const p=o.p;
    if(!byPlace.has(p.id)) byPlace.set(p.id,placeVisits(p).map(v=>persistableVisit(p,v)));
    const vv=byPlace.get(p.id); if(vv[o.visitIndex]) vv[o.visitIndex].order=pos+1;
  });
  if(opSpaceId!==currentSpaceId) return;
  [...byPlace.entries()].forEach(([id,vv])=>{ if(places[id]) places[id].visits=vv; });
  renderList(); renderMarkers();
  await Promise.all([...byPlace.entries()].map(([id,vv])=>updateDoc(placeDocFor(opSpaceId,id),{visits:vv,...visitLegacyFields(vv,places[id])})));
}

// Serialize a normalized Visit for a whole-array rewrite without disturbing its
// raw participant representation (APPROVED PHASE 2 CONTRACT §8). A Visit that
// carried neither field keeps today's behaviour of materialising `who`.
function persistableVisit(p,v){
  const fields=nextVisitParticipantFields({ raw:v, edited:false, resolvedIds:visitWhoUids(p,v) });
  const out={ ...v };
  delete out.participantIds; delete out.who;
  if (Object.hasOwn(fields,"participantIds")) out.participantIds=fields.participantIds;
  if (Object.hasOwn(fields,"who")) out.who=fields.who;
  return out;
}
function visitLegacyFields(vv,p=null){
  const base=p||{}, clean=vv.filter(v=>v.date).map((v,i)=>normalizedVisit(base,v,i));
  const latest=clean.slice().sort((a,b)=>a.date.localeCompare(b.date)||(Number(a.order)||1e9)-(Number(b.order)||1e9)).pop();
  const who=latest ? visitWhoUids(base,latest) : whoUids(base);
  return {
    visitedOn:latest?latest.date:"",
    tripId:latest?.tripId||"",
    categories:latest?.category?[latest.category]:(base.categories||[]),
    who,
    whoMode:deriveLegacyWhoMode(who, { ...legacyParticipantContext(), createdBy:base.createdBy })
  };
}
async function deleteVisitOccurrence(key){
  const opSpaceId=currentSpaceId;
  const [pid,idxRaw]=key.split(":"),p=places[pid],idx=+idxRaw; if(!p) return;
  const vv=placeVisits(p).map(v=>persistableVisit(p,v)); if(idx<0||idx>=vv.length) return;
  vv.splice(idx,1);
  if(opSpaceId!==currentSpaceId) return;
  if(!vv.length){
    // Deleting the last remaining Visit removes the whole Place — a Place only
    // exists because it has Visit history (§15).
    await deleteDoc(placeDocFor(opSpaceId,pid));
  }else{
    await updateDoc(placeDocFor(opSpaceId,pid),{visits:vv,status:"visited",...visitLegacyFields(vv,p)});
  }
}

/* ============================================================
   5) 搜尋(Google Places New:AutocompleteSuggestion → toPlace → fetchFields)
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
    const q = input.value.trim();
    if (q.length < 2){ box.style.display="none"; return; }
    searchTimer = setTimeout(async () => {
      // Capture the Space session AND a request generation BEFORE the request
      // begins (§5). A Space switch or a newer keystroke invalidates both.
      const reqSession = spaceSession;
      const reqSeq = ++searchReqSeq;
      const reqCurrent = () => reqSeq === searchReqSeq && isCurrentSpaceSession(reqSession, spaceSession);
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
  const pickerSession = spaceSession;
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
  if (!isCurrentSpaceSession(pickerSession, spaceSession)) return;   // switched Space mid-lookup (§18)
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
    if (!isCurrentSpaceSession(pickerSession, spaceSession)) return;
    openSeed({ name: pl.displayName||"", lat: la, lng: ln, admin, source:"google", extId: pl.id });
  });
  document.getElementById("nb_custom").onclick = async () => {
    closeModal();
    const admin = await reverseGeocode(lat, lng);
    if (!isCurrentSpaceSession(pickerSession, spaceSession)) return;
    openEditor(null, { name:"", lat, lng, admin, source:"map" });
  };
}

function addDays(date,n){
  if(!date) return ""; const d=new Date(date+"T00:00:00"); d.setDate(d.getDate()+n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
const placeEditorWriteQueues=new Map();
// Every queued write targets the Space that owned the editor (§17), never a
// later switched-to Space. Only mutate the in-memory Place when that Space is
// still the active one.
function persistPlaceEditorData(spaceId,id,data){
  if(spaceId===currentSpaceId && places[id]) Object.assign(places[id],data);
  const key=`${spaceId}:${id}`;
  const previous=placeEditorWriteQueues.get(key)||Promise.resolve();
  const write=previous.then(()=>updateDoc(placeDocFor(spaceId,id),data));
  const settled=write.catch(()=>{});
  placeEditorWriteQueues.set(key,settled);
  settled.finally(()=>{ if(placeEditorWriteQueues.get(key)===settled) placeEditorWriteQueues.delete(key); });
  return write;
}
function openEditor(id, seed, opts={}){
  const p = id ? places[id] : { categories:[], ...seed };
  const shared=placeSharedFields(p);
  // The editor is bound to the Space that was active when it opened. Every write
  // it makes targets `editorSpaceId`, and it stops acting once a Space switch
  // invalidates its session (§17).
  const editorSpaceId = currentSpaceId;
  const editorSession = spaceSession;
  const editorLive = () => isCurrentSpaceSession(editorSession, spaceSession);
  let docId = id || null, persistQueue=Promise.resolve();
  let level = shared.level;
  let deleted = false;   // set once the Place has been deleted (last Visit removed / 刪除地點)
  // Legacy whoMode anchor: a NEW Place is genuinely created by the current
  // User; an EXISTING Place uses only its explicit stored `createdBy` and never
  // substitutes the viewer, so an old Place resolves/serializes the same for
  // everyone (Phase 2 §2). deriveLegacyWhoMode stays fail-closed when empty.
  const partCtx = {
    ...legacyParticipantContext(),
    createdBy: isUsableUid(p.createdBy) ? p.createdBy : (id ? "" : (user?.uid || ""))
  };
  const activeMembersList = orderedActiveMembers();
  const activeIds = activeMembersList.map(m=>m.userId);
  const activeIdSet = new Set(activeIds);
  const filterTrip = specificTripId();
  const defaultDate = defaultDateForNewVisit();
  // Every NEW-Visit participant seed is intersected with active valid
  // Memberships — a removed Member is never copied into new data merely because
  // a previous Visit had them (CONTRACT §3). A new/explicitly-edited Visit
  // writes `participantIds` and `who` identically.
  const newWorkingVisit = (base, selected) => ({
    ...base,
    _raw:{},
    _selected:orderParticipantSelection(sanitizeParticipantsForNewSelection(selected, activeIds), activeIds),
    _participantsEdited:true,
    _mismatch:null
  });
  const loadWorkingVisit = (rawVisit, i) => {
    const norm = normalizedVisit(p, rawVisit, i);
    const id = (norm.id && !String(norm.id).startsWith("legacy_")) ? norm.id : newVisitId();
    const resolved = resolveVisitParticipants(norm, p, partCtx).participantIds;
    return {
      ...norm,
      id,
      _raw:{
        ...(Object.hasOwn(norm,"participantIds") ? { participantIds:norm.participantIds } : {}),
        ...(Object.hasOwn(norm,"who") ? { who:norm.who } : {})
      },
      // Active Members + retained historical participants. Historical entries
      // stay until the user explicitly removes them (one-way, §1).
      _selected:orderParticipantSelection(resolved, activeIds),
      _participantsEdited:false,
      _mismatch:detectParticipantMismatch(norm)
    };
  };
  let visits = placeVisits(p).map(loadWorkingVisit);
  let focusIndex = Number.isFinite(Number(opts.focusVisitIndex)) ? Number(opts.focusVisitIndex) : -1;
  // A Place exists in the active product only because it has Visit history:
  //  - a brand-new Place, or a legacy record reached through explicit search/add
  //    (`opts.addVisit`), gets its first Visit here using the Phase 2 defaults;
  //  - an existing recorded Place with no Visits (should not occur in normal
  //    views) is defensively given one so it never stays as an empty document.
  if (opts.addVisit || !id || !visits.length){
    const prev=id?latestVisit(p):null;
    const cat=prev ? visitCategory(p,prev) : (filter.cats.size===1?[...filter.cats][0]:((p.categories||[])[0]||""));
    const prevSeed=prev?visitWhoUids(p,prev):[];
    const k=level==="住宿"?"stay":"visit";
    visits.push(newWorkingVisit(
      {id:newVisitId(),kind:k,date:defaultDate,endDate:k==="stay"?addDays(defaultDate,1):"",tripId:filterTrip||"",category:cat},
      prevSeed.length?prevSeed:defaultParticipants()
    ));
    focusIndex=visits.length-1;
  }

  // Arbitrary-Member participant picker. Active Members are toggle chips.
  // Historical (removed / unknown) participants already on the record render as
  // a chip with an explicit "×": they are preserved until removed, the removal
  // is one-way, and they are never offered as a re-addable candidate (§1, §2).
  function participantPickHTML(selectedIds, opts={}){
    const sel=[...new Set(selectedIds||[])];
    const selSet=new Set(sel);
    const attr=`${opts.id?` id="${opts.id}"`:""} class="pick partpick${opts.cls?` ${opts.cls}`:""}"`;
    const historical=sel.filter(uid=>!activeIdSet.has(uid));
    if(!activeMembersList.length && !historical.length){
      return `<div${attr}><span style="font-size:12px;color:var(--ink-soft)">尚無可選成員</span></div>`;
    }
    const active=activeMembersList.map(m=>
      `<span class="chip ${selSet.has(m.userId)?'on':''}" data-uid="${esc(m.userId)}" role="button" tabindex="0">${esc(participantName(m.userId))}</span>`
    ).join("");
    const removed=historical.map(uid=>
      `<span class="chip histchip" title="歷史參與者：可移除，但無法重新加入">${esc(participantName(uid))} <b class="histx" data-hist-uid="${esc(uid)}" role="button" tabindex="0" aria-label="移除">×</b></span>`
    ).join("");
    return `<div${attr}>${active}${removed}</div>`;
  }
  function wireParticipantPick(container, getSelected, setSelected){
    if(!container) return;
    const commit = next => setSelected(orderParticipantSelection(next, activeIds));
    container.querySelectorAll(".chip[data-uid]").forEach(chip=>{
      const toggle=()=>{
        const uid=chip.dataset.uid, cur=getSelected();
        commit(cur.includes(uid) ? cur.filter(x=>x!==uid) : [...cur, uid]);
      };
      chip.onclick=toggle;
      chip.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); toggle(); } };
    });
    container.querySelectorAll(".histx[data-hist-uid]").forEach(x=>{
      const remove=e=>{ e.stopPropagation(); commit(getSelected().filter(y=>y!==x.dataset.histUid)); };
      x.onclick=remove;
      x.onkeydown=e=>{ if(e.key==="Enter"||e.key===" "){ e.preventDefault(); remove(e); } };
    });
  }
  modal(`
    <h2 style="margin-bottom:3px">${esc(p.name||"新地點")}</h2>
    <div class="admin" style="margin-bottom:10px">改動會自動儲存${opts.addVisit?" · 本次已帶入上一次的設定，可直接修改":""}</div>

    <div class="editor-section">
      <div class="editor-section-head"><div class="editor-section-title">地點</div></div>
      <input id="f_name" value="${esc(p.name||"")}" placeholder="名稱" style="width:100%;padding:9px;border:1px solid var(--line);border-radius:9px;background:#fff">
    </div>

    <div class="editor-section" id="f_visitwrap">
      <div class="editor-section-head">
        <div><div class="editor-section-title">造訪紀錄</div><div class="editor-section-note">每次造訪各自記日期、目的、旅程與同行者；評價仍共用</div></div>
        <button class="btn grey mini" id="v_add" type="button">＋新增</button>
      </div>
      <div id="f_visits"></div>
    </div>

    <div class="editor-section">
      <div class="editor-section-head"><div><div class="editor-section-title">地點共用</div><div class="editor-section-note">以下設定不分造訪次數</div></div></div>
      <div class="field" style="margin-bottom:10px"><label>造訪深度</label>
        <div class="seg lvlseg" id="f_level">${LEVEL_ORDER.map(l=>`<button data-l="${l}" class="${level===l?'on':''}" style="${level===l?`background:${levelColors[l]};color:#fff`:''}">${l}</button>`).join("")}</div>
      </div>
      <div class="field" style="margin-bottom:8px"><label>共用評價</label>
        <div class="row" style="align-items:center;gap:10px"><input type="range" id="f_rating" min="0" max="5" step="0.5" value="${shared.rating}" style="flex:1"><span id="f_ratingval" style="width:64px;text-align:right;color:var(--ink-soft)">${shared.rating?("★ "+shared.rating):"未評分"}</span></div>
      </div>
      <textarea id="f_review" placeholder="這個地點的共用評語…" style="width:100%;min-height:62px;padding:9px;border:1px solid var(--line);border-radius:9px;background:#fff;resize:vertical">${esc(shared.review)}</textarea>
    </div>

    <div class="row"><button class="btn" id="f_done">完成</button>${id?`<button class="danger" id="f_del" style="border-radius:10px">刪除地點</button>`:``}</div>
  `);

  const nameEl=document.getElementById("f_name"), visitWrap=document.getElementById("f_visitwrap");
  function collect(){
    const clean=visits.filter(v=>v.date).map(v=>{
      const kind=v.kind==="stay"?"stay":"visit";
      const out={id:v.id||newVisitId(),kind,date:v.date,tripId:v.tripId||"",category:v.category||""};
      if(kind==="stay") out.endDate=(v.endDate&&v.endDate>v.date)?v.endDate:addDays(v.date,1);
      else out.endDate="";
      if(Number.isFinite(Number(v.order))) out.order=Number(v.order);
      // Preserve the raw participant representation for untouched Visits; write
      // both fields identically only on an explicit participant edit / new Visit
      // (APPROVED PHASE 2 CONTRACT §3, §8).
      const parts=nextVisitParticipantFields({
        raw:v._raw||{},
        edited:!!v._participantsEdited,
        selectedIds:v._selected||[],
        resolvedIds:v._selected||[]
      });
      if(Object.hasOwn(parts,"participantIds")) out.participantIds=parts.participantIds;
      if(Object.hasOwn(parts,"who")) out.who=parts.who;
      return out;
    });
    const latest=clean.slice().sort((a,b)=>a.date.localeCompare(b.date)||(Number(a.order)||1e9)-(Number(b.order)||1e9)).pop();
    const summaryWho=latest ? resolveVisitParticipants(latest, p, partCtx).participantIds : defaultParticipants();
    const rv=parseFloat(document.getElementById("f_rating").value);
    const latestCat=latest?.category||"";
    // A recorded Place is always a Visit-bearing document. `status:"visited"` is
    // kept only as a mixed-client compatibility mirror (§18); it carries no
    // domain meaning any more.
    return {
      name:nameEl.value.trim(),lat:p.lat,lng:p.lng,source:p.source||"google",extId:p.extId||null,admin:p.admin||{},
      status:"visited", categories:latestCat?[latestCat]:[], level, whoMode:deriveLegacyWhoMode(summaryWho, partCtx), who:summaryWho,
      visits:clean, visitedOn:latest?.date||"", tripId:latest?.tripId||"",
      rating:rv>0?rv:null, review:document.getElementById("f_review").value.trim()
    };
  }
  function persist(){
    if(!editorLive() || deleted) return Promise.resolve();   // switch invalidated the editor, or the Place is gone
    const data=collect();
    if(!data.visits.length) return Promise.resolve();   // never autosave an empty Place (§15)
    if(docId) return persistPlaceEditorData(editorSpaceId,docId,data);
    const queued=persistQueue.then(async()=>{
      if(!editorLive() || deleted) return;
      if(!docId){
        if(!data.name) return;
        data.createdBy=user.uid; data.createdAt=serverTimestamp();
        const ref=await addDoc(placesColFor(editorSpaceId),data); docId=ref.id;
      }else await persistPlaceEditorData(editorSpaceId,docId,data);
    });
    persistQueue=queued.catch(()=>{});
    return queued;
  }
  async function deletePlaceAndClose(){
    deleted = true;
    try { if (editorLive() && docId) await deleteDoc(placeDocFor(editorSpaceId, docId)); }
    catch(e){ /* snapshot will reconcile */ }
    closeModal();
  }
  function catOptions(selected){
    return `<option value="">未分類</option>`+spaceCats.map(c=>`<option value="${esc(c)}" ${selected===c?'selected':''}>${esc(c)}</option>`).join("")+`<option value="__new__">＋新增分類…</option>`;
  }
  function tripOptions(selected){
    return `<option value="">日常</option>`+Object.values(trips).map(t=>`<option value="${t.id}" ${selected===t.id?'selected':''}>${esc((t.emoji?t.emoji+' ':'')+t.name)}</option>`).join('')+`<option value="__new__">＋新增旅程…</option>`;
  }
  function renderVisits(){
    const box=document.getElementById("f_visits"); if(!box) return;
    if(!visits.length){ box.innerHTML=`<div style="font-size:12px;color:var(--ink-soft);padding:4px 2px 8px">尚無造訪紀錄。</div>`; return; }
    box.innerHTML=visits.map((v,i)=>{
      const stay=visitKind(v)==="stay", co=stay?(v.endDate&&v.endDate>v.date?v.endDate:addDays(v.date,1)):"";
      const nights=stay?Math.max(1,dayDiff(v.date||co,co)):0;
      const conflict=v._mismatch?.mismatch && !v._participantsEdited;
      return `<div class="visitrow ${i===focusIndex?'focus':''}" data-i="${i}">
        ${i===focusIndex?`<span class="visitbadge">本次</span>`:""}
        <div class="visitmain ${stay?'stay':''}">
          <input type="date" class="v_date" value="${v.date||''}" title="${stay?'入住日':'造訪日'}">
          ${stay?`<span class="stayarrow">→</span><input type="date" class="v_end" min="${v.date||''}" value="${co}" title="退房日">`:``}
          <button class="delx v_del" title="刪除此造訪">✕</button>
          ${stay?`<div class="staymeta">${nights} 晚 · 自動成為每晚最後一站與隔天早上第一站</div>`:``}
        </div>
        <div class="visitextra">
          <label class="visitmini"><span>做什麼</span><select class="v_cat">${catOptions(v.category||'')}</select></label>
          <label class="visitmini"><span>旅程</span><select class="v_trip">${tripOptions(v.tripId||'')}</select></label>
        </div>
        <div class="visitparts">
          <span>同行</span>
          ${participantPickHTML(v._selected||[], {cls:"v_who"})}
          ${conflict?`<div class="visitwarn">同行者資料需確認（who 與 participantIds 不一致，顯示以 participantIds 為準；重新選擇即可更新）</div>`:""}
        </div>
      </div>`;
    }).join("");
    box.querySelectorAll(".visitrow").forEach(row=>{
      const i=+row.dataset.i, d=row.querySelector(".v_date"), cat=row.querySelector(".v_cat"), trip=row.querySelector(".v_trip"), end=row.querySelector(".v_end");
      wireParticipantPick(
        row.querySelector(".v_who"),
        ()=>visits[i]._selected||[],
        next=>{ visits[i]._selected=next; visits[i]._participantsEdited=true; focusIndex=i; renderVisits(); persist(); }
      );
      d.onchange=()=>{
        visits[i].date=d.value;
        if(visitKind(visits[i])==="stay" && (!visits[i].endDate||visits[i].endDate<=d.value)) visits[i].endDate=addDays(d.value,1);
        if(d.value&&!visits[i].tripId){ const t=Object.values(trips).find(t=>t.startDate&&t.endDate&&d.value>=t.startDate&&d.value<=t.endDate); if(t) visits[i].tripId=t.id; }
        focusIndex=i; renderVisits(); persist();
      };
      cat.onchange=()=>{
        if(cat.value==="__new__"){
          const name=(prompt("新增分類(例:溫泉、看展、爬山)")||"").trim();
          if(!name){ renderVisits(); return; }
          if(!spaceCats.includes(name)){ spaceCats.push(name); if(editorLive()) setDoc(metaDocFor(editorSpaceId),{categories:arrayUnion(name)},{merge:true}); }
          visits[i].category=name; focusIndex=i; renderVisits(); persist(); return;
        }
        visits[i].category=cat.value; focusIndex=i; persist();
      };
      trip.onchange=()=>{
        if(trip.value==="__new__"){
          trip.value=visits[i].tripId||""; editTrip(null,t=>{visits[i].tripId=t.id;focusIndex=i;renderVisits();persist();}); return;
        }
        visits[i].tripId=trip.value; focusIndex=i; persist();
      };
      if(end) end.onchange=()=>{
        visits[i].kind="stay";
        visits[i].endDate=end.value&&end.value>visits[i].date?end.value:addDays(visits[i].date,1); focusIndex=i; renderVisits(); persist();
      };
      row.querySelector(".v_del").onclick=()=>{
        // Deleting the last Visit deletes the whole Place and closes the editor
        // (§15). Otherwise the Place keeps its remaining Visits.
        if(visits.length<=1){ deletePlaceAndClose(); return; }
        visits.splice(i,1); focusIndex=Math.min(i,visits.length-1);
        renderVisits(); persist();
      };
    });
    if(focusIndex>=0){ setTimeout(()=>{ const r=box.querySelector(`.visitrow[data-i="${focusIndex}"]`); r?.scrollIntoView({block:"nearest"}); },0); }
  }
  function addVisit(){
    const prev=visits.filter(v=>v.date).slice().sort((a,b)=>a.date.localeCompare(b.date)||(Number(a.order)||1e9)-(Number(b.order)||1e9)).pop();
    const d=defaultDateForNewVisit(), k=level==="住宿"?"stay":"visit";
    const seedParticipants=prev?sanitizeParticipantsForNewSelection(prev._selected||[], activeIds):[];
    visits.push(newWorkingVisit(
      {id:newVisitId(),kind:k,date:d,endDate:k==="stay"?addDays(d,1):"",tripId:filterTrip||"",category:prev?.category||latestVisitCategory(p)||""},
      seedParticipants.length?seedParticipants:defaultParticipants()
    ));
    focusIndex=visits.length-1; renderVisits(); persist();
  }

  renderVisits();
  document.getElementById("v_add").onclick=addVisit;

  document.querySelectorAll("#f_level button").forEach(b=>b.onclick=()=>{
    level=b.dataset.l;
    document.querySelectorAll("#f_level button").forEach(x=>{x.classList.remove("on");x.style.background="";x.style.color="";}); b.classList.add("on");b.style.background=levelColors[level];b.style.color="#fff";
    if(level==="住宿"){
      if(!visits.length){ const d=defaultDateForNewVisit(); visits.push(newWorkingVisit({id:newVisitId(),kind:"stay",date:d,endDate:addDays(d,1),tripId:filterTrip||"",category:""}, defaultParticipants())); focusIndex=0; }
      const i=focusIndex>=0?focusIndex:visits.length-1;
      if(visits[i]){ visits[i].kind="stay"; visits[i].endDate=(visits[i].endDate&&visits[i].endDate>visits[i].date)?visits[i].endDate:addDays(visits[i].date||defaultDateForNewVisit(),1); if(!visits[i].category&&spaceCats.includes("住宿"))visits[i].category="住宿"; focusIndex=i; renderVisits(); }
    }
    persist();
  });
  nameEl.addEventListener("change",persist); nameEl.addEventListener("blur",persist);
  const rEl=document.getElementById("f_rating"),rVal=document.getElementById("f_ratingval");
  rEl.oninput=()=>{const v=parseFloat(rEl.value);rVal.textContent=v>0?("★ "+v):"未評分";}; rEl.addEventListener("change",persist);
  document.getElementById("f_review").addEventListener("blur",persist);
  document.getElementById("f_done").onclick=async()=>{await persist();closeModal();};
  const fdel=document.getElementById("f_del"); if(fdel)fdel.onclick=deletePlaceAndClose;
  if(!id&&collect().name) persist();
}

/* ============================================================
   7) 詳情:雙方感想 + 加到行程
   ============================================================ */
/* ============================================================
   7) 旅程(以 tripId 歸屬;點旅程 = 篩選該趟)
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
        <button class="delx" data-del="${t.id}" title="刪除">✕</button>
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
  el.querySelectorAll("[data-del]").forEach(b => b.onclick = ev => { ev.stopPropagation(); deleteDoc(tripDoc(b.dataset.del)); });
}
function editTrip(id, onDone){
  let docId = id || null, creating = false;
  const t = id ? trips[id] : {};
  let emoji = t.emoji || "";
  const g = x => document.getElementById(x);
  const tripSpaceId = currentSpaceId;
  const tripSession = spaceSession;
  const tripLive = () => isCurrentSpaceSession(tripSession, spaceSession);
  modal(`
    <h2 style="margin-bottom:2px">${id?"編輯":"新"}旅程</h2>
    <div style="font-size:12px;color:var(--ink-soft);margin-bottom:12px">改動會自動儲存</div>
    <div class="field"><label>表情 + 名稱</label>
      <div class="row" style="gap:8px;position:relative">
        <button type="button" id="t_emoji" style="flex:0 0 52px;height:40px;font-size:22px;border:1px solid var(--line);border-radius:8px;background:#fff;cursor:pointer">${emoji||"➕"}</button>
        <input id="t_name" value="${esc(t.name||"")}" placeholder="例:2026 東京" style="flex:1">
        <div id="emojipop" style="display:none;position:absolute;top:46px;left:0;z-index:30;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:8px;grid-template-columns:repeat(7,1fr);gap:2px;width:264px">
          ${EMOJIS.map(e=>`<button type="button" class="emojibtn" data-e="${e}" style="font-size:20px;border:none;background:none;cursor:pointer;padding:4px">${e}</button>`).join("")}
        </div>
      </div>
    </div>
    <div class="row">
      <div class="field" style="flex:1"><label>開始</label><input type="date" id="t_start" value="${t.startDate||""}"></div>
      <div class="field" style="flex:1"><label>結束</label><input type="date" id="t_end" value="${t.endDate||""}"></div>
    </div>
    <div class="field"><label>顏色</label>
      <input type="color" id="t_color" value="${t.color||"#3f7d78"}" style="width:48px;height:34px;padding:0;border:1px solid var(--line);border-radius:8px">
    </div>
    <div class="row">
      <button class="btn" id="t_done">完成</button>
      ${id?`<button class="danger" id="t_del" style="border-radius:10px">刪除</button>`:``}
    </div>
  `);
  const eBtn = g("t_emoji"), ePop = g("emojipop");
  eBtn.onclick = () => { ePop.style.display = ePop.style.display === "none" ? "grid" : "none"; };
  ePop.querySelectorAll(".emojibtn").forEach(b => b.onclick = () => {
    emoji = b.dataset.e; eBtn.textContent = emoji; ePop.style.display = "none"; persist();
  });
  function collect(){ return { emoji, name:g("t_name").value.trim(),
    startDate:g("t_start").value, endDate:g("t_end").value, color:g("t_color").value }; }
  async function persist(){
    if (!tripLive()) return;   // a Space switch invalidated this Trip editor
    const data = collect();
    if (!docId){ if(!data.name||creating) return; creating=true;
      data.createdBy=user.uid; data.createdAt=serverTimestamp();
      const ref=await addDoc(tripsColFor(tripSpaceId),data); docId=ref.id; creating=false; }
    else await updateDoc(tripDocFor(tripSpaceId,docId), data);
  }
  ["t_name","t_start","t_end","t_color"].forEach(x => {
    g(x).addEventListener("change", persist); g(x).addEventListener("blur", persist);
  });
  g("t_done").onclick = async () => {
    await persist();
    if (onDone && docId) onDone({ id: docId, ...collect() });
    closeModal();
  };
  const td = g("t_del");
  if (td) td.onclick = async () => { if (tripLive()) await deleteDoc(tripDocFor(tripSpaceId,docId||id)); closeModal(); };
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
  currentSpaceId = runtimeConfig.spaceId;
  if (!runtimeConfig.firebase.projectId || !runtimeConfig.google.apiKey) renderSetup();
  else boot();
} catch(e){
  showRuntimeFatal(`Firebase environment safety check failed.\n${e.message}`, true);
}
