const CACHE='kakeibo-shell-v44';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.map(k=>caches.delete(k)));await self.clients.claim()})()));
self.addEventListener('fetch',event=>{
  const req=event.request,url=new URL(req.url);
  if(req.mode==='navigate'||url.pathname.endsWith('/version.json')||url.pathname.endsWith('/manifest.webmanifest')){
    event.respondWith(fetch(req,{cache:'no-store'}).catch(()=>caches.match(req)));
  }
});