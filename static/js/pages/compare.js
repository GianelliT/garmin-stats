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
const chips = a => catPills(a.category, a.subtags);
const signed = (d, f) => { const t = f(Math.abs(d)); return /[1-9]/.test(t) ? (d > 0 ? "+" : "−") + t : t; };   // pas de « −0 bpm »
const ok = v => v != null && !Number.isNaN(v);
const secPerKm = a => a.distance_m > 0 ? a.duration_s / (a.distance_m / 1000) : null;
const kmh = a => a.distance_m > 0 ? a.distance_m / 1000 / (a.duration_s / 3600) : null;
const hasFast = a => a.fast?.length > 0;                                          // tours rapides détectés (voir series.split_efforts côté serveur)
const fastLaps = a => (a.laps || []).filter(l => a.fast?.includes(l.n));
const fastKmh = a => a.fast_pace_s > 0 ? 3600 / a.fast_pace_s : null;             // vitesse moyenne des tours rapides
const CHEV = '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>';

/** Une séance en pastille : lettre (couleur de la séance), nom, date · distance · catégorie, et la croix pour la retirer. */
const pill = (a, i, removable) => `<li style="--c:var(${VARS[i]})"><span class="cmp-badge">${LETTERS[i]}</span>
  <div class="cmp-main"><a class="cmp-name" href="#/activity/${a.id}" title="${title(a)}">${title(a)}</a><span class="cmp-sub"><span>${dateFr(a.date)} · ${fr(a.distance_m / 1000, 1)} km</span>${chips(a)}</span></div>
  ${removable ? `<button type="button" class="x" data-id="${a.id}" title="Retirer cette séance" aria-label="Retirer la séance du ${dateFr(a.date)}">×</button>` : ""}</li>`;

/** Lignes du tableau, par groupe : [titre, [[libellé, valeur(séance), format, sens favorable : -1 = plus petit c'est mieux, 1 = plus grand, 0 = neutre]]].
 *  Les tours rapides (allure ou vitesse, FC, récupération) passent d'abord ; pas de ligne « vitesse » en plus de l'allure pour un sport à l'allure. */
const groups = (a, withFast) => {
  const bike = isSpeed(a.type);
  return [
    ...(withFast ? [["Tours rapides", [
      ["Nombre de tours", x => x.fast?.length || null, v => v, 0],
      bike ? ["Vitesse moyenne", fastKmh, v => fr(v, 1) + " km/h", 1] : ["Allure moyenne", x => x.fast_pace_s, v => mmss(v) + "/km", -1],
      ["FC moyenne", x => x.fast_hr, v => Math.round(v) + " bpm", 0],
      ["Récup. moyenne (±5 s)", x => x.rest_avg_s, mmss, 0],
    ]]] : []),
    [withFast ? "Séance entière" : "", [
      ["Distance", x => x.distance_m / 1000, v => fr(v, 2) + " km", 0],
      ["Durée", x => x.duration_s, mmss, 0],
      bike ? ["Vitesse moyenne", kmh, v => fr(v, 1) + " km/h", 1] : ["Allure moyenne", secPerKm, v => mmss(v) + "/km", -1],
      ["FC moyenne", x => x.avg_hr, v => Math.round(v) + " bpm", 0], ["FC max", x => x.max_hr, v => v + " bpm", 0],
      ["Dénivelé positif", x => x.elevation_m, v => Math.round(v) + " m", 0], ["Cadence", x => x.avg_cadence, v => Math.round(v) + " spm", 0],
      ["Calories", x => x.calories, v => Math.round(v), 0], ["Effet aérobie", x => x.aerobic_te, v => fr(v, 1), 0],
    ]],
  ];
};

/** 2 séances : colonne « Écart » (B moins A). 3 à 5 : la meilleure valeur de chaque ligne est mise en vert. */
function table(S) {
  const two = S.length === 2, cols = S.length + 1 + (two ? 1 : 0), gs = groups(S[0], S.some(hasFast));
  const body = gs.map(([name, list]) => {
    const trs = list.map(([l, get, f, dir]) => {
      const v = S.map(get), known = v.filter(ok), best = dir && !two && known.length > 1 && new Set(known).size > 1 ? (dir < 0 ? Math.min(...known) : Math.max(...known)) : null;
      const cells = v.map(x => `<td class="${best != null && x === best ? "best" : ""}">${ok(x) ? f(x) : "–"}</td>`).join("");
      let gap = "";
      if (two) { const d = ok(v[0]) && ok(v[1]) ? v[1] - v[0] : null; gap = `<td class="${dir && d ? (d * dir > 0 ? "good" : "bad") : ""}">${d == null ? "–" : signed(d, f)}</td>`; }
      return `<tr><td>${l}</td>${cells}${gap}</tr>`;
    }).join("");
    return (gs.length > 1 ? `<tr class="grp"><td colspan="${cols}">${name}</td></tr>` : "") + trs;
  }).join("");
  const dot = i => `<i class="dot" style="--c:var(${VARS[i]})"></i>`;
  return `<table class="tbl${two ? " two" : ""}"><thead><tr><th></th>${S.map((_, i) => `<th>${dot(i)}${LETTERS[i]}</th>`).join("")}${two ? "<th>Écart</th>" : ""}</tr></thead><tbody>${body}</tbody></table>`;
}

/** Courbe y = f(donnée) en fonction de la distance, une ligne par séance. Les courbes empilées partagent le même axe des km (de 0 à la plus longue
 *  séance) pour que leurs zones de tracé s'alignent ; seule la dernière affiche les graduations (`showX`). */
function lineChart(canvas, S, key, f, scaleY = {}, fmt = v => v, showX = true) {
  const C = COLORS(), pts = a => (a.track?.dist || []).map((d, i) => d == null ? null : { x: d / 1000, y: a.track[key][i] == null ? null : f(a.track[key][i]) }).filter(Boolean);
  let xMax = 0; S.forEach(a => (a.track?.dist || []).forEach(d => { if (d > xMax) xMax = d; })); xMax /= 1000;
  return mk(canvas, { type: "line", data: { datasets: S.map((a, i) => ({ label: label(a, i), data: pts(a), borderColor: C[i], pointRadius: 0, spanGaps: true, borderWidth: 2.25 })) },
    options: { interaction: { mode: "nearest", axis: "x", intersect: false }, layout: { padding: { right: 14 } },
      scales: { x: { ...axis.x({}), type: "linear", min: 0, max: xMax || undefined, ticks: { display: showX, callback: v => fr(v, 0) + " km", maxTicksLimit: 8 } }, y: axis.y({ beginAtZero: false, width: 52, ...scaleY }) },
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

/** Épaisseur des barres calculée d'après la place réellement disponible. Avec un maximum fixe (ancien réglage), les barres restaient minces dans une
 *  case très large : elles flottaient loin les unes des autres. Ici, une case de n barres groupées par k séances occupe au plus 70 % de sa largeur,
 *  les barres d'un même groupe se touchent presque, et elles s'élargissent quand il y a peu de répétitions (jusqu'à 56 px). Recalculé à chaque redimensionnement. */
function fit(datasets, n, k, width) {
  const slot = Math.max(1, (width - 64) / n), thick = Math.max(6, Math.min(56, 130 / k, slot * 0.7 / k));
  datasets.forEach(d => { if (d.type !== "line") Object.assign(d, { categoryPercentage: Math.min(0.92, k * thick / slot), barPercentage: 0.9, maxBarThickness: 64 }); });
}
const fitBars = (n, k) => ({ id: "fitBars", beforeUpdate: chart => fit(chart.data.datasets, n, k, chart.width) });

/** Barres groupées : une série par séance, valeurs en km/h. `avgOf(séance)` (km/h), facultatif, ajoute pour chaque séance une fine ligne pointillée
 *  à sa moyenne. Les lignes passent DERRIÈRE les barres (order élevé), sans trait de fond : elles guident l'œil sans masquer les valeurs. */
function bars(canvas, S, valuesOf, what, speedMode, avgOf) {
  const C = COLORS(), k = S.length, sets = S.map(valuesOf), n = Math.max(1, ...sets.map(x => x.length));
  const datasets = sets.map((d, i) => ({ label: label(S[i], i), data: d, backgroundColor: C[i], borderRadius: 3 }));
  if (avgOf) S.forEach((a, i) => {
    const v = avgOf(a); if (!(v > 0)) return;
    datasets.push({ type: "line", data: Array(n).fill(v), label: `${label(a, i)} · moyenne`, borderColor: C[i], borderWidth: 1.5, borderDash: [2, 4], borderCapStyle: "round",
      pointRadius: 0, pointHoverRadius: 0, tension: 0, order: 10, isAvg: true });
  });
  fit(datasets, n, k, canvas.parentElement?.clientWidth || 900);
  const speeds = [...sets.flat(), ...(avgOf ? S.map(avgOf) : [])].filter(ok);
  return mk(canvas, { type: "bar", plugins: [fitBars(n, k)], data: { labels: Array.from({ length: n }, (_, i) => i + 1), datasets },
    options: { interaction: { mode: "index", intersect: false }, scales: { x: axis.x({}), y: paceScale(speeds, speedMode) },
      plugins: { tooltip: { filter: it => !it.dataset.isAvg && it.raw != null, callbacks: { title: i => `${what} ${i[0].label}`, label: c => ` ${c.dataset.label} : ${speedMode ? fr(c.raw, 1) + " km/h" : mmss(3600 / c.raw) + "/km"}` } } } } });
}
const splitsChart = (canvas, S, speed) => bars(canvas, S, a => a.splits.map(s => s.s > 0 ? 3600 / s.s : null), "Kilomètre", speed);
/** Allure (ou vitesse) de chaque répétition ; avec `withAvg`, l'allure moyenne des tours rapides de chaque séance en pointillés. */
const fastChart = (canvas, S, speed, withAvg) => bars(canvas, S, a => fastLaps(a).map(l => l.spd > 0 ? l.spd * 3.6 : null), "Répétition", speed, withAvg ? fastKmh : null);

/** Récupération entre deux répétitions consécutives (valeurs déjà arrondies à 5 s par le serveur). La durée est écrite au-dessus de chaque barre
 *  tant qu'il reste assez de place entre deux barres voisines ; sinon, elle est dans l'infobulle. */
function restChart(canvas, S) {
  const C = COLORS(), k = S.length, sets = S.map(a => a.rests || []), n = Math.max(...sets.map(x => x.length), 1), top = Math.max(...sets.flat(), 0);
  const labels = Array.from({ length: n }, (_, i) => `${i + 1}→${i + 2}`);
  const dmax = top * 1.12, step = [5, 10, 15, 30, 60, 120, 300, 600].find(x => Math.ceil(dmax / x) <= 4) || 600, max = Math.ceil(dmax / step) * step || step;   // graduations « rondes », 5 au plus
  const values = {
    id: "restValues",
    afterDatasetsDraw(chart) {
      const m = chart.getDatasetMeta(0), m2 = chart.getDatasetMeta(1);
      if (!m2?.data[0] || Math.abs(m2.data[0].x - m.data[0].x) < 28) return;
      const { ctx } = chart;
      ctx.save(); ctx.fillStyle = css("--ink-2"); ctx.font = `600 10px ${Chart.defaults.font.family}`; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
      chart.data.datasets.forEach((d, j) => chart.getDatasetMeta(j).data.forEach((bar, i) => { if (d.data[i] != null) ctx.fillText(mmss(d.data[i]), bar.x, bar.y - 3); }));
      ctx.restore();
    },
  };
  const datasets = sets.map((d, i) => ({ label: label(S[i], i), data: d, backgroundColor: C[i], borderRadius: 3 }));
  fit(datasets, n, k, canvas.parentElement?.clientWidth || 900);
  return mk(canvas, { type: "bar", plugins: [fitBars(n, k), values], data: { labels, datasets },
    options: { interaction: { mode: "index", intersect: false }, scales: { x: axis.x({}), y: axis.y({ beginAtZero: true, min: 0, max, width: 52, ticks: { stepSize: step, callback: v => mmss(v) } }) },
      plugins: { tooltip: { filter: it => it.raw != null, callbacks: { title: i => `Récupération entre les répétitions ${i[0].label.replace("→", " et ")}`, label: c => ` ${c.dataset.label} : ${mmss(c.raw)}` } } } } });
}

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
    <header class="page cmp-head"><div><h1>Comparer avec…</h1></div><ul class="cmp-list">${pill(A, 0, false)}</ul></header>
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

  /** Au plus trois onglets (avant : sept). Chacun est une pile de graphiques { h : hauteur, title, build(canvas, avecMoyennes) } ;
   *  `note(séance)` complète la légende, `avg` fait apparaître l'interrupteur « Afficher les moyennes ». */
  const views = [];
  if (S.some(hasFast)) views.push({ label: "Répétitions", avg: true,
    note: a => hasFast(a) ? ` · moy. ${speed ? fr(fastKmh(a), 1) + " km/h" : mmss(a.fast_pace_s) + "/km"}` : " · pas de tours rapides",
    charts: [{ h: 250, title: speed ? "Vitesse par répétition" : "Allure par répétition", build: (c, avg) => fastChart(c, S, speed, avg) },
      ...(S.some(a => a.rests?.length) ? [{ h: 130, title: "Récupération entre répétitions", build: c => restChart(c, S) }] : [])] });
  if (bothTracks) views.push({ label: "Courbes", charts: [
    { h: 170, title: speed ? "Vitesse" : "Allure", build: c => lineChart(c, S, "spd", paceOf, { reverse: !speed, ticks: { callback: v => speed ? v : mmss(v) } }, v => speed ? fr(v, 1) + " km/h" : mmss(v) + "/km", false) },
    { h: 120, title: "Fréquence cardiaque", build: c => lineChart(c, S, "hr", v => v, {}, v => Math.round(v) + " bpm", false) },
    { h: 110, title: "Altitude", build: c => lineChart(c, S, "alt", v => v, {}, v => Math.round(v) + " m") }] });
  if (!S.every(hasFast)) {      // pour des séances de répétitions, l'onglet « Répétitions » remplace le détail par km ou par tour
    if (S.every(a => a.splits?.length)) views.push({ label: speed ? "Vitesse par km" : "Allure par km", charts: [{ h: 300, build: c => splitsChart(c, S, speed) }] });
    else if (S.every(a => a.laps?.length > 1)) views.push({ label: speed ? "Vitesse par tour" : "Allure par tour", charts: [{ h: 300, build: c => lapsChart(c, S, speed) }] });
  }

  const rest = id => S.filter(a => a.id !== id).map(a => a.id);
  const key = S.map((a, i) => route(a.track).length > 1 ? `<span style="--c:var(${VARS[i]})"><i></i>${LETTERS[i]}</span>` : "").join("");
  el.innerHTML = `<a href="#/activity/${S[0].id}" class="back">${CHEV}Retour à la séance</a>
    <header class="page cmp-head"><div><h1>Comparaison</h1></div>
      <div class="actions">${S.length < MAX ? `<select id="add" aria-label="Ajouter une séance"><option value="">+ Ajouter une séance (${S.length}/${MAX})</option>${options(S, acts)}</select>` : `<span class="sub">5 séances au maximum</span>`}</div>
      <ul class="cmp-list">${S.map((a, i) => pill(a, i, true)).join("")}</ul></header>
    <div class="grid">
      <section class="card c${hasMap ? 7 : 12}"><header class="card-h"><div><h3>En chiffres</h3><p class="sub">${S.length === 2 ? "Écart = B moins A, en vert quand B est plus rapide" : "La meilleure valeur de chaque ligne est en vert"}</p></div></header><div class="scroll tblwrap">${table(S)}</div></section>
      ${hasMap ? `<section class="card flush cmp-map c5"><div id="map" class="map"></div><div class="cmp-key">${key}</div></section>` : ""}
      ${views.length ? `<section class="card c12 cmp-chart"><header class="card-h">${views.length > 1 ? `<div class="seg">${views.map(v => `<button>${v.label}</button>`).join("")}</div>` : `<h3>${views[0].label}</h3>`}
        <label class="chk" id="avgwrap" hidden><input type="checkbox" id="avg">Afficher les moyennes</label></header>
        <div class="legend cmp-legend" id="lg"></div><div id="stage"></div></section>` : ""}
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

  if (!views.length) return;
  const tabs = [...el.querySelectorAll(".seg button")], avgWrap = el.querySelector("#avgwrap"), avgBox = el.querySelector("#avg"), lg = el.querySelector("#lg"), stage = el.querySelector("#stage");
  let cur = 0, showAvg = false;       // les moyennes sont masquées par défaut : l'interrupteur les affiche
  const show = i => {
    cur = i;
    const v = views[i];
    charts.forEach(c => c.destroy()); charts = [];
    tabs.forEach((b, j) => b.classList.toggle("on", i === j));
    avgWrap.hidden = !v.avg;
    lg.innerHTML = S.map((a, k) => `<span><i style="--c:var(${VARS[k]})"></i>${label(a, k)}${v.note?.(a) || ""}</span>`).join("");
    stage.innerHTML = v.charts.map(c => `<div class="mc">${v.charts.length > 1 && c.title ? `<div class="mc-h"><b>${c.title}</b></div>` : ""}<div class="chart" style="--h:${c.h}px"><canvas></canvas></div></div>`).join("");
    const canvases = [...stage.querySelectorAll("canvas")];
    charts = v.charts.map((c, k) => c.build(canvases[k], showAvg));
  };
  tabs.forEach((b, i) => { b.onclick = () => show(i); });
  avgBox.onchange = () => { showAvg = avgBox.checked; show(cur); };
  show(0);
}