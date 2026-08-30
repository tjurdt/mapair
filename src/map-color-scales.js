export const VISIT_DATE_RAINBOW = Object.freeze([
  "#d94b4b",
  "#e98a32",
  "#e0bd34",
  "#4a9f63",
  "#3f78b5",
  "#7756b3"
]);

export function lerpHex(from, to, amount){
  const channels=hex=>[1,3,5].map(index=>parseInt(hex.slice(index,index+2),16));
  const t=Math.max(0,Math.min(1,Number.isFinite(amount)?amount:0));
  const start=channels(from), end=channels(to);
  const channel=(a,b)=>Math.round(a+(b-a)*t).toString(16).padStart(2,"0");
  return `#${channel(start[0],end[0])}${channel(start[1],end[1])}${channel(start[2],end[2])}`;
}

export function multiStopColor(colors,t){
  if(!Array.isArray(colors) || !colors.length) return null;
  if(colors.length===1) return colors[0];
  const normalized=Math.max(0,Math.min(1,Number.isFinite(t)?t:0));
  const position=normalized*(colors.length-1);
  const index=Math.min(colors.length-2,Math.floor(position));
  return lerpHex(colors[index],colors[index+1],position-index);
}

export function positiveExtrema(values=[]){
  const positive=(values||[]).map(Number).filter(value=>Number.isFinite(value) && value>0);
  return positive.length ? {min:Math.min(...positive),max:Math.max(...positive)} : null;
}

export function quantitativeColor(colors,value,extrema){
  const numeric=Number(value);
  if(!Number.isFinite(numeric) || numeric<=0 || !extrema) return null;
  const min=Number(extrema.min), max=Number(extrema.max);
  if(!Number.isFinite(min) || !Number.isFinite(max) || min<=0 || max<min) return null;
  const position=min===max ? 0.5 : (numeric-min)/(max-min);
  return multiStopColor(colors,position);
}

// Deepest level in `levels` according to `order` (index 0 = shallowest).
// Unknown values are ignored; returns null when nothing matches.
export function deepestLevel(levels = [], order = []) {
  let best = -1;
  for (const value of levels) {
    const index = order.indexOf(value);
    if (index > best) best = index;
  }
  return best < 0 ? null : order[best];
}

export function orderedVisitDateColor({
  baseColor,
  occurrenceIndex=0,
  occurrenceCount=1,
  singleDay=false,
  rainbow=VISIT_DATE_RAINBOW
}={}){
  const count=Math.max(1,Math.trunc(Number(occurrenceCount))||1);
  const index=Math.max(0,Math.min(count-1,Math.trunc(Number(occurrenceIndex))||0));
  if(singleDay){
    const position=count===1 ? 0.5 : index/(count-1);
    return multiStopColor(rainbow,position);
  }
  if(count===1) return baseColor;
  const position=index/(count-1);
  if(position<=0.5) return lerpHex("#ffffff",baseColor,0.55+0.45*(position/0.5));
  return lerpHex(baseColor,"#000000",0.55*((position-0.5)/0.5));
}
