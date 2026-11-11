/** Carte Leaflet avec fond OpenStreetMap. */
export function osmMap(elementId, options = {}) {
  const m = L.map(elementId, options);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    { maxZoom: 19, attribution: "© OpenStreetMap contributors" }).addTo(m);
  return m;
}
