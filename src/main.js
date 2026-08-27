import { initializeApp } from "https://www.gstatic.com/firebasejs/12.11.0/firebase-app.js";
import { getAuth, GoogleAuthProvider, signInWithPopup, signInWithCustomToken, signOut, onAuthStateChanged, connectAuthEmulator }
  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-auth.js";
import { getFirestore, collection, doc, addDoc, updateDoc, deleteDoc, setDoc,
         onSnapshot, query, orderBy, arrayUnion, serverTimestamp, connectFirestoreEmulator }
  from "https://www.gstatic.com/firebasejs/12.11.0/firebase-firestore.js";
import { resolveRuntimeConfig } from "./config.js";
import {
  isVisitReorderAvailable,
  layoutViewState,
  ordinaryOccurrences,
  placeSharedFields,
  reorderWithinSlots,
  resolveVisitMoveTarget,
  shouldShowReorderControls,
  shouldAutoFitViewport,
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
let map, geocoder, MapCtor, AdvMarker, Pin, AutocompleteSuggestion, AutocompleteSessionToken, PlaceClass;
let markers = [], tripLine = null, sessionToken = null;
let places = {}, trips = {}, tab = "visited";
let choroLevel = "off", choroLayer = null, geoCache = {};
let showPins = true, choroAlpha = 0.7, choroMetric = "level", numberPins = false;
let catColors = {}, markerMode = "cat", lastMarkerClick = 0;
let nicknames = {}, levelColors = { ...LEVEL_COLORS }, addMode = false;
let choroLayerLevel = null, legendCollapsed = false;
let proximityStorage = null;
try { proximityStorage = globalThis.localStorage; } catch(e) {}
const initialProximityPreferences = readProximityPreferences(proximityStorage);
let proximityRadius = initialProximityPreferences.radius;
let proximityMaskTaiwan = initialProximityPreferences.maskToTaiwan;
let proximityLayer = null, proximityLayerKey = "", proximityMaskIndex = null, proximityRenderVersion = 0;
let proximityOutlineLayer = null, proximityOutlineKey = "";
let selectedRegionMaskCache = { identity:"", maskIndex:null, outline:null };
let proximitySeedCount = 0, proximityRadiusTimer = null;
const proximityGeometryCache = new Map();
const CAT_PALETTE = ["#d98b3f","#3f7d78","#b25b6b","#6b8fb2","#8f6bb2","#b2a03f","#5fa38a","#c2603f","#4f9d5f","#b23f7a","#3f6bb2","#7a7a7a"];
const nameFor = uid => nicknames[uid] || members[uid] || (uid===(user&&user.uid) ? "我" : "對方");
function catColor(c){ return catColors[c] || CAT_PALETTE[Math.max(0, spaceCats.indexOf(c)) % CAT_PALETTE.length]; }
function textOn(hex){
  const h=(hex||"#888").replace("#",""); if(h.length<6) return "#152230";
  const r=parseInt(h.slice(0,2),16),g=parseInt(h.slice(2,4),16),b=parseInt(h.slice(4,6),16);
  return (0.299*r+0.587*g+0.114*b) > 150 ? "#152230" : "#ffffff";
}
let members = {};   // uid -> 顯示名稱(兩人)
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
const partnerUid = () => Object.keys(members).find(u => u !== (user && user.uid)) || null;
const otherOf = uid => Object.keys(members).find(u => u !== uid) || null;
// 舊資料的「誰去」保留在地點層級作相容摘要；新資料以每次 visit.who 為準
function whoUids(p){
  const creator = p.createdBy, other = otherOf(creator);
  if (p.whoMode === "both") return [creator, other].filter(Boolean);
  if (p.whoMode === "me")   return [creator].filter(Boolean);
  if (p.whoMode === "partner") return [other].filter(Boolean);
  return (p.who && p.who.length) ? p.who : (creator ? [creator] : []);
}
function whoModeOf(p){
  if (p.whoMode) return p.whoMode;
  const w = p.who||[], creator = p.createdBy, other = otherOf(creator);
  if (creator && w.includes(creator) && other && w.includes(other)) return "both";
  if (other && w.includes(other) && !(creator && w.includes(creator))) return "partner";
  return "me";
}
function legacyWhoModeForPlace(p,w){
  const creator=p?.createdBy||user?.uid, other=otherOf(creator), arr=Array.isArray(w)?w:[];
  if(creator&&arr.includes(creator)&&other&&arr.includes(other)) return "both";
  if(other&&arr.includes(other)&&!arr.includes(creator)) return "partner";
  return "me";
}
function newVisitId(){
  try { if (crypto?.randomUUID) return crypto.randomUUID(); } catch(e){}
  return `v_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
}
function normalizedVisit(p,v,i=0){
  const fallbackCat=(p.categories||[])[0]||"";
  const kind=v?.kind || ((v?.endDate && v.endDate>v.date) ? "stay" : "visit");
  const legacyWho=whoUids(p);
  return {
    id:v?.id || `legacy_${i}`,
    kind,
    date:v?.date||"",
    endDate:v?.endDate||"",
    tripId:v?.tripId||"",
    category:v?.category || (v?.categories||[])[0] || fallbackCat,
    who:(Array.isArray(v?.who) && v.who.length) ? [...v.who] : [...legacyWho],
    ...(Number.isFinite(Number(v?.order)) ? {order:Number(v.order)} : {})
  };
}
// 一個 place 是共享地點；visits 是獨立造訪事件。舊資料會即時以相容格式讀取。
function placeVisits(p){
  if (p.visits && p.visits.length) return p.visits.map((v,i)=>normalizedVisit(p,v,i));
  if (p.visitedOn) return [normalizedVisit(p,{ date:p.visitedOn, tripId:p.tripId||"", category:(p.categories||[])[0]||"" },0)];
  return [];
}
function visitCategory(p,v){ return v?.category || (p.categories||[])[0] || ""; }
function visitWhoUids(p,v){ return (Array.isArray(v?.who) && v.who.length) ? v.who : whoUids(p); }
function visitWhoMode(p,v){
  const w=visitWhoUids(p,v), pu=partnerUid();
  if(user && w.includes(user.uid) && pu && w.includes(pu)) return "both";
  if(user && w.includes(user.uid)) return "me";
  if(pu && w.includes(pu)) return "partner";
  return w.length>1 ? "both" : "me";
}
function whoUidsFromMode(mode){
  const pu=partnerUid();
  if(mode==="both") return [user?.uid,pu].filter(Boolean);
  if(mode==="partner") return pu?[pu]:[];
  return user?.uid?[user.uid]:[];
}
function visitWhoText(p,v){
  const mode=visitWhoMode(p,v), pu=partnerUid();
  if(mode==="both") return "一起";
  if(mode==="partner") return pu?nameFor(pu):"對方";
  return user?nameFor(user.uid):"我";
}
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
  if (!placeStaticFilter(p)) return false;
  if (p.status === "visited"){
    const vv=placeVisits(p);
    const hasVisitConstraint=filter.who!=="all" || filter.tripId!=="all" || !!filter.from || !!filter.to || !!filter.cats.size;
    return !hasVisitConstraint || vv.some(v=>visitPassFilter(p,v));
  }
  if (filter.who !== "all"){
    const w=whoUids(p); if (whoModeOf(p)!=="both" && !w.includes(filter.who)) return false;
  }
  if (filter.cats.size && !(p.categories||[]).some(c=>filter.cats.has(c))) return false;
  const tr=placeTrips(p);
  if (filter.tripId === "daily" && tr.length) return false;
  if (filter.tripId !== "all" && filter.tripId !== "daily" && !tr.includes(filter.tripId)) return false;
  return true;
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
    if(p.status!=="visited" || !placeStaticFilter(p)) return;
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
    if(p.status!=="visited" || !placeStaticFilter(p)) return;
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
    if(p.status!=="visited") return;
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
    onAuthStateChanged(auth, u => { user = u; u ? renderApp() : renderGate(); },
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
  proximityRenderVersion++;
  removeAdministrativeLayer();
  removeProximityLayer();
  document.getElementById("app").innerHTML = `
    <header>
      <span class="title">我們去過的地方</span>
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
          <button class="tab" data-t="wishlist">想去</button>
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
  subscribe();
  document.querySelectorAll("#mapctl button").forEach(b => b.onclick = () => {
    if (b.dataset.l !== "proximity" && filter.regions.length){ filter.regions = []; renderList(); renderFilterChips(); }
    setChoro(b.dataset.l);
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
    if (choroLevel === "proximity") setChoro("proximity");
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
    if (choroLevel === "proximity") setChoro("proximity");
  };

  // 記錄自己是這個空間的成員(單/雙人篩選用)
  setDoc(metaDoc(), { members: { [user.uid]: me() } }, { merge:true })
    .catch(e => isLocalTest() ? failLocal("initial member write", e) : undefined);

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
  const markerOpts = [["status","是否去過"],["cat","在這裡做什麼"],["level","造訪深度"],["who","誰去的"],["trip","哪趟旅程"],["rating","評分"],["dateFirst","造訪日期（最早一次）"],["dateLast","造訪日期（最後一次）"]];
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
  g("s_alpha").oninput = e => { choroAlpha = (+e.target.value)/100; if(choroLevel!=="off") setChoro(choroLevel); };
  g("s_metric").onchange = e => { choroMetric = e.target.value; if(choroLevel!=="off") setChoro(choroLevel); };
  const saveNick = () => {
    nicknames[user.uid] = g("s_nick").value.trim();
    setDoc(metaDoc(), { nicknames: { [user.uid]: nicknames[user.uid] } }, { merge:true });
    refreshFilterUI();
  };
  g("s_nick").addEventListener("change", saveNick); g("s_nick").addEventListener("blur", saveNick);
  document.querySelectorAll("input[data-lv]").forEach(inp => inp.onchange = () => {
    levelColors[inp.dataset.lv] = inp.value;
    setDoc(metaDoc(), { levelColors: { [inp.dataset.lv]: inp.value } }, { merge:true });
    renderMarkers(); if(choroLevel!=="off") setChoro(choroLevel);
  });
  document.querySelectorAll("input[data-cat]").forEach(inp => inp.onchange = () => {
    catColors[inp.dataset.cat] = inp.value;
    setDoc(metaDoc(), { catColors: { [inp.dataset.cat]: inp.value } }, { merge:true });
    renderMarkers();
  });
  document.querySelectorAll("input[data-trip]").forEach(inp => inp.onchange = () => {
    updateDoc(tripDoc(inp.dataset.trip), { color: inp.value }); renderMarkers();
  });
  document.querySelectorAll(".catname").forEach(inp => inp.addEventListener("change", () => renameCat(inp.dataset.old, inp.value)));
  document.querySelectorAll("[data-catdel]").forEach(b => b.onclick = () => deleteCat(b.dataset.catdel));
  g("s_done").onclick = closeModal;
}
async function renameCat(oldN, newN){
  newN = (newN||"").trim();
  if (!newN || newN === oldN || spaceCats.includes(newN)) return;
  const i = spaceCats.indexOf(oldN); if (i < 0) return;
  spaceCats[i] = newN;
  const cc = { ...catColors }; if (cc[oldN] !== undefined){ cc[newN] = cc[oldN]; delete cc[oldN]; }
  catColors = cc;
  await setDoc(metaDoc(), { categories: spaceCats, catColors: cc }, { merge:true });
  for (const p of Object.values(places)){
    if ((p.categories||[]).includes(oldN)) updateDoc(placeDoc(p.id), { categories: p.categories.map(x=>x===oldN?newN:x) });
  }
  openSettings();  // 重繪
}
async function deleteCat(c){
  spaceCats = spaceCats.filter(x => x !== c);
  const cc = { ...catColors }; delete cc[c]; catColors = cc;
  await setDoc(metaDoc(), { categories: spaceCats, catColors: cc }, { merge:true });
  for (const p of Object.values(places)){
    if ((p.categories||[]).includes(c)) updateDoc(placeDoc(p.id), { categories: p.categories.filter(x=>x!==c) });
  }
  closeModal(); openSettings();
}

/* ---------- 篩選 UI ---------- */
let filterFitTimer=null;
function fitMapToCurrentFilter(){
  if(!map || layoutState.map || tab==="trips") return;
  if(!shouldAutoFitViewport({tripId:filter.tripId,regionCount:filter.regions.length})) return;
  const status=tab==="wishlist"?"wishlist":"visited";
  const pts=Object.values(places).filter(p=>p.status===status && passFilter(p) && Number.isFinite(p.lat) && Number.isFinite(p.lng));
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
function applyFilter(){
  renderList(); renderMarkers();
  if (choroLevel !== "off") setChoro(choroLevel);
  renderFilterChips();
  scheduleFilterFit();
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
  who.innerHTML = `<option value="all">兩人合併</option>` +
    Object.keys(members).map(u=>`<option value="${u}">${esc(nameFor(u))}</option>`).join("");
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
  const n = tab==="visited" ? getFilteredVisitOccurrences().length : Object.values(places).filter(p => p.status===tab && passFilter(p)).length;
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
    if (choroLevel!=="off") setChoro(choroLevel);
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
function subscribe(){
  const base = ["spaces", runtimeConfig.spaceId];
  onSnapshot(query(collection(db, ...base, "places"), orderBy("createdAt","desc")), snap => {
    if (localFailure) return;
    places = {}; snap.forEach(d => places[d.id] = { id:d.id, ...d.data() });
    renderList(); renderMarkers();
    if (choroLevel !== "off") setChoro(choroLevel);
  }, error => handleFirestoreError("places", error));
  onSnapshot(query(collection(db, ...base, "trips"), orderBy("createdAt","desc")), snap => {
    if (localFailure) return;
    trips = {}; snap.forEach(d => trips[d.id] = { id:d.id, ...d.data() });
    renderList(); renderMarkers();
    refreshFilterUI();
    if (choroLevel !== "off") setChoro(choroLevel);
  }, error => handleFirestoreError("trips", error));
  onSnapshot(metaDoc(), s => {
    if (localFailure) return;
    const d = s.data() || {};
    spaceCats = d.categories || [];
    members   = d.members || {};
    catColors = d.catColors || {};
    nicknames = d.nicknames || {};
    levelColors = { ...LEVEL_COLORS, ...(d.levelColors||{}) };
    refreshFilterUI();
    renderList(); renderMarkers(); renderMarkerLegend();
    if (choroLevel !== "off") setChoro(choroLevel);
  }, error => handleFirestoreError("meta/config", error));
}
const metaDoc   = () => doc(db, "spaces", runtimeConfig.spaceId, "meta", "config");
const placesCol = () => collection(db, "spaces", runtimeConfig.spaceId, "places");
const placeDoc  = id => doc(db, "spaces", runtimeConfig.spaceId, "places", id);
const tripsCol  = () => collection(db, "spaces", runtimeConfig.spaceId, "trips");
const tripDoc   = id => doc(db, "spaces", runtimeConfig.spaceId, "trips", id);

/* ---------- 地圖標記(AdvancedMarker + 彩色 PinElement) ---------- */
function whoColor(p){
  const m = whoModeOf(p);
  if (m === "both") return "#b25b6b";
  if (m === "partner") return "#d98b3f";
  return "#3f7d78";
}
function visitWhoColor(p,v){
  const m=visitWhoMode(p,v);
  if(m==="both") return "#b25b6b";
  if(m==="partner") return "#d98b3f";
  return "#3f7d78";
}
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
  return p.status === "wishlist" ? getCSS("--wish") : getCSS("--visited");
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
  if(p.status!=="visited") return color;
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
  if (!showPins && choroLevel!=="proximity") return "";
  const titles = { status:"是否去過", cat:"在這裡做什麼", level:"造訪深度", who:"誰去的", trip:"哪趟旅程", rating:"評分", dateFirst:"最早造訪", dateLast:"最後造訪" };
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
  if (markerMode === "status") rows = [[getCSS("--visited"),"去過"],[getCSS("--wish"),"想去"]];
  else if (markerMode === "who") rows = [["#3f7d78", nameFor(user.uid)], ["#d98b3f", partnerUid()?nameFor(partnerUid()):"對方"], ["#b25b6b","一起"]];
  else if (markerMode === "level") rows = LEVEL_ORDER.slice().reverse().map(l=>[levelColors[l], l]);
  else if (markerMode === "cat") rows = spaceCats.map(c=>[catColor(c), c]);
  else if (markerMode === "trip") rows = Object.values(trips).map(t=>[t.color||"#3f7d78", (t.emoji?t.emoji+" ":"")+t.name]);
  const body=rows.length ? rows.map(r=>`<div class="lg"><span class="sw" style="background:${r[0]}"></span>${esc(r[1])}</div>`).join("") : `<div style="font-size:11px">尚無項目</div>`;
  return `<div class="legendsection"><div class="legendtitle">地標 · ${titles[markerMode]||"地標"}</div>${body}</div>`;
}

function regionLegendBody(){
  if(!regionLegendState || choroLevel==="off") return "";
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
  if(choroLevel!=="proximity") return "";
  const maskMode=resolveProximityMaskMode(filter.regions,proximityMaskTaiwan);
  const landText=maskMode.type==="regions" ? `已選行政區 × ${maskMode.count}`
    : maskMode.type==="taiwan" ? "臺灣陸地" : "無遮罩";
  const seedText=proximitySeedCount ? `${proximitySeedCount} 個造訪地點` : "目前篩選下沒有造訪地點";
  return `<div class="legendsection"><div class="legendtitle">最近造訪涵蓋 · ${formatProximityRadius(proximityRadius)} km</div>`+
    `<div class="legendnote">${seedText}<br>${landText}<br>重疊範圍歸最近的造訪地點；顏色沿用地標配色。</div></div>`;
}
function renderUnifiedLegend(){
  const el=document.getElementById("maplegend"); if(!el) return;
  const hasMarker=showPins, hasRegion=choroLevel!=="off" && choroLevel!=="proximity" && !!regionLegendState;
  const hasProximity=choroLevel==="proximity";
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
// 造訪深度:沒設 level 的「去過」地點,預設當作「旅遊」;想去(wishlist)不算足跡
function effLevel(p){ return p.level || (p.status === "visited" ? "旅遊" : ""); }

// 確保每個地點都有該級的行政區代碼(算一次就寫回 Firestore 快取)
async function ensureCounty(){
  const geo = await loadGeo("geo/county.json");
  for (const p of Object.values(places)){
    if (p.countyCode) continue;
    const code = pip(p.lat, p.lng, geo.features, "COUNTYCODE");
    if (code){ p.countyCode = code; updateDoc(placeDoc(p.id), { countyCode: code }); }
  }
  return geo;
}
async function ensureTown(){
  const geo = await loadGeo("geo/town.json");
  for (const p of Object.values(places)){
    if (p.townCode) continue;
    const code = pip(p.lat, p.lng, geo.features, "TOWNCODE");
    if (code){ p.townCode = code; updateDoc(placeDoc(p.id), { townCode: code }); }
  }
  return geo;
}
async function ensureVillage(){
  const county = await ensureCounty();                       // 先確保 countyCode
  const codes = county.features.map(f => f.properties.COUNTYCODE);
  const byCounty = {}; let feats = [];
  for (const c of codes){
    let geo; try { geo = await loadGeo("geo/village/" + c + ".json"); } catch(e){ continue; }
    byCounty[c] = geo.features; feats = feats.concat(geo.features);
  }
  for (const p of Object.values(places)){
    if (p.villCode || !p.countyCode) continue;
    const gf = byCounty[p.countyCode]; if (!gf) continue;
    const code = pip(p.lat, p.lng, gf, "VILLCODE");
    if (code){ p.villCode = code; updateDoc(placeDoc(p.id), { villCode: code }); }
  }
  return { type:"FeatureCollection", features: feats };
}
// 每個行政區代碼 → 符合篩選、已造訪的地點清單
function regionPlaces(codeOf){
  const m = {};
  for (const p of Object.values(places)){
    if (!passFilter(p)) continue;
    if (p.status !== "visited") continue;
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

function updateSurfaceControls(level){
  document.querySelectorAll("#mapctl button").forEach(b => b.classList.toggle("on", b.dataset.l === level));
  const administrative=["county","town","village"].includes(level);
  const multi=document.getElementById("multiBtn");
  const proximity=document.getElementById("proximityCtl");
  if(multi) multi.style.display=administrative ? "block" : "none";
  if(proximity) proximity.style.display=level==="proximity" ? "flex" : "none";
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
  if(!choroLayer) return;
  choroLayer.setMap(null);
  choroLayer=null;
  choroLayerLevel=null;
}
function removeProximityLayer(){
  if(proximityLayer){
    proximityLayer.setMap(null);
    proximityLayer=null;
    proximityLayerKey="";
  }
  if(proximityOutlineLayer){
    proximityOutlineLayer.setMap(null);
    proximityOutlineLayer=null;
    proximityOutlineKey="";
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
      zIndex:1,
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
    maskIndex:createMaskIndex(turf,maskFeatures),
    outline:turf.featureCollection(selectedFeatures)
  };
  return selectedRegionMaskCache;
}
function renderProximityOutline(mode,outline){
  if(mode.type!=="regions"){
    if(proximityOutlineLayer) proximityOutlineLayer.setMap(null);
    proximityOutlineLayer=null;
    proximityOutlineKey="";
    return;
  }
  if(proximityOutlineLayer && proximityOutlineKey===mode.identity) return;
  if(proximityOutlineLayer) proximityOutlineLayer.setMap(null);
  proximityOutlineLayer=new google.maps.Data({map});
  proximityOutlineLayer.addGeoJson(outline);
  proximityOutlineLayer.setStyle({
    fillOpacity:0,
    strokeColor:"#152230",
    strokeOpacity:0.58,
    strokeWeight:1.4,
    zIndex:2,
    clickable:false
  });
  proximityOutlineKey=mode.identity;
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
  let maskIndex=null, outline=null;
  if(maskMode.type==="regions"){
    const selectedMask=await selectedRegionMask(maskMode,selectedRegions);
    maskIndex=selectedMask.maskIndex;
    outline=selectedMask.outline;
  }else if(maskMode.type==="taiwan" && seeds.length){
    if(!proximityMaskIndex){
      const townGeo=await loadGeo("geo/town.json");
      proximityMaskIndex=createMaskIndex(turf,townGeo.features);
    }
    maskIndex=proximityMaskIndex;
  }
  if(requestVersion!==proximityRenderVersion || choroLevel!=="proximity") return;
  renderProximityOutline(maskMode,outline);
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
  if(requestVersion!==proximityRenderVersion || choroLevel!=="proximity") return;
  if(proximityLayer && proximityLayerKey===key){ restyleProximityLayer(); return; }
  if(proximityLayer) proximityLayer.setMap(null);
  proximityLayer=new google.maps.Data({map});
  proximityLayer.addGeoJson(featureCollection);
  proximityLayerKey=key;
  restyleProximityLayer();
  renderUnifiedLegend();
}

async function setChoro(level){
  const requestVersion=++proximityRenderVersion;
  choroLevel = level;
  updateSurfaceControls(level);
  if(level==="proximity"){
    removeAdministrativeLayer();
    regionLegendState=null;
    try { await renderProximityCoverage(requestVersion); }
    catch(e){
      if(requestVersion!==proximityRenderVersion) return;
      alert("鄰近涵蓋範圍計算失敗：\n"+e.message);
      setChoro("off");
    }
    return;
  }
  removeProximityLayer();
  if (level === "off"){
    removeAdministrativeLayer();
    regionLegendState=null; renderUnifiedLegend(); return;
  }

  let fc, codeProp, codeOf;
  try {
    if (level === "county"){ fc = await ensureCounty(); codeProp = "COUNTYCODE"; codeOf = p => p.countyCode; }
    else if (level === "town"){ fc = await ensureTown(); codeProp = "TOWNCODE"; codeOf = p => p.townCode; }
    else { fc = await ensureVillage(); codeProp = "VILLCODE"; codeOf = p => p.villCode; }
  } catch(e){
    alert("行政區資料載入失敗——確認 geo/ 資料夾已上傳到 repo:\n" + e.message);
    setChoro("off"); return;
  }
  if(requestVersion!==proximityRenderVersion || choroLevel!==level) return;

  const byRegion = regionPlaces(codeOf);
  let dmin, dmax;
  if (choroMetric === "first" || choroMetric === "last"){
    const b=markerDateBounds(); dmin=b.from; dmax=b.to;
  }
  const colorOf = code => {
    const pls = byRegion[code]; if (!pls || !pls.length) return null;
    if (choroMetric === "level"){
      let best=-1; for(const p of pls){ const i=LEVEL_ORDER.indexOf(effLevel(p)); if(i>best) best=i; }
      return best<0 ? null : levelColors[LEVEL_ORDER[best]];
    }
    if (choroMetric === "count") return countColor(pls.length);
    const d = regionDate(pls, choroMetric); return d ? dateColor(d, dmin, dmax) : null;
  };
  const selCodes = new Set(filter.regions.filter(r => r.key === CODEKEY[level]).map(r => r.code));
  const styleFn = f => {
    const code = f.getProperty(codeProp);
    if (selCodes.size && !selCodes.has(code)){
      return { fillColor:"#12202e", fillOpacity:0.55, strokeWeight:0, clickable:true };  // 其餘變暗
    }
    const c = colorOf(code);
    return {
      fillColor: c || "#e5e0d6", fillOpacity: c ? choroAlpha : 0.12,
      strokeColor: selCodes.has(code) ? "#152230" : "#ffffff",
      strokeWeight: selCodes.has(code) ? 1.6 : 0.6, clickable: true
    };
  };

  if (!choroLayer || choroLayerLevel !== level){
    if (choroLayer) choroLayer.setMap(null);
    choroLayer = new google.maps.Data({ map });
    choroLayer.addGeoJson(fc);
    choroLayer.addListener("click", ev => {
      const f = ev.feature;
      const parts = level==="county" ? [f.getProperty("COUNTYNAME")]
        : level==="town" ? [f.getProperty("COUNTYNAME"), f.getProperty("TOWNNAME")]
        : [f.getProperty("COUNTYNAME"), f.getProperty("TOWNNAME"), f.getProperty("VILLNAME")];
      const entry = {
        key:CODEKEY[level],
        code:f.getProperty(codeProp),
        name:parts.filter(Boolean).join(""),
        ...(level==="village" ? {countyCode:f.getProperty("COUNTYCODE")} : {})
      };
      const idx = filter.regions.findIndex(r => r.key===entry.key && r.code===entry.code);
      if (regionMulti){
        if (idx>=0) filter.regions.splice(idx,1); else filter.regions.push(entry);
      } else {
        filter.regions = (idx>=0 && filter.regions.length===1) ? [] : [entry];
      }
      tab = "visited";
      document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.t==="visited"));
      applyFilter();
      setChoro(level);   // 重新套遮罩
    });
    choroLayerLevel = level;
  }
  choroLayer.setStyle(styleFn);
  renderLegend(choroMetric, { dmin, dmax });
}

/* ============================================================
   4) 清單
   ============================================================ */
let listItems = [], dayVisitItems = [];
const effOrd = p => (p.ord != null ? p.ord : (p.createdAt?.seconds || 0));
function renderList(){
  document.querySelectorAll(".tab").forEach(b => b.classList.toggle("on", b.dataset.t === tab));
  document.getElementById("searchWrap").style.display = tab === "trips" ? "none" : "block";
  const el = document.getElementById("list");
  if (tab === "trips"){ renderTrips(el); return; }

  if(tab==="wishlist"){
    listItems=Object.values(places).filter(p=>p.status==="wishlist"&&passFilter(p)).sort((a,b)=>effOrd(a)-effOrd(b));
    if(!listItems.length){ el.innerHTML=`<div class="empty">沒有符合的地點。</div>`; renderFilterChips(); return; }
    el.innerHTML=listItems.map(p=>cardHTML(p)).join("");
    listItems.forEach(p=>document.getElementById("c_"+p.id).onclick=ev=>{
      if(ev.target.closest("[data-del]")||ev.target.closest(".ordbtn")) return;
      focusMapOnPlace(p); openEditor(p.id);
    });
    el.querySelectorAll("[data-del]").forEach(b=>b.onclick=ev=>{ev.stopPropagation();deleteDoc(placeDoc(b.dataset.del));});
    el.querySelectorAll("[data-up]").forEach(b=>b.onclick=ev=>{ev.stopPropagation();movePlace(b.dataset.up,-1);});
    el.querySelectorAll("[data-down]").forEach(b=>b.onclick=ev=>{ev.stopPropagation();movePlace(b.dataset.down,1);});
    renderFilterChips(); return;
  }

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
  if(!occ.length){ el.innerHTML=`<div class="empty">沒有符合的造訪紀錄。</div>`; renderFilterChips(); return; }
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

function movePlace(id, dir){
  const i = listItems.findIndex(p => p.id === id); const j = i + dir;
  if (j < 0 || j >= listItems.length) return;
  const a = listItems[i], b = listItems[j];
  updateDoc(placeDoc(a.id), { ord: effOrd(b) });
  updateDoc(placeDoc(b.id), { ord: effOrd(a) });
}
function cardHTML(p){
  const cat=(p.categories||[])[0], col=cat?catColor(cat):"#9aa5ad";
  const mode=whoModeOf(p), whoTxt=mode==="both"?"一起":mode==="partner"?nameFor(otherOf(p.createdBy)):nameFor(p.createdBy||user.uid);
  const tags=[
    cat?`<span class="ptag" style="background:${col};color:${textOn(col)}">${esc(cat)}</span>`:"",
    `<span class="ptag" style="background:#efe9df">${esc(whoTxt)}</span>`,
    p.rating?`<span class="ptag" style="background:#f3e7d3">★${p.rating}</span>`:"",
    `<span class="ptag" style="background:#e6efe9">想去</span>`
  ].filter(Boolean).join("");
  return `<div class="card compact" id="c_${p.id}" style="background:${col}14"><div style="display:flex;align-items:center;gap:8px">
    <span class="dot" style="background:${col};flex:0 0 auto"></span><div style="flex:1;min-width:0"><div class="cname">${esc(p.name)}</div><div class="ptags">${tags}</div></div>
    <div class="ordcol"><button class="ordbtn" data-up="${p.id}">▲</button><button class="ordbtn" data-down="${p.id}">▼</button></div>
    <button class="delx" data-del="${p.id}" title="刪除地點">✕</button></div></div>`;
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
    if(!byPlace.has(p.id)) byPlace.set(p.id,placeVisits(p).map(v=>({...v})));
    const vv=byPlace.get(p.id); if(vv[o.visitIndex]) vv[o.visitIndex].order=pos+1;
  });
  [...byPlace.entries()].forEach(([id,vv])=>{ if(places[id]) places[id].visits=vv; });
  renderList(); renderMarkers();
  await Promise.all([...byPlace.entries()].map(([id,vv])=>updateDoc(placeDoc(id),{visits:vv,...visitLegacyFields(vv,places[id])})));
}

function visitLegacyFields(vv,p=null){
  const base=p||{}, clean=vv.filter(v=>v.date).map((v,i)=>normalizedVisit(base,v,i));
  const latest=clean.slice().sort((a,b)=>a.date.localeCompare(b.date)||(Number(a.order)||1e9)-(Number(b.order)||1e9)).pop();
  const who=latest?.who?.length?[...latest.who]:whoUids(base);
  return { visitedOn:latest?latest.date:"", tripId:latest?.tripId||"", categories:latest?.category?[latest.category]:(base.categories||[]), who, whoMode:legacyWhoModeForPlace(base,who) };
}
async function deleteVisitOccurrence(key){
  const [pid,idxRaw]=key.split(":"),p=places[pid],idx=+idxRaw; if(!p) return;
  const vv=placeVisits(p).map(v=>({...v})); if(idx<0||idx>=vv.length) return;
  vv.splice(idx,1);
  if(!vv.length){
    await updateDoc(placeDoc(pid),{visits:[],status:"wishlist",visitedOn:"",tripId:""});
  }else{
    await updateDoc(placeDoc(pid),{visits:vv,status:"visited",...visitLegacyFields(vv,p)});
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
  const existing=findExistingPlace(seed);
  if(existing){
    if(tab==="visited") openEditor(existing.id,null,{addVisit:true});
    else openEditor(existing.id);
  }else openEditor(null,seed);
}
function wireSearch(){
  const input = document.getElementById("search");
  const box = document.getElementById("results");
  input.oninput = () => {
    clearTimeout(searchTimer);
    const q = input.value.trim();
    if (q.length < 2){ box.style.display="none"; return; }
    searchTimer = setTimeout(async () => {
      let rs = [];
      try { rs = await searchPlace(q); } catch(e){ console.warn(e); }
      box.innerHTML = rs.map((r,i)=>`<div data-i="${i}">${esc(r.name)}</div>`).join("") || `<div>找不到</div>`;
      box.style.display = "block";
      box.querySelectorAll("div[data-i]").forEach(d => d.onclick = async () => {
        const r = rs[+d.dataset.i]; box.style.display="none"; input.value="";
        try {
          const place = r.prediction.toPlace();
          await place.fetchFields({ fields:["displayName","location","formattedAddress"] });
          sessionToken = null;                       // 選定後結束 session(計費最佳化)
          const lat = place.location.lat(), lng = place.location.lng();
          const admin = await reverseGeocode(lat, lng);
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
    openSeed({ name: pl.displayName||"", lat: la, lng: ln, admin, source:"google", extId: pl.id });
  });
  document.getElementById("nb_custom").onclick = async () => {
    closeModal();
    const admin = await reverseGeocode(lat, lng);
    openEditor(null, { name:"", lat, lng, admin, source:"map" });
  };
}

function addDays(date,n){
  if(!date) return ""; const d=new Date(date+"T00:00:00"); d.setDate(d.getDate()+n);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}
const placeEditorWriteQueues=new Map();
function persistPlaceEditorData(id,data){
  if(places[id]) Object.assign(places[id],data);
  const previous=placeEditorWriteQueues.get(id)||Promise.resolve();
  const write=previous.then(()=>updateDoc(placeDoc(id),data));
  const settled=write.catch(()=>{});
  placeEditorWriteQueues.set(id,settled);
  settled.finally(()=>{ if(placeEditorWriteQueues.get(id)===settled) placeEditorWriteQueues.delete(id); });
  return write;
}
function openEditor(id, seed, opts={}){
  const p = id ? places[id] : { status: tab==="wishlist"?"wishlist":"visited", categories:[], ...seed };
  const shared=placeSharedFields(p);
  let docId = id || null, persistQueue=Promise.resolve();
  let wishlistCats = new Set((p.categories||[]).slice(0,1));
  let status = p.status || "visited";
  let level = shared.level;
  const pu = partnerUid();
  let whoSel = id ? whoModeOf(p) : (pu ? "both" : "me");
  const filterTrip = specificTripId();
  const defaultDate = defaultDateForNewVisit();
  const defaultWho = () => whoUidsFromMode(pu?"both":"me");
  let visits = placeVisits(p).map((v,i)=>({ ...normalizedVisit(p,v,i), id:(v.id&& !String(v.id).startsWith("legacy_"))?v.id:newVisitId() }));
  let focusIndex = Number.isFinite(Number(opts.focusVisitIndex)) ? Number(opts.focusVisitIndex) : -1;
  if (!id && status==="visited" && !visits.length){
    const presetCat=filter.cats.size===1?[...filter.cats][0]:"";
    visits.push({id:newVisitId(),kind:"visit",date:defaultDate,endDate:"",tripId:filterTrip||"",category:presetCat,who:defaultWho()}); focusIndex=0;
  }
  if (id && opts.addVisit){
    status="visited";
    const prev=latestVisit(p), cat=prev?visitCategory(p,prev):((p.categories||[])[0]||"");
    const k=level==="住宿"?"stay":"visit";
    visits.push({id:newVisitId(),kind:k,date:defaultDate,endDate:k==="stay"?addDays(defaultDate,1):"",tripId:filterTrip||"",category:cat,who:prev?.who?.length?[...prev.who]:defaultWho()});
    focusIndex=visits.length-1;
  }

  const visitedHasHistory = () => visits.some(v=>v.date);
  modal(`
    <h2 style="margin-bottom:3px">${esc(p.name||"新地點")}</h2>
    <div class="admin" style="margin-bottom:10px">改動會自動儲存${opts.addVisit?" · 本次已帶入上一次的設定，可直接修改":""}</div>

    <div class="editor-section">
      <div class="editor-section-head"><div class="editor-section-title">地點</div></div>
      <input id="f_name" value="${esc(p.name||"")}" placeholder="名稱" style="width:100%;padding:9px;border:1px solid var(--line);border-radius:9px;background:#fff">
      <div class="seg" id="f_status" style="margin-top:8px">
        <button data-s="visited" class="${status==='visited'?'on-v':''}">去過了</button>
        <button data-s="wishlist" class="${status==='wishlist'?'on-w':''}" ${id&&visitedHasHistory()?'disabled title="已有造訪紀錄；請先刪除造訪紀錄"':''}>想去</button>
      </div>
    </div>

    <div class="editor-section" id="f_wishlistSection" style="${status==='wishlist'?'':'display:none'}">
      <div class="editor-section-head"><div class="editor-section-title">想去設定</div></div>
      <div class="field" style="margin-bottom:8px"><label>想去這裡做什麼</label>
        <div class="pick" id="f_cats">${spaceCats.map(c=>`<span class="chip ${wishlistCats.has(c)?'on':''}" data-c="${esc(c)}" style="${wishlistCats.has(c)?`background:${catColor(c)};color:${textOn(catColor(c))};border-color:${catColor(c)}`:''}">${esc(c)}</span>`).join("")}<span class="chip addcat" id="f_addcat">＋自訂</span></div>
      </div>
      <div class="field" id="f_wishwho" style="margin-bottom:0"><label>預計誰去</label>
        <div class="seg" id="f_who">
          <button data-w="me" class="${whoSel==='me'?'on-v':''}">我</button>
          ${pu?`<button data-w="partner" class="${whoSel==='partner'?'on-v':''}">${esc(nameFor(pu))}</button>`:""}
          ${pu?`<button data-w="both" class="${whoSel==='both'?'on-v':''}">一起</button>`:""}
        </div>
      </div>
    </div>

    <div class="editor-section" id="f_visitwrap" style="${status==='wishlist'?'display:none':''}">
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

  const nameEl=document.getElementById("f_name"), visitWrap=document.getElementById("f_visitwrap"), wishSection=document.getElementById("f_wishlistSection");
  function collect(){
    const clean=visits.filter(v=>v.date).map(v=>{
      const kind=v.kind==="stay"?"stay":"visit";
      const out={id:v.id||newVisitId(),kind,date:v.date,tripId:v.tripId||"",category:v.category||"",who:(Array.isArray(v.who)&&v.who.length)?[...v.who]:defaultWho()};
      if(kind==="stay") out.endDate=(v.endDate&&v.endDate>v.date)?v.endDate:addDays(v.date,1);
      else out.endDate="";
      if(Number.isFinite(Number(v.order))) out.order=Number(v.order);
      return out;
    });
    const latest=clean.slice().sort((a,b)=>a.date.localeCompare(b.date)||(Number(a.order)||1e9)-(Number(b.order)||1e9)).pop();
    const summaryWho=status==="visited"?(latest?.who||defaultWho()):whoUidsFromMode(whoSel);
    const rv=parseFloat(document.getElementById("f_rating").value);
    const latestCat=latest?.category||"";
    return {
      name:nameEl.value.trim(),lat:p.lat,lng:p.lng,source:p.source||"google",extId:p.extId||null,admin:p.admin||{},
      status, categories:status==="visited"?(latestCat?[latestCat]:[]):[...wishlistCats], level, whoMode:legacyWhoModeForPlace(p,summaryWho), who:summaryWho,
      visits:status==="visited"?clean:[], visitedOn:status==="visited"?(latest?.date||""):"", tripId:status==="visited"?(latest?.tripId||""):"",
      rating:rv>0?rv:null, review:document.getElementById("f_review").value.trim()
    };
  }
  function persist(){
    const data=collect();
    if(docId) return persistPlaceEditorData(docId,data);
    const queued=persistQueue.then(async()=>{
      if(!docId){
        if(!data.name) return;
        data.createdBy=user.uid; data.createdAt=serverTimestamp();
        const ref=await addDoc(placesCol(),data); docId=ref.id;
      }else await persistPlaceEditorData(docId,data);
    });
    persistQueue=queued.catch(()=>{});
    return queued;
  }
  function catOptions(selected){
    return `<option value="">未分類</option>`+spaceCats.map(c=>`<option value="${esc(c)}" ${selected===c?'selected':''}>${esc(c)}</option>`).join("")+`<option value="__new__">＋新增分類…</option>`;
  }
  function tripOptions(selected){
    return `<option value="">日常</option>`+Object.values(trips).map(t=>`<option value="${t.id}" ${selected===t.id?'selected':''}>${esc((t.emoji?t.emoji+' ':'')+t.name)}</option>`).join('')+`<option value="__new__">＋新增旅程…</option>`;
  }
  function whoOptions(v){
    const m=visitWhoMode(p,v);
    return `<option value="me" ${m==='me'?'selected':''}>我</option>`+
      (pu?`<option value="partner" ${m==='partner'?'selected':''}>${esc(nameFor(pu))}</option><option value="both" ${m==='both'?'selected':''}>一起</option>`:"");
  }
  function renderVisits(){
    const box=document.getElementById("f_visits"); if(!box) return;
    if(!visits.length){ box.innerHTML=`<div style="font-size:12px;color:var(--ink-soft);padding:4px 2px 8px">尚無造訪紀錄。</div>`; return; }
    box.innerHTML=visits.map((v,i)=>{
      const stay=visitKind(v)==="stay", co=stay?(v.endDate&&v.endDate>v.date?v.endDate:addDays(v.date,1)):"";
      const nights=stay?Math.max(1,dayDiff(v.date||co,co)):0;
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
          <label class="visitmini"><span>同行</span><select class="v_who">${whoOptions(v)}</select></label>
        </div>
      </div>`;
    }).join("");
    box.querySelectorAll(".visitrow").forEach(row=>{
      const i=+row.dataset.i, d=row.querySelector(".v_date"), cat=row.querySelector(".v_cat"), trip=row.querySelector(".v_trip"), who=row.querySelector(".v_who"), end=row.querySelector(".v_end");
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
          if(!spaceCats.includes(name)){ spaceCats.push(name); setDoc(metaDoc(),{categories:arrayUnion(name)},{merge:true}); }
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
      who.onchange=()=>{ visits[i].who=whoUidsFromMode(who.value); focusIndex=i; persist(); };
      if(end) end.onchange=()=>{
        visits[i].kind="stay";
        visits[i].endDate=end.value&&end.value>visits[i].date?end.value:addDays(visits[i].date,1); focusIndex=i; renderVisits(); persist();
      };
      row.querySelector(".v_del").onclick=()=>{
        visits.splice(i,1); focusIndex=Math.min(i,visits.length-1); if(!visits.length) status="wishlist";
        visitWrap.style.display=status==="wishlist"?"none":"block"; wishSection.style.display=status==="wishlist"?"block":"none";
        document.querySelectorAll("#f_status button").forEach(x=>{ x.className=""; x.disabled=false; });
        const sb=document.querySelector(`#f_status button[data-s="${status}"]`); if(sb) sb.className=status==="visited"?"on-v":"on-w";
        renderVisits(); persist();
      };
    });
    if(focusIndex>=0){ setTimeout(()=>{ const r=box.querySelector(`.visitrow[data-i="${focusIndex}"]`); r?.scrollIntoView({block:"nearest"}); },0); }
  }
  function addVisit(){
    const prev=visits.filter(v=>v.date).slice().sort((a,b)=>a.date.localeCompare(b.date)||(Number(a.order)||1e9)-(Number(b.order)||1e9)).pop();
    const d=defaultDateForNewVisit(), k=level==="住宿"?"stay":"visit";
    visits.push({id:newVisitId(),kind:k,date:d,endDate:k==="stay"?addDays(d,1):"",tripId:filterTrip||"",category:prev?.category||latestVisitCategory(p)||"",who:prev?.who?.length?[...prev.who]:defaultWho()});
    status="visited"; focusIndex=visits.length-1; visitWrap.style.display="block"; wishSection.style.display="none"; renderVisits(); persist();
  }

  renderVisits();
  document.getElementById("v_add").onclick=addVisit;

  document.querySelectorAll("#f_status button").forEach(b=>b.onclick=()=>{
    if(b.disabled) return; status=b.dataset.s;
    document.querySelectorAll("#f_status button").forEach(x=>x.className=""); b.className=status==="visited"?"on-v":"on-w";
    visitWrap.style.display=status==="wishlist"?"none":"block"; wishSection.style.display=status==="wishlist"?"block":"none";
    if(status==="visited"&&!visits.length){
      const d=defaultDateForNewVisit(),k=level==="住宿"?"stay":"visit";
      visits.push({id:newVisitId(),kind:k,date:d,endDate:k==="stay"?addDays(d,1):"",tripId:filterTrip||"",category:[...wishlistCats][0]||"",who:whoUidsFromMode(whoSel)}); focusIndex=0; renderVisits();
    }
    persist();
  });
  document.querySelectorAll("#f_cats .chip[data-c]").forEach(c=>c.onclick=()=>{
    const k=c.dataset.c,already=wishlistCats.has(k); wishlistCats=new Set(already?[]:[k]);
    document.querySelectorAll("#f_cats .chip[data-c]").forEach(x=>{ const on=wishlistCats.has(x.dataset.c); x.classList.toggle("on",on); if(on){const col=catColor(x.dataset.c);x.style.background=col;x.style.color=textOn(col);x.style.borderColor=col;}else{x.style.background="";x.style.color="";x.style.borderColor="";} }); persist();
  });
  document.getElementById("f_addcat").onclick=()=>{
    const name=(prompt("新增分類(例:溫泉、看展、爬山)")||"").trim(); if(!name)return;
    if(!spaceCats.includes(name)){spaceCats.push(name);setDoc(metaDoc(),{categories:arrayUnion(name)},{merge:true});}
    wishlistCats=new Set([name]);
    const wrap=document.getElementById("f_cats");
    wrap.querySelectorAll(".chip[data-c]").forEach(x=>{x.classList.remove("on");x.style.background="";x.style.color="";x.style.borderColor="";});
    const chip=document.createElement("span"),col=catColor(name); chip.className="chip on";chip.dataset.c=name;chip.textContent=name;chip.style.background=col;chip.style.color=textOn(col);chip.style.borderColor=col;
    chip.onclick=()=>{wishlistCats=new Set([name]);persist();}; document.getElementById("f_addcat").before(chip); persist();
  };
  document.querySelectorAll("#f_level button").forEach(b=>b.onclick=()=>{
    level=b.dataset.l;
    document.querySelectorAll("#f_level button").forEach(x=>{x.classList.remove("on");x.style.background="";x.style.color="";}); b.classList.add("on");b.style.background=levelColors[level];b.style.color="#fff";
    if(level==="住宿" && status==="visited"){
      if(!visits.length){ const d=defaultDateForNewVisit(); visits.push({id:newVisitId(),kind:"stay",date:d,endDate:addDays(d,1),tripId:filterTrip||"",category:"",who:defaultWho()}); focusIndex=0; }
      const i=focusIndex>=0?focusIndex:visits.length-1;
      if(visits[i]){ visits[i].kind="stay"; visits[i].endDate=(visits[i].endDate&&visits[i].endDate>visits[i].date)?visits[i].endDate:addDays(visits[i].date||defaultDateForNewVisit(),1); if(!visits[i].category&&spaceCats.includes("住宿"))visits[i].category="住宿"; focusIndex=i; renderVisits(); }
    }
    persist();
  });
  document.querySelectorAll("#f_who button").forEach(b=>b.onclick=()=>{whoSel=b.dataset.w;document.querySelectorAll("#f_who button").forEach(x=>x.className="");b.className="on-v";persist();});
  nameEl.addEventListener("change",persist); nameEl.addEventListener("blur",persist);
  const rEl=document.getElementById("f_rating"),rVal=document.getElementById("f_ratingval");
  rEl.oninput=()=>{const v=parseFloat(rEl.value);rVal.textContent=v>0?("★ "+v):"未評分";}; rEl.addEventListener("change",persist);
  document.getElementById("f_review").addEventListener("blur",persist);
  document.getElementById("f_done").onclick=async()=>{await persist();closeModal();};
  const fdel=document.getElementById("f_del"); if(fdel)fdel.onclick=async()=>{await deleteDoc(placeDoc(docId||id));closeModal();};
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
    const data = collect();
    if (!docId){ if(!data.name||creating) return; creating=true;
      data.createdBy=user.uid; data.createdAt=serverTimestamp();
      const ref=await addDoc(tripsCol(),data); docId=ref.id; creating=false; }
    else await updateDoc(tripDoc(docId), data);
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
  if (td) td.onclick = async () => { await deleteDoc(tripDoc(docId||id)); closeModal(); };
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
