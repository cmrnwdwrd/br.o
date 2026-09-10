/* ---------- GitHub Actions compact shared observed history ---------- */
let sharedObservedRecords=[]; // compatibility with older local-history renderers
let observedTop50Data=null;
const OBSERVED_TOP50_URL="data/stats/observed_top50.json";

async function loadSharedObservedHistory(){
  const status=document.getElementById("status-observed");
  if(status) status.textContent="Refreshing…";
  try{
    const r=await fetch(OBSERVED_TOP50_URL+"?t="+Date.now(),{cache:"no-store"});
    if(!r.ok)throw new Error(r.status+" "+r.statusText);
    const text=await r.text();
    observedTop50Data=JSON.parse(text);
    const updated=observedTop50Data?.updatedAt
      ?new Date(observedTop50Data.updatedAt).toLocaleString()
      :"—";
    if(status) status.textContent="Last Updated: "+updated;
    renderPersistentHistories();
  }catch(e){
    observedTop50Data=null;
    if(status) status.textContent="Last Updated: unavailable";
  }
}

/* Kept for compatibility with earlier local-only history code. */
document.getElementById("refreshObservedHistory")?.addEventListener("click",async()=>{
  await loadSharedObservedHistory();
});

function mergeObserved(local,shared){
  const m=new Map();
  for(const r of [...(shared||[]),...(local||[])])m.set(r.playKey,r);
  return [...m.values()];
}

/* ---------- v26 Active Streams dashboard ---------- */
let listenerDoc=null;
let listenerPeriod="90d";
let listenerPlotPoints=[];
let listenerCanvasHoverX=null;
let listenerSelectedHour=null;

function parseListenerTime(v){
  const d=new Date(v);
  return isNaN(d)?null:d;
}
function listenerPeriodMs(period){
  return period==="24h"?86400000:
         period==="7d"?7*86400000:
         period==="30d"?30*86400000:
         period==="90d"?90*86400000:null;
}
function currentListenerSamples(){
  if(!listenerDoc)return[];
  return listenerDoc.recentSamples||listenerDoc.samples||[];
}
function filterListenerSamples(period){
  const samples=currentListenerSamples()
    .map(s=>({timestamp:s.timestamp,time:parseListenerTime(s.timestamp),listeners:Number(s.listeners)}))
    .filter(s=>s.time&&Number.isFinite(s.listeners))
    .sort((a,b)=>a.time-b.time);
  const ms=listenerPeriodMs(period);
  if(!ms)return samples;
  const cutoff=Date.now()-ms;
  return samples.filter(s=>s.time.getTime()>=cutoff);
}
function dailyFromSamples(samples){
  const map=new Map();
  for(const s of samples){
    const d=s.time||parseListenerTime(s.timestamp);if(!d)continue;
    const key=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0");
    if(!map.has(key))map.set(key,{date:key,time:new Date(d.getFullYear(),d.getMonth(),d.getDate()),sum:0,count:0,min:Infinity,max:-Infinity});
    const x=map.get(key),v=Number(s.listeners);
    x.sum+=v;x.count++;x.min=Math.min(x.min,v);x.max=Math.max(x.max,v);
  }
  return [...map.values()].sort((a,b)=>a.time-b.time).map(x=>({...x,avg:x.sum/x.count}));
}
function allTimeDailyPoints(){
  if(!listenerDoc)return[];
  const old=(listenerDoc.dailySummaries||[]).map(d=>({
    date:d.date,time:new Date(d.date+"T12:00:00"),sum:Number(d.sum||0),count:Number(d.count||0),
    min:Number(d.min||0),max:Number(d.max||0),avg:Number(d.avg||0)
  })).filter(d=>!isNaN(d.time));
  const recent=dailyFromSamples(filterListenerSamples("all"));
  const m=new Map();
  old.forEach(d=>m.set(d.date,d));recent.forEach(d=>m.set(d.date,d));
  return [...m.values()].sort((a,b)=>a.time-b.time);
}
function listenerStatsForPeriod(period){
  if(period==="all"){
    const days=allTimeDailyPoints();
    if(!days.length)return null;
    const totalCount=days.reduce((a,d)=>a+d.count,0);
    const weighted=days.reduce((a,d)=>a+d.avg*d.count,0);
    return {
      min:Math.min(...days.map(d=>d.min)),
      max:Math.max(...days.map(d=>d.max)),
      avg:totalCount?weighted/totalCount:0,
      count:totalCount,
      days:days.length
    };
  }
  const s=filterListenerSamples(period);
  if(!s.length)return null;
  return {
    min:Math.min(...s.map(x=>x.listeners)),
    max:Math.max(...s.map(x=>x.listeners)),
    avg:s.reduce((a,x)=>a+x.listeners,0)/s.length,
    count:s.length,
    days:new Set(s.map(x=>x.time.toLocaleDateString())).size
  };
}
function resizeCanvas(canvas,heightCss){
  const ratio=window.devicePixelRatio||1;
  const w=Math.max(320,canvas.clientWidth||canvas.parentElement.clientWidth||800);
  const h=heightCss;
  canvas.width=Math.round(w*ratio);
  canvas.height=Math.round(h*ratio);
  canvas.style.height=h+"px";
  const ctx=canvas.getContext("2d");
  ctx.setTransform(ratio,0,0,ratio,0,0);
  return {ctx,w,h};
}
function drawListenerChart(){
  const canvas=document.getElementById("listenerCanvas");if(!canvas||!listenerDoc)return;
  const {ctx,w,h}=resizeCanvas(canvas,330);
  ctx.clearRect(0,0,w,h);
  const L=48,R=18,T=20,B=38, pw=w-L-R, ph=h-T-B;

  let points;
  if(listenerPeriod==="all"){
    points=allTimeDailyPoints().map(d=>({time:d.time,value:d.avg,day:d}));
  }else{
    points=filterListenerSamples(listenerPeriod).map(s=>({time:s.time,value:s.listeners,sample:s}));
  }
  listenerPlotPoints=points;
  if(!points.length){
    ctx.fillStyle="#aaa";ctx.font="14px system-ui";ctx.textAlign="center";
    ctx.fillText("No active-stream samples for this period",w/2,h/2);return;
  }
  const x0=points[0].time.getTime(), x1=Math.max(x0+1,points[points.length-1].time.getTime());
  const ymax=Math.max(1,Math.ceil(Math.max(...points.map(p=>p.value))));
  const yTop=Math.max(1,ymax);

  ctx.font="12px system-ui";
  ctx.strokeStyle="#333";ctx.fillStyle="#aaa";ctx.lineWidth=1;
  ctx.textAlign="right";
  for(let i=0;i<=4;i++){
    const y=T+ph*i/4;
    const val=yTop*(4-i)/4;
    ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(w-R,y);ctx.stroke();
    ctx.fillText(val.toFixed(val%1?1:0),L-7,y+4);
  }
  ctx.textAlign="center";
  for(const f of [0,.5,1]){
    const ts=x0+(x1-x0)*f;
    const d=new Date(ts);
    const x=L+pw*f;
    const label=listenerPeriod==="24h"
      ?d.toLocaleTimeString([],{hour:"numeric",minute:"2-digit"})
      :d.toLocaleDateString([],{month:"short",day:"numeric"});
    ctx.fillText(label,x,h-12);
  }

  const xy=points.map(p=>({
    ...p,
    x:L+(p.time.getTime()-x0)/(x1-x0)*pw,
    y:T+ph-(p.value/yTop)*ph
  }));
  listenerPlotPoints=xy;

  ctx.strokeStyle="#f3f3f3";ctx.lineWidth=2;ctx.lineJoin="round";
  ctx.beginPath();
  xy.forEach((p,i)=>{if(i===0)ctx.moveTo(p.x,p.y);else{ctx.lineTo(p.x,xy[i-1].y);ctx.lineTo(p.x,p.y)}});
  ctx.stroke();

  const stride=Math.max(1,Math.ceil(xy.length/250));
  ctx.fillStyle="#111";ctx.strokeStyle="#f3f3f3";ctx.lineWidth=1.5;
  xy.forEach((p,i)=>{if(i%stride)return;ctx.beginPath();ctx.arc(p.x,p.y,2.5,0,Math.PI*2);ctx.fill();ctx.stroke()});

  if(listenerCanvasHoverX!==null){
    const x=Math.max(L,Math.min(w-R,listenerCanvasHoverX));
    ctx.strokeStyle="#888";ctx.lineWidth=1;
    ctx.beginPath();ctx.moveTo(x,T);ctx.lineTo(x,T+ph);ctx.stroke();
  }
}
function nearestPlotPoint(x){
  if(!listenerPlotPoints.length)return null;
  return listenerPlotPoints.reduce((best,p)=>!best||Math.abs(p.x-x)<Math.abs(best.x-x)?p:best,null);
}
function showListenerCanvasTooltip(clientX,clientY){
  const canvas=document.getElementById("listenerCanvas"),tip=document.getElementById("listenerTooltip");
  if(!canvas||!tip||!listenerPlotPoints.length)return;
  const rect=canvas.getBoundingClientRect();
  listenerCanvasHoverX=Math.max(0,Math.min(rect.width,clientX-rect.left));
  const p=nearestPlotPoint(listenerCanvasHoverX);if(!p)return;

  if(listenerPeriod==="all"&&p.day){
    tip.innerHTML="<strong>"+p.day.time.toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",year:"numeric"})+"</strong>"+
      '<div class="tip-row"><span>Min</span><b>'+p.day.min+"</b></div>"+
      '<div class="tip-row"><span>Average</span><b>'+p.day.avg.toFixed(1)+"</b></div>"+
      '<div class="tip-row"><span>Max</span><b>'+p.day.max+"</b></div>"+
      '<div class="tip-row"><span>Samples</span><b>'+p.day.count+"</b></div>";
  }else{
    const d=p.time;
    const sameDay=filterListenerSamples(listenerPeriod).filter(s=>s.time.toLocaleDateString()===d.toLocaleDateString());
    const ds=dailyFromSamples(sameDay)[0];
    tip.innerHTML="<strong>"+d.toLocaleString(undefined,{weekday:"short",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"})+"</strong>"+
      '<div class="tip-row"><span>Active streams</span><b>'+p.value+"</b></div>"+
      (ds?'<div class="tip-row"><span>Day min / avg / max</span><b>'+ds.min+" / "+ds.avg.toFixed(1)+" / "+ds.max+"</b></div>":"");
  }
  tip.hidden=false;
  let left=listenerCanvasHoverX+10;
  const tw=tip.offsetWidth||220;
  if(left+tw>rect.width)left=Math.max(0,listenerCanvasHoverX-tw-10);
  tip.style.left=left+"px";tip.style.top="12px";
  drawListenerChart();
}
function setupListenerCanvas(){
  const canvas=document.getElementById("listenerCanvas"),tip=document.getElementById("listenerTooltip");
  if(!canvas||!tip)return;
  canvas.addEventListener("mousemove",e=>showListenerCanvasTooltip(e.clientX,e.clientY));
  canvas.addEventListener("mouseleave",()=>{tip.hidden=true;listenerCanvasHoverX=null;drawListenerChart()});
  canvas.addEventListener("click",e=>showListenerCanvasTooltip(e.clientX,e.clientY));

  let touchStartX=0,touchStartY=0,touchScrubbing=false;
  canvas.addEventListener("touchstart",e=>{
    const t=e.touches?.[0];if(!t)return;
    touchStartX=t.clientX;touchStartY=t.clientY;touchScrubbing=false;
    showListenerCanvasTooltip(t.clientX,t.clientY);
  },{passive:true});
  canvas.addEventListener("touchmove",e=>{
    const t=e.touches?.[0];if(!t)return;
    const dx=t.clientX-touchStartX,dy=t.clientY-touchStartY;
    if(!touchScrubbing && Math.abs(dx)>6 && Math.abs(dx)>=Math.abs(dy))touchScrubbing=true;
    if(touchScrubbing){
      e.preventDefault();
      showListenerCanvasTooltip(t.clientX,t.clientY);
    }
  },{passive:false});
  canvas.addEventListener("touchend",()=>{touchScrubbing=false},{passive:true});
  canvas.addEventListener("touchcancel",()=>{touchScrubbing=false},{passive:true});

  window.addEventListener("resize",()=>{drawListenerChart();drawHourChart()});
  if("ResizeObserver" in window){
    const ro=new ResizeObserver(entries=>{
      for(const entry of entries){
        if(entry.contentRect.width>0){drawListenerChart();drawHourChart();}
      }
    });
    ro.observe(document.getElementById("listenerCanvasWrap"));
  }
}
function renderListenerPeriodStats(){
  const s=listenerStatsForPeriod(listenerPeriod);
  const el=document.getElementById("listenerPeriodStats");if(!el)return;
  el.innerHTML=s?[
    statTile("Minimum",s.min),
    statTile("Average",s.avg.toFixed(2)),
    statTile("Maximum",s.max),
    statTile("Samples",s.count),
    statTile("Days represented",s.days)
  ].join(""):statTile("Period","No samples");
  const labels={"24h":"Last 24 hours","7d":"Last 7 days","30d":"Last 30 days","90d":"Last 90 days","all":"All-time daily summaries"};
  document.getElementById("listenerPeriodLabel").textContent=labels[listenerPeriod];
}
function allTimeHourBins(){
  const bins=listenerDoc?.hourBins;
  if(Array.isArray(bins)&&bins.length===24)return bins;
  const out=Array.from({length:24},(_,hour)=>({hour,sum:0,count:0,min:null,max:null}));
  for(const s of filterListenerSamples("all")){
    const h=s.time.getHours(),b=out[h],v=s.listeners;
    b.sum+=v;b.count++;b.min=b.min===null?v:Math.min(b.min,v);b.max=b.max===null?v:Math.max(b.max,v);
  }
  return out;
}
function drawHourChart(){
  const canvas=document.getElementById("listenerHourCanvas");if(!canvas||!listenerDoc)return;
  const {ctx,w,h}=resizeCanvas(canvas,190);
  ctx.clearRect(0,0,w,h);
  const bins=allTimeHourBins();
  const avgs=bins.map(b=>b.count?b.sum/b.count:0), ymax=Math.max(1,...avgs);
  const L=34,R=8,T=12,B=28,pw=w-L-R,ph=h-T-B;
  ctx.strokeStyle="#333";ctx.fillStyle="#aaa";ctx.font="11px system-ui";
  for(let i=0;i<=2;i++){const y=T+ph*i/2;ctx.beginPath();ctx.moveTo(L,y);ctx.lineTo(w-R,y);ctx.stroke()}
  const bw=pw/24;

  avgs.forEach((v,hour)=>{
    const barH=(v/ymax)*ph;
    ctx.fillStyle=hour===listenerSelectedHour?"#777":"#ddd";
    ctx.fillRect(L+hour*bw+1,T+ph-barH,Math.max(1,bw-2),barH);
  });

  ctx.fillStyle="#aaa";ctx.textAlign="center";
  [0,6,12,18,23].forEach(hour=>ctx.fillText(hour===0?"12a":hour<12?hour+"a":hour===12?"12p":(hour-12)+"p",L+(hour+.5)*bw,h-8));

  const best=avgs.reduce((bi,v,i)=>v>avgs[bi]?i:bi,0);
  setKV("listenerHourStats",[
    ["Busiest hour",formatHourRange(best)],
    ["Average then",avgs[best].toFixed(2)],
    ["Samples then",bins[best].count]
  ]);

  const label=document.getElementById("listenerHourSelection");
  if(label){
    if(listenerSelectedHour===null){
      label.hidden=true;
      label.textContent="";
    }else{
      const hour=listenerSelectedHour;
      label.hidden=false;
      label.textContent=formatHourRange(hour)+" · "+avgs[hour].toFixed(2)+" avg active streams · "+bins[hour].count+" samples";
    }
  }

  canvas._hourChartGeometry={L,R,T,B,pw,ph,bw,w,h,bins,avgs};
}
function toggleHourSelectionFromClientX(clientX){
  const canvas=document.getElementById("listenerHourCanvas");
  const g=canvas?canvas._hourChartGeometry:null;
  if(!canvas||!g)return;
  const rect=canvas.getBoundingClientRect();
  const x=(clientX-rect.left)*(g.w/rect.width);
  if(x<g.L||x>g.w-g.R)return;
  const hour=Math.max(0,Math.min(23,Math.floor((x-g.L)/g.bw)));
  listenerSelectedHour=(listenerSelectedHour===hour)?null:hour;
  drawHourChart();
}

function formatHourRange(h){
  const fmtH=x=>x===0?"12 AM":x<12?x+" AM":x===12?"12 PM":(x-12)+" PM";
  return fmtH(h)+"–"+fmtH((h+1)%24);
}
function renderListenerRecords(){
  const records=listenerDoc?.records||{};
  const atm=listenerDoc?.allTimeMax||records.allTimeMax;
  const rows=[];
  if(atm)rows.push(["All-time max",atm.listeners+" · "+new Date(atm.timestamp).toLocaleString()]);
  if(records.highestDailyAverage)rows.push(["Highest daily average",Number(records.highestDailyAverage.avg).toFixed(2)+" · "+records.highestDailyAverage.date]);
  if(records.highestDailyMax)rows.push(["Highest daily peak",records.highestDailyMax.max+" · "+records.highestDailyMax.date]);
  rows.push(["Days recorded",records.daysRecorded??"—"]);
  const bestHour=allTimeHourBins().map((b,i)=>({i,avg:b.count?b.sum/b.count:0,count:b.count})).sort((a,b)=>b.avg-a.avg)[0];
  if(bestHour&&bestHour.count)rows.push(["Busiest hour",formatHourRange(bestHour.i)+" · "+bestHour.avg.toFixed(2)+" avg"]);
  setKV("listenerRecords",rows);
}
function renderCollectorHealth(){
  const el=document.getElementById("collectorHealth");if(!el||!listenerDoc)return;
  const d=parseListenerTime(listenerDoc.updatedAt);
  if(!d){el.textContent="Collector: unknown";el.className="collector-health warn";return}
  const mins=(Date.now()-d.getTime())/60000;
  const fallback=listenerDoc.lastSampleSource==="github-fallback";
  el.className="collector-health "+(mins<=15?"ok":mins<=30?"warn":"bad");
  el.textContent=mins<=15
    ?"Collector: ✓ "+Math.max(0,Math.round(mins))+" min ago"+(fallback?" · Fallback sample":"")
    :mins<=30
      ?"Collector delayed · "+Math.round(mins)+" min"
      :"Collector stale · "+Math.round(mins)+" min";
}
async function refreshListenerHistoryInfo(){
  const live=Number(latestData?.listeners?.current);
  document.getElementById("listenerLiveCurrent").textContent=Number.isFinite(live)?String(live):"—";
  try{
    const r=await fetch("data/listener_history.json?t="+Date.now(),{cache:"no-store"});
    if(!r.ok)throw new Error(r.status+" "+r.statusText);
    listenerDoc=await r.json();
    renderListenerRecords();renderListenerPeriodStats();drawListenerChart();drawHourChart();renderCollectorHealth();
    const recent=currentListenerSamples(),last=recent.length?recent[recent.length-1]:null;
    document.getElementById("listenerPlotStatus").textContent=last
      ?"Latest detailed sample: "+last.listeners+" at "+new Date(last.timestamp).toLocaleString()
      :"No detailed samples yet.";
  }catch(e){
    document.getElementById("collectorHealth").textContent="Collector data unavailable";
    document.getElementById("collectorHealth").className="collector-health bad";
    document.getElementById("listenerPlotStatus").textContent="Listener history unavailable: "+e;
  }
}
async function refreshListenerPlot(){
  await refreshListenerHistoryInfo();
  document.getElementById("listenerPlotStatus").textContent+=" · refreshed "+new Date().toLocaleTimeString();
}
document.getElementById("refreshListenerPlot").addEventListener("click",refreshListenerPlot);
document.querySelectorAll("#listenerPeriodTabs button").forEach(b=>b.addEventListener("click",()=>{
  listenerPeriod=b.dataset.period;
  document.querySelectorAll("#listenerPeriodTabs button").forEach(x=>x.classList.toggle("active",x===b));
  listenerCanvasHoverX=null;
  document.getElementById("listenerTooltip").hidden=true;
  renderListenerPeriodStats();drawListenerChart();
}));
setupListenerCanvas();
const listenerHourCanvas=document.getElementById("listenerHourCanvas");
if(listenerHourCanvas){
  listenerHourCanvas.addEventListener("click",e=>toggleHourSelectionFromClientX(e.clientX));
}
setTimeout(refreshListenerHistoryInfo,700);

Object.assign(infoHelp,{
  listenertrend:{title:"Active Streams",items:[
    ["Periods","Switch between 24 hours, 7 days, 30 days, 90 days, and all time. Detailed 5-minute samples are retained for 90 days; older history is compressed into daily summaries."],
    ["Interactive chart","Move the mouse or tap anywhere along the x-axis. You do not need to hit a data point; the nearest sample/day is selected and a vertical cursor appears."],
    ["Time of day","The hourly chart uses cumulative aggregate samples to show when BottleRag tends to have the most simultaneous active streams."],
    ["Records","All-time peak, highest daily average, highest daily peak, and busiest hour remain available even after old detailed samples are compressed."],
    ["Collector health","Shows how recently GitHub Actions updated the shared data. More than about 15 minutes suggests the scheduled collector is delayed."]
  ]}
});

setTimeout(loadSharedObservedHistory,500);
