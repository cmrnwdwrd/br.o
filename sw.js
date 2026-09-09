const CACHE="bottlerag-shell-v29";
const SHELL=["./","./index.html","./manifest.webmanifest","./assets/styles.css","./js/01-core.js","./js/02-player-ui.js","./js/03-history-storage.js","./js/04-favorites-observed.js","./js/05-shared-analytics.js","./js/06-final-ui.js"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)))});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(u.origin===self.location.origin){
    e.respondWith(fetch(e.request).then(r=>{const copy=r.clone();caches.open(CACHE).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request)));
  }
});