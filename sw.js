// Betriebskilometer – Service Worker: App-Datei zuerst aus dem Netz, offline aus dem Zwischenspeicher
const CACHE='betriebskilometer-v28';
const APP=['/','/manifest.webmanifest','/icon-192.png','/icon-512.png','/apple-touch-icon.png'];
self.addEventListener('install',e=>{ e.waitUntil(caches.open(CACHE).then(c=>c.addAll(APP)).then(()=>self.skipWaiting())); });
self.addEventListener('activate',e=>{ e.waitUntil(caches.keys().then(k=>Promise.all(k.filter(n=>n!==CACHE).map(n=>caches.delete(n)))).then(()=>self.clients.claim())); });
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET'||u.origin!==location.origin) return;   // Karten, Overpass usw. direkt aus dem Netz
  e.respondWith(fetch(e.request).then(r=>{ const c=r.clone(); caches.open(CACHE).then(ca=>ca.put(e.request,c)); return r; }).catch(()=>caches.match(e.request).then(r=>r||caches.match('/'))));
});
