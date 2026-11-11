import { api } from "../api.js";
import { filterBar, matches, store } from "../filters.js";
import { catPills, serieHref, dateShort, esc, familyColor, familyLabel, fr, mmss, monthLong, paceLabel, paceMs, paceParts, speedParts, typeLabel } from "../format.js";

const PAGE_SIZE = 48;
const TILE = 256, W = 320, H = 170, PAD = 14;   // taille logique de la vignette (px)

let io, cartoKey = "";
const DARK = matchMedia("(prefers-color-scheme: dark)");
/** Avec une clé CARTO : fond épuré sans libellés (clair ou sombre selon le thème).
 *  Sans clé : tuiles OpenStreetMap passées en gris par le CSS (classe "mono"). */
const tileUrl = (z, x, y) => cartoKey
  ? `https://basemaps.cartocdn.com/rastertiles/${DARK.matches ? "dark" : "light"}_nolabels/${z}/${x}/${y}.png?key=${encodeURIComponent(cartoKey)}`
  : `https://tile.openstreetmap.org/${z}/${x}/${y}.png`;
export function destroy() { io?.disconnect(); }

/** Projection Web Mercator (celle des tuiles OpenStreetMap) : lat/lon -> pixels au zoom z. */
const project = (lat, lon, z) => {
  const s = TILE * 2 ** z, sin = Math.sin(lat * Math.PI / 180);
  return [(lon + 180) / 360 * s, (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * s];
};

/** Choisit le zoom (fractionnaire, pour remplir au mieux la vignette) qui fait tenir le tracé ; renvoie les points du tracé et les tuiles à afficher. */
export function mapView(poly) {
  const lats = poly.map(p => p[0]), lons = poly.map(p => p[1]);
  const [la0, la1, lo0, lo1] = [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  // l'étendue du tracé double à chaque niveau de zoom : on part du zoom 0 et on en déduit le zoom exact
  const [[x0, y1], [x1, y0]] = [project(la0, lo0, 0), project(la1, lo1, 0)];
  const fit = Math.min((W - 2 * PAD) / (x1 - x0), (H - 2 * PAD) / (y1 - y0));   // Infinity si le tracé est un point
  const zf = Math.min(17, Math.max(2, Math.log2(fit) - 0.25));
  // les tuiles existent à des zooms entiers : on prend celui du dessus et on les réduit légèrement (rendu net)
  const zt = Math.ceil(zf - 1e-9), size = TILE * 2 ** (zf - zt), n = 2 ** zt;
  const [[a0, b1], [a1, b0]] = [project(la0, lo0, zf), project(la1, lo1, zf)];
  const ox = (a0 + a1) / 2 - W / 2, oy = (b0 + b1) / 2 - H / 2;
  const pts = poly.map(([la, lo]) => { const [x, y] = project(la, lo, zf); return `${(x - ox).toFixed(1)},${(y - oy).toFixed(1)}`; }).join(" ");
  const tiles = [];
  for (let tx = Math.floor(ox / size); tx <= Math.floor((ox + W) / size); tx++)
    for (let ty = Math.floor(oy / size); ty <= Math.floor((oy + H) / size); ty++)
      if (ty >= 0 && ty < n) tiles.push([zt, ((tx % n) + n) % n, ty, +(tx * size - ox).toFixed(1), +(ty * size - oy).toFixed(1), +size.toFixed(2)]);
  return { pts, tiles };
}

function preview(poly) {
  if (!poly?.length) return '<div class="noimg">Pas de tracé GPS</div>';
  const { pts, tiles } = mapView(poly), vb = `viewBox="0 0 ${W} ${H}"`;
  return `<div class="tl" data-tiles='${JSON.stringify(tiles)}' style="position:absolute;inset:0"><svg class="tiles${cartoKey ? "" : " mono"}" ${vb}></svg>
    <svg ${vb}><polyline class="case" points="${pts}"/><polyline points="${pts}"/></svg></div>`;
}

/** Les tuiles ne sont chargées que lorsque la vignette approche de l'écran. */
function loadTiles(entries) {
  for (const e of entries) {
    if (!e.isIntersecting) continue;
    io.unobserve(e.target);
    e.target.querySelector(".tiles").innerHTML = JSON.parse(e.target.dataset.tiles).map(([z, x, y, px, py, size]) =>
      `<image href="${tileUrl(z, x, y)}" x="${px}" y="${py}" width="${size + .5}" height="${size + .5}"/>`).join("");
  }
}

const tagChips = a => a.category ? `<div class="ctags">${catPills(a.category, a.subtags)}</div>` : "";

const card = (a, poly, showTag) => {
  const [pv, pu] = paceParts(a), where = [typeLabel(a.type), a.city || a.region].filter(Boolean).join(" · ");
  return `<a class="act" href="#/activity/${a.id}" style="--route:${familyColor(a.family)}"><div class="thumb">${preview(poly)}
    ${showTag ? `<span class="tag"><i></i>${familyLabel(a.family)}</span>` : ""}</div>
  <div class="act-b"><div class="act-t"><h3>${esc(a.name || typeLabel(a.type))}</h3><p>${dateShort(a.date)} · ${a.start_local.slice(11, 16)} · ${where}</p></div>
    <dl class="m3"><div><dt>Distance</dt><dd>${fr((a.distance_m || 0) / 1000, 2)}<small>km</small></dd></div>
      <div><dt>Durée</dt><dd>${mmss(a.duration_s)}</dd></div>
      <div><dt>${paceLabel(a.type)}</dt><dd>${pv}<small>${pu}</small></dd></div></dl>${tagChips(a)}</div></a>`;
};

const SORTS = [["date", "Plus récentes"], ["dist", "Plus longues"], ["fast", "Plus rapides"], ["elev", "Plus de dénivelé"]];
const sorters = {
  date: () => 0, dist: (a, b) => (b.distance_m || 0) - (a.distance_m || 0),
  fast: (a, b) => paceMs(b) - paceMs(a), elev: (a, b) => (b.elevation_m || 0) - (a.elevation_m || 0),
};

export async function render(el) {
  const [acts, tracks, cfg] = await Promise.all([api.activities(), api.tracks(), api.config()]);
  cartoKey = cfg.carto_key || "";
  const polys = new Map(tracks.map(t => [t.id, t.poly])), fam = store.family;
  el.innerHTML = `<header class="page"><div><h1>Activités</h1><p id="n" class="sub"></p></div>
      <div class="actions"><select id="sort" aria-label="Trier">${SORTS.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select><div id="f"></div></div></header>
    <div id="grid" class="agrid"></div><button id="more" class="btn more">Afficher plus</button>
    <p class="attrib">Fonds de carte © OpenStreetMap contributors${cartoKey ? " © CARTO" : ""}</p>`;
  const [grid, more, count, sort] = ["#grid", "#more", "#n", "#sort"].map(s => el.querySelector(s));
  io = new IntersectionObserver(loadTiles, { rootMargin: "300px" });
  let list = [], shown = 0, lastMonth = "";

  const drawMore = () => {
    const chunk = list.slice(shown, shown + PAGE_SIZE), byDate = sort.value === "date";
    grid.insertAdjacentHTML("beforeend", chunk.map(a => {
      const m = a.date.slice(0, 7);
      let head = "";
      if (byDate && m !== lastMonth) {
        lastMonth = m;
        const inM = list.filter(x => x.date.startsWith(m));
        head = `<h2 class="month">${monthLong(m)}<span>${inM.length} sortie${inM.length > 1 ? "s" : ""} · ${fr(inM.reduce((s, x) => s + (x.distance_m || 0), 0) / 1000, 0)} km</span></h2>`;
      }
      return head + card(a, polys.get(a.id), fam === "all");
    }).join(""));
    shown = Math.min(list.length, shown + PAGE_SIZE);
    more.hidden = shown >= list.length;
    grid.querySelectorAll(".tl[data-tiles]:not([data-obs])").forEach(t => { t.dataset.obs = 1; io.observe(t); });
  };
  const apply = f => {
    io.disconnect();
    list = acts.filter(a => matches(a, f)).sort(sorters[sort.value]); shown = 0; lastMonth = ""; grid.innerHTML = "";
    const km = list.reduce((s, a) => s + (a.distance_m || 0), 0) / 1000;
    count.innerHTML = (list.length ? `${fr(list.length)} sortie${list.length > 1 ? "s" : ""} · ${fr(km, 0)} km` : "") +
      (f.cat && f.cat !== "none" ? ` · <a class="lnk" href="${serieHref(f.cat, f.sub)}">Comparer cette série</a>` : "");
    if (!list.length) grid.innerHTML = '<p class="msg" style="grid-column:1/-1">Aucune sortie ne correspond à ces filtres.</p>';
    drawMore();
  };
  more.onclick = drawMore;
  const read = filterBar(el.querySelector("#f"), acts, apply);
  sort.onchange = () => apply(read());
  apply(read());
}
