import { api } from "../api.js";
import { axis, mk } from "../charts.js";
import { catPills, css, dateFr, esc, fr, isSpeed, mmss, pace, typeLabel } from "../format.js";
import { osmMap } from "../map.js";

const MAX = 5;                                                          // nombre maximal de séances comparées
const VARS = ["--ac", "--cmp-b", "--cmp-c", "--cmp-d", "--cmp-e"];      // une couleur par séance, A à E
const LETTERS = "ABCDE";
const COLORS = () => VARS.map(css);

let map, charts = [];
export function destroy() { map?.remove(); map = null; charts.forEach(c => c.destroy()); charts = []; }

const title = a => esc(a.name || typeLabel(a.type));
const label = (a, i) => `${LETTERS[i]} · ${dateFr(a.date)}`;
const dot = i => `<i class="dot" style="--c:var(${VARS[i]})"></i>`;
const chips = a => catPills(a.category, a.subtags);
const signed = (d, f) => { const t = f(Math.abs(d)); return /[1-9]/.test(t) ? (d > 0 ? "+" : "−") + t : t; };   // pas de « −0 bpm »
const ok = v => v != null && !Number.isNaN(v);
const secPerKm = a => a.distance_m > 0 ? a.duration_s / (a.distance_m / 1000) : null;
const kmh = a => a.distance_m > 0 ? a.distance_m / 1000 / (a.duration_s / 3600) : null;
const CHEV = '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>';

/** [libellé, valeur(séance), format, sens favorable : -1 = plus petit c'est mieux, 1 = plus grand, 0 = neutre] */
const rows = a => [
  ["Distance", x => x.distance_m / 1000, v => fr(v, 2) + " km", 0],
  ["Durée", x => x.duration_s, mmss, 0],
  isSpeed(a.type) ? ["Vitesse moyenne", kmh, v => fr(v, 1) + " km/h", 1] : ["Allure moyenne", secPerKm, v => mmss(v) + "/km", -1],
  ["FC moyenne", x => x.avg_hr, v => Math.round(v) + " bpm", 0], ["FC max", x => x.max_hr, v => v + " bpm", 0],
  ["Dénivelé positif", x => x.elevation_m, v => Math.round(v) + " m", 0], ["Cadence", x => x.avg_cadence, v => Math.round(v) + " spm", 0],
  ["Calories", x => x.calories, v => Math.round(v), 0], ["Effet aérobie", x => x.aerobic_te, v => fr(v, 1), 0],
];

/** 2 séances : colonne « Écart » (B moins A). 3 à 5 : la meilleure valeur de chaque ligne est mise en vert. */
function table(S) {
  const two = S.length === 2;
  const body = rows(S[0]).map(([l, get, f, dir]) => {
    const v = S.map(get), known = v.filter(ok), best = dir && !two && known.length > 1 && new Set(known).size > 1 ? (dir < 0 ? Math.min(...known) : Math.max(...known)) : null;
    const cells = v.map(x => `<td class="${best != null && x === best ? "best" : ""}">${ok(x) ? f(x) : "–"}</td>`).join("");
    let gap = "";
    if (two) { const d = ok(v[0]) && ok(v[1]) ? v[1] - v[0] : null; gap = `<td class="${dir && d ? (d * dir > 0 ? "good" : "bad") : ""}">${d == null ? "–" : signed(d, f)}</td>`; }
    return `<tr><td>${l}</td>${cells}${gap}</tr>`;
  }).join("");
  return `<table class="tbl${two ? " two" : ""}"><thead><tr><th></th>${S.map((_, i) => `<th>${dot(i)}${LETTERS[i]}</th>`).join("")}${two ? "<th>Écart</th>" : ""}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Courbe y = f(donnée) en fonction de la distance, une ligne par séance. */
function lineChart(canvas, S, key, f, scaleY = {}, fmt = v => v) {
  const C = COLORS(), pts = a => (a.track?.dist || []).map((d, i) => d == null ? null : { x: d / 1000, y: a.track[key][i] == null ? null : f(a.track[key][i]) }).filter(Boolean);
  return mk(canvas, { type: "line", data: { datasets: S.map((a, i) => ({ label: label(a, i), data: pts(a), borderColor: C[i], pointRadius: 0, spanGaps: true, borderWidth: 2.25 })) },
    options: { interaction: { mode: "nearest", axis: "x", intersect: false },
      scales: { x: { ...axis.x({}), type: "linear", ticks: { callback: v => fr(v, 0) + " km", maxTicksLimit: 8 } }, y: axis.y({ beginAtZero: false, width: 52, ...scaleY }) },
      plugins: { tooltip: { callbacks: { title: () => "", label: c => ` ${c.dataset.label} : ${fmt(c.parsed.y)}` } } } } });
}

/** Axe vertical pour des barres d'allure : on trace la VITESSE (plus la barre est haute, plus c'est rapide), mais les graduations
 *  s'écrivent en allure (4:00, 4:15…). L'axe ne démarre pas à zéro, sinon 4:00 et 4:10 se confondraient. */
function paceScale(speeds, speedMode) {
  const v = speeds.filter(x => x > 0), lo = Math.min(...v), hi = Math.max(...v), span = Math.max(hi - lo, hi * 0.08);
  const o = { beginAtZero: false, width: 52, min: Math.max(lo * 0.5, lo - span * 0.6), max: hi + span * 0.15 };
  if (speedMode) return axis.y({ ...o, ticks: { callback: x => fr(x, 0) } });
  return axis.y({ ...o, ticks: { callback: x => mmss(3600 / x) },
    afterBuildTicks(sc) {                      // graduations à des allures « rondes », placées à leur vitesse
      const pMin = 3600 / sc.max, pMax = 3600 / sc.min, step = [5, 10, 15, 20, 30, 60, 120].find(s => (pMax - pMin) / s <= 5) || 120, t = [];
      for (let p = Math.ceil(pMin / step) * step; p <= pMax; p += step) t.push({ value: 3600 / p });
      sc.ticks = t.sort((a, b) => a.value - b.value);
    } });
}

/** Barres groupées : une série par séance, valeurs en km/h. */
function bars(canvas, S, valuesOf, what, speedMode) {
  const C = COLORS(), sets = S.map(valuesOf), n = Math.max(...sets.map(x => x.length));
  return mk(canvas, { type: "bar", data: { labels: Array.from({ length: n }, (_, i) => i + 1), datasets: sets.map((d, i) => ({ label: label(S[i], i), data: d, backgroundColor: C[i], maxBarThickness: S.length > 3 ? 12 : 18, borderRadius: 3 })) },
    options: { scales: { x: axis.x({}), y: paceScale(sets.flat().filter(ok), speedMode) },
      plugins: { tooltip: { callbacks: { title: i => `${what} ${i[0].label}`, label: c => ` ${c.dataset.label} : ${speedMode ? fr(c.raw, 1) + " km/h" : mmss(3600 / c.raw) + "/km"}` } } } } });
}
const splitsChart = (canvas, S, speed) => bars(canvas, S, a => a.splits.map(s => s.s > 0 ? 3600 / s.s : null), "Kilomètre", speed);
const lapsChart = (canvas, S, speed) => bars(canvas, S, a => a.laps.map(l => l.spd > 0 ? l.spd * 3.6 : null), "Tour", speed);

const route = T => T?.lat ? T.lat.map((la, i) => [la, T.lon[i]]).filter(p => p[0] != null) : [];

/** Séances à proposer : d'abord celles de la même série (tag en commun), puis les plus proches en distance. */
function options(S, acts) {
  const ids = new Set(S.map(a => a.id)), info = id => acts.find(x => x.id === id) || {}, fam = info(S[0].id).family;
  const base = info(S[0].id), pool = acts.filter(x => x.family === fam && !ids.has(x.id));
  const shared = base.category ? pool.filter(x => x.category === base.category && (!(base.subtags || []).length || (x.subtags || []).some(t => base.subtags.includes(t)))).sort((p, q) => q.start_local.localeCompare(p.start_local)) : [];   // même catégorie (et même précision)
  const near = pool.filter(x => !shared.includes(x)).sort((p, q) => Math.abs(p.distance_m - S[0].distance_m) - Math.abs(q.distance_m - S[0].distance_m)).slice(0, 60);
  const opt = x => `<option value="${x.id}">${dateFr(x.date)} · ${fr(x.distance_m / 1000, 1)} km · ${pace(x)} · ${esc(x.name)}</option>`;
  return (shared.length ? `<optgroup label="Même série">${shared.map(opt).join("")}</optgroup>` : "") + `<optgroup label="Séances proches en distance">${near.map(opt).join("")}</optgroup>`;
}

/** Une seule séance : on propose d'ajouter la deuxième. */
async function picker(el, A, acts) {
  el.innerHTML = `<a href="#/activity/${A.id}" class="back">${CHEV}Retour à la séance</a>
    <header class="page"><div><h1>Comparer avec…</h1><ul class="cmp-list"><li>${dot(0)}${title(A)} · ${dateFr(A.date)} · ${fr(A.distance_m / 1000, 1)} km${chips(A)}</li></ul></div></header>
    <section class="card"><div class="card-h"><div><h3>Choisissez une séance</h3><p class="sub">Celles de la même série (même tag) viennent en premier. Vous pourrez en ajouter jusqu'à ${MAX - 1} autres.</p></div></div>
    <select id="pick" style="width:100%;max-width:560px"><option value="">Sélectionner…</option>${options([A], acts)}</select></section>`;
  el.querySelector("#pick").onchange = e => { if (e.target.value) location.hash = `#/compare/${A.id}/${e.target.value}`; };
}

export async function render(el, idsParam) {
  const ids = [...new Set(idsParam.split("/").map(Number))].slice(0, MAX);
  const [S, acts] = await Promise.all([Promise.all(ids.map(id => api.activity(id))), api.activities()]);
  if (S.length === 1) return picker(el, S[0], acts);
  const speed = isSpeed(S[0].type), C = COLORS();
  const hasMap = S.some(a => route(a.track).length > 1), bothTracks = S.every(a => a.track?.dist);
  const paceOf = s => !s || s < 0.5 ? null : speed ? s * 3.6 : Math.min(1000 / s, 900);
  const views = [];
  if (bothTracks) views.push(
    [speed ? "Vitesse" : "Allure", c => lineChart(c, S, "spd", paceOf, { reverse: !speed, ticks: { callback: v => speed ? v : mmss(v) } }, v => speed ? fr(v, 1) + " km/h" : mmss(v) + "/km")],
    ["Fréquence cardiaque", c => lineChart(c, S, "hr", v => v, {}, v => Math.round(v) + " bpm")],
    ["Altitude", c => lineChart(c, S, "alt", v => v, {}, v => Math.round(v) + " m")]);
  if (S.every(a => a.splits?.length)) views.push([speed ? "Vitesse par km" : "Allure par km", c => splitsChart(c, S, speed)]);
  if (S.every(a => a.laps?.length > 1)) views.push([speed ? "Vitesse par tour" : "Allure par tour", c => lapsChart(c, S, speed)]);

  const rest = id => S.filter(a => a.id !== id).map(a => a.id);
  el.innerHTML = `<a href="#/activity/${S[0].id}" class="back">${CHEV}Retour à la séance</a>
    <header class="page"><div><h1>Comparaison</h1><ul class="cmp-list">${S.map((a, i) => `<li>${dot(i)}<div class="cmp-main"><a href="#/activity/${a.id}">${title(a)} · ${dateFr(a.date)}</a>${chips(a)}</div><button type="button" class="x" data-id="${a.id}" title="Retirer cette séance" aria-label="Retirer la séance du ${dateFr(a.date)}">×</button></li>`).join("")}</ul></div>
      <div class="actions">${S.length < MAX ? `<select id="add" aria-label="Ajouter une séance"><option value="">+ Ajouter une séance (${S.length}/${MAX})</option>${options(S, acts)}</select>` : `<span class="sub">5 séances au maximum</span>`}</div></header>
    <div class="grid">
      ${hasMap ? '<section class="card flush c7 hh" style="position:relative"><div id="map" class="map"></div></section>' : ""}
      <section class="card c${hasMap ? 5 : 12}"><header class="card-h"><div><h3>En chiffres</h3><p class="sub">${S.length === 2 ? "Écart = B moins A, en vert quand B est plus rapide" : "La meilleure valeur de chaque ligne est en vert"}</p></div></header><div class="scroll tblwrap">${table(S)}</div></section>
      ${views.length ? `<section class="card c12"><header class="card-h"><div class="seg">${views.map(([l], i) => `<button data-i="${i}">${l}</button>`).join("")}</div>
        <div class="legend">${S.map((a, i) => `<span><i style="--c:var(${VARS[i]})"></i>${label(a, i)}</span>`).join("")}</div></header><div class="chart" style="height:320px"><canvas></canvas></div></section>` : ""}
    </div>`;

  el.querySelector("#add")?.addEventListener("change", e => { if (e.target.value) location.hash = `#/compare/${[...ids, e.target.value].join("/")}`; });
  el.querySelectorAll(".cmp-list .x").forEach(b => { b.onclick = () => { const r = rest(+b.dataset.id); location.hash = r.length > 1 ? `#/compare/${r.join("/")}` : r.length ? `#/compare/${r[0]}` : "#/activities"; }; });

  if (hasMap) {
    map = osmMap("map");
    const g = L.featureGroup().addTo(map);
    S.forEach((a, i) => { const r = route(a.track); if (r.length > 1) {
      L.polyline(r, { color: css("--surface"), weight: 8, opacity: .9 }).addTo(g);
      L.polyline(r, { color: C[i], weight: 4, opacity: 1 }).addTo(g); } });
    map.fitBounds(g.getBounds().pad(0.1));
  }
  const tabs = [...el.querySelectorAll(".seg button")];
  const show = i => {
    charts.forEach(c => c.destroy());
    charts = [views[i][1](el.querySelector(".chart canvas"))];
    tabs.forEach((b, j) => b.classList.toggle("on", i === j));
  };
  tabs.forEach((b, i) => { b.onclick = () => show(i); });
  if (views.length) show(0);
}
