'use strict';
// Cache only this app's shell, and keep caches for other GitHub Pages projects intact.
const PREFIX='ekikan-shell-'+encodeURIComponent(self.registration.scope)+'-';
const CACHE=PREFIX+'47.0';
const SHELL=['./','./index.html','./journey.css','./journey-ui.js','./notifications.js','./iphone-alerts.html','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./station_coverage_report.txt','./station_coverage_report.tsv','./station_support.json','./all_station_support.txt','./supported_stations.txt','./unsupported_stations.txt','./partially_supported_stations.txt','./source_inventory.tsv','./changes.txt','./validation_report.txt','./github_pages_fix.txt','./parser_regression_tests.txt','./guide-source-index.json'];
const urls=SHELL.map(p=>new URL(p,self.registration.scope).href);
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(urls);await self.skipWaiting()})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim()})()));
self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET')return;
 const url=new URL(request.url);if(url.searchParams.has('v')&&url.searchParams.get('v')!=='47.0')return;url.search='';url.hash='';
 if(!urls.includes(url.href))return;
 event.respondWith((async()=>{
  const cache=await caches.open(CACHE),key=url.href;
  if(request.mode==='navigate'){
   const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),5000);
   try{const response=await fetch(request,{signal:controller.signal});if(!response.ok)throw new Error('Navigation failed');await cache.put(key,response.clone());return response}
   catch{const saved=await cache.match(key)||await cache.match(new URL('./index.html',self.registration.scope).href);return saved||Response.error()}
   finally{clearTimeout(timer)}
  }
  const saved=await cache.match(key);if(saved)return saved;
  return fetch(request);
 })());
});

// Notifications always return to this app; do not follow notification-supplied URLs.
self.addEventListener('notificationclick', event => {
 event.notification.close();
 event.waitUntil((async () => {
  const windows = await self.clients.matchAll({type:'window',includeUncontrolled:true});
  const current = windows.find(client => client.url.startsWith(self.registration.scope));
  if(current) return current.focus();
  return self.clients.openWindow(self.registration.scope);
 })());
});
