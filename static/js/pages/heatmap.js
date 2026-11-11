import { api } from "../api.js";
import { filterBar, matches } from "../filters.js";
import { familyColor, fr } from "../format.js";
import { osmMap } from "../map.js";

let map;
export function destroy() { map?.remove(); map = null; }

const MIN_SPAN = 0.002;   // ~200 m : en dessous, un tracé ressemble à un point (il est alors affiché en pastille seule)
const weightAt = z => z <= 10 ? 2.2 : z <= 12 ? 2.4 : z <= 14 ? 2.8 : 4;     // les traits restent assez épais pour se voir quand on dézoome
const opacityAt = z => z <= 10 ? 0.85 : z <= 13 ? 0.65 : 0.5;
/** Pastille au départ de chaque activité : elle matérialise les zones parcourues quand les routes ne se distinguent plus.
 *  Grosse en vue d'ensemble, plus petite en zoomant, masquée en vue détaillée où les tracés suffisent. */
const DOT_MAX_ZOOM = 13;
const dotRadius = z => z <= 7 ? 6 : z <= 9 ? 5.5 : z <= 11 ? 4.5 : 3.5;

const span = poly => {
  const la = poly.map(p => p[0]), lo = poly.map(p => p[1]);
  return Math.max(Math.max(...la) - Math.min(...la), Math.max(...lo) - Math.min(...lo));
};

/** Zone où se concentrent la plupart des traces (ignore les voyages lointains, qui dézoomeraient trop). */
function mainBounds(polys) {
  const c = polys.map(p => [p.reduce((s, q) => s + q[0], 0) / p.length, p.reduce((s, q) => s + q[1], 0) / p.length]);
  const median = k => c.map(x => x[k]).sort((a, b) => a - b)[Math.floor(c.length / 2)];
  const [mla, mlo] = [median(0), median(1)], kx = Math.cos(mla * Math.PI / 180);
  const near = polys.filter((_, i) => Math.hypot(c[i][0] - mla, (c[i][1] - mlo) * kx) < 0.5);   // ~55 km
  return L.latLngBounds((near.length ? near : polys).flat());
}

export async function render(el) {
  const [acts, tracks] = await Promise.all([api.activities(), api.tracks()]);
  const byId = new Map(acts.map(a => [a.id, a]));
  el.innerHTML = `<header class="page"><div><h1>Carte</h1><p id="n" class="sub"></p></div><div id="f"></div></header>
    <div class="bigmap"><div id="map" class="map"></div>
      <div class="mapbtns"><button class="btn" id="main">Zone principale</button><button class="btn" id="all">Tout voir</button></div></div>`;
  map = osmMap("map", { preferCanvas: true });
  const group = L.featureGroup().addTo(map);
  const dots = L.featureGroup().addTo(map);   // ajouté après : les pastilles passent au-dessus des traits
  let shown = [];

  const style = () => {
    const z = map.getZoom();
    group.setStyle({ weight: weightAt(z), opacity: opacityAt(z) });
    dots.setStyle({ radius: dotRadius(z) });
    if (z > DOT_MAX_ZOOM) map.removeLayer(dots); else if (!map.hasLayer(dots)) dots.addTo(map);
  };
  const focusMain = () => shown.length && map.fitBounds(mainBounds(shown).pad(0.05), { maxZoom: 14 });
  const focusAll = () => shown.length && map.fitBounds(L.latLngBounds(shown.flat()).pad(0.05), { maxZoom: 16 });

  const apply = f => {
    group.clearLayers(); dots.clearLayers(); shown = [];
    let tiny = 0;
    for (const t of tracks) {
      const a = byId.get(t.id);
      if (!a || !matches(a, f)) continue;
      shown.push(t.poly);
      const open = () => { location.hash = `#/activity/${t.id}`; }, color = familyColor(a.family);
      if (span(t.poly) < MIN_SPAN) tiny++;
      else L.polyline(t.poly, { color, lineCap: "round", lineJoin: "round", smoothFactor: 0.5 }).on("click", open).addTo(group);
      L.circleMarker(t.poly[0], { radius: 5, color: "#fff", weight: 1.5, opacity: 0.9, fillColor: color, fillOpacity: 0.6 }).on("click", open).addTo(dots);
    }
    style();
    el.querySelector("#n").textContent = shown.length
      ? `${fr(shown.length)} parcours superposés` + (tiny ? ` · dont ${tiny} très courts, affichés en points` : "")
      : tracks.length ? "Aucun parcours pour ces filtres" : "Aucun tracé : lancez python download_tracks.py";
    shown.length ? focusAll() : map.setView([46.6, 2.5], 5);   // vue globale par défaut ; « Zone principale » recentre sur la zone habituelle
  };
  map.on("zoomend", style);
  el.querySelector("#main").onclick = focusMain;
  el.querySelector("#all").onclick = focusAll;
  apply(filterBar(el.querySelector("#f"), acts, apply, { search: false, periodKey: "map", defaultPeriod: "all" })());
}