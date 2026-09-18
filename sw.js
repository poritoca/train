'use strict';
// Cache only this app's shell, and keep caches for other GitHub Pages projects intact.
const PREFIX='ekikan-shell-'+encodeURIComponent(self.registration.scope)+'-';
const CACHE=PREFIX+'15';
const SHELL=['./','./index.html','./manifest.webmanifest','./icon.svg','./icon-192.png','./icon-512.png','./apple-touch-icon.png','./station_coverage_report_15.txt','./station_coverage_report_15.tsv','./station_support_15.json','./all_station_support_15.txt','./supported_stations_15.txt','./unsupported_stations_15.txt','./partially_supported_stations_15.txt','./source_inventory_15.tsv','./changes_15.txt','./validation_report_15.txt'];
const urls=SHELL.map(p=>new URL(p,self.registration.scope).href);
self.addEventListener('install',event=>event.waitUntil((async()=>{const cache=await caches.open(CACHE);await cache.addAll(urls);await self.skipWaiting()})()));
self.addEventListener('activate',event=>event.waitUntil((async()=>{const keys=await caches.keys();await Promise.all(keys.filter(k=>k.startsWith(PREFIX)&&k!==CACHE).map(k=>caches.delete(k)));await self.clients.claim()})()));
self.addEventListener('fetch',event=>{
 const request=event.request;if(request.method!=='GET')return;
 const url=new URL(request.url);url.search='';url.hash='';
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
