// Fergeorakelet har flytta til https://ruter.trandal.org/.
// Denne service workeren erstattar den gamle: tømer alle cachar,
// avregistrerer seg sjølv og sender opne vindauge til den nye adressa.
const TARGET = "https://ruter.trandal.org/";

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
    await self.clients.claim();
    await self.registration.unregister();
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(windows.map((client) => {
      const url = new URL(client.url);
      return client.navigate(TARGET + url.search + url.hash).catch(() => {});
    }));
  })());
});

self.addEventListener("fetch", (event) => {
  event.respondWith(fetch(event.request));
});
