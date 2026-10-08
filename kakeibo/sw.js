const CACHE='kakeibo-shell-v49';
// Network-first navigation; do not delete data, origin-wide caches, or other apps' state.
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil(self.clients.claim()));
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET')return;
  const url=new URL(req.url);
  if(req.mode==='navigate'||url.pathname.endsWith('/version.json')||url.pathname.endsWith('/manifest.webmanifest')){
    event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match(req)));
  }
});
