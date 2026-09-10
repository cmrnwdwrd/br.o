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


/* ---------- v29 compact observed-history UI + favorites search ---------- */
let observedSearchValue="";
const observedOpenGroups=new Set();
let favoritesSearchValue="";

function recordTrackKey(r){
  return ((r?.artist||"").trim().toLowerCase()+"|"+(r?.title||"").trim().toLowerCase());
}
function recordMatchesSearch(r,q){
  if(!q)return true;
  const hay=[r?.artist,r?.title,r?.album,r?.playlist,playlistSummaryText(r)].filter(Boolean).join(" ").toLowerCase();
  return hay.includes(q.toLowerCase());
}
function playlistSummaryText(item){
  const m=item?.playlists||{};
  const entries=Object.entries(m).sort((a,b)=>Number(b[1])-Number(a[1]));
  if(!entries.length)return "";
  return entries.map(([name,count])=>name+(entries.length>1?" ("+count+")":"")).join(", ");
}
function observedLikeRecord(item,playlistOverride=""){
  return {
    artist:item?.artist||"",
    title:item?.title||"Unknown",
    album:item?.album||"",
    playlist:normalizePlaylistName(playlistOverride||playlistSummaryText(item).split(" (")[0]||"")
  };
}
function heardMeta(first,last){
  const f=first?fmtDate(first):"—";
  const l=last?fmtDate(last):"—";
  return "First: "+f+" · Last: "+l;
}
function top50Matches(item,q){
  if(!q)return true;
  if(recordMatchesSearch(item,q))return true;
  return Array.isArray(item?.songs)&&item.songs.some(s=>recordMatchesSearch(s,q));
}
function filteredTop50(items){
  const q=observedSearchValue.trim();
  return (items||[]).filter(x=>top50Matches(x,q)).slice(0,50);
}
function bindObservedGroupState(details,key){
  details.dataset.groupKey=key;
  details.open=observedOpenGroups.has(key);
  details.addEventListener("toggle",()=>{
    if(details.open)observedOpenGroups.add(key);
    else observedOpenGroups.delete(key);
  });
}
function captureOpenDetailKeys(root){
  return new Set([...root.querySelectorAll("details[data-group-key][open]")].map(d=>d.dataset.groupKey));
}
function songRowActions(record,artist,title){
  const wrap=document.createElement("div");
  wrap.className="song-row-actions";
  const like=historyLikeButton(record);
  if(like)wrap.appendChild(like);
  if(artist&&title&&title.trim().toLowerCase()!=="unknown"){
    wrap.appendChild(spotifyMiniButton(artist,title));
  }
  return wrap;
}
function makeTopSongRow(s,i){
  const row=document.createElement("div");row.className="rank-row";
  const main=document.createElement("div");
  main.innerHTML='<span class="rank-number">#'+(i+1)+'</span><strong>'+escapeHtml(s.title||"Unknown")+'</strong>'+
    '<div class="muted tiny">'+escapeHtml(s.artist||"")+(s.album?' · '+escapeHtml(s.album):'')+
    (playlistSummaryText(s)?' · Playlist: '+escapeHtml(playlistSummaryText(s)):'')+'</div>'+
    '<div class="aggregate-meta">'+escapeHtml(heardMeta(s.first,s.last))+'</div>';
  const count=document.createElement("div");count.className="rank-count";
  count.textContent=(s.count||0)+" play"+(Number(s.count)===1?"":"s");
  row.append(main,count,songRowActions(observedLikeRecord(s),s.artist||"",s.title||""));
  return row;
}
function renderCompactObservedTop50(){
  const data=observedTop50Data;
  const stats=document.getElementById("observedStats");
  const sr=document.getElementById("observedTopSongs");
  const ar=document.getElementById("observedTopArtists");
  const al=document.getElementById("observedTopAlbums");
  const pl=document.getElementById("observedTopPlaylists");
  if(!data){
    stats.innerHTML=[statTile("Shared history","Waiting for collector")].join("");
    [sr,ar,al,pl].forEach(el=>el&&el.replaceChildren());
    return;
  }

  const s=data.summary||{};
  stats.innerHTML=[
    statTile("Observed plays",s.totalPlays??0),
    statTile("Unique artists",s.uniqueArtists??0),
    statTile("Unique tracks",s.uniqueTracks??0),
    statTile("Unique albums",s.uniqueAlbums??0),
    statTile("Unique playlists",s.uniquePlaylists??0),
    statTile("First observed",s.firstObserved?fmtDate(s.firstObserved):"—"),
    statTile("Most recent",s.lastObserved?fmtDate(s.lastObserved):"—")
  ].join("");

  const songs=filteredTop50(data.topSongs);
  sr.replaceChildren();
  document.getElementById("observedSongCount").textContent=songs.length+" of top 50";
  songs.forEach((x,i)=>sr.appendChild(makeTopSongRow(x,i)));

  const artists=filteredTop50(data.topArtists);
  ar.replaceChildren();
  document.getElementById("observedArtistCount").textContent=artists.length+" of top 50";
  artists.forEach((a,i)=>{
    const d=document.createElement("details");d.className="artist-rank";
    const stableGroupKey="artist:"+(a.artist||"Unknown artist").trim().toLowerCase();
    bindObservedGroupState(d,stableGroupKey);
    const sum=document.createElement("summary");
    const name=document.createElement("span");
    name.innerHTML="#"+(i+1)+" "+escapeHtml(a.artist||"Unknown artist")+
      '<div class="aggregate-meta">'+escapeHtml(heardMeta(a.first,a.last))+"</div>";
    const count=document.createElement("span");count.className="rank-count";
    count.textContent=(a.count||0)+" plays";
    sum.append(name,count);d.appendChild(sum);
    const songsWrap=document.createElement("div");songsWrap.className="artist-song-list";
    (a.songs||[]).filter(x=>recordMatchesSearch(x,observedSearchValue)||!observedSearchValue).slice(0,50).forEach(sg=>{
      const row=document.createElement("div");row.className="artist-song-row";
      const main=document.createElement("div");
      main.innerHTML='<strong>'+escapeHtml(sg.title||"Unknown")+'</strong>'+
        (sg.album?'<div class="muted tiny">'+escapeHtml(sg.album)+
        (playlistSummaryText(sg)?' · Playlist: '+escapeHtml(playlistSummaryText(sg)):'')+'</div>':
        (playlistSummaryText(sg)?'<div class="muted tiny">Playlist: '+escapeHtml(playlistSummaryText(sg))+'</div>':''))+
        '<div class="aggregate-meta">'+escapeHtml(heardMeta(sg.first,sg.last))+'</div>';
      const c=document.createElement("div");c.className="rank-count";c.textContent=(sg.count||0)+" plays";
      row.append(
        main,
        c,
        songRowActions(
          observedLikeRecord({...sg,artist:sg.artist||a.artist||""}),
          sg.artist||a.artist||"",
          sg.title||""
        )
      );
      songsWrap.appendChild(row);
    });
    d.appendChild(songsWrap);ar.appendChild(d);
  });

  const albums=filteredTop50(data.topAlbums);
  al.replaceChildren();
  document.getElementById("observedAlbumCount").textContent=albums.length+" of top 50";
  albums.forEach((a,i)=>{
    const d=document.createElement("details");d.className="artist-rank";
    const stableGroupKey="album:"+((a.artist||"")+"|"+(a.album||"Unknown album")).trim().toLowerCase();
    bindObservedGroupState(d,stableGroupKey);
    const sum=document.createElement("summary");
    const name=document.createElement("span");
    name.innerHTML="#"+(i+1)+" "+escapeHtml(a.album||"Unknown album")+
      '<div class="muted tiny">'+escapeHtml(a.artist||"Unknown artist")+'</div>'+
      '<div class="aggregate-meta">'+escapeHtml(heardMeta(a.first,a.last))+"</div>";
    const count=document.createElement("span");count.className="rank-count";count.textContent=(a.count||0)+" plays";
    sum.append(name,count);d.appendChild(sum);
    const songsWrap=document.createElement("div");songsWrap.className="artist-song-list";
    (a.songs||[]).filter(x=>recordMatchesSearch(x,observedSearchValue)||!observedSearchValue).slice(0,50).forEach(sg=>{
      const row=document.createElement("div");row.className="artist-song-row";
      const main=document.createElement("div");
      main.innerHTML='<strong>'+escapeHtml(sg.title||"Unknown")+'</strong>'+
        (playlistSummaryText(sg)?'<div class="muted tiny">Playlist: '+escapeHtml(playlistSummaryText(sg))+'</div>':'')+
        '<div class="aggregate-meta">'+escapeHtml(heardMeta(sg.first,sg.last))+'</div>';
      const c=document.createElement("div");c.className="rank-count";c.textContent=(sg.count||0)+" plays";
      row.append(
        main,
        c,
        songRowActions(
          observedLikeRecord({...sg,artist:sg.artist||a.artist||""}),
          sg.artist||a.artist||"",
          sg.title||""
        )
      );
      songsWrap.appendChild(row);
    });
    d.appendChild(songsWrap);al.appendChild(d);
  });
  const observedNo=document.getElementById("observedNoResults");
  const anyObservedMatches=(songs.length||artists.length||albums.length||(data.topPlaylists||[]).some(x=>top50Matches(x,observedSearchValue)));
  if(observedNo)observedNo.hidden=!(observedSearchValue&& !anyObservedMatches);
  const playlists=(data.topPlaylists||[]).slice(0,10);
  pl.replaceChildren();
  document.getElementById("observedPlaylistCount").textContent=playlists.length+" playlists";
  playlists.forEach((a,i)=>{
    const d=document.createElement("details");d.className="artist-rank";
    const stableGroupKey="playlist:"+normalizePlaylistName(a.playlist||"Unspecified").toLowerCase();
    bindObservedGroupState(d,stableGroupKey);
    const sum=document.createElement("summary");
    const name=document.createElement("span");
    name.innerHTML="#"+(i+1)+" "+escapeHtml(a.playlist||"Unspecified")+
      '<div class="aggregate-meta">'+escapeHtml(heardMeta(a.first,a.last))+"</div>";
    const count=document.createElement("span");count.className="rank-count";
    count.textContent=(a.count||0)+" plays";
    sum.append(name,count);d.appendChild(sum);

    const songsWrap=document.createElement("div");songsWrap.className="artist-song-list";
    (a.songs||[]).slice(0,5).forEach(sg=>{
      const row=document.createElement("div");row.className="artist-song-row";
      const main=document.createElement("div");
      main.innerHTML='<strong>'+escapeHtml(sg.title||"Unknown")+'</strong>'+
        '<div class="muted tiny">'+escapeHtml(sg.artist||"")+
        (sg.album?' · '+escapeHtml(sg.album):'')+
        ' · Playlist: '+escapeHtml(a.playlist||"Unspecified")+'</div>'+
        '<div class="aggregate-meta">'+escapeHtml(heardMeta(sg.first,sg.last))+'</div>';
      const c=document.createElement("div");c.className="rank-count";
      c.textContent=(sg.count||0)+" play"+(Number(sg.count)===1?"":"s");
      row.append(
        main,
        c,
        songRowActions(
          observedLikeRecord(sg,a.playlist||""),
          sg.artist||"",
          sg.title||""
        )
      );
      songsWrap.appendChild(row);
    });
    d.appendChild(songsWrap);pl.appendChild(d);
  });

}

const _renderFavoritesV29Base=renderFavorites;
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
  const favNo=document.getElementById("favoritesNoResults");
  if(favNo)favNo.hidden=!(favoritesSearchValue&&all.length===0);
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

async function renderListeningMilestonesV29(listening){
  const heard=listening.filter(r=>!isUnknownRecord(r));
  const heardTracks=new Set(heard.map(recordTrackKey));
  const heardArtists=new Set(heard.map(r=>(r.artist||"").trim().toLowerCase()).filter(Boolean));
  const topSongs=observedTop50Data?.topSongs||[];
  const topArtists=observedTop50Data?.topArtists||[];
  const topSongKeys=new Set(topSongs.map(recordTrackKey));
  const topArtistKeys=new Set(topArtists.map(r=>(r.artist||"").trim().toLowerCase()).filter(Boolean));
  const songsHeard=[...topSongKeys].filter(k=>heardTracks.has(k)).length;
  const artistsHeard=[...topArtistKeys].filter(k=>heardArtists.has(k)).length;
  let likes=[];try{likes=await getAllRecords("favorites")}catch(e){}
  const panel=document.getElementById("listeningMilestones");
  panel.innerHTML='<strong>Listening milestones</strong>'+
    '<div class="stats-grid" style="margin-top:9px;margin-bottom:0">'+
    statTile("Top-50 songs heard",songsHeard+" / "+topSongKeys.size)+
    statTile("Top-50 artists heard",artistsHeard+" / "+topArtistKeys.size)+
    statTile("Liked songs",likes.length+" saved")+
    '</div>';
}

const _renderPersistentHistoriesV29Base=renderPersistentHistories;
renderPersistentHistories=async function(){
  await _renderPersistentHistoriesV29Base();
  try{
    const listening=await getAllRecords("listening");
    await renderListeningMilestonesV29(listening);
    renderCompactObservedTop50();
    await renderFavorites();
  }catch(e){}
};

document.getElementById("observedSearch").addEventListener("input",e=>{
  observedSearchValue=e.target.value.trim();
  renderCompactObservedTop50();
});
document.getElementById("favoritesSearch").addEventListener("input",e=>{
  favoritesSearchValue=e.target.value.trim();
  renderFavorites();
});

function syncSearchClearButton(input){
  const b=document.querySelector('.search-clear[data-clear-for="'+input.id+'"]');
  if(b)b.hidden=!input.value;
}
document.querySelectorAll(".search-wrap .history-search").forEach(input=>{
  syncSearchClearButton(input);
  input.addEventListener("input",()=>syncSearchClearButton(input));
});
document.querySelectorAll(".search-clear").forEach(btn=>{
  btn.addEventListener("click",()=>{
    const input=document.getElementById(btn.dataset.clearFor);
    if(!input)return;
    input.value="";
    syncSearchClearButton(input);
    input.dispatchEvent(new Event("input",{bubbles:true}));
    input.focus();
  });
});

Object.assign(infoHelp,{
  observed:{title:"Observed BottleRag History",items:[
    ["Compact rankings","The player downloads compact all-time Top 50 Songs, Artists, and Albums plus the Top 10 Playlists with five songs per playlist. Recently Observed Tracks is not downloaded or shown."],
    ["Monthly archive","The collector stores raw observed plays by month in the repository for long-term history. Those monthly files are not downloaded during normal player use."],
    ["Search","Search filters the compact song, artist, album, and playlist rankings already loaded on the device."],
    ["Cross-device","Every device using the GitHub Pages player reads the same shared compact summary produced by the cloud collector."]
  ]},
  myhistory:{title:"My Listening History",items:[
    ["Milestones","Shows how many of the station's current all-time top-50 songs and artists this device has recorded you hearing."],
    ["Search","Search filters the local track, artist, album, and playlist lists."],
    ["Organization","Lists are ordered as Tracks, Artists, Albums, then Playlists. Artist, album, and playlist groups are sorted by most recently heard."],
    ["Storage","Listening history remains local to this browser/device and can be exported/imported from Settings."],
    ["Ads","Unknown tracks are excluded from music lists but retained for the ads-played and ad-time statistics."]
  ]}
});

setTimeout(()=>renderPersistentHistories(),1000);


/* ---------- PWA service worker ---------- */
if("serviceWorker" in navigator && location.protocol.startsWith("http")){
  window.addEventListener("load",()=>navigator.serviceWorker.register("sw.js").catch(()=>{}));
}
