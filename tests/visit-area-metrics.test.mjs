import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  aggregatePlaceVisitAreaMetrics,
  categoryMode,
  summarizeVisitAreaMetrics
} from "../src/visit-area-metrics.js";

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
assert.deepEqual(aggregate,{earliest:"2024-01-01",latest:"2025-01-01",categoryMode:"美食",visitCount:3},"administrative aggregation combines Visit occurrences across Places");
assert.deepEqual(
  aggregatePlaceVisitAreaMetrics([repeatedPlace]),
  {earliest:"2024-01-01",latest:"2024-02-01",categoryMode:"美食",visitCount:2},
  "a proximity seed derives every metric from its Visits"
);
assert.notEqual(aggregate.earliest,repeatedPlace.visitedOn,"legacy Place date cannot override Visit-derived metrics");
assert.notEqual(aggregate.categoryMode,repeatedPlace.categories[0],"legacy Place category cannot override Visit-derived metrics");

const filtered=aggregatePlaceVisitAreaMetrics([repeatedPlace,otherPlace],{
  visitFilter:visit=>visit.date>="2024-02-01"
});
assert.deepEqual(filtered,{earliest:"2024-02-01",latest:"2025-01-01",categoryMode:"美食",visitCount:2});

const mainSource=await readFile(new URL("../src/main.js",import.meta.url),"utf8");
const settingsBlock=mainSource.slice(mainSource.indexOf("function openNoSpaceSettings"),mainSource.indexOf("function noSpaceSessionIsCurrent"));
for(const text of ["地圖上色","上色依據","透明度"]){
  assert.match(settingsBlock,new RegExp(text),`No-Space settings contain ${text}`);
}
assert.match(settingsBlock,/id="ns_metric"[\s\S]*MAP_AREA_METRIC_OPTIONS/,"No-Space settings render the shared area metric options");
for(const text of ["造訪深度","地標數","最早造訪日期","最後造訪日期","造訪目的（眾數）"]){
  assert.match(mainSource,new RegExp(text),`shared area metric options contain ${text}`);
}
assert.match(settingsBlock,/metric\.onchange\s*=\s*event\s*=>\s*setMapAreaMetric\(event\.target\.value\)/,"changing the No-Space area metric uses the shared refresh path");
assert.match(mainSource,/function setMapAreaMetric\(metric\)\s*{\s*choroMetric=metric;\s*refreshMapSurfaces\(\);\s*}/,"changing the metric refreshes every active map surface");
assert.match(mainSource,/choroMetric==="categoryMode"/,"administrative and proximity rendering support category mode");
assert.match(mainSource,/isNoSpace\(\) \? \(Array\.isArray\(place\?\.visits\)/,"No-Space area metrics read embedded projected Visits directly");

console.log("visit area metric assertions passed");
