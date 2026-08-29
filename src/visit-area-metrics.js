function validVisitDate(value){
  if(typeof value!=="string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "";
  const [year,month,day]=value.split("-").map(Number);
  const date=new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear()===year && date.getUTCMonth()===month-1 && date.getUTCDate()===day ? value : "";
}

function normalizedCategory(value){
  return typeof value==="string" ? value.trim() : "";
}

function lexicalCompare(a,b){
  return a===b ? 0 : a<b ? -1 : 1;
}

export function categoryMode(visits=[], categoryOrder=[]){
  const counts=new Map();
  for(const visit of visits){
    const category=normalizedCategory(visit?.category);
    if(category) counts.set(category,(counts.get(category)||0)+1);
  }
  if(!counts.size) return "";

  const configuredRank=new Map();
  for(const category of categoryOrder){
    const normalized=normalizedCategory(category);
    if(normalized && !configuredRank.has(normalized)) configuredRank.set(normalized,configuredRank.size);
  }
  return [...counts.keys()].sort((a,b)=>{
    const countDifference=counts.get(b)-counts.get(a);
    if(countDifference) return countDifference;
    const aRank=configuredRank.has(a) ? configuredRank.get(a) : Number.POSITIVE_INFINITY;
    const bRank=configuredRank.has(b) ? configuredRank.get(b) : Number.POSITIVE_INFINITY;
    return aRank-bRank || lexicalCompare(a,b);
  })[0];
}

export function summarizeVisitAreaMetrics(visits=[], categoryOrder=[]){
  const visitList=Array.isArray(visits) ? visits : [];
  const dates=visitList.map(visit=>validVisitDate(visit?.date)).filter(Boolean).sort(lexicalCompare);
  return {
    earliest:dates[0]||"",
    latest:dates[dates.length-1]||"",
    categoryMode:categoryMode(visitList,categoryOrder),
    visitCount:visitList.length
  };
}

export function aggregatePlaceVisitAreaMetrics(places=[], {
  categoryOrder=[],
  selectVisits=place=>Array.isArray(place?.visits) ? place.visits : [],
  visitFilter=()=>true
}={}){
  const visits=[];
  for(const place of places||[]){
    for(const visit of selectVisits(place)||[]){
      if(visitFilter(visit,place)) visits.push(visit);
    }
  }
  return summarizeVisitAreaMetrics(visits,categoryOrder);
}
