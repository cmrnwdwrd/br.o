/* ---------- Custom audio transport / stream recovery ---------- */
const LIVE_STREAM_BASE = "https://studio18.radiolize.com/radio/8140/radio.mp3";
let streamResyncing=false;
let playerPausedAt=null;
const livePlayer=document.getElementById("player");
const playStopBtn=document.getElementById("playStopBtn");
const transportIcon=document.getElementById("transportIcon");
const volumeSlider=document.getElementById("volumeSlider");
const muteBtn=document.getElementById("muteBtn");
const speakerIcon=document.getElementById("speakerIcon");
const PLAYER_VOLUME_KEY="bottlerag-player-volume";

function restorePlayerVolume(){
  let value=Number(volumeSlider.value);
  try{
    const saved=localStorage.getItem(PLAYER_VOLUME_KEY);
    if(saved!==null){
      const parsed=Number(saved);
      if(Number.isFinite(parsed))value=parsed;
    }
  }catch(e){}
  if(!Number.isFinite(value))value=1;
  value=Math.max(0,Math.min(1,value));
  volumeSlider.value=String(value);
  livePlayer.volume=value;
}

function updateTransportUI(){
  const playing=!livePlayer.paused && !livePlayer.ended;
  transportIcon.textContent=playing ? "■" : "▶";
  playStopBtn.setAttribute("aria-label",playing ? "Stop live stream" : "Play live stream");
  playStopBtn.title=playing ? "Stop" : "Play";
}
function updateSpeakerUI(){
  const muted=livePlayer.muted || livePlayer.volume===0;
  speakerIcon.textContent=muted ? "🔇" : (livePlayer.volume<0.5 ? "🔉" : "🔊");
  muteBtn.title=muted ? "Unmute" : "Mute";
  muteBtn.setAttribute("aria-label",muted ? "Unmute" : "Mute");
}
async function reconnectLiveStream(autoplay=true){
  if(streamResyncing) return;
  streamResyncing=true;
  const btn=document.getElementById("resyncStream");
  if(btn) btn.classList.add("spinning");
  const rememberedVolume=livePlayer.volume;
  const rememberedMuted=livePlayer.muted;
  try{
    livePlayer.pause();
    livePlayer.removeAttribute("src");
    livePlayer.load();
    livePlayer.src=LIVE_STREAM_BASE+"?live="+Date.now();
    livePlayer.volume=rememberedVolume;
    livePlayer.muted=rememberedMuted;
    livePlayer.load();
    if(autoplay){
      try{await livePlayer.play()}catch(e){}
    }
    try{
      const data=await fetchData();
      latestData=data; renderNow(data); renderHistory(data);
    }catch(e){}
    document.getElementById("status-now").textContent="Live stream resynced "+new Date().toLocaleTimeString();
  }finally{
    streamResyncing=false;
    if(btn) btn.classList.remove("spinning");
    updateTransportUI();
  }
}
playStopBtn.addEventListener("click",async()=>{
  if(livePlayer.paused){
    // Always establish a fresh connection after a stop/pause. This prevents stale
    // buffered live audio from fighting with the current stream.
    await reconnectLiveStream(true);
  }else{
    livePlayer.pause();
    livePlayer.removeAttribute("src");
    livePlayer.load();
    playerPausedAt=Date.now();
    updateTransportUI();
  }
});
document.getElementById("resyncStream").addEventListener("click",()=>reconnectLiveStream(!livePlayer.paused));
volumeSlider.addEventListener("input",()=>{
  livePlayer.volume=Number(volumeSlider.value);
  if(livePlayer.volume>0) livePlayer.muted=false;
  try{localStorage.setItem(PLAYER_VOLUME_KEY,String(livePlayer.volume))}catch(e){}
  updateSpeakerUI();
});
muteBtn.addEventListener("click",()=>{
  livePlayer.muted=!livePlayer.muted;
  updateSpeakerUI();
});
livePlayer.addEventListener("play",()=>{playerPausedAt=null;updateTransportUI()});
livePlayer.addEventListener("pause",()=>{if(!streamResyncing)playerPausedAt=Date.now();updateTransportUI()});
livePlayer.addEventListener("volumechange",updateSpeakerUI);
restorePlayerVolume();
window.addEventListener("pageshow",()=>{restorePlayerVolume();updateSpeakerUI()});
updateTransportUI(); updateSpeakerUI();

/* ---------- Settings modal ---------- */
const settingsModal=document.getElementById("settingsModal");
document.getElementById("settingsBtn").addEventListener("click",()=>settingsModal.hidden=false);
document.getElementById("settingsClose").addEventListener("click",()=>settingsModal.hidden=true);
settingsModal.addEventListener("click",e=>{if(e.target===settingsModal)settingsModal.hidden=true});
document.addEventListener("keydown",e=>{if(e.key==="Escape")settingsModal.hidden=true});

/* ---------- Categories ---------- */
const CATEGORY_IDS=["likedCategory","listeningCategory","historyCategory","stationCategory","technicalCategory"];
const OPTIONAL_DETAIL_CATEGORY_IDS=["stationCategory","technicalCategory"];
const HIDE_DETAIL_CATEGORIES_KEY="bottlerag-hide-station-technical";

function applyDetailCategoryVisibility(hide){
  OPTIONAL_DETAIL_CATEGORY_IDS.forEach(id=>{
    const section=document.getElementById(id);
    if(section)section.classList.toggle("display-category-hidden",hide);
  });
}

const hideStationTechnical=document.getElementById("hideStationTechnical");
if(hideStationTechnical){
  let hide=true;
  try{
    const saved=localStorage.getItem(HIDE_DETAIL_CATEGORIES_KEY);
    hide=saved===null?true:saved!=="false";
  }catch(e){}
  hideStationTechnical.checked=hide;
  applyDetailCategoryVisibility(hide);
  hideStationTechnical.addEventListener("change",()=>{
    const next=hideStationTechnical.checked;
    applyDetailCategoryVisibility(next);
    try{localStorage.setItem(HIDE_DETAIL_CATEGORIES_KEY,String(next))}catch(e){}
    updateGlobalCategoryButton();
  });
}

function setCategory(id,show){
  const body=document.getElementById(id+"-body");
  const btn=document.querySelector('.category-toggle[data-category="'+id+'"]');
  if(!body||!btn)return;
  body.hidden=!show;
  btn.setAttribute("aria-expanded",show?"true":"false");
}
document.querySelectorAll(".category-toggle").forEach(btn=>{
  btn.addEventListener("click",()=>{
    setCategory(btn.dataset.category,btn.getAttribute("aria-expanded")!=="true");
    updateGlobalCategoryButton();
  });
});
function updateGlobalCategoryButton(){
  const visibleIds=CATEGORY_IDS.filter(id=>!document.getElementById(id)?.classList.contains("display-category-hidden"));
  const allOpen=visibleIds.every(id=>!document.getElementById(id+"-body").hidden);
  document.getElementById("toggleAllCategories").textContent=allOpen?"Collapse all":"Expand all";
}
document.getElementById("toggleAllCategories").addEventListener("click",()=>{
  const visibleIds=CATEGORY_IDS.filter(id=>!document.getElementById(id)?.classList.contains("display-category-hidden"));
  const allOpen=visibleIds.every(id=>!document.getElementById(id+"-body").hidden);
  visibleIds.forEach(id=>setCategory(id,!allOpen));
  updateGlobalCategoryButton();
});
document.getElementById("expandCategories").addEventListener("click",()=>{
  CATEGORY_IDS.filter(id=>!document.getElementById(id)?.classList.contains("display-category-hidden")).forEach(id=>setCategory(id,true)); updateGlobalCategoryButton();
});
document.getElementById("collapseCategories").addEventListener("click",()=>{
  CATEGORY_IDS.filter(id=>!document.getElementById(id)?.classList.contains("display-category-hidden")).forEach(id=>setCategory(id,false)); updateGlobalCategoryButton();
});
CATEGORY_IDS.forEach(id=>setCategory(id,false));
updateGlobalCategoryButton();
