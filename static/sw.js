/* Service worker — permet l'ouverture hors ligne de l'application (coque, scripts, styles, polices, bibliothèques).
   Les données (/api/…) ne sont JAMAIS mises en cache : elles viennent toujours du serveur.
   Servi à la racine par Flask (/sw.js) pour contrôler toute l'application. */
const VERSION = "v1";                       // changer cette valeur force le rafraîchissement du cache chez tout le monde
const CACHE = `garmin-${VERSION}`;
const SHELL = [
  "/", "/manifest.webmanifest",
  "/static/css/app.css",
  ...["api", "charts", "filters", "format", "main", "map", "sync", "wheel"].map(n => `/static/js/${n}.js`),
  ...["activities", "compare", "dashboard", "detail", "forme", "heatmap", "series", "stat", "vdot", "widgets"].map(n => `/static/js/pages/${n}.js`),
  "/static/icons/apple-touch-icon.png", "/static/icons/icon-192.png",
  // bibliothèques externes (mêmes URL que dans index.html) : préchargées pour que la carte et les graphiques marchent aussi hors ligne
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css",
  "https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js",
  "https://fonts.googleapis.com/css2?family=Geist:wght@400..700&display=swap",
];
const LIBS = ["cdnjs.cloudflare.com", "fonts.googleapis.com", "fonts.gstatic.com"];   // bibliothèques et polices : mises en cache à la première utilisation

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => Promise.allSettled(SHELL.map(u => c.add(u)))).then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith("garmin-") && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

const put = (req, res) => { if (res && (res.ok || res.type === "opaque")) caches.open(CACHE).then(c => c.put(req, res.clone())); return res; };

self.addEventListener("fetch", e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== "GET") return;
  if (url.origin === location.origin) {
    if (url.pathname.startsWith("/api/") || url.pathname === "/sw.js") return;       // données : toujours le réseau
    // fichiers de l'application : réseau d'abord (toujours à jour), cache en secours (hors ligne)
    e.respondWith(fetch(req).then(r => put(req, r)).catch(() =>
      caches.match(req, { ignoreSearch: true }).then(r => r || (req.mode === "navigate" ? caches.match("/") : Response.error()))));
    return;
  }
  if (LIBS.includes(url.hostname)) {                                                 // lib/polices : cache d'abord (ne changent pas)
    e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => put(req, res))));
  }                                                                                   // tuiles de carte et le reste : réseau, sans cache
});
