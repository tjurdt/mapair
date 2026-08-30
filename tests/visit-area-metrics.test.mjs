import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  aggregatePlaceVisitAreaMetrics,
  categoryMode,
  summarizeVisitAreaMetrics
} from "../src/visit-area-metrics.js";
import {
  VISIT_DATE_RAINBOW,
  deepestLevel,
  multiStopColor,
  orderedVisitDateColor,
  positiveExtrema,
  quantitativeColor
} from "../src/map-color-scales.js";
import { selectNearbyPlaces } from "../src/proximity-geometry.js";

const datedVisits=[
  {date:"2024-02-01",category:"美食"},
  {date:"2023-05-01",category:"自然"},
  {date:"2025-01-01",category:"美食"}
];
const summary=summarizeVisitAreaMetrics(datedVisits);
assert.equal(summary.earliest,"2023-05-01");
assert.equal(summary.latest,"2025-01-01");
assert.equal(summary.categoryMode,"美食");
assert.deepEqual(
  summarizeVisitAreaMetrics([{date:"2024-02-30"},{date:"not-a-date"}]),
  {earliest:"",latest:"",categoryMode:"",visitCount:2},
  "invalid Visit dates do not influence date metrics"
);

assert.equal(categoryMode([{category:"自然"},{category:"美食"}], ["美食","自然"]),"美食","configured category order resolves a tie");
assert.equal(categoryMode([{category:"自然"},{category:"美食"}]),"美食","lexical order resolves an otherwise unconfigured tie");

const repeatedPlace={
  id:"a",
  visitedOn:"1999-01-01",
  categories:["legacy-category"],
  visits:[
    {date:"2024-01-01",category:"美食"},
    {date:"2024-02-01",category:"美食"}
  ]
};
const otherPlace={id:"b",visits:[{date:"2025-01-01",category:"自然"}]};
const aggregate=aggregatePlaceVisitAreaMetrics([repeatedPlace,otherPlace]);
assert.equal(aggregate.visitCount,3,"repeated Visits at one Place count individually");
assert.equal(aggregate.placeCount,2,"two unique Places with surviving Visits count once each");
assert.deepEqual(aggregate,{earliest:"2024-01-01",latest:"2025-01-01",categoryMode:"美食",visitCount:3,placeCount:2},"administrative aggregation combines Visit occurrences across Places");
assert.deepEqual(
  aggregatePlaceVisitAreaMetrics([repeatedPlace]),
  {earliest:"2024-01-01",latest:"2024-02-01",categoryMode:"美食",visitCount:2,placeCount:1},
  "a proximity seed derives every metric from its Visits"
);
assert.notEqual(aggregate.earliest,repeatedPlace.visitedOn,"legacy Place date cannot override Visit-derived metrics");
assert.notEqual(aggregate.categoryMode,repeatedPlace.categories[0],"legacy Place category cannot override Visit-derived metrics");

const filtered=aggregatePlaceVisitAreaMetrics([repeatedPlace,otherPlace],{
  visitFilter:visit=>visit.date>="2024-02-01"
});
assert.deepEqual(filtered,{earliest:"2024-02-01",latest:"2025-01-01",categoryMode:"美食",visitCount:2,placeCount:2});

const threeAndTwo=[
  {id:"place-a",lat:0,lng:0,visits:[{date:"2026-01-01"},{date:"2026-01-02"},{date:"2026-01-03"}]},
  {id:"place-b",lat:0,lng:0.009,visits:[{date:"2026-01-04"},{date:"2026-01-05"}]}
];
assert.deepEqual(
  aggregatePlaceVisitAreaMetrics(threeAndTwo),
  {earliest:"2026-01-01",latest:"2026-01-05",categoryMode:"",visitCount:5,placeCount:2},
  "Place A with three Visits plus Place B with two produces placeCount 2 and visitCount 5"
);
const seed={id:"place-a",lat:0,lng:0};
assert.equal(selectNearbyPlaces(seed,threeAndTwo,0.5).length,1,"a smaller radius includes only the seed Place");
assert.equal(selectNearbyPlaces(seed,threeAndTwo,1.2).length,2,"increasing proximity radius changes the nearby Place count");

const COUNT_COLORS=["#f0dcc0","#e6bd86","#d98b3f","#b96a24","#8f4f18"];
const filteredBounds=positiveExtrema([0,null,4,9,18,31]);
assert.deepEqual(filteredBounds,{min:4,max:31},"zero and no-data values do not force the filtered minimum to zero");
assert.equal(quantitativeColor(COUNT_COLORS,4,filteredBounds),COUNT_COLORS[0],"filtered minimum uses the light end");
assert.equal(quantitativeColor(COUNT_COLORS,31,filteredBounds),COUNT_COLORS.at(-1),"filtered maximum uses the dark end");
assert.equal(quantitativeColor(COUNT_COLORS,0,filteredBounds),null,"zero remains no-data");
const singleValueBounds=positiveExtrema([0,7,7]);
assert.deepEqual(singleValueBounds,{min:7,max:7});
assert.equal(quantitativeColor(COUNT_COLORS,7,singleValueBounds),multiStopColor(COUNT_COLORS,0.5),"a single positive value safely uses the palette midpoint");
assert.deepEqual(positiveExtrema([2,47]),{min:2,max:47});
assert.deepEqual(positiveExtrema([9,18]),{min:9,max:18},"changing filtered values recomputes the extrema");

const luminance=color=>{
  const [r,g,b]=[1,3,5].map(index=>parseInt(color.slice(index,index+2),16));
  return 0.2126*r+0.7152*g+0.0722*b;
};
const base="#4a9f63";
const multiDayColors=[0,1,2].map(index=>orderedVisitDateColor({baseColor:base,occurrenceIndex:index,occurrenceCount:3}));
assert.ok(luminance(multiDayColors[0])>luminance(base),"an earlier same-day occurrence is lighter than the day's base hue");
assert.equal(multiDayColors[1],base,"the middle same-day occurrence keeps the day's base hue");
assert.ok(luminance(multiDayColors[2])<luminance(base),"a later same-day occurrence is darker than the day's base hue");
assert.notEqual(multiDayColors[2],"#000000","the last same-day occurrence retains identifiable hue");

const singleDayColors=Array.from({length:6},(_,index)=>orderedVisitDateColor({baseColor:base,occurrenceIndex:index,occurrenceCount:6,singleDay:true}));
assert.equal(singleDayColors[0],VISIT_DATE_RAINBOW[0],"single-day first occurrence maps to the rainbow start");
assert.equal(singleDayColors.at(-1),VISIT_DATE_RAINBOW.at(-1),"single-day last occurrence maps to the rainbow end");
singleDayColors.forEach((color,index)=>assert.equal(color,multiStopColor(VISIT_DATE_RAINBOW,index/5),"single-day occurrences interpolate evenly across the rainbow"));
assert.equal(
  orderedVisitDateColor({baseColor:base,occurrenceIndex:0,occurrenceCount:1,singleDay:true}),
  multiStopColor(VISIT_DATE_RAINBOW,0.5),
  "one single-day occurrence receives a deterministic rainbow color"
);

const LEVELS=["經過","接地","旅遊","住宿","居住"];
assert.equal(deepestLevel(["經過","居住","旅遊"],LEVELS),"居住","deepest level wins regardless of order");
assert.equal(deepestLevel(["經過","接地"],LEVELS),"接地");
assert.equal(deepestLevel(["旅遊"],LEVELS),"旅遊","a single level resolves to itself");
assert.equal(deepestLevel([],LEVELS),null,"no levels -> null (region stays uncoloured)");
assert.equal(deepestLevel(["unknown","經過"],LEVELS),"經過","unrecognised values are ignored, not deepest");
assert.equal(deepestLevel(["unknown"],LEVELS),null);

const mainSource=await readFile(new URL("../src/main.js",import.meta.url),"utf8");
const mapColorSource=await readFile(new URL("../src/map-color-scales.js",import.meta.url),"utf8");
const settingsBlock=mainSource.slice(mainSource.indexOf("function openNoSpaceSettings"),mainSource.indexOf("function runtimeSessionIsCurrent"));
for(const text of ["地圖上色","上色依據","透明度"]){
  assert.match(settingsBlock,new RegExp(text),`No-Space settings contain ${text}`);
}
assert.match(settingsBlock,/id="ns_metric"[\s\S]*MAP_AREA_METRIC_OPTIONS/,"No-Space settings render the shared area metric options");
for(const text of ["造訪深度","地標數","造訪次數","最早造訪日期","最後造訪日期","造訪目的（眾數）"]){
  assert.match(mainSource,new RegExp(text),`shared area metric options contain ${text}`);
}
assert.match(settingsBlock,/metric\.onchange\s*=\s*event\s*=>\s*setMapAreaMetric\(event\.target\.value\)/,"changing the No-Space area metric uses the shared refresh path");
assert.match(mainSource,/function setMapAreaMetric\(metric\)\s*{\s*choroMetric=metric;\s*refreshMapSurfaces\(\);\s*}/,"changing the metric refreshes every active map surface");
assert.match(mainSource,/choroMetric==="categoryMode"/,"administrative and proximity rendering support category mode");
assert.match(mainSource,/choroMetric==="visitCount"/,"administrative and proximity rendering support Visit count");
assert.match(mainSource,/function areaVisitsForPlace\(place\)\{\s*return Array\.isArray\(place\?\.visits\) \? place\.visits : \[\];/,"area metrics read embedded projected Visits directly");
assert.doesNotMatch(mapColorSource,/\b(?:clockTime|visitTime|timeOfDay)\b/,"date-order coloring introduces no clock-time field");

console.log("visit area metric assertions passed");
