// AFK Town offline copy (DESIGN 16, from rc5.10). One cache per patch, named afktown-<patch>; written at freeze with the build tag.
// Network first for the page and version.json (5 s limit), refreshing the copy when that works; the copy only when the network fails.
// rc6.0.1: "fails" also means the answer isn't the real game (host paused or out of credits): a non-200 status (402, 503, 404...),
// a redirect to another origin, the wrong content type, or a page without the game's BUILD marker. Then the phone's copy is used,
// and a bad answer is never cached over the good copy. The save is never stored here: it stays in localStorage "afktown.save".
const PATCH = "rc6.4.1";
const CACHE = "afktown-" + PATCH;
const CORE = ["index.html", "manifest.json", "icon-192.png", "icon-512.png", "apple-touch-icon.png", "version.json"];
const LIMIT = 5000;
const scopeURL = p => new URL(p, self.registration.scope).href;
const MARK = /const BUILD = "rc\d+(\.\d+)*"/;
// is this network answer the real game file for key? (reads a clone; never consumes r)
async function realGame(key, r) {
  try {
    if (!r || r.type === "opaqueredirect" || r.type === "error" || r.status !== 200) return false;
    if (r.url && new URL(r.url).origin !== self.location.origin) return false; // redirected somewhere else
    const ct = (r.headers.get("content-type") || "").toLowerCase();
    if (key === "index.html") { if (!ct.includes("text/html")) return false; return MARK.test(await r.clone().text()); }
    if (key === "version.json") { if (ct.includes("text/html")) return false; const j = JSON.parse(await r.clone().text()); return !!(j && typeof j.patch === "string" && j.patch); }
    if (key === "manifest.json") { if (ct.includes("text/html")) return false; JSON.parse(await r.clone().text()); return true; }
    if (/\.png$/.test(key)) return ct.startsWith("image/");
    return true;
  } catch (err) { return false; }
}
self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await Promise.all(CORE.map(async p => { try { const r = await fetch(scopeURL(p), { cache: "no-store" }); if (await realGame(p, r)) await c.put(scopeURL(p), r); } catch (err) { } }));
    await self.skipWaiting(); // a new sw.js takes over at once
  })());
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    // older patches go once this one is in, but only if this patch really has its page (a paused host can't empty the phone)
    const c = await caches.open(CACHE), mine = await c.match(scopeURL("index.html"));
    if (mine) for (const k of await caches.keys()) if (k.startsWith("afktown-") && k !== CACHE) await caches.delete(k);
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
// the phone's copy: this patch's cache first, then any older afktown-* copy (e.g. right after an update on a paused host)
async function anyCopy(key) {
  const c = await caches.open(CACHE); let hit = await c.match(scopeURL(key));
  if (!hit) for (const k of (await caches.keys()).filter(k => k.startsWith("afktown-") && k !== CACHE).sort().reverse()) { hit = await (await caches.open(k)).match(scopeURL(key)); if (hit) break; }
  return hit || null;
}
const asCopy = async hit => { const h = new Headers(hit.headers); h.set("x-afk-copy", "1"); return new Response(await hit.blob(), { status: 200, statusText: "OK", headers: h }); };
async function netFirst(req, key) {
  const c = await caches.open(CACHE);
  let r = null;
  try {
    const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), LIMIT);
    r = await fetch(req.url, { cache: "no-store", signal: ctl.signal, credentials: "same-origin", redirect: "follow" });
    const good = await realGame(key, r); clearTimeout(t);
    if (good) { await c.put(scopeURL(key), r.clone()); return r; }
  } catch (err) { r = null; }
  const hit = await anyCopy(key);
  if (hit) return asCopy(hit); // marked as the phone's copy, so the page knows the check did not reach the real game
  if (r) return r; // never loaded here: show what the network gave
  return Response.error(); // the phone's own no-internet page
}
async function copyFirst(req, key) {
  const hit = await anyCopy(key);
  if (hit) return hit;
  const r = await fetch(req); if (await realGame(key, r)) { const c = await caches.open(CACHE); await c.put(scopeURL(key), r.clone()); } return r;
}
self.addEventListener("fetch", e => {
  const req = e.request; if (req.method !== "GET") return;
  const k = kindOf(new URL(req.url)); if (!k) return;
  e.respondWith(k.net ? netFirst(req, k.key) : copyFirst(req, k.key));
});
// rc6.4.1: "heroes are home" pushes from the afk-town-push Worker. Every push shows a visible notification, even if its data is unreadable.
self.addEventListener("push", e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { try { d = { body: e.data.text() }; } catch (y) { d = {}; } }
  const title = String(d.title || "AFK Town").slice(0, 80), body = String(d.body || "Your heroes are home!").slice(0, 200);
  e.waitUntil(self.registration.showNotification(title, { body, tag: String(d.tag || "afktown"), icon: scopeURL("icon-192.png"), badge: scopeURL("icon-192.png"), data: { url: scopeURL("./") } }));
});
self.addEventListener("notificationclick", e => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || scopeURL("./");
  e.waitUntil((async () => {
    const cs = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of cs) if (c.url.startsWith(self.registration.scope) && "focus" in c) return c.focus();
    if (self.clients.openWindow) return self.clients.openWindow(url);
  })());
});
