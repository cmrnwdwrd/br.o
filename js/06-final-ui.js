/* ---------- Liked-songs-only backup controls ---------- */
document.getElementById("exportFavoritesBtn").addEventListener("click",async()=>{
  try{
    const favorites=await getAllRecords("favorites");
    const payload={type:"BottleRagLikedSongs",exportedAt:new Date().toISOString(),favorites};
    const blob=new Blob([JSON.stringify(payload,null,2)],{type:"application/json"});
    const a=document.createElement("a");
    a.href=URL.createObjectURL(blob);
    a.download="bottlerag-liked-songs-"+new Date().toISOString().slice(0,10)+".json";
    a.click();
    setTimeout(()=>URL.revokeObjectURL(a.href),1000);
  }catch(e){
    document.getElementById("storageStatus").textContent="Liked songs export failed: "+e;
  }
});
document.getElementById("importFavoritesInput").addEventListener("change",async e=>{
  const file=e.target.files?.[0]; if(!file)return;
  try{
    const data=JSON.parse(await file.text());
    const favorites=Array.isArray(data)?data:(data.favorites||[]);
    for(const r of favorites){
      if(r && r.trackKey)await putRecord("favorites",r);
    }
    document.getElementById("storageStatus").textContent="Liked songs imported.";
    await renderFavorites();
    await updateNowLikeUI();
  }catch(err){
    document.getElementById("storageStatus").textContent="Liked songs import failed: "+err;
  }
  e.target.value="";
});
document.getElementById("clearFavoritesBtn").addEventListener("click",async()=>{
  if(confirm("Clear all liked songs on this device?")){
    await clearStore("favorites");
    await renderFavorites();
    await updateNowLikeUI();
    document.getElementById("storageStatus").textContent="Liked songs cleared.";
  }
});


/* ---------- Simplified iPhone player ---------- */
const simpleModeBtn=document.getElementById("simpleModeBtn");
let simpleMode=false;
function setSimpleMode(enabled){
  simpleMode=enabled;
  document.body.classList.toggle("simple-mode",enabled);
  simpleModeBtn.textContent=enabled?"↩":"📱";
  simpleModeBtn.title=enabled?"Return to full player":"Simplified iPhone player";
  simpleModeBtn.setAttribute("aria-label",enabled?"Return to full player":"Switch to simplified iPhone player");
  if(enabled){
    const d=document.getElementById("simpleRecent");
    if(d)d.open=false;
    window.scrollTo({top:0,behavior:"smooth"});
  }
}
simpleModeBtn.addEventListener("click",()=>setSimpleMode(!simpleMode));


/* ---------- v26 search, filters, rankings and milestones ---------- */
let observedRangeValue="all";
let observedSearchValue="";
let favoritesSearchValue="";

function recordTrackKey(r){
  return ((r?.artist||"").trim().toLowerCase()+"|"+(r?.title||"").trim().toLowerCase());
}
function recordMatchesSearch(r,q){
  if(!q)return true;
  const hay=[r.artist,r.title,r.album].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
}
function filterObservedV26(records){
  let out=records.filter(r=>!isUnknownRecord(r));
  const now=Date.now();
  if(observedRangeValue==="today"){
    const today=new Date();
    out=out.filter(r=>{
      const d=new Date((r.playedAt||0)*1000);
      return d.getFullYear()===today.getFullYear()&&d.getMonth()===today.getMonth()&&d.getDate()===today.getDate();
    });
  }else if(observedRangeValue!=="all"){
    const days=Number(observedRangeValue);
    const cutoff=now-days*86400000;
    out=out.filter(r=>(r.playedAt||0)*1000>=cutoff);
  }
  if(observedSearchValue)out=out.filter(r=>recordMatchesSearch(r,observedSearchValue));
  return out;
}
function aggregateSongsV26(records){
  const m=new Map();
  for(const r of records){
    const key=recordTrackKey(r);
    if(!m.has(key))m.set(key,{
      artist:r.artist||"",title:r.title||"Unknown",album:r.album||"",
      count:0,first:Infinity,last:0
    });
    const x=m.get(key),ts=Number(r.playedAt||0);
    x.count++;if(ts){x.first=Math.min(x.first,ts);x.last=Math.max(x.last,ts)}
  }
  return [...m.values()].sort((a,b)=>b.count-a.count||b.last-a.last);
}
function aggregateArtistsV26(records){
  const m=new Map();
  for(const r of records){
    const name=(r.artist||"Unknown artist").trim()||"Unknown artist";
    if(!m.has(name))m.set(name,[]);
    m.get(name).push(r);
  }
  return [...m.entries()].sort((a,b)=>b[1].length-a[1].length||a[0].localeCompare(b[0]));
}
function aggregateAlbumsV26(records){
  const m=new Map();
  for(const r of records){
    const album=(r.album||"Unknown album").trim()||"Unknown album";
    const key=(r.artist||"").trim().toLowerCase()+"|"+album.toLowerCase();
    if(!m.has(key))m.set(key,{album,artist:r.artist||"",records:[]});
    m.get(key).records.push(r);
  }
  return [...m.values()].sort((a,b)=>b.records.length-a.records.length||a.album.localeCompare(b.album));
}
function heardMeta(first,last){
  const f=Number.isFinite(first)&&first!==Infinity?fmtDate(first):"—";
  const l=last?fmtDate(last):"—";
  return "First: "+f+" · Last: "+l;
}
renderObservedRankings=function(records){
  const songs=aggregateSongsV26(records);
  const sr=document.getElementById("observedTopSongs");sr.replaceChildren();
  document.getElementById("observedSongCount").textContent=songs.length+" tracks";
  songs.forEach((s,i)=>{
    const row=document.createElement("div");row.className="rank-row";
    const main=document.createElement("div");
    main.innerHTML='<span class="rank-number">#'+(i+1)+'</span><strong>'+escapeHtml(s.title)+'</strong>'+
      '<div class="muted tiny">'+escapeHtml(s.artist)+(s.album?' · '+escapeHtml(s.album):'')+'</div>'+
      '<div class="aggregate-meta">'+escapeHtml(heardMeta(s.first,s.last))+'</div>';
    const count=document.createElement("div");count.className="rank-count";count.textContent=s.count+" play"+(s.count===1?"":"s");
    row.append(main,count,spotifyMiniButton(s.artist,s.title));sr.appendChild(row);
  });

  const artists=aggregateArtistsV26(records);
  const ar=document.getElementById("observedTopArtists");ar.replaceChildren();
  document.getElementById("observedArtistCount").textContent=artists.length+" artists";
  artists.forEach(([artist,recs],i)=>{
    const times=recs.map(r=>Number(r.playedAt||0)).filter(Boolean);
    const first=times.length?Math.min(...times):Infinity,last=times.length?Math.max(...times):0;
    const d=document.createElement("details");d.className="artist-rank";
    const sum=document.createElement("summary");
    const name=document.createElement("span");
    name.innerHTML="#"+(i+1)+" "+escapeHtml(artist)+'<div class="aggregate-meta">'+escapeHtml(heardMeta(first,last))+"</div>";
    const count=document.createElement("span");count.className="rank-count";count.textContent=recs.length+" plays";
    sum.append(name,count);d.appendChild(sum);
    const songsWrap=document.createElement("div");songsWrap.className="artist-song-list";
    aggregateSongsV26(recs).forEach(s=>{
      const row=document.createElement("div");row.className="artist-song-row";
      const main=document.createElement("div");
      main.innerHTML='<strong>'+escapeHtml(s.title)+'</strong>'+
        (s.album?'<div class="muted tiny">'+escapeHtml(s.album)+'</div>':'')+
        '<div class="aggregate-meta">'+escapeHtml(heardMeta(s.first,s.last))+'</div>';
      const c=document.createElement("div");c.className="rank-count";c.textContent=s.count+" play"+(s.count===1?"":"s");
      row.append(main,c,spotifyMiniButton(s.artist,s.title));songsWrap.appendChild(row);
    });
    d.appendChild(songsWrap);ar.appendChild(d);
  });

  const albums=aggregateAlbumsV26(records);
  const al=document.getElementById("observedTopAlbums");al.replaceChildren();
  document.getElementById("observedAlbumCount").textContent=albums.length+" albums";
  albums.forEach((a,i)=>{
    const times=a.records.map(r=>Number(r.playedAt||0)).filter(Boolean);
    const first=times.length?Math.min(...times):Infinity,last=times.length?Math.max(...times):0;
    const d=document.createElement("details");d.className="artist-rank";
    const sum=document.createElement("summary");
    const name=document.createElement("span");
    name.innerHTML="#"+(i+1)+" "+escapeHtml(a.album)+
      '<div class="muted tiny">'+escapeHtml(a.artist||"Unknown artist")+'</div>'+
      '<div class="aggregate-meta">'+escapeHtml(heardMeta(first,last))+"</div>";
    const count=document.createElement("span");count.className="rank-count";count.textContent=a.records.length+" plays";
    sum.append(name,count);d.appendChild(sum);
    const songsWrap=document.createElement("div");songsWrap.className="artist-song-list";
    aggregateSongsV26(a.records).forEach(s=>{
      const row=document.createElement("div");row.className="artist-song-row";
      const main=document.createElement("div");
      main.innerHTML='<strong>'+escapeHtml(s.title)+'</strong>'+
        '<div class="aggregate-meta">'+escapeHtml(heardMeta(s.first,s.last))+'</div>';
      const c=document.createElement("div");c.className="rank-count";c.textContent=s.count+" play"+(s.count===1?"":"s");
      row.append(main,c,spotifyMiniButton(s.artist,s.title));songsWrap.appendChild(row);
    });
    d.appendChild(songsWrap);al.appendChild(d);
  });
};

const _renderFavoritesV26Base=renderFavorites;
renderFavorites=async function(){
  const all=(await getAllRecords("favorites"))
    .sort((a,b)=>b.likedAt-a.likedAt)
    .filter(r=>recordMatchesSearch(r,favoritesSearchValue));
  document.getElementById("favoritesSummary").innerHTML=[
    statTile("Liked songs",all.length),
    statTile("Artists",uniqueCount(all,"artist")),
    statTile("Albums",uniqueCount(all,"album"))
  ].join("");
  const root=document.getElementById("favoritesList");root.replaceChildren();
  if(!all.length){
    root.innerHTML='<div class="muted tiny">'+(favoritesSearchValue?"No liked songs match your search.":"Like a song with the ♡ beside Now Playing. It will be saved here.")+'</div>';
    return;
  }
  if(favoriteView==="recent"){all.forEach(r=>root.appendChild(favoriteRow(r)));return}
  const key=favoriteView==="artist"?"artist":"album";
  const groups=new Map();
  for(const r of all){
    const name=(r[key]||"").trim()||(key==="album"?"Unknown album":"Unknown artist");
    if(!groups.has(name))groups.set(name,[]);
    groups.get(name).push(r);
  }
  [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([name,recs])=>{
    const d=document.createElement("details");d.className="favorite-group";
    const s=document.createElement("summary");s.textContent=name+" ("+recs.length+")";d.appendChild(s);
    const rows=document.createElement("div");rows.className="favorite-group-rows";
    recs.slice().sort((a,b)=>(b.likedAt||0)-(a.likedAt||0)).forEach(r=>rows.appendChild(favoriteRow(r)));
    d.appendChild(rows);root.appendChild(d);
  });
};

async function renderListeningMilestones(listening,observed){
  const visibleObserved=observed.filter(r=>!isUnknownRecord(r));
  const heard=listening.filter(r=>!isUnknownRecord(r));
  const obsTracks=new Set(visibleObserved.map(recordTrackKey));
  const heardTracks=new Set(heard.map(recordTrackKey));
  const obsArtists=new Set(visibleObserved.map(r=>(r.artist||"").trim().toLowerCase()).filter(Boolean));
  const heardArtists=new Set(heard.map(r=>(r.artist||"").trim().toLowerCase()).filter(Boolean));
  let likes=[];
  try{likes=await getAllRecords("favorites")}catch(e){}
  const pct=obsTracks.size?100*heardTracks.size/obsTracks.size:0;
  const artistPct=obsArtists.size?100*heardArtists.size/obsArtists.size:0;
  const panel=document.getElementById("listeningMilestones");
  panel.innerHTML='<strong>Listening milestones</strong>'+
    '<div class="stats-grid" style="margin-top:9px;margin-bottom:0">'+
    statTile("Observed catalog heard",heardTracks.size+" / "+obsTracks.size+" ("+pct.toFixed(1)+"%)")+
    statTile("Observed artists heard",heardArtists.size+" / "+obsArtists.size+" ("+artistPct.toFixed(1)+"%)")+
    statTile("Liked from heard catalog",likes.length+" saved")+
    '</div>';
}

async function renderObservedV26(){
  const local=await getAllRecords("observed");
  const merged=mergeObserved(local,sharedObservedRecords);
  const filtered=filterObservedV26(merged);
  const first=filtered.length?Math.min(...filtered.map(r=>r.playedAt||Infinity)):"";
  const last=filtered.length?Math.max(...filtered.map(r=>r.playedAt||0)):"";
  document.getElementById("observedStats").innerHTML=[
    statTile("Plays in view",filtered.length),
    statTile("Unique artists",uniqueCount(filtered,"artist")),
    statTile("Unique tracks",new Set(filtered.map(recordTrackKey)).size),
    statTile("Unique albums",uniqueCount(filtered,"album")),
    statTile("First in view",first?fmtDate(first):"—"),
    statTile("Most recent",last?fmtDate(last):"—")
  ].join("");
  document.getElementById("observedTop").innerHTML='<strong>Source:</strong> GitHub Actions 24/7 collector + this browser';
  renderObservedRankings(filtered);
  document.getElementById("observedHistoryListCount").textContent=filtered.length+" tracks";
  renderCompactHistory("observedHistoryList",filtered,Infinity,{hideUnknown:true});
}

const _renderPersistentHistoriesV26Base=renderPersistentHistories;
renderPersistentHistories=async function(){
  await _renderPersistentHistoriesV26Base();
  try{
    const [listening,localObserved]=await Promise.all([getAllRecords("listening"),getAllRecords("observed")]);
    const observed=mergeObserved(localObserved,sharedObservedRecords);
    await renderListeningMilestones(listening,observed);
    await renderObservedV26();
    await renderFavorites();
  }catch(e){}
};

document.getElementById("observedSearch").addEventListener("input",e=>{
  observedSearchValue=e.target.value.trim();
  renderObservedV26();
});
document.getElementById("observedRange").addEventListener("change",e=>{
  observedRangeValue=e.target.value;
  renderObservedV26();
});
document.getElementById("favoritesSearch").addEventListener("input",e=>{
  favoritesSearchValue=e.target.value.trim();
  renderFavorites();
});

Object.assign(infoHelp,{
  observed:{title:"Observed BottleRag History",items:[
    ["Date range","Filter the shared station history to Today, the last 7 days, last 30 days, or all time."],
    ["Search","Search across song title, artist, and album without downloading anything extra."],
    ["Rankings","Most Played Songs, Artists, and Albums use only the currently selected date range/search. Expanded entries show first and last observed times."],
    ["Shared history","GitHub Actions supplies 24/7 observed history; local observations are merged and deduplicated."]
  ]},
  myhistory:{title:"My Listening History",items:[
    ["Milestones","Compares songs and artists you have actually heard with the catalog your BottleRag collector has observed."],
    ["Storage","Listening history remains local to this browser/device and can be exported/imported from Settings."],
    ["Ads","Unknown tracks are excluded from music lists but retained for the ads-played and ad-time statistics."]
  ]}
});

setTimeout(()=>renderPersistentHistories(),1000);


/* ---------- PWA service worker ---------- */
if("serviceWorker" in navigator && location.protocol.startsWith("http")){
  window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
}
