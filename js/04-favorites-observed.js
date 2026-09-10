/* ---------- Spotify helpers used by history/favorites ---------- */
function spotifySearchUrl(artist,title){
  return "https://open.spotify.com/search/"+encodeURIComponent(((artist||"")+" "+(title||"")).trim());
}
function spotifyMiniButton(artist,title){
  const b=document.createElement("button");
  b.className="mini-spotify"; b.type="button";
  b.title="Open on Spotify"; b.setAttribute("aria-label","Open "+title+" on Spotify");
  b.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"></circle><path d="M6.3 9.2c3.7-1.1 8.2-.8 11.4.8" fill="none" stroke="#111" stroke-width="1.8" stroke-linecap="round"/><path d="M7 12.1c3.2-.8 7-.6 9.8.7" fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round"/><path d="M7.6 14.9c2.6-.6 5.8-.4 8.2.6" fill="none" stroke="#111" stroke-width="1.4" stroke-linecap="round"/></svg>';
  b.addEventListener("click",()=>window.open(spotifySearchUrl(artist,title),"_blank","noopener"));
  return b;
}

/* ---------- Liked songs ---------- */
let favoriteView="recent";
function trackKeyFor(song){
  return ((song?.artist||"").trim().toLowerCase()+"|"+(song?.title||"").trim().toLowerCase());
}
async function currentFavoriteRecord(){
  const s=latestData?.now_playing?.song||{};
  if(!s.title)return null;
  const all=await getAllRecords("favorites");
  return all.find(x=>x.trackKey===trackKeyFor(s))||null;
}
async function updateNowLikeUI(){
  const btn=document.getElementById("nowLikeBtn");if(!btn)return;
  const fav=await currentFavoriteRecord();
  btn.classList.toggle("liked",!!fav);
  btn.querySelector("span").textContent=fav?"♥":"♡";
  btn.title=fav?"Unlike this song":"Like this song";
}
document.getElementById("nowLikeBtn").addEventListener("click",async()=>{
  const s=latestData?.now_playing?.song||{};
  if(!s.title)return;
  const key=trackKeyFor(s);
  const all=await getAllRecords("favorites");
  const existing=all.find(x=>x.trackKey===key);
  const db=await openHistoryDB();
  if(existing){
    await new Promise((resolve,reject)=>{
      const tx=db.transaction("favorites","readwrite");
      tx.objectStore("favorites").delete(key);
      tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);
    });
  }else{
    await putRecord("favorites",{
      trackKey:key,artist:s.artist||"",title:s.title||"Unknown",album:s.album||"",
      genre:s.genre||"",art:s.art||"",playlist:normalizePlaylistName(latestData?.now_playing?.playlist||""),likedAt:Date.now()
    });
  }
  await updateNowLikeUI();await renderFavorites();
});
document.querySelectorAll(".favorite-tab").forEach(b=>b.addEventListener("click",()=>{
  favoriteView=b.dataset.favView;
  document.querySelectorAll(".favorite-tab").forEach(x=>x.classList.toggle("active",x===b));
  renderFavorites();
}));
function favoriteRow(r){
  const row=document.createElement("div");row.className="favorite-row";
  const main=document.createElement("div");
  main.innerHTML='<strong>'+escapeHtml(r.title)+'</strong><div class="muted tiny">'+escapeHtml(r.artist||"")+
    (r.album?' · '+escapeHtml(r.album):'')+
    (r.playlist?' · Playlist: '+escapeHtml(r.playlist):'')+'</div>';

  const like=document.createElement("button");
  like.className="mini-like liked";
  like.type="button";
  like.textContent="♥";
  like.title="Unlike this song";
  like.setAttribute("aria-label","Unlike "+(r.title||"this song"));
  like.addEventListener("click",async()=>{
    const db=await openHistoryDB();
    await new Promise((resolve,reject)=>{
      const tx=db.transaction("favorites","readwrite");
      tx.objectStore("favorites").delete(r.trackKey);
      tx.oncomplete=resolve;
      tx.onerror=()=>reject(tx.error);
    });
    await renderFavorites();
    await updateNowLikeUI();
    if(latestData) renderHistory(latestData);
  });

  row.append(main,like,spotifyMiniButton(r.artist,r.title));
  return row;
}
async function renderFavorites(){
  const all=(await getAllRecords("favorites")).sort((a,b)=>b.likedAt-a.likedAt);
  document.getElementById("favoritesSummary").innerHTML=[
    statTile("Liked songs",all.length),
    statTile("Artists",uniqueCount(all,"artist")),
    statTile("Albums",uniqueCount(all,"album"))
  ].join("");
  const root=document.getElementById("favoritesList");root.replaceChildren();
  if(!all.length){root.innerHTML='<div class="muted tiny">Like a song with the ♡ beside Now Playing. It will be saved here.</div>';return}
  if(favoriteView==="recent"){
    all.forEach(r=>root.appendChild(favoriteRow(r)));return;
  }
  const key=favoriteView==="artist"?"artist":"album";
  const groups=new Map();
  for(const r of all){
    const name=(r[key]||"").trim() || (key==="album"?"Unknown album":"Unknown artist");
    if(!groups.has(name))groups.set(name,[]);
    groups.get(name).push(r);
  }
  [...groups.entries()].sort((a,b)=>a[0].localeCompare(b[0])).forEach(([name,recs])=>{
    const d=document.createElement("details");
    d.className="favorite-group";

    const s=document.createElement("summary");
    s.textContent=name+" ("+recs.length+")";
    d.appendChild(s);

    const rows=document.createElement("div");
    rows.className="favorite-group-rows";
    recs
      .slice()
      .sort((a,b)=>(b.likedAt||0)-(a.likedAt||0))
      .forEach(r=>rows.appendChild(favoriteRow(r)));

    d.appendChild(rows);
    root.appendChild(d);
  });
}

/* ---------- Expanded Observed BottleRag rankings ---------- */
function aggregateObservedSongs(records){
  const m=new Map();
  for(const r of records){
    const key=((r.artist||"")+"|"+(r.title||"")).toLowerCase();
    if(!m.has(key))m.set(key,{artist:r.artist||"",title:r.title||"Unknown",album:r.album||"",count:0,last:0});
    const x=m.get(key);x.count++;x.last=Math.max(x.last,r.playedAt||0);
  }
  return [...m.values()].sort((a,b)=>b.count-a.count || b.last-a.last);
}
function aggregateObservedArtists(records){
  const m=new Map();
  for(const r of records){
    const artist=(r.artist||"Unknown artist").trim()||"Unknown artist";
    if(!m.has(artist))m.set(artist,[]);
    m.get(artist).push(r);
  }
  return [...m.entries()].sort((a,b)=>b[1].length-a[1].length);
}
function renderObservedRankings(records){
  records=records.filter(r=>!isUnknownRecord(r));
  const songs=aggregateObservedSongs(records);
  document.getElementById("observedSongCount").textContent=songs.length+" tracks";
  const sr=document.getElementById("observedTopSongs");sr.replaceChildren();
  songs.forEach((s,i)=>{
    const row=document.createElement("div");row.className="rank-row";
    const main=document.createElement("div");main.innerHTML='<span class="rank-number">#'+(i+1)+'</span><strong>'+escapeHtml(s.title)+'</strong><div class="muted tiny">'+escapeHtml(s.artist)+'</div>';
    const count=document.createElement("div");count.className="rank-count";count.textContent=s.count+" play"+(s.count===1?"":"s");
    row.append(main,count,spotifyMiniButton(s.artist,s.title));sr.appendChild(row);
  });

  const artists=aggregateObservedArtists(records);
  document.getElementById("observedArtistCount").textContent=artists.length+" artists";
  const ar=document.getElementById("observedTopArtists");ar.replaceChildren();
  artists.forEach(([artist,recs],i)=>{
    const d=document.createElement("details");d.className="artist-rank";
    const sum=document.createElement("summary");
    const name=document.createElement("span");name.textContent="#"+(i+1)+" "+artist;
    const count=document.createElement("span");count.className="rank-count";count.textContent=recs.length+" plays";
    sum.append(name,count);d.appendChild(sum);
    const songsWrap=document.createElement("div");songsWrap.className="artist-song-list";
    aggregateObservedSongs(recs).forEach(s=>{
      const row=document.createElement("div");row.className="artist-song-row";
      const main=document.createElement("div");main.innerHTML='<strong>'+escapeHtml(s.title)+'</strong>'+(s.album?'<div class="muted tiny">'+escapeHtml(s.album)+'</div>':'');
      const c=document.createElement("div");c.className="rank-count";c.textContent=s.count+" play"+(s.count===1?"":"s");
      row.append(main,c,spotifyMiniButton(s.artist,s.title));songsWrap.appendChild(row);
    });
    d.appendChild(songsWrap);ar.appendChild(d);
  });
}

/* Extend persistent history rendering with rankings and favorites. */
const _renderPersistentHistoriesV13=renderPersistentHistories;
renderPersistentHistories=async function(){
  await _renderPersistentHistoriesV13();
  try{
    const observed=await getAllRecords("observed");
    renderObservedRankings(observed);
    await renderFavorites();
    await updateNowLikeUI();
  }catch(e){}
};

/* Extend Now Playing refresh so heart follows the current song. */
const _updateMediaSessionSafeV13=updateMediaSessionSafe;
updateMediaSessionSafe=function(data){
  _updateMediaSessionSafeV13(data);
  setTimeout(updateNowLikeUI,0);
};

setTimeout(()=>renderPersistentHistories(),100);

Object.assign(infoHelp,{
  favorites:{title:"Liked Songs",items:[
    ["Like","Tap ♡ next to the current song. A filled ♥ means it is saved."],
    ["Recent / Artist / Album","Switch how your saved songs are organized. Artist and Album views expand into groups."],
        ["Spotify","The Spotify icon opens a search for that exact artist and song."],
    ["Storage","Likes are stored locally in this browser/device and are included in history export/import."]
  ]}
});


/* ---------- Album art overlay ---------- */
const artOverlay=document.getElementById("artOverlay");
const artOverlayImage=document.getElementById("artOverlayImage");
document.getElementById("artwork").addEventListener("click",()=>{
  const src=document.getElementById("artwork").src;if(!src)return;
  artOverlayImage.src=src;artOverlay.hidden=false;
});
artOverlay.addEventListener("click",()=>{artOverlay.hidden=true;artOverlayImage.removeAttribute("src")});
document.addEventListener("keydown",e=>{if(e.key==="Escape"&&!artOverlay.hidden){artOverlay.hidden=true;artOverlayImage.removeAttribute("src")}});
