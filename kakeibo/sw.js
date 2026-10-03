const CACHE='kakeibo-shell-v36';
self.addEventListener('install',()=>self.skipWaiting());
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    const keys=await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const req=event.request;
  const url=new URL(req.url);
  if(req.mode==='navigate'){
    event.respondWith((async()=>{
      try{
        const fresh=await fetch(req,{cache:'no-store'});
        const cache=await caches.open(CACHE);
        cache.put('./',fresh.clone()).catch(()=>{});
        return fresh;
      }catch{
        return (await caches.match('./')) || Response.error();
      }
    })());
    return;
  }
  if(url.origin===self.location.origin && (url.pathname.endsWith('/version.json')||url.pathname.endsWith('/manifest.webmanifest'))){
    event.respondWith(fetch(req,{cache:'no-store'}));
  }
});
