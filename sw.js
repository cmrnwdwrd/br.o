
const CACHE = "bottlerag-shell-v1";
const SHELL = ["./", "./index.html", "./manifest.webmanifest"];
self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});
self.addEventListener("activate", event => {
  event.waitUntil(self.clients.claim());
});
self.addEventListener("fetch", event => {
  const url = new URL(event.request.url);
  if(url.origin === self.location.origin){
    event.respondWith(
      caches.match(event.request).then(r => r || fetch(event.request))
    );
  }
});
