function normalizePlaylistName(value){
  return String(value||"").trim().replace(/\s+/g," ");
}
const API = "https://studio18.radiolize.com/api/nowplaying/109";
const LIVE_FALLBACK_MS = 60000;

let latestData = null;
let localElapsed = 0;
let autoTimer = null;
let liveTimer = null;
let lastNowPlayingId = null;
let historyExpanded = false;
let currentHistory = [];

const sectionToCard = {
  station:"stationCard",
  listeners:"listenersCard",
  live:"liveCard",
  stream:"streamCard",
  raw:"rawCard"
};

function fmt(sec){
  sec = Math.max(0, Math.round(Number(sec) || 0));
  return Math.floor(sec/60) + ":" + String(sec%60).padStart(2,"0");
}
function display(v){
  return (v === null || v === undefined || v === "") ? "—" : String(v);
}
function addKV(container,key,value,link=false){
  const k=document.createElement("div");
  k.className="key"; k.textContent=key;
  const v=document.createElement("div");
  v.className="value";
  if(link && value){
    const a=document.createElement("a");
    a.href=value; a.target="_blank"; a.rel="noopener"; a.textContent=value;
    v.appendChild(a);
  }else{
    v.textContent=display(value);
  }
  container.append(k,v);
}
function setKV(id,rows){
  const el=document.getElementById(id);
  el.replaceChildren();
  for(const row of rows) addKV(el,row[0],row[1],!!row[2]);
}
function markUpdated(section){
  const el=document.getElementById("status-"+section);
  if(el) el.textContent="Updated "+new Date().toLocaleTimeString();
  const cardId = sectionToCard[section];
  if(cardId){
    const card=document.getElementById(cardId);
    card.classList.remove("flash");
    void card.offsetWidth;
    card.classList.add("flash");
  }
}
function markError(section,err){
  const el=document.getElementById("status-"+section);
  if(el) el.textContent="Update failed: "+err;
}
function updateProgress(){
  if(!latestData) return;
  const np=latestData.now_playing||{};
  const dur=Number(np.duration)||0;
  const elapsed=Math.min(localElapsed,dur||localElapsed);
  const rem=Math.max(0,dur-elapsed);
  const p=document.getElementById("songProgress");
  p.max=Math.max(1,dur); p.value=elapsed;
  document.getElementById("elapsed").textContent=fmt(elapsed);
  document.getElementById("duration").textContent=fmt(dur);
  document.getElementById("remaining").textContent=fmt(rem)+" remaining";
}
function renderNow(data){
  const np=data.now_playing||{};
  const song=np.song||{};
  const live=data.live||{};
  document.getElementById("songTitle").textContent=display(song.title);
  document.getElementById("songArtist").textContent=display(song.artist);
  document.getElementById("songAlbum").textContent=song.album ? song.album : "";
  const playlistEl=document.getElementById("songPlaylist");
  if(playlistEl)playlistEl.textContent=np.playlist ? "Playlist: "+np.playlist : "";
  const art=document.getElementById("artwork");
  if(song.art){ art.src=song.art; art.style.display=""; }
  else { art.removeAttribute("src"); art.style.display="none"; }
  document.getElementById("stationStatus").innerHTML =
    '<span class="status-dot '+(data.is_online?'':'off')+'"></span>'+
    (data.is_online?'Online':'Offline')+' · '+
    (live.is_live?'LIVE DJ':'Automated programming');
  localElapsed=Number(np.elapsed)||0;
  updateProgress();
  document.getElementById("status-now").textContent =
    "Updated "+new Date().toLocaleTimeString();
}
function renderStation(data){
  const st=data.station||{};
  setKV("stationInfo",[
    ["Name",st.name],["Station ID",st.id],["Shortcode",st.shortcode],
    ["Website",st.url],["Public player",st.public_player_url,true],
    ["Public",st.is_public],["Frontend",st.frontend],["Backend",st.backend],
    ["Cache",data.cache]
  ]);
}
function renderListeners(data){
  const liveEl=document.getElementById("listenerLiveCurrent");
  if(liveEl){
    const n=Number(data?.listeners?.current);
    liveEl.textContent=Number.isFinite(n)?String(n):"—";
  }
  const st=data.station||{};
  const mount=(st.mounts&&st.mounts.length)?st.mounts[0]:{};
  const listeners=data.listeners||{};
  const ml=mount.listeners||{};
  setKV("listenerInfo",[
    ["Current",listeners.current],["Unique",listeners.unique],["Total",listeners.total],
    ["Mount current",ml.current],["Mount unique",ml.unique],["Mount total",ml.total]
  ]);
}
function renderLive(data){
  const np=data.now_playing||{};
  const live=data.live||{};
  setKV("liveInfo",[
    ["Live now",live.is_live],["Streamer",live.streamer_name],
    ["Broadcast start",live.broadcast_start],["Playlist",np.playlist],
    ["Streamer field",np.streamer],["Song request",np.is_request],
    ["Playing next",data.playing_next?JSON.stringify(data.playing_next):"—"]
  ]);
}
function renderStream(data){
  const st=data.station||{};
  const mount=(st.mounts&&st.mounts.length)?st.mounts[0]:{};
  setKV("streamInfo",[
    ["Mount name",mount.name],["Format",mount.format],
    ["Bitrate",mount.bitrate?mount.bitrate+" kbps":"—"],["Mount path",mount.path],
    ["Direct stream",mount.url||st.listen_url,true],
    ["PLS playlist",st.playlist_pls_url,true],
    ["M3U playlist",st.playlist_m3u_url,true],
    ["Station URL",st.listen_url,true]
  ]);
}
function makeRecentSpotifyControl(s){
  const spot=document.createElement("div");
  spot.className="track-spotify";
  const spotWrap=document.createElement("div");
  spotWrap.className="spotify-wrap";
  const spotBtn=document.createElement("button");
  spotBtn.className="spotify-btn";
  spotBtn.type="button";
  spotBtn.title="Open on Spotify";
  spotBtn.setAttribute("aria-label","Open "+display(s.title)+" on Spotify");
  spotBtn.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="11" fill="currentColor"></circle><path d="M6.3 9.2c3.7-1.1 8.2-.8 11.4.8" fill="none" stroke="#111" stroke-width="1.8" stroke-linecap="round"/><path d="M7 12.1c3.2-.8 7-.6 9.8.7" fill="none" stroke="#111" stroke-width="1.6" stroke-linecap="round"/><path d="M7.6 14.9c2.6-.6 5.8-.4 8.2.6" fill="none" stroke="#111" stroke-width="1.4" stroke-linecap="round"/></svg>';
  const spotMenu=document.createElement("div");
  spotMenu.className="spotify-menu"; spotMenu.hidden=true;
  const browserBtn=document.createElement("button");
  browserBtn.type="button"; browserBtn.textContent="Open in browser";
  const appBtn=document.createElement("button");
  appBtn.type="button"; appBtn.textContent="Open in Spotify app";
  const query=[s.artist,s.title].filter(Boolean).join(" ");
  browserBtn.addEventListener("click",()=>openSpotify(query,"browser"));
  appBtn.addEventListener("click",()=>openSpotify(query,"app"));
  spotBtn.addEventListener("click",(e)=>{
    e.stopPropagation();
    closeAllSpotifyMenus(spotMenu);
    spotMenu.hidden=!spotMenu.hidden;
  });
  spotMenu.append(browserBtn,appBtn);
  spotWrap.append(spotBtn,spotMenu); spot.appendChild(spotWrap);
  return spot;
}
function makeRecentLikeButton(s,item=null){
  const b=document.createElement("button");
  b.className="mini-like"; b.type="button"; b.textContent="♡";
  const refresh=async()=>{
    try{
      const key=trackKeyFor(s);
      const all=await getAllRecords("favorites");
      const liked=all.some(x=>x.trackKey===key);
      b.classList.toggle("liked",liked);
      b.textContent=liked?"♥":"♡";
      b.title=liked?"Unlike this song":"Like this song";
      b.setAttribute("aria-label",(liked?"Unlike ":"Like ")+display(s.title));
    }catch(e){}
  };
  b.addEventListener("click",async()=>{
    try{
      const key=trackKeyFor(s);
      const all=await getAllRecords("favorites");
      const existing=all.find(x=>x.trackKey===key);
      const db=await openHistoryDB();
      if(existing){
        await new Promise((resolve,reject)=>{
          const tx=db.transaction("favorites","readwrite");
          tx.objectStore("favorites").delete(key);
          tx.oncomplete=resolve; tx.onerror=()=>reject(tx.error);
        });
      }else{
        await putRecord("favorites",{
          trackKey:key,artist:s.artist||"",title:s.title||"Unknown",
          album:s.album||"",art:s.art||"",playlist:item?.playlist||"",likedAt:Date.now()
        });
      }
      await renderFavorites();
      await updateNowLikeUI();
      if(latestData) renderHistory(latestData);
    }catch(e){}
  });
  refresh();
  return b;
}
function buildRecentTrackRow(item){
  const s=item.song||{};
  const row=document.createElement("div"); row.className="track";
  const img=document.createElement("img");
  img.className="thumb"; img.alt=""; if(s.art)img.src=s.art;
  const main=document.createElement("div"); main.className="track-main";
  const titleRow=document.createElement("div"); titleRow.className="song-title-row";
  const title=document.createElement("div");
  title.className="track-title"; title.style.fontWeight="650"; title.textContent=display(s.title);
  titleRow.appendChild(title);
  const sub=document.createElement("div"); sub.className="track-sub muted tiny";
  const parts=[];
  if(s.artist)parts.push(s.artist);
  if(s.album)parts.push(s.album);
  if(item.playlist)parts.push("Playlist: "+normalizePlaylistName(item.playlist));
  if(item.streamer)parts.push("streamer: "+item.streamer);
  if(item.is_request)parts.push("requested");
  sub.textContent=parts.join(" · ");
  main.append(titleRow,sub);
  const unknown=((s.title||"").trim().toLowerCase()==="unknown" && !(s.artist||"").trim());
  if(unknown)row.classList.add("no-like");
  const like=unknown?null:makeRecentLikeButton(s,item);
  const spot=unknown?null:makeRecentSpotifyControl(s);
  const right=document.createElement("div"); right.className="track-time muted tiny";
  const when=item.played_at?new Date(item.played_at*1000):null;
  right.textContent=fmt(item.duration)+(when&&!isNaN(when)?"\n"+when.toLocaleTimeString():"");
  row.append(img,main);
  if(like)row.appendChild(like);
  if(spot)row.appendChild(spot);
  row.appendChild(right);
  return row;
}
function fillRecentList(container,items){
  container.replaceChildren();
  if(!items.length){
    const e=document.createElement("div");
    e.className="muted"; e.textContent="No song history returned.";
    container.appendChild(e); return;
  }
  items.forEach(item=>container.appendChild(buildRecentTrackRow(item)));
}
function renderHistory(data){
  currentHistory=data.song_history||[];
  fillRecentList(document.getElementById("recentTracks"),
    historyExpanded?currentHistory:currentHistory.slice(0,5));
  const simple=document.getElementById("simpleRecentTracks");
  if(simple)fillRecentList(simple,currentHistory.slice(0,5));

  const toggle=document.getElementById("historyToggle");
  if(currentHistory.length<=5){
    toggle.style.display="none";
  }else{
    toggle.style.display="";
    toggle.setAttribute("aria-expanded",historyExpanded?"true":"false");
    toggle.title=historyExpanded?"Show only the last five songs":"Show all recently played songs";
  }
  document.getElementById("status-history").textContent="Updated "+new Date().toLocaleTimeString();
}
function renderRaw(data){
  document.getElementById("rawMetadata").textContent=JSON.stringify(data,null,2);
}

const renderers = {
  station:renderStation,
  listeners:renderListeners,
  live:renderLive,
  stream:renderStream,
  raw:renderRaw
};

async function fetchData(){
  const r=await fetch(API,{cache:"no-store"});
  if(!r.ok) throw new Error(r.status+" "+r.statusText);
  const buf=await r.arrayBuffer();
  metadataSessionBytes += buf.byteLength;
  const text=new TextDecoder().decode(buf);
  return JSON.parse(text);
}

async function refreshSection(section){
  try{
    const data=await fetchData();
    latestData=data;
    renderers[section](data);
    markUpdated(section);
  }catch(err){
    markError(section,err);
  }
}

async function refreshInfoBoxes(){
  try{
    const data=await fetchData();
    latestData=data;
    for(const section of Object.keys(renderers)){
      renderers[section](data);
      markUpdated(section);
    }
  }catch(err){
    for(const section of Object.keys(renderers)) markError(section,err);
  }
}

function scheduleNextLiveRefresh(data){
  if(typeof realtimeState!=="undefined" && realtimeState.active!=="fallback polling") return;
  if(liveTimer) clearTimeout(liveTimer);
  const np=(data&&data.now_playing)||{};
  let delay=LIVE_FALLBACK_MS;

  // When duration/remaining are known, wait until just after the expected song change.
  const remaining=Number(np.remaining);
  if(Number.isFinite(remaining) && remaining>=0){
    delay=Math.max(3000, Math.min(LIVE_FALLBACK_MS, (remaining+1.5)*1000));
  }else if((data&&data.live&&data.live.is_live)){
    // Live shows may not have reliable track timing, so check modestly more often.
    delay=15000;
  }

  liveTimer=setTimeout(refreshAlwaysLive,delay);
}

async function refreshAlwaysLive(){
  try{
    const data=await fetchData();
    latestData=data;
    renderNow(data);
    renderHistory(data);
    lastNowPlayingId=(data.now_playing||{}).sh_id || null;
    scheduleNextLiveRefresh(data);
  }catch(err){
    document.getElementById("status-now").textContent="Update failed: "+err;
    document.getElementById("status-history").textContent="Update failed: "+err;
    if(liveTimer) clearTimeout(liveTimer);
    liveTimer=setTimeout(refreshAlwaysLive,15000);
  }
}

function activeAutoSections(){
  if(document.getElementById("autoAll").checked) return Object.keys(renderers);
  return [...document.querySelectorAll(".auto-box:checked")]
    .map(x=>x.dataset.section);
}

async function autoTick(){
  const sections=activeAutoSections();
  if(!sections.length) return;
  try{
    const data=await fetchData();
    latestData=data;
    for(const section of sections){
      renderers[section](data);
      markUpdated(section);
    }
  }catch(err){
    for(const section of sections) markError(section,err);
  }
}

function restartAutoTimer(){
  if(autoTimer) clearInterval(autoTimer);
  const sec=Number(document.getElementById("intervalSelect").value)||15;
  autoTimer=setInterval(autoTick,sec*1000);
}

document.querySelectorAll(".refresh-btn").forEach(btn=>{
  btn.addEventListener("click",()=>refreshSection(btn.dataset.section));
});
document.getElementById("refreshAll").addEventListener("click",refreshInfoBoxes);
document.getElementById("intervalSelect").addEventListener("change",restartAutoTimer);
document.getElementById("autoAll").addEventListener("change",()=>{
  if(document.getElementById("autoAll").checked) autoTick();
});
document.querySelectorAll(".auto-box").forEach(cb=>{
  cb.addEventListener("change",()=>{
    if(cb.checked) refreshSection(cb.dataset.section);
  });
});

document.querySelectorAll(".collapse-btn").forEach(btn=>{
  btn.addEventListener("click",()=>{
    const body=document.getElementById(btn.dataset.target);
    const expanded=btn.getAttribute("aria-expanded")==="true";
    btn.setAttribute("aria-expanded",expanded ? "false" : "true");
    body.hidden=expanded;
  });
});

document.getElementById("historyToggle").addEventListener("click",()=>{
  historyExpanded=!historyExpanded;
  if(latestData) renderHistory(latestData);
});

refreshAlwaysLive();
refreshInfoBoxes();
restartAutoTimer();


setInterval(()=>{
  localElapsed+=1;
  updateProgress();
},1000);


const STREAM_BITRATE_KBPS = 128;
const STREAM_BYTES_PER_SEC = STREAM_BITRATE_KBPS * 1000 / 8;
let dataSessionBytes = 0;
let metadataSessionBytes = 0;
let dataSessionSeconds = 0;
let dataLastTick = performance.now();

function formatBytes(bytes){
  if(bytes < 1024) return bytes.toFixed(0)+" B";
  if(bytes < 1024*1024) return (bytes/1024).toFixed(1)+" KB";
  if(bytes < 1024*1024*1024) return (bytes/(1024*1024)).toFixed(2)+" MB";
  return (bytes/(1024*1024*1024)).toFixed(2)+" GB";
}
function formatHMS(seconds){
  seconds=Math.max(0,Math.floor(seconds));
  const h=Math.floor(seconds/3600);
  const m=Math.floor((seconds%3600)/60);
  const s=seconds%60;
  return h+":"+String(m).padStart(2,"0")+":"+String(s).padStart(2,"0");
}
function updateDataUsage(){
  const player=document.getElementById("player");
  const now=performance.now();
  const dt=(now-dataLastTick)/1000;
  dataLastTick=now;

  if(player && !player.paused && !player.ended && player.readyState>0){
    dataSessionSeconds += dt;
    dataSessionBytes += STREAM_BYTES_PER_SEC * dt;
    document.getElementById("dataRate").textContent=(STREAM_BYTES_PER_SEC/1000).toFixed(1)+" KB/s";
    document.getElementById("status-data").textContent="Estimating while audio is playing";
  }else{
    document.getElementById("dataRate").textContent="0 KB/s";
    document.getElementById("status-data").textContent=player && player.paused ? "Paused" : "Waiting for playback";
  }
  document.getElementById("dataTotal").textContent=formatBytes(dataSessionBytes);
  document.getElementById("metadataTotal").textContent=formatBytes(metadataSessionBytes);
  document.getElementById("listenTime").textContent=formatHMS(dataSessionSeconds);
}
document.getElementById("resetData").addEventListener("click",()=>{
  dataSessionBytes=0;
  metadataSessionBytes=0;
  dataSessionSeconds=0;
  dataLastTick=performance.now();
  updateDataUsage();
});
setInterval(updateDataUsage,1000);

function spotifyQuery(){
  if(!latestData) return "";
  const song=(latestData.now_playing||{}).song||{};
  return [song.artist,song.title].filter(Boolean).join(" ");
}
function openSpotify(query,mode){
  if(!query) return;
  if(mode==="app"){
    window.location.href="spotify:search:"+encodeURIComponent(query);
  }else{
    window.open("https://open.spotify.com/search/"+encodeURIComponent(query),"_blank","noopener");
  }
}
function closeAllSpotifyMenus(except=null){
  document.querySelectorAll(".spotify-menu").forEach(menu=>{
    if(menu!==except) menu.hidden=true;
  });
}
const nowSpotifyBtn=document.getElementById("nowSpotifyBtn");
const nowSpotifyMenu=document.getElementById("nowSpotifyMenu");
nowSpotifyBtn.addEventListener("click",(e)=>{
  e.stopPropagation();
  closeAllSpotifyMenus(nowSpotifyMenu);
  nowSpotifyMenu.hidden=!nowSpotifyMenu.hidden;
});
nowSpotifyMenu.querySelector('[data-open-spotify="browser"]').addEventListener("click",()=>{
  openSpotify(spotifyQuery(),"browser");
  nowSpotifyMenu.hidden=true;
});
nowSpotifyMenu.querySelector('[data-open-spotify="app"]').addEventListener("click",()=>{
  openSpotify(spotifyQuery(),"app");
  nowSpotifyMenu.hidden=true;
});
document.addEventListener("click",()=>closeAllSpotifyMenus());

const infoHelp = {
  available: {
    title: "Available Stream Data — what this box does",
    items: [
      ["Probe", "Tests several public, read-only BottleRag/Radiolize/Icecast endpoints from your browser. It never uses an admin endpoint and never requests listener IP addresses."],
      ["Realtime metadata", "Shows whether a live push connection can be established. If a usable realtime feed is available, the page can receive track changes without repeatedly polling the full now-playing API."],
      ["Public endpoint discoveries", "Shows which lightweight/public endpoints responded, such as the static now-playing text endpoint, playlist files, or public Icecast status JSON."],
      ["Public stream/server fields", "Displays extra non-sensitive fields found in those public responses, such as MIME type, stream start time, server description, genre, listener peak, sample rate, channels, or other fields if the server exposes them."],
      ["Safe raw discovered data", "Shows the public data returned by successful probes after filtering out listener IP/address fields, user-agent fields, credentials, and administrative/sensitive fields."],
      ["Why some fields may be missing", "Public Icecast/Radiolize installations can hide many statistics. The box only displays what this particular server exposes to an ordinary browser."],
      ["Low-data behavior", "Probes run only at page load and when you press Probe. They are not continuously repeated. Realtime push, when available, is preferred for song changes; the existing low-data song-boundary refresh remains the fallback."]
    ]
  },
  data: {
    title: "Listening Data — what the numbers mean",
    items: [
      ["Audio payload rate", "The stream is 128 kbps, which equals about 16 KB per second of audio while playback is active. This is an estimate, not a direct reading from your cellular/Wi-Fi interface."],
      ["Estimated audio payload", "The estimated amount of audio data consumed since this page was opened or since you last reset the session counter."],
      ["Listening time", "How long the audio player has actually been in the playing state during the current counter session."],
      ["Stream bitrate", "BottleRag broadcasts a 128 kbps MP3 stream."],
      ["Metadata payload", "The page counts the actual bytes in the JSON metadata responses it downloads. HTTP/TLS headers and album-art downloads are not included in that number."],
      ["Network overhead", "TCP/TLS/HTTP overhead, buffering, and artwork can make real network usage slightly higher than the displayed totals."],
      ["Reset session counter", "Sets the estimated data total and listening-time counter back to zero without stopping the radio."]
    ]
  },
  now: {
    title: "Now Playing — what the information means",
    items: [
      ["Online / Offline", "Whether Radiolize currently reports the BottleRag stream as available."],
      ["Automated programming", "The station is playing scheduled or playlist material rather than a live DJ/streamer."],
      ["LIVE DJ", "Radiolize reports that a live streamer is currently connected."],
      ["Title", "The title supplied in the current track's metadata."],
      ["Artist", "The artist supplied in the current track's metadata."],
      ["Album", "The album tag supplied for the current track, when available."],
      ["Artwork", "Album or station artwork supplied by BottleRag/Radiolize for the current item."],
      ["Elapsed", "How far Radiolize says the current item has progressed. The page advances this timer locally between metadata checks."],
      ["Duration", "The total duration reported for the current item."],
      ["Remaining", "An estimate of time left, calculated from duration minus elapsed time."],
      ["Audio player", "Plays BottleRag's direct 128 kbps MP3 stream. Updating metadata does not reload or restart this player."]
    ]
  },
  station: {
    title: "Station — what the information means",
    items: [
      ["Name", "The station's display name in Radiolize."],
      ["Station ID", "Radiolize's numeric internal identifier for this station. BottleRag is station 109."],
      ["Shortcode", "A human-readable unique station identifier used in Radiolize public-player URLs and related endpoints."],
      ["Website", "The website address the station owner entered for BottleRag."],
      ["Public player", "Radiolize's hosted web player for the station."],
      ["Public", "Whether the station is configured as publicly accessible in Radiolize."],
      ["Frontend", "The streaming server exposed to listeners. Icecast handles delivery of the public audio stream."],
      ["Backend", "The audio automation/processing system. Liquidsoap can schedule, mix, process, and hand audio to the streaming server."],
      ["Cache", "The cache mechanism reported by the API. Redis is being used to cache/update now-playing data efficiently."]
    ]
  },
  listeners: {
    title: "Listeners — what the counts mean",
    items: [
      ["Current", "The number of listener connections Radiolize reports at the moment of the metadata request."],
      ["Unique", "The number of distinct listeners represented in the current station listener statistics. The exact deduplication method is determined by Radiolize/AzuraCast-style server statistics."],
      ["Total", "The station-level total listener count reported in this now-playing response."],
      ["Mount current", "Current connections specifically to the /radio.mp3 mount point."],
      ["Mount unique", "Unique listeners reported specifically for that mount point."],
      ["Mount total", "Total listeners reported specifically for that mount point."],
      ["Why they match", "BottleRag currently exposes only one audio mount, so the station-wide and mount-specific figures will usually be identical."],
      ["Your connection", "If you are listening through this page, your player may be included as one listener once the server registers the connection."]
    ]
  },
  live: {
    title: "Live / Automation — what the information means",
    items: [
      ["Live now", "True means a live streamer/DJ is connected; false means the station is not presently flagged as live."],
      ["Streamer", "The display name of the live broadcaster, if one is supplied."],
      ["Broadcast start", "When the current live broadcast began, if the station is live."],
      ["Playlist", "The automation playlist responsible for the current item. '1default' is BottleRag's default playlist identifier."],
      ["Streamer field", "The streamer associated with the currently playing item. It is normally blank during automated playback."],
      ["Song request", "True means the current song was inserted as a listener/requested track; false means it was not marked as a request."],
      ["Playing next", "Metadata for the next scheduled item when the server exposes it. A dash means the API did not provide a next item."]
    ]
  },
  stream: {
    title: "Stream — what the information means",
    items: [
      ["Mount name", "BottleRag's label for this particular stream configuration: 128kbps MP3."],
      ["Format", "The audio codec/container delivered to listeners. BottleRag uses MP3."],
      ["Bitrate", "The target audio data rate. At 128 kbps, the audio itself is about 57.6 MB per hour before network overhead."],
      ["Mount path", "The Icecast path identifying this stream, /radio.mp3."],
      ["Direct stream", "The direct continuous audio URL used by the player. Opening it bypasses BottleRag's full website."],
      ["PLS playlist", "A small .pls internet-radio playlist file that tells compatible players where the stream is."],
      ["M3U playlist", "A small .m3u internet-radio playlist file serving the same general purpose for compatible players."],
      ["Station URL", "The listen URL supplied by the station metadata; for BottleRag it currently points to the same direct MP3 stream."]
    ]
  },
  history: {
    title: "Recently Played — what the information means",
    items: [
      ["Default view", "Shows the five most recent completed items returned by Radiolize."],
      ["Down arrow", "Expands the list to show the rest of the song history returned by the API. Click it again to return to five."],
      ["Title / Artist / Album", "Track tags stored in the station's metadata."],
      ["Playlist", "The automation playlist that supplied that track, when reported."],
      ["Streamer", "The live streamer responsible for the item, if it came from a live broadcast and that field is supplied."],
      ["Requested", "Appears when the server marks the item as a listener/song request."],
      ["Duration", "The reported length of the item."],
      ["Time", "Your browser converts the API's Unix played_at timestamp into your device's local time."],
      ["Automatic updates", "This section updates automatically even if the optional auto-update controls are off. To save data, the page normally waits until the current song is expected to end, then checks again instead of polling every few seconds."]
    ]
  },
  auto: {
    title: "Auto-update Settings — what the controls mean",
    items: [
      ["Auto-update all info boxes", "Automatically refreshes Station, Listeners, Live / Automation, Stream, and Raw Metadata together."],
      ["Interval", "How often the optional information boxes are refreshed when their Auto option, or Auto-update all, is enabled."],
      ["Individual Auto", "Each optional box has its own Auto checkbox, so you can continuously update only the information you care about."],
      ["Refresh", "Fetches fresh metadata for just that box without reloading the webpage."],
      ["Refresh all info boxes", "Fetches one fresh metadata response and updates all optional information boxes from it."],
      ["Now Playing / Recently Played", "These are intentionally independent of these controls. They refresh automatically near the expected end of each song, with a slower fallback check when timing is unavailable, which saves substantially more data than polling every few seconds."],
      ["Audio playback", "None of these metadata refreshes reload the page or replace the audio element, so they should not interrupt the stream."]
    ]
  },
  raw: {
    title: "Raw Metadata — what the information means",
    items: [
      ["Purpose", "This is the complete JSON response returned by BottleRag's public Radiolize now-playing API."],
      ["station", "Station configuration, stream mount information, URLs, codec/bitrate, and mount listener statistics."],
      ["listeners", "Station-level listener statistics."],
      ["live", "Whether a live broadcaster is connected and any live-streamer information."],
      ["now_playing", "Current track, timing, playlist, request status, artwork, and related identifiers."],
      ["song_history", "Recently completed tracks/items returned by the server."],
      ["playing_next", "The next item when the server makes that information available."],
      ["is_online", "Whether the station is currently reported online."],
      ["cache", "The caching backend named by the API."],
      ["Why keep it", "It lets you see fields that are not yet given their own display in this page and is useful when BottleRag/Radiolize adds or changes metadata."]
    ]
  }
};

function openInfo(section){
  const data = infoHelp[section];
  if(!data) return;
  document.getElementById("infoTitle").textContent = data.title;
  const content = document.getElementById("infoContent");
  content.replaceChildren();

  const list = document.createElement("div");
  list.className = "info-list";
  for(const [term, desc] of data.items){
    const t = document.createElement("div");
    t.className = "info-term";
    t.textContent = term;
    const d = document.createElement("div");
    d.className = "info-desc";
    d.textContent = desc;
    list.append(t,d);
  }
  content.appendChild(list);
  document.getElementById("infoModal").hidden = false;
}
function closeInfo(){
  document.getElementById("infoModal").hidden = true;
}
document.querySelectorAll(".info-btn").forEach(btn=>{
  btn.addEventListener("click",()=>openInfo(btn.dataset.info));
});
document.getElementById("infoClose").addEventListener("click",closeInfo);
document.getElementById("infoModal").addEventListener("click",e=>{
  if(e.target.id === "infoModal") closeInfo();
});
document.addEventListener("keydown",e=>{
  if(e.key === "Escape") closeInfo();
});


const STREAM_PROBES = {
  staticNowPlaying: "https://studio18.radiolize.com/api/nowplaying_static/bottlerag_radio_bukjmd.txt",
  icecastRoot: "https://studio18.radiolize.com/status-json.xsl",
  icecastRadioPath: "https://studio18.radiolize.com/radio/8140/status-json.xsl",
  pls: "https://studio18.radiolize.com/public/bottlerag_radio_bukjmd/playlist.pls",
  m3u: "https://studio18.radiolize.com/public/bottlerag_radio_bukjmd/playlist.m3u"
};
const REALTIME_WS = "wss://studio18.radiolize.com/api/live/nowplaying/websocket";
const REALTIME_SSE = "https://studio18.radiolize.com/api/live/nowplaying/sse";
const REALTIME_CHANNEL = "station:bottlerag_radio_bukjmd";

let probeResults = {};
let realtimeTransport = null;
let realtimeState = {
  websocket: "not tried",
  sse: "not tried",
  active: "fallback polling",
  lastMessage: "—"
};

const blockedFieldPattern = /(ip|address|user.?agent|password|passwd|credential|authorization|admin|token|secret|client_list|listener_list|listeners_list)/i;

function safeClone(value, seen=new WeakSet()){
  if(value === null || typeof value !== "object") return value;
  if(seen.has(value)) return "[circular]";
  seen.add(value);
  if(Array.isArray(value)){
    return value.map(v=>safeClone(v,seen));
  }
  const out={};
  for(const [k,v] of Object.entries(value)){
    if(blockedFieldPattern.test(k)) continue;
    // Do not expose per-listener objects even if a server happens to return them.
    if(/^listener(s)?$/i.test(k) && Array.isArray(v)) continue;
    out[k]=safeClone(v,seen);
  }
  return out;
}

function flattenSafe(obj, prefix="", out={}){
  if(obj === null || obj === undefined) return out;
  if(typeof obj !== "object"){
    out[prefix || "value"] = obj;
    return out;
  }
  if(Array.isArray(obj)){
    obj.forEach((v,i)=>flattenSafe(v, prefix ? prefix+"["+i+"]" : "["+i+"]", out));
    return out;
  }
  for(const [k,v] of Object.entries(obj)){
    if(blockedFieldPattern.test(k)) continue;
    const key=prefix ? prefix+"."+k : k;
    if(v !== null && typeof v === "object") flattenSafe(v,key,out);
    else out[key]=v;
  }
  return out;
}

function setProbeKV(id, rows){
  const el=document.getElementById(id);
  if(!el) return;
  el.replaceChildren();
  if(!rows.length){
    const k=document.createElement("div");
    k.className="key"; k.textContent="Status";
    const v=document.createElement("div");
    v.className="value"; v.textContent="No additional public fields discovered.";
    el.append(k,v);
    return;
  }
  for(const [k,v] of rows){
    addKV(el,k,v,false);
  }
}

function chip(label,state){
  const wrap=document.createElement("span");
  wrap.className="probe-chip";
  const dot=document.createElement("span");
  dot.className="probe-dot "+(state==="ok"?"ok":state==="bad"?"bad":"wait");
  const txt=document.createElement("span");
  txt.textContent=label;
  wrap.append(dot,txt);
  return wrap;
}

function updateProbeSummary(){
  const el=document.getElementById("probeSummary");
  if(!el) return;
  el.replaceChildren();
  const items=[
    ["Static now-playing",probeResults.staticNowPlaying?.ok],
    ["Icecast status",probeResults.icecast?.ok],
    ["PLS",probeResults.pls?.ok],
    ["M3U",probeResults.m3u?.ok],
    ["Realtime",realtimeState.active!=="fallback polling"]
  ];
  for(const [label,state] of items){
    el.appendChild(chip(label,state===true?"ok":state===false?"bad":"wait"));
  }
}

async function fetchTextProbe(url, timeoutMs=6000){
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try{
    const r=await fetch(url,{cache:"no-store",signal:controller.signal});
    if(!r.ok) throw new Error(r.status+" "+r.statusText);
    const text=await r.text();
    return {ok:true,status:r.status,text,contentType:r.headers.get("content-type")||""};
  }finally{
    clearTimeout(timer);
  }
}

async function fetchJsonProbe(url, timeoutMs=6000){
  const t=await fetchTextProbe(url,timeoutMs);
  let data;
  try{ data=JSON.parse(t.text); }
  catch(e){ throw new Error("Response was not JSON"); }
  return {...t,data};
}

function friendlyIcecastKey(key){
  const last=key.split(".").pop().replace(/\[(\d+)\]/g," $1");
  const labels={
    server_name:"Server name",
    server_description:"Server description",
    server_type:"Content type",
    server_url:"Station website",
    server_id:"Icecast server",
    genre:"Genre",
    stream_start:"Stream started",
    stream_start_iso8601:"Stream started",
    listener_peak:"Listener peak",
    listeners:"Current listeners",
    bitrate:"Bitrate",
    samplerate:"Sample rate",
    sample_rate:"Sample rate",
    channels:"Channels",
    audio_info:"Audio information",
    quality:"Quality",
    content_type:"Content type",
    listenurl:"Listen URL",
    title:"Current title",
    artist:"Current artist",
    yp_currently_playing:"Currently playing",
    outgoing_kbitrate:"Outgoing bitrate",
    incoming_bitrate:"Incoming bitrate"
  };
  return labels[last] || last.replace(/_/g," ").replace(/\b\w/g,c=>c.toUpperCase());
}

function summarizeIcecast(data){
  const flat=flattenSafe(data);
  const interestingKeys = Object.keys(flat).filter(k =>
    /(server_name|server_description|server_type|server_url|genre|stream_start|stream_start_iso8601|listener_peak|listeners$|bitrate|samplerate|sample_rate|channels|audio_info|quality|content_type|server_id|listenurl|title|artist|yp_currently_playing)/i.test(k)
  );
  return interestingKeys.slice(0,80).map(k=>[friendlyIcecastKey(k),display(flat[k])]);
}

function renderRealtimeInfo(){
  setProbeKV("realtimeInfo",[
    ["Active method",realtimeState.active],
    ["WebSocket",realtimeState.websocket],
    ["Server-Sent Events",realtimeState.sse],
    ["Last realtime message",realtimeState.lastMessage]
  ]);
}

function findNowPlayingObject(obj, depth=0){
  if(!obj || typeof obj!=="object" || depth>8) return null;
  if(obj.now_playing && obj.station) return obj;
  for(const v of Object.values(obj)){
    if(v && typeof v==="object"){
      const found=findNowPlayingObject(v,depth+1);
      if(found) return found;
    }
  }
  return null;
}

function applyRealtimePayload(payload, source){
  let obj=payload;
  if(typeof payload==="string"){
    try{obj=JSON.parse(payload)}catch(e){return false}
  }
  const np=findNowPlayingObject(obj);
  if(!np) return false;
  latestData=np;
  renderNow(np);
  renderHistory(np);
  realtimeState.active=source;
  realtimeState.lastMessage=new Date().toLocaleTimeString();
  renderRealtimeInfo();
  updateProbeSummary();
  return true;
}

function stopRealtime(){
  try{
    if(realtimeTransport && typeof realtimeTransport.close==="function") realtimeTransport.close();
  }catch(e){}
  realtimeTransport=null;
}

function tryRealtimeWebSocket(){
  return new Promise(resolve=>{
    let useful=false, settled=false;
    let ws;
    try{
      ws=new WebSocket(REALTIME_WS);
    }catch(e){
      realtimeState.websocket="unsupported/blocked";
      renderRealtimeInfo(); resolve(false); return;
    }
    realtimeTransport=ws;

    const finish=(ok)=>{
      if(settled) return;
      settled=true;
      clearTimeout(timer);
      resolve(ok);
    };

    const timer=setTimeout(()=>{
      if(!useful){
        realtimeState.websocket="connected, no usable station update";
        try{ws.close()}catch(e){}
        renderRealtimeInfo();
        finish(false);
      }
    },9000);

    ws.onopen=()=>{
      realtimeState.websocket="connected";
      renderRealtimeInfo();
      // Centrifugo-compatible anonymous connect + subscribe.
      try{ws.send(JSON.stringify({connect:{},id:1}))}catch(e){}
      setTimeout(()=>{
        if(ws.readyState===1){
          try{ws.send(JSON.stringify({subscribe:{channel:REALTIME_CHANNEL},id:2}))}catch(e){}
        }
      },350);
    };
    ws.onmessage=(ev)=>{
      let parsed=ev.data;
      try{parsed=JSON.parse(ev.data)}catch(e){}
      // Some servers wrap JSON strings within publication data.
      if(applyRealtimePayload(parsed,"WebSocket")){
        useful=true;
        realtimeState.websocket="active";
        renderRealtimeInfo();
        finish(true);
      } else {
        // Look for nested .push.pub.data / .result.data string/object.
        try{
          const candidates=[
            parsed?.push?.pub?.data,
            parsed?.result?.data,
            parsed?.data
          ].filter(v=>v!==undefined);
          for(const c of candidates){
            if(applyRealtimePayload(c,"WebSocket")){
              useful=true;
              realtimeState.websocket="active";
              renderRealtimeInfo();
              finish(true);
              break;
            }
          }
        }catch(e){}
      }
    };
    ws.onerror=()=>{
      realtimeState.websocket="failed";
      renderRealtimeInfo();
    };
    ws.onclose=()=>{
      if(!useful){
        realtimeState.websocket=realtimeState.websocket==="failed"?"failed":"closed";
        renderRealtimeInfo();
        finish(false);
      }
    };
  });
}

function tryRealtimeSSE(){
  return new Promise(resolve=>{
    if(!("EventSource" in window)){
      realtimeState.sse="unsupported";
      renderRealtimeInfo(); resolve(false); return;
    }
    let useful=false, settled=false;
    let es;
    try{
      es=new EventSource(REALTIME_SSE);
    }catch(e){
      realtimeState.sse="blocked";
      renderRealtimeInfo(); resolve(false); return;
    }
    realtimeTransport=es;
    const finish=(ok)=>{
      if(settled) return;
      settled=true;
      clearTimeout(timer);
      resolve(ok);
    };
    const timer=setTimeout(()=>{
      if(!useful){
        realtimeState.sse="connected, no usable station update";
        try{es.close()}catch(e){}
        renderRealtimeInfo();
        finish(false);
      }
    },9000);
    es.onopen=()=>{
      realtimeState.sse="connected";
      renderRealtimeInfo();
    };
    es.onmessage=(ev)=>{
      if(applyRealtimePayload(ev.data,"Server-Sent Events")){
        useful=true;
        realtimeState.sse="active";
        renderRealtimeInfo();
        finish(true);
      }
    };
    es.onerror=()=>{
      if(!useful){
        realtimeState.sse="failed/closed";
        renderRealtimeInfo();
        try{es.close()}catch(e){}
        finish(false);
      }
    };
  });
}

async function probeRealtime(){
  stopRealtime();
  realtimeState={websocket:"trying",sse:"not tried",active:"fallback polling",lastMessage:"—"};
  renderRealtimeInfo();
  updateProbeSummary();

  let ok=await tryRealtimeWebSocket();
  if(ok){
    // Realtime is active; stop the scheduled fallback timer to save requests.
    if(liveTimer){ clearTimeout(liveTimer); liveTimer=null; }
    return true;
  }
  realtimeState.sse="trying";
  renderRealtimeInfo();
  ok=await tryRealtimeSSE();
  if(ok){
    if(liveTimer){ clearTimeout(liveTimer); liveTimer=null; }
    return true;
  }

  realtimeState.active="fallback polling";
  renderRealtimeInfo();
  updateProbeSummary();
  // Ensure fallback song-boundary refresh continues.
  if(latestData) scheduleNextLiveRefresh(latestData);
  return false;
}

async function probePublicStreamData(){
  const status=document.getElementById("status-available");
  status.textContent="Probing public endpoints…";
  probeResults={};
  updateProbeSummary();

  const discoveredRows=[];
  let icecastData=null;

  // Static now-playing
  try{
    const r=await fetchTextProbe(STREAM_PROBES.staticNowPlaying);
    probeResults.staticNowPlaying=r;
    discoveredRows.push(["Static now-playing",r.text.trim()||"(blank)"]);
    discoveredRows.push(["Static content type",r.contentType||"—"]);
  }catch(e){
    probeResults.staticNowPlaying={ok:false,error:String(e)};
  }

  // PLS
  try{
    const r=await fetchTextProbe(STREAM_PROBES.pls);
    probeResults.pls=r;
    const firstUrl=(r.text.match(/https?:\/\/[^\s\r\n]+/i)||[])[0];
    discoveredRows.push(["PLS public", "yes"]);
    if(firstUrl) discoveredRows.push(["PLS stream entry",firstUrl]);
  }catch(e){
    probeResults.pls={ok:false,error:String(e)};
  }

  // M3U
  try{
    const r=await fetchTextProbe(STREAM_PROBES.m3u);
    probeResults.m3u=r;
    const firstUrl=(r.text.match(/https?:\/\/[^\s\r\n]+/i)||[])[0];
    discoveredRows.push(["M3U public","yes"]);
    if(firstUrl) discoveredRows.push(["M3U stream entry",firstUrl]);
  }catch(e){
    probeResults.m3u={ok:false,error:String(e)};
  }

  // Icecast status candidates; first successful one wins.
  const icecastCandidates=[STREAM_PROBES.icecastRadioPath,STREAM_PROBES.icecastRoot];
  let icecastError="";
  for(const url of icecastCandidates){
    try{
      const r=await fetchJsonProbe(url);
      probeResults.icecast={...r,url};
      icecastData=r.data;
      discoveredRows.push(["Icecast status endpoint",url]);
      break;
    }catch(e){
      icecastError=String(e);
    }
  }
  if(!icecastData) probeResults.icecast={ok:false,error:icecastError||"not available"};

  setProbeKV("discoveredInfo",discoveredRows);
  setProbeKV("serverInfo",icecastData ? summarizeIcecast(icecastData) : []);

  const safeRaw = safeClone({
    probes:{
      staticNowPlaying:probeResults.staticNowPlaying,
      pls:probeResults.pls,
      m3u:probeResults.m3u,
      icecast:probeResults.icecast
    },
    currentNowPlaying: latestData ? {
      station: latestData.station,
      live: latestData.live,
      now_playing: latestData.now_playing,
      playing_next: latestData.playing_next,
      is_online: latestData.is_online,
      cache: latestData.cache
    } : null
  });
  document.getElementById("probeRaw").textContent=JSON.stringify(safeRaw,null,2);

  updateProbeSummary();
  status.textContent="Public endpoint probe finished "+new Date().toLocaleTimeString();

  // Probe realtime separately after the one-shot public endpoint checks.
  await probeRealtime();
  status.textContent="Probe finished "+new Date().toLocaleTimeString();
}

document.getElementById("probeStreamData").addEventListener("click",probePublicStreamData);

// Run one low-frequency probe on page load. It does not repeat automatically.
setTimeout(probePublicStreamData,1200);
