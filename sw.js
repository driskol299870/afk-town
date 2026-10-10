// AFK Town offline copy (DESIGN 16, from rc5.10). One cache per patch, named afktown-<patch>; written at freeze with the build tag.
// Network first for the page and version.json (5 s limit), refreshing the copy when that works; the copy only when the network fails.
// The manifest and icons can come from the copy. The save is never stored here: it stays in localStorage "afktown.save".
const PATCH = "rc6";
const CACHE = "afktown-" + PATCH;
const CORE = ["index.html", "manifest.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "version.json"];
const LIMIT = 5000;
const scopeURL = p => new URL(p, self.registration.scope).href;
self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(CORE.map(async p => { try { const r = await fetch(scopeURL(p), { cache: "no-store" }); if (r.ok) await c.put(scopeURL(p), r); } catch (err) { } }));
    await self.skipWaiting(); // a new sw.js takes over at once
  })());
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith("afktown-") && k !== CACHE) await caches.delete(k); // older patches go once this one is in
    await self.clients.claim();
  })());
});
const kindOf = url => {
  if (url.origin !== self.location.origin) return null;
  const scope = new URL(self.registration.scope), rel = url.pathname.startsWith(scope.pathname) ? url.pathname.slice(scope.pathname.length) : null;
  if (rel === null) return null;
  if (rel === "" || rel === "index.html") return { key: "index.html", net: true };
  if (rel === "version.json") return { key: "version.json", net: true };
  if (CORE.includes(rel)) return { key: rel, net: false };
  return null; // anything else (old frozen builds, tests) goes straight to the network
};
async function netFirst(req, key) {
  const c = await caches.open(CACHE);
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), LIMIT);
    const r = await fetch(req.url, { cache: "no-store", signal: ctl.signal, credentials: "same-origin" }); clearTimeout(t);
    if (r.ok) { await c.put(scopeURL(key), r.clone()); }
    return r;
  } catch (err) {
    const hit = await c.match(scopeURL(key));
    if (hit) { // marked as the phone's copy, so the page knows the check did not reach the network
      const h = new Headers(hit.headers); h.set("x-afk-copy", "1");
      return new Response(await hit.blob(), { status: 200, statusText: "OK", headers: h });
    }
    throw err; // never loaded here: the phone's own no-internet page
  }
}
async function copyFirst(req, key) {
  const c = await caches.open(CACHE), hit = await c.match(scopeURL(key));
  if (hit) return hit;
  const r = await fetch(req); if (r.ok) await c.put(scopeURL(key), r.clone()); return r;
}
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const k = kindOf(new URL(req.url)); if (!k) return;
  e.respondWith(k.net ? netFirst(req, k.key) : copyFirst(req, k.key));
});
