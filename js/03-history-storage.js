/* ---------- IndexedDB history ---------- */
const DB_NAME="BottleRagHistory";
const DB_VERSION=2;
let dbPromise=null;
function openHistoryDB(){
  if(dbPromise)return dbPromise;
  dbPromise=new Promise((resolve,reject)=>{
    const req=indexedDB.open(DB_NAME,DB_VERSION);
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains("observed")){
        const s=db.createObjectStore("observed",{keyPath:"playKey"});
        s.createIndex("playedAt","playedAt");
      }
      if(!db.objectStoreNames.contains("listening")){
        const s=db.createObjectStore("listening",{keyPath:"playKey"});
        s.createIndex("playedAt","playedAt");
      }
      if(!db.objectStoreNames.contains("favorites")){
        const s=db.createObjectStore("favorites",{keyPath:"trackKey"});
        s.createIndex("likedAt","likedAt");
      }
    };
    req.onsuccess=()=>resolve(req.result);
    req.onerror=()=>reject(req.error);
  });
  return dbPromise;
}
async function putRecord(store,record){
  const db=await openHistoryDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,"readwrite");
    tx.objectStore(store).put(record);
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}
async function getAllRecords(store){
  const db=await openHistoryDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,"readonly");
    const req=tx.objectStore(store).getAll();
    req.onsuccess=()=>resolve(req.result||[]);
    req.onerror=()=>reject(req.error);
  });
}
async function clearStore(store){
  const db=await openHistoryDB();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction(store,"readwrite");
    tx.objectStore(store).clear();
    tx.oncomplete=()=>resolve();
    tx.onerror=()=>reject(tx.error);
  });
}
function itemToRecord(item,source="observed"){
  const song=item?.song||{};
  const playedAt=Number(item?.played_at||0);
  const sh=item?.sh_id;
  const fallback=[playedAt,song.artist||"",song.title||"",item?.duration||0].join("|");
  return {
    playKey: sh ? "sh:"+sh : "fallback:"+fallback,
    shId:sh||null,
    songId:song.id||null,
    artist:song.artist||"",
    title:song.title||"Unknown",
    album:song.album||"",
    art:song.art||"",
    duration:Number(item?.duration||0),
    playedAt,
    playlist:item?.playlist||"",
    streamer:item?.streamer||"",
    isRequest:!!item?.is_request,
    source,
    firstSeenAt:Date.now(),
    listenedSeconds:0
  };
}
function nowPlayingToItem(data){
  const np=data?.now_playing||{};
  return {
    sh_id:np.sh_id,played_at:np.played_at,duration:np.duration,
    playlist:np.playlist,streamer:np.streamer,is_request:np.is_request,
    song:np.song||{}
  };
}

let session={
  startedAt:Date.now(),
  listeningSeconds:0,
  playKeys:new Set(),
  records:new Map(),
  listenerSamples:[],
  metadataStartBytes: typeof metadataSessionBytes!=="undefined" ? metadataSessionBytes : 0
};
let lastObservedKey=null;
let activeListeningKey=null;
let listeningWriteCounter=0;

async function ingestMetadata(data){
  if(!data)return;
  const observedItems=[nowPlayingToItem(data),...(data.song_history||[])];
  for(const item of observedItems){
    const rec=itemToRecord(item,"observed");
    if(rec.playedAt||rec.shId) await putRecord("observed",rec);
  }
  const current=itemToRecord(nowPlayingToItem(data),"observed");
  lastObservedKey=current.playKey;

  const listeners=Number(data.listeners?.current);
  if(Number.isFinite(listeners))session.listenerSamples.push(listeners);

  if(!livePlayer.paused){
    await registerListeningCurrent(data);
  }
  renderSessionStats();
  scheduleHistoryRenders();
}
async function registerListeningCurrent(data){
  if(!data)return;
  const rec=itemToRecord(nowPlayingToItem(data),"listening");
  if(!(rec.playedAt||rec.shId))return;
  activeListeningKey=rec.playKey;
  session.playKeys.add(rec.playKey);
  if(!session.records.has(rec.playKey))session.records.set(rec.playKey,rec);
  const existing=(await getAllRecords("listening")).find(x=>x.playKey===rec.playKey);
  if(existing) rec.listenedSeconds=existing.listenedSeconds||0;
  await putRecord("listening",rec);
}

/* Hook all metadata rendering so observed history gets populated without extra requests. */
const _renderNowBase=renderNow;
renderNow=function(data){
  _renderNowBase(data);
  ingestMetadata(data).catch(()=>{});
  updateMediaSessionSafe(data);
};

/* ---------- Session/listening timers ---------- */
setInterval(async()=>{
  if(!livePlayer.paused){
    session.listeningSeconds++;
    const np=latestData?itemToRecord(nowPlayingToItem(latestData),"listening"):null;
    if(np && (np.playedAt||np.shId)){
      activeListeningKey=np.playKey;
      session.playKeys.add(np.playKey);
      let sr=session.records.get(np.playKey);
      if(!sr){sr=np;session.records.set(np.playKey,sr)}
      sr.listenedSeconds=(sr.listenedSeconds||0)+1;
      listeningWriteCounter++;
      if(listeningWriteCounter>=10){
        listeningWriteCounter=0;
        try{
          const all=await getAllRecords("listening");
          const existing=all.find(x=>x.playKey===np.playKey);
          np.listenedSeconds=(existing?.listenedSeconds||0)+10;
          await putRecord("listening",np);
        }catch(e){}
      }
    }
  }
  renderSessionStats();
},1000);

function statTile(label,value){
  return '<div class="stat-tile"><div class="muted tiny">'+escapeHtml(label)+'</div><div class="stat-value">'+escapeHtml(String(value))+'</div></div>';
}
function escapeHtml(s){
  const d=document.createElement("div");
  d.textContent=String(s);
  return d.innerHTML;
}
function uniqueCount(records,key){
  return new Set(records.map(r=>(r[key]||"").trim()).filter(Boolean)).size;
}
function fmtDate(ts){
  if(!ts)return "—";
  return new Date(ts>1e12?ts:ts*1000).toLocaleString();
}
function isUnknownRecord(r){
  const title=(r?.title||"").trim().toLowerCase();
  const artist=(r?.artist||"").trim().toLowerCase();
  return title==="unknown" || (!artist && (!title || title==="unknown"));
}
function spotifyHistoryButton(artist,title){
  if(typeof spotifyMiniButton==="function") return spotifyMiniButton(artist,title);
  const b=document.createElement("button");
  b.className="mini-spotify";b.type="button";b.title="Open on Spotify";
  b.textContent="♪";
  b.addEventListener("click",()=>window.open("https://open.spotify.com/search/"+encodeURIComponent(((artist||"")+" "+(title||"")).trim()),"_blank","noopener"));
  return b;
}
function renderCompactHistory(id,records,limit=25,options={}){
  const el=document.getElementById(id);if(!el)return;
  el.replaceChildren();
  let rows=[...records].sort((a,b)=>(b.playedAt||0)-(a.playedAt||0));
  if(options.hideUnknown)rows=rows.filter(r=>!isUnknownRecord(r));
  if(Number.isFinite(limit))rows=rows.slice(0,limit);
  if(!rows.length){el.innerHTML='<div class="muted tiny">No records yet.</div>';return}
  for(const r of rows){
    const row=document.createElement("div");row.className="compact-row spotify-history-row";
    const main=document.createElement("div");main.className="compact-main";
    main.innerHTML='<strong>'+escapeHtml(r.title||"Unknown")+'</strong><div class="muted tiny">'+escapeHtml(r.artist||"")+(r.album?' · '+escapeHtml(r.album):'')+'</div>';
    const time=document.createElement("div");time.className="compact-time";time.textContent=fmtDate(r.playedAt);
    const spot=spotifyHistoryButton(r.artist||"",r.title||"");
    row.append(main,time,spot);el.appendChild(row);
  }
}
function renderSessionStats(){
  const recs=[...session.records.values()];
  const samples=session.listenerSamples;
  const min=samples.length?Math.min(...samples):"—";
  const max=samples.length?Math.max(...samples):"—";
  const avg=samples.length?(samples.reduce((a,b)=>a+b,0)/samples.length).toFixed(1):"—";
  const estBytes=session.listeningSeconds*16000;
  document.getElementById("sessionStats").innerHTML=[
    statTile("Session length",formatHMS((Date.now()-session.startedAt)/1000)),
    statTile("Listening time",formatHMS(session.listeningSeconds)),
    statTile("Songs heard",session.playKeys.size),
    statTile("Unique artists",uniqueCount(recs,"artist")),
    statTile("Estimated audio",formatBytes(estBytes)),
    statTile("Listeners min / avg / max",min+" / "+avg+" / "+max)
  ].join("");
  document.getElementById("sessionListCount").textContent=recs.length+" plays";
  renderCompactHistory("sessionHistoryList",recs,Infinity);
  document.getElementById("status-session").textContent="Session started "+new Date(session.startedAt).toLocaleTimeString();
}
let historyRenderTimer=null;
function scheduleHistoryRenders(){
  if(historyRenderTimer)return;
  historyRenderTimer=setTimeout(async()=>{
    historyRenderTimer=null;
    await renderPersistentHistories();
  },800);
}
function topCounts(records,key,limit=5){
  const m=new Map();
  for(const r of records){
    const v=(r[key]||"").trim();if(!v)continue;
    m.set(v,(m.get(v)||0)+1);
  }
  return [...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,limit);
}
async function renderPersistentHistories(){
  let listening=[],observed=[];
  try{[listening,observed]=await Promise.all([getAllRecords("listening"),getAllRecords("observed")])}catch(e){return}
  const firstL=listening.length?Math.min(...listening.map(r=>r.playedAt||Infinity)):"";
  const lastL=listening.length?Math.max(...listening.map(r=>r.playedAt||0)):"";
  const listenSeconds=listening.reduce((a,r)=>a+(r.listenedSeconds||0),0);
  document.getElementById("myHistoryStats").innerHTML=[
    statTile("Recorded plays",listening.length),
    statTile("Unique artists",uniqueCount(listening,"artist")),
    statTile("Unique tracks",new Set(listening.map(r=>(r.artist||"")+"|"+(r.title||""))).size),
    statTile("Tracked listening",formatHMS(listenSeconds)),
    statTile("First recorded",firstL?fmtDate(firstL):"—"),
    statTile("Most recent",lastL?fmtDate(lastL):"—"),
    statTile("Ads played",listening.filter(isUnknownRecord).length),
    statTile("Avg ad time / listening hr",(()=>{const ads=listening.filter(isUnknownRecord);const adSec=ads.reduce((a,r)=>a+(Number(r.listenedSeconds)||0),0);return listenSeconds>0?fmt(adSec/(listenSeconds/3600))+" / hr":"—"})())
  ].join("");
  document.getElementById("myHistoryTop").innerHTML='<strong>Top artists:</strong> '+(topCounts(listening,"artist").map(([n,c])=>escapeHtml(n)+" ("+c+")").join(" · ")||"—");
  document.getElementById("myHistoryListCount").textContent=listening.length+" plays";
  renderCompactHistory("myHistoryList",listening,Infinity);

  const firstO=observed.length?Math.min(...observed.map(r=>r.playedAt||Infinity)):"";
  const lastO=observed.length?Math.max(...observed.map(r=>r.playedAt||0)):"";
  document.getElementById("observedStats").innerHTML=[
    statTile("Observed plays",observed.length),
    statTile("Unique artists",uniqueCount(observed,"artist")),
    statTile("Unique tracks",new Set(observed.map(r=>(r.artist||"")+"|"+(r.title||""))).size),
    statTile("First observed",firstO?fmtDate(firstO):"—"),
    statTile("Most recent",lastO?fmtDate(lastO):"—"),
    statTile("Coverage",observed.length?(new Date(firstO*1000).toLocaleDateString()+" → "+new Date(lastO*1000).toLocaleDateString()):"—")
  ].join("");
  document.getElementById("observedHistoryListCount").textContent=observed.filter(r=>!isUnknownRecord(r)).length+" tracks";
  renderCompactHistory("observedHistoryList",observed,Infinity,{hideUnknown:true});
  document.getElementById("status-myhistory").textContent="Stored on this device";
}

/* ---------- Export / import / resets ---------- */
document.getElementById("exportHistoryBtn").addEventListener("click",async()=>{
  const payload={
    exportedAt:new Date().toISOString(),
    observed:await getAllRecords("observed"),
    listening:await getAllRecords("listening"),
    favorites:await getAllRecords("favorites")
  };
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
  const a=document.createElement("a");
  a.href=URL.createObjectURL(blob);
  a.download="bottlerag-history-"+new Date().toISOString().slice(0,10)+".json";
  a.click();
  setTimeout(()=>URL.revokeObjectURL(a.href),1000);
});
document.getElementById("importHistoryInput").addEventListener("change",async e=>{
  const file=e.target.files?.[0];if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    for(const r of (data.observed||[]))await putRecord("observed",r);
    for(const r of (data.listening||[]))await putRecord("listening",r);
    for(const r of (data.favorites||[]))await putRecord("favorites",r);
    document.getElementById("storageStatus").textContent="History imported successfully.";
    renderPersistentHistories();
  }catch(err){
    document.getElementById("storageStatus").textContent="Import failed: "+err;
  }
  e.target.value="";
});
document.getElementById("clearListeningBtn").addEventListener("click",async()=>{
  if(confirm("Clear My Listening History on this device?")){await clearStore("listening");renderPersistentHistories()}
});
document.getElementById("clearObservedBtn").addEventListener("click",async()=>{
  if(confirm("Clear Observed BottleRag History on this device?")){await clearStore("observed");renderPersistentHistories()}
});
function resetCurrentSession(){
  session={startedAt:Date.now(),listeningSeconds:0,playKeys:new Set(),records:new Map(),listenerSamples:[],metadataStartBytes:metadataSessionBytes||0};
  renderSessionStats();
}
document.getElementById("resetSessionBtn").addEventListener("click",resetCurrentSession);
document.getElementById("resetDataSettingsBtn").addEventListener("click",()=>document.getElementById("resetData").click());

/* ---------- Media Session for iPhone lock screen ---------- */
function updateMediaSessionSafe(data){
  try{
    if(!("mediaSession" in navigator) || !("MediaMetadata" in window))return;
    const s=data?.now_playing?.song||{};
    navigator.mediaSession.metadata=new MediaMetadata({
      title:s.title||"BottleRag Radio",
      artist:s.artist||"BottleRag Radio",
      album:s.album||"",
      artwork:s.art?[{src:s.art,sizes:"512x512"}]:[]
    });
  }catch(e){}
}
try{
  if("mediaSession" in navigator){
    navigator.mediaSession.setActionHandler("play",()=>reconnectLiveStream(true));
    navigator.mediaSession.setActionHandler("pause",()=>{livePlayer.pause();livePlayer.removeAttribute("src");livePlayer.load();updateTransportUI()});
  }
}catch(e){}

/* ---------- Extend info help ---------- */
Object.assign(infoHelp,{
  session:{title:"Current Session",items:[
    ["Session","Starts when this page loads or when you reset the session."],
    ["Songs heard","Counts distinct BottleRag play events encountered while the audio was actually playing."],
    ["Listener statistics","Minimum, average, and maximum current-listener values observed during this session."],
    ["Persistence","Current Session resets when the page reloads; long-term listening records are stored separately."]
  ]},
  myhistory:{title:"My Listening History",items:[
    ["Recorded when","Only while this player's audio is actually playing."],
    ["Storage","Saved locally in IndexedDB on this browser/device and survives closing the page."],
    ["Device-specific","The same GitHub Pages URL on another browser/device has its own database unless you export/import it."]
  ]},
  observed:{title:"Observed BottleRag History",items:[
    ["Recorded when","Whenever this page receives BottleRag metadata, even if the audio is paused."],
    ["Recent-history backfill","Each API response's song_history entries are also saved, filling in some plays from immediately before the page was opened."],
    ["24/7 shared history","The included GitHub Actions workflow now collects public BottleRag history in the repository even while your browser is closed. Local observations are merged with it."],
  ]}
});

/* ---------- Refresh icons ---------- */
document.querySelectorAll(".refresh-btn").forEach(btn=>{
  btn.innerHTML='<span aria-hidden="true">↻</span>';
  btn.classList.add("icon-btn");
  btn.title="Refresh";
});

/* ---------- Initialize histories ---------- */
openHistoryDB().then(()=>renderPersistentHistories()).catch(e=>{
  document.getElementById("storageStatus").textContent="Local history storage unavailable: "+e;
});
renderSessionStats();
