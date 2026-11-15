// Enregistre le service worker (HTTPS ou localhost uniquement : c'est une règle des navigateurs).
if ("serviceWorker" in navigator && (location.protocol === "https:" || ["localhost", "127.0.0.1"].includes(location.hostname))) {
  addEventListener("load", () => navigator.serviceWorker.register("/sw.js").catch(() => {}));
}
