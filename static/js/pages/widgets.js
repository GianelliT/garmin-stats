import { api } from "../api.js";
import { alpha, axis, timeTicks, fade, highlightMax, mk, narrow } from "../charts.js";
import { CATS, css, dateFr, dateShort, esc, familyColor, familyLabel, fr, hm, isSpeedFamily, mmss, monthShort } from "../format.js";
import { destroyForme, formePage } from "./forme.js";

// Les widgets du dashboard. Chaque carte a une version compacte (le dashboard) et une version « détail » (page #/stat/<id>)
// qui reprend le même dessin en plus grand, avec des contrôles et, si besoin, un tableau.
let charts = [];
export function destroyCharts() { charts.forEach(c => c.destroy()); charts = []; destroyForme(); }

const canvas = body => { body.innerHTML = '<div class="chart"><canvas></canvas></div>'; return body.querySelector("canvas"); };
const legend = (items, toggle = false) => `<div class="legend">${items.map(([l, c], i) => `<span${toggle ? ` data-i="${i}" title="Afficher / masquer"` : ""}><i style="--c:${c}"></i>${l}</span>`).join("")}</div>`;

// ───────── Cette semaine ─────────
function week(d, body, { fam, big }) {
  const max = Math.max(10, ...d.km), diff = d.total_km - d.last_km;
  const delta = d.last_km || d.total_km
    ? `<span class="delta ${diff > 0 ? "up" : ""}">${diff > 0 ? "+" : diff < 0 ? "−" : ""}${fr(Math.abs(diff), 1)} km vs sem. dernière</span>` : "";
  body.innerHTML = `<div class="wk"><div><div class="big">${fr(d.total_km, 1)}<small>km</small></div>${delta}
      <p class="meta">${d.n} sortie${d.n > 1 ? "s" : ""} · ${hm(d.hours * 3600)}</p></div>
    <div class="wkbars" role="img" aria-label="Kilomètres par jour cette semaine">${d.days.map((l, i) => `<div class="wkb ${d.km[i] ? "" : i > d.today ? "future" : "zero"} ${i === d.today ? "today" : ""}">
      <span class="v">${d.km[i] ? fr(d.km[i], 1) : ""}</span><div class="bar" style="height:${d.km[i] ? Math.max(6, d.km[i] / max * 100) : 4}%;${d.km[i] ? `background:${familyColor(fam === "all" ? "run" : fam)}` : ""}"></div><b>${l[0]}</b></div>`).join("")}</div></div>`;
  const end = new Date(d.monday + "T12:00"); end.setDate(end.getDate() + 6);
  return { sub: big ? `Du ${dateShort(d.monday)} au ${end.toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" })} · comparée à la semaine précédente, au même jour` : "Comparée à la semaine dernière, au même jour" };
}

// ───────── Forme : VO2max + prédictions (valeurs de la montre si disponibles, sinon estimées) + charge ─────────
const spark = v => {
  const lo = Math.min(...v), hi = Math.max(...v), W = 150, H = 34, pts = v.map((x, i) => `${(i / (v.length - 1) * W).toFixed(1)},${(H - 3 - (hi === lo ? .5 : (x - lo) / (hi - lo)) * (H - 6)).toFixed(1)}`).join(" ");
  return `<svg class="spark" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="var(--ac)" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
};
async function fitness(est, body) {
  const [load, g] = await Promise.all([api.stat("load", null), api.garminFitness().catch(() => null)]);
  const vo = g?.vo2max, race = g?.race;
  if (!est && !vo && !race) {
    body.innerHTML = '<div class="empty">Pas encore de valeurs de votre montre.<br>Lancez <code>python connect_sync.py --login</code> une fois,<br>puis cliquez sur Synchroniser.</div>';
    return {};
  }
  const t = race?.times, KM = { t5k: ["5 km", 5], t10k: ["10 km", 10], thalf: ["Semi", 21.0975], tmarathon: ["Marathon", 42.195] };
  const preds = race ? Object.entries(KM).filter(([k]) => t[k]).map(([k, [l, km]]) => [l, t[k], km]) : (est?.predictions || []).map(p => [p.label.replace("Semi-marathon", "Semi"), p.time_s, p.km]);
  const value = vo ? vo.value : est?.vdot, hist = vo?.history?.slice(-60).map(x => x.v) || [];
  const r = load.ratio, st = r == null ? null : r < 0.8 ? ["Charge en baisse", "--warn"] : r <= 1.3 ? ["Charge bien dosée", "--good"] : r <= 1.5 ? ["Charge élevée", "--warn"] : ["Surcharge", "--bad"];
  body.innerHTML = `<div class="fit"><div>${value ? `<div class="big">${fr(value, vo ? 0 : 1)}</div><p class="what">VO₂max ${vo ? "Garmin" : "estimée"}</p>
      <p class="basis">${vo ? `Mesurée par votre montre, le ${dateFr(vo.date)}` : `D'après votre ${est.basis}, le ${dateFr(est.date)}`}</p>${hist.length >= 3 ? spark(hist) : ""}` : ""}</div>
    <div class="pred">${preds.map(([l, s, km]) => `<a href="#/dashboard"><span class="pl">${l}</span><b>${mmss(s)}</b><span>${mmss(s / km)}/km</span></a>`).join("")}</div></div>
    ${st ? `<div class="pill" style="--c:var(${st[1]})"><i></i>${st[0]} · ratio ${fr(r, 2)}</div>` : ""}`;
  return { sub: vo && race ? "Valeurs de votre montre" : !vo && !race ? "Estimations calculées ici, pas celles de votre montre" : `VO₂max ${vo ? "Garmin" : "estimée"} · prédictions ${race ? "Garmin" : "estimées"}` };
}

// ───────── Volume hebdomadaire ─────────
function volume(d, body, { fam, big, opts }) {
  const month = opts?.by === "month", W = month ? 3 : 4, unit = month ? "mois" : "semaine";
  const weeks = d.labels, dense = weeks.length > 80;      // toute la période choisie ; au-delà de ~80 barres, on les resserre
  const fams = Object.keys(d.series), tot = weeks.map((_, i) => fams.reduce((s, f) => s + d.series[f][i], 0));
  const avg = tot.map((_, i) => { const w = tot.slice(Math.max(0, i - W + 1), i + 1); return +(w.reduce((a, b) => a + b, 0) / w.length).toFixed(1); });
  const color = f => familyColor(f), multi = fams.length > 1;
  charts.push(mk(canvas(body), { type: "bar", data: { labels: weeks, datasets: [
    ...fams.map(f => ({ label: familyLabel(f), data: d.series[f], backgroundColor: color(f), borderRadius: dense ? 0 : multi ? 3 : 6, maxBarThickness: 22, stack: "s", order: 2, ...(dense ? { categoryPercentage: 1, barPercentage: 0.9 } : {}) })),
    { type: "line", label: `Moyenne sur ${W} ${month ? "mois" : "semaines"}`, data: avg, borderColor: css("--ink"), borderWidth: 2, order: 1, borderDash: [5, 4] }] },
    options: { scales: { x: axis.x({ stacked: true, ticks: { maxTicksLimit: big ? 14 : 9, ...timeTicks(weeks, { month }) } }), y: axis.y({ stacked: true }) },
      plugins: { tooltip: { callbacks: { title: i => month ? monthShort(weeks[i[0].dataIndex]) : "Semaine du " + dateFr(weeks[i[0].dataIndex]), label: c => ` ${c.dataset.label} : ${fr(c.raw, 1)} km` } } } } }));
  const mean = tot.reduce((a, b) => a + b, 0) / (tot.length || 1);
  return { sub: `Moyenne : ${fr(mean, 1)} km par ${unit}`, aside: legend([...(multi ? fams.map(f => [familyLabel(f), color(f)]) : [[fam === "all" ? "Distance" : familyLabel(fam), color(fams[0])]]), [`Moyenne ${W} ${month ? "mois" : "sem."}`, css("--ink")]]) };
}

// ───────── Volume par catégorie (course, footing, séance, trail) + hausses trop rapides ─────────
const CAT_KEYS = ["course", "footing", "seance", "trail", "none"];
const catColor = k => k === "none" ? css("--line-2") : css(`--cat-${k}`);
const catName = k => k === "none" ? "Sans catégorie" : CATS[k];
const weekName = k => k === "seance" ? "Séance (tours rapides)" : catName(k);     // dans le volume hebdomadaire, une séance ne compte que pour ses tours rapides
const alertColor = a => css(a.level === "high" ? "--bad" : "--warn");
const alertText = (a, rule) => `+${a.pct} % : ${fr(a.km, 0)} km contre ${fr(a.base, 0)} km en moyenne sur les ${rule.window} semaines précédentes`;

function catVolume(d, body, { big }) {
  const weeks = d.labels, dense = weeks.length > 80;      // toute la période choisie ; au-delà de ~80 barres, on les resserre
  const keys = CAT_KEYS.filter(k => d.series[k]), S = d.series;
  const tot = weeks.map((_, i) => keys.reduce((s, k) => s + S[k][i], 0));
  const alerts = new Map(d.alerts.map(a => [a.i, a]));
  // petit triangle au-dessus des semaines dont le volume a trop augmenté
  const marks = { id: "volAlert", afterDatasetsDraw(chart) {
    const { ctx, scales: { y } } = chart, bars = chart.getDatasetMeta(0).data;
    ctx.save();
    alerts.forEach((a, i) => { const x = bars[i]?.x, top = y.getPixelForValue(tot[i]); if (x == null) return;
      const z = dense ? 3.5 : 5;      // triangle plus petit quand les barres sont resserrées
      ctx.fillStyle = alertColor(a); ctx.beginPath(); ctx.moveTo(x - z, top - 3 * z); ctx.lineTo(x + z, top - 3 * z); ctx.lineTo(x, top - 1.4 * z); ctx.closePath(); ctx.fill(); });
    ctx.restore();
  } };
  charts.push(mk(canvas(body), { type: "bar", plugins: [marks], data: { labels: weeks, datasets: keys.map(k => ({ label: weekName(k), data: S[k], backgroundColor: catColor(k), borderRadius: dense ? 0 : 3, maxBarThickness: 22, stack: "s", ...(dense ? { categoryPercentage: 1, barPercentage: 0.9 } : {}) })) },
    options: { scales: { x: axis.x({ stacked: true, ticks: { maxTicksLimit: big ? 14 : 9, ...timeTicks(weeks) } }), y: axis.y({ stacked: true, grace: "10%" }) },
      plugins: { tooltip: { filter: c => c.raw > 0, callbacks: { title: i => "Semaine du " + dateFr(weeks[i[0].dataIndex]), label: c => ` ${c.dataset.label} : ${fr(c.raw, 1)} km`,
        footer: i => { const n = i[0].dataIndex, a = alerts.get(n); return [`Total : ${fr(tot[n], 1)} km`, ...(a ? [`⚠ ${alertText(a, d.rule)}`] : [])]; } } } } } }));
  const mean = tot.reduce((a, b) => a + b, 0) / (tot.length || 1);
  const recent = [...alerts].filter(([i]) => i >= weeks.length - 2).map(([, a]) => a).at(-1);     // semaine en cours ou précédente
  const warn = recent ? ` · <span class="alert-chip" style="--c:${alertColor(recent)}"><i></i>Hausse rapide, semaine du ${dateShort(recent.week)} : ${alertText(recent, d.rule)}</span>` : "";
  // légende : les couleurs des catégories, puis les triangles du graphique (un par niveau d'alerte présent)
  const tri = [["warn", `Hausse rapide (+${d.rule.pct} %)`], ["high", `Forte hausse (+${d.rule.high_pct} %)`]].filter(([l]) => [...alerts.values()].some(a => a.level === l));
  const note = big ? " · séances : seuls les km des tours rapides comptent en séance, le reste est compté en footing" : "";
  return { sub: `Moyenne : ${fr(mean, 1)} km par semaine${note}${warn}`,
    aside: `<div class="legend">${keys.map(k => `<span><i style="--c:${catColor(k)}"></i>${weekName(k)}</span>`).join("")}${tri.map(([l, t]) => `<span class="tri"><i style="--c:${css(l === "high" ? "--bad" : "--warn")}"></i>${t}</span>`).join("")}</div>` };
}

function catVolumeTable(d, el) {
  const rows = [...d.alerts].reverse().map(a => [dateFr(a.week), `<b>${fr(a.km, 1)} km</b>`, `${fr(a.base, 1)} km`, `<span class="alert-chip" style="--c:${alertColor(a)}"><i></i>+${a.pct} %</span>`]);
  el.innerHTML = `<section class="card flush" style="margin-top:16px"><header class="card-h" style="padding:22px 22px 0"><div><h3>Hausses rapides</h3><p class="sub">Une semaine est signalée quand son volume dépasse de ${d.rule.pct} % la moyenne des ${d.rule.window} semaines précédentes (au moins ${d.rule.min_base_km} km par semaine de référence et ${d.rule.min_km} km la semaine signalée). Au-delà de +${d.rule.high_pct} %, le triangle passe au rouge.</p></div></header>
    ${rows.length ? `<div class="scroll">${table(["Semaine du", "Volume", `Moyenne des ${d.rule.window} sem. précédentes`, "Hausse"], rows)}</div>` : '<div class="empty">Aucune hausse rapide sur cette période.</div>'}</section>`;
}

// ───────── Répartition par catégorie : deux anneaux (nombre d'activités, kilomètres) ─────────
// En kilomètres, une séance ne compte que pour ses tours rapides ; le reste de la séance est compté en footing (voir stats.category_split).
const SPLIT_KEYS = ["footing", "trail", "course", "seance"];

function catSplit(d, body, { fam }) {
  const pies = [
    { title: "Nombre d'activités", data: d.count, fmt: v => fr(v), unit: "activités" },
    { title: "Kilomètres", data: d.km, fmt: v => `${fr(v, v >= 100 ? 0 : 1)} km`, unit: "km" },
  ].map(p => ({ ...p, keys: SPLIT_KEYS.filter(k => p.data[k] > 0), total: SPLIT_KEYS.reduce((s, k) => s + p.data[k], 0) }));
  if (!pies[0].total) { body.innerHTML = '<div class="empty">Aucune course classée sur cette sélection.<br>Classez vos courses depuis la page Séries.</div>'; return {}; }
  const pct = (v, t) => { const p = v / t * 100; return p > 0 && p < 1 ? "<1" : fr(p, 0); };
  body.innerHTML = `<div class="pies">${pies.map(p => `<figure class="pie"><figcaption>${p.title}</figcaption><div class="chart"><canvas></canvas></div>
    <ul class="pielist">${p.keys.map(k => `<li><i style="--c:${catColor(k)}"></i><span>${catName(k)}</span><b>${p.fmt(p.data[k])}</b><small>${pct(p.data[k], p.total)} %</small></li>`).join("")}</ul></figure>`).join("")}</div>`;
  body.querySelectorAll("canvas").forEach((cv, i) => {
    const p = pies[i];
    const center = { id: "centerTotal", afterDraw(chart) {       // le total au milieu de l'anneau
      const { ctx, chartArea: a } = chart, x = (a.left + a.right) / 2, y = (a.top + a.bottom) / 2;
      ctx.save(); ctx.textAlign = "center"; ctx.textBaseline = "middle";
      ctx.fillStyle = css("--ink"); ctx.font = `600 24px ${Chart.defaults.font.family}`; ctx.fillText(fr(p.total, i && p.total < 100 ? 1 : 0), x, y - 8);
      ctx.fillStyle = css("--ink-3"); ctx.font = `12px ${Chart.defaults.font.family}`; ctx.fillText(p.unit, x, y + 14);
      ctx.restore();
    } };
    charts.push(mk(cv, { type: "doughnut", plugins: [center], data: { labels: p.keys.map(catName), datasets: [{ data: p.keys.map(k => p.data[k]), backgroundColor: p.keys.map(catColor), borderColor: css("--surface"), borderWidth: 3, hoverOffset: 6 }] },
      options: { cutout: "64%", interaction: { mode: "nearest", intersect: true }, plugins: { tooltip: { callbacks: { label: c => ` ${c.label} : ${p.fmt(c.raw)} (${pct(c.raw, p.total)} %)` } } } } }));
  });
  const notes = [d.seance.no_fast ? `${d.seance.no_fast} séance${d.seance.no_fast > 1 ? "s" : ""} sans tour rapide détecté : ${d.seance.no_fast > 1 ? "leurs" : "ses"} km sont comptés en footing` : "",
    d.unclassified ? `${d.unclassified} course${d.unclassified > 1 ? "s" : ""} sans catégorie non comptée${d.unclassified > 1 ? "s" : ""}` : ""].filter(Boolean);
  return { sub: ["Séances : seuls les km des tours rapides comptent", ...notes].join(" · ") };
}

function catSplitTable(d, el) {
  const nT = SPLIT_KEYS.reduce((s, k) => s + d.count[k], 0), kT = SPLIT_KEYS.reduce((s, k) => s + d.km[k], 0), sh = (v, t) => t ? `${fr(v / t * 100, 0)} %` : "–";
  el.innerHTML = `<section class="card flush" style="margin-top:16px"><header class="card-h" style="padding:22px 22px 0"><div><h3>Détail</h3>
    <p class="sub">Séances : ${fr(d.seance.km, 1)} km au total, dont ${fr(d.seance.fast_km, 1)} km de tours rapides (comptés en séance). Les ${fr(Math.max(d.seance.km - d.seance.fast_km, 0), 1)} km d'échauffement, de récupération et de retour au calme sont comptés en footing.</p></div></header>
    <div class="scroll">${table(["Catégorie", "Activités", "Part", "Kilomètres", "Part"], SPLIT_KEYS.map(k => [`<span class="chip cat sm" style="--c:${catColor(k)}"><i></i>${catName(k)}</span>`, fr(d.count[k]), sh(d.count[k], nT), `${fr(d.km[k], 1)} km`, sh(d.km[k], kT)]))}</div></section>`;
}

// ───────── Allure / vitesse moyenne par mois ─────────
function paceTrend(d, body, { fam, big }) {
  const speed = isSpeedFamily(fam), vals = speed ? d.kmh : d.pace_s, c = familyColor(fam === "all" ? "run" : fam);
  const labels = big ? d.labels : d.labels.slice(-18), v = big ? vals : vals.slice(-18);
  const fmt = x => speed ? fr(x, 1) + " km/h" : mmss(x) + "/km";
  const known = v.filter(x => x != null), lo = Math.min(...known), hi = Math.max(...known), pad = (hi - lo) * 0.15 || 1, ymin = lo - pad, ymax = hi + pad;
  charts.push(mk(canvas(body), { type: "line", data: { labels, datasets: [{ data: v, borderColor: c, backgroundColor: fade(c, .2), fill: { target: { value: speed ? ymin : ymax } }, spanGaps: true, pointRadius: 3,   // on remplit jusqu'au bas de l'axe (l'axe d'allure est inversé)
     pointBackgroundColor: c, pointBorderColor: css("--surface"), pointBorderWidth: 2 }] },
    options: { scales: { x: axis.x({ ticks: { maxTicksLimit: big ? 12 : 6, callback(i) { return monthShort(this.getLabelForValue(i)); } } }),
      y: axis.y({ beginAtZero: false, reverse: !speed, min: ymin, max: ymax, width: 48, ticks: { callback: x => speed ? x : mmss(x) } }) },
      plugins: { tooltip: { displayColors: false, callbacks: { title: i => monthShort(labels[i[0].dataIndex]), label: x => fmt(x.raw) } } } } }));
  const last = v.filter(x => x != null);
  if (last.length < 2) return { sub: last.length ? "Allure du dernier mois : " + fmt(last[0]) : "" };
  const dlt = last.at(-1) - last.at(-2), better = speed ? dlt > 0 : dlt < 0;
  return { sub: `${fmt(last.at(-1))} ce mois-ci · <span class="${dlt === 0 ? "" : better ? "good" : "bad"}">${dlt === 0 ? "stable" : (speed ? (dlt > 0 ? "+" : "−") + fr(Math.abs(dlt), 1) + " km/h" : (dlt > 0 ? "+" : "−") + mmss(Math.abs(dlt)) + "/km")}</span> vs mois précédent` };
}

// ───────── Charge d'entraînement : forme, fatigue, fraîcheur ─────────
function loadChart(d, body, { big }) {
  const [h1, h2] = big ? [300, 140] : [170, 96];
  body.innerHTML = `<div class="mc"><div class="mc-h"><b><i style="--c:var(--ac)"></i>Forme et fatigue</b></div><div class="chart" style="height:${h1}px"><canvas></canvas></div></div>` +
    `<div class="mc"><div class="mc-h"><b><i style="--c:var(--good)"></i>Fraîcheur</b><span>Positive = reposé, négative = en charge</span></div><div class="chart" style="height:${h2}px"><canvas></canvas></div></div>`;
  const [c1, c2] = body.querySelectorAll("canvas"), ac = css("--ac"), ld = css("--load"), g = css("--good"), bad = css("--bad");
  const tick = { maxTicksLimit: 8, callback(v) { return dateShort(this.getLabelForValue(v)); } };
  const tt = { title: i => dateFr(d.labels[i[0].dataIndex]) };
  charts.push(mk(c1, { type: "line", data: { labels: d.labels, datasets: [
    { label: "Forme", data: d.ctl, borderColor: ac, backgroundColor: fade(ac, .18), fill: true },
    { label: "Fatigue", data: d.atl, borderColor: ld, borderWidth: 2 }] },
    options: { scales: { x: axis.x({ ticks: { ...tick, display: false } }), y: axis.y({}) }, plugins: { tooltip: { callbacks: { ...tt, label: c => ` ${c.dataset.label} : ${fr(c.raw, 1)}` } } } } }));
  charts.push(mk(c2, { type: "line", data: { labels: d.labels, datasets: [{ label: "Fraîcheur", data: d.tsb, borderColor: g, borderWidth: 2, fill: { target: "origin", above: alpha(g, .16), below: alpha(bad, .16) },
      segment: { borderColor: s => (s.p0.parsed.y + s.p1.parsed.y) / 2 < 0 ? bad : g } }] },
    options: { scales: { x: axis.x({ ticks: tick }), y: axis.y({ beginAtZero: false, ticks: { maxTicksLimit: 3 } }) }, plugins: { tooltip: { callbacks: { ...tt, label: c => ` Fraîcheur : ${c.raw > 0 ? "+" : ""}${fr(c.raw, 1)}` } } } } }));
  return { sub: `Sur toutes vos activités · ${d.acute} cette semaine, ${d.chronic} en moyenne sur 4 semaines`,
    aside: legend([["Forme", ac], ["Fatigue", ld]]) };
}

// ───────── Records ─────────
async function records(d, body) {
  const st = await api.stat("streaks", null).catch(() => null);
  if (!d.length) { body.innerHTML = '<div class="empty">Aucun record de course détecté.</div>'; return {}; }
  body.innerHTML = `<div class="recs">${d.map(e => { const km = { "1 km": 1, "5 km": 5, "10 km": 10, "Semi-marathon": 21.0975 }[e.label];
    return `<a class="rec" href="#/activity/${e.id}"><div><b>${e.label}</b><span>${dateFr(e.date)}</span></div><div><b>${mmss(e.time_s)}</b><span>${mmss(e.time_s / km)}/km</span></div></a>`; }).join("")}</div>
    ${st ? `<dl class="mini"><div><dd>${st.current} j</dd><dt>Série en cours</dt></div><div><dd>${st.longest} j</dd><dt>Plus longue série</dt></div><div><dd>${st.eddington}</dd><dt>Eddington</dt></div></dl>` : ""}`;
  return { sub: "Vos meilleurs segments, toutes sorties confondues" };
}

// ───────── Calendrier d'assiduité ─────────
function calendar(d, body, { fam, opts }) {
  const year = opts?.year && opts.year !== "12m" ? +opts.year : null;
  const by = new Map(d.map(x => [x.d, x.km])), vals = [...by.values()].filter(v => v > 0).sort((a, b) => a - b);
  const q = p => vals[Math.min(vals.length - 1, Math.floor(vals.length * p))] || 0, [q1, q2, q3] = [q(.25), q(.5), q(.75)];
  const lvl = v => !v ? "" : v <= q1 ? "l1" : v <= q2 ? "l2" : v <= q3 ? "l3" : "l4";
  const today = new Date(); today.setHours(12, 0, 0, 0);
  const end = year ? new Date(year, 11, 31, 12) : new Date(today);
  const start = year ? new Date(year, 0, 1, 12) : new Date(end);
  if (!year) start.setDate(end.getDate() - 364);
  start.setDate(start.getDate() - (start.getDay() + 6) % 7);
  const iso = x => `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  const cols = [`<div class="col days"><em></em>${["L", "", "M", "", "V", "", ""].map(l => `<em>${l}</em>`).join("")}</div>`];
  let active = 0, prevMonth = -1;
  for (const day = new Date(start); day <= end;) {
    const m = day.getMonth(), cells = [];
    const label = m !== prevMonth && day.getDate() <= 7 ? day.toLocaleDateString("fr-FR", { month: "short" }).replace(".", "") : "";
    if (label) prevMonth = m;
    for (let i = 0; i < 7; i++, day.setDate(day.getDate() + 1)) {
      if (day > end || day > today) { cells.push('<i style="visibility:hidden"></i>'); continue; }
      const k = iso(day), km = by.get(k) || 0; if (km) active++;
      cells.push(`<i class="${lvl(km)}" title="${dateFr(k)}${km ? ` · ${fr(km, 1)} km` : ""}"></i>`);
    }
    cols.push(`<div class="col"><em>${label}</em>${cells.join("")}</div>`);
  }
  body.innerHTML = `<div class="cal">${cols.join("")}</div><div class="cal-foot">Moins <i></i><i style="background:color-mix(in srgb,var(--ac) 28%,transparent)"></i><i style="background:color-mix(in srgb,var(--ac) 52%,transparent)"></i><i style="background:color-mix(in srgb,var(--ac) 76%,transparent)"></i><i style="background:var(--ac)"></i> Plus</div>`;
  body.querySelector(".cal").scrollLeft = year ? 0 : 1e5;
  return { sub: `${active} jours actifs ${year ? `en ${year}` : "sur les 12 derniers mois"}` };
}

// ───────── Cumul annuel ─────────
// Une couleur par année, stable d'une vue à l'autre (même année = même couleur) ; huit teintes, donc des années voisines ne se ressemblent jamais.
const YEAR_COLORS = {
  light: ["#4f46e5", "#0d9488", "#d97706", "#db2777", "#0ea5e9", "#7c3aed", "#16a34a", "#e11d48"],
  dark: ["#8f8aff", "#2dd4bf", "#fbbf24", "#f472b6", "#38bdf8", "#a78bfa", "#4ade80", "#fb7185"],
};
const yearColor = y => YEAR_COLORS[matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"][+y % 8];
const KEEP = 3;   // nombre d'années affichées par défaut

function cumulative(d, body, { big }) {
  const all = Object.keys(d).sort(), now = String(new Date().getFullYear());
  const years = big ? all : all.slice(-KEEP), recent = new Set(all.slice(-KEEP));
  const starts = [1, 32, 60, 91, 121, 152, 182, 213, 244, 274, 305, 335], M = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];
  charts.push(mk(canvas(body), { type: "line", data: { labels: Array.from({ length: 366 }, (_, i) => i + 1), datasets: years.map(y =>
      ({ label: y, data: d[y], borderColor: yearColor(y), borderWidth: y === now ? 3 : 2, order: y === now ? 0 : 1, hidden: big && !recent.has(y) })) },
    options: { scales: { x: axis.x({ ticks: { autoSkip: false, maxRotation: 0, callback: (v, i) => starts.includes(i + 1) ? (narrow() ? M[starts.indexOf(i + 1)][0].toUpperCase() : M[starts.indexOf(i + 1)]) : "" } }), y: axis.y({}) },
      plugins: { tooltip: { itemSort: (a, b) => b.raw - a.raw, callbacks: { title: i => new Date(2024, 0, +i[0].label).toLocaleDateString("fr-FR", { day: "numeric", month: "long" }), label: c => ` ${c.dataset.label} : ${fr(c.raw, 0)} km` } } } } }));
  const ch = charts.at(-1);

  if (!big) return { aside: legend(years.map(y => [y, yearColor(y)])), sub: `Distance cumulée depuis le 1er janvier · ${years.length} dernière${years.length > 1 ? "s" : ""} année${years.length > 1 ? "s" : ""}` };

  // Vue détaillée : une pastille par année (toutes les années de l'historique), les 5 dernières cochées au départ.
  const chips = `<div class="yrs">${years.map((y, i) => `<button type="button" class="yr" data-i="${i}" aria-pressed="${recent.has(y)}" style="--c:${yearColor(y)}"><i></i>${y}</button>`).join("")}</div>
    <div class="yrs-q"><button type="button" class="btn sm" data-q="5">5 dernières</button><button type="button" class="btn sm" data-q="3">3 dernières</button><button type="button" class="btn sm" data-q="all">Toutes</button></div>`;
  return { aside: chips, sub: "Distance cumulée depuis le 1er janvier · cliquez une ou plusieurs années pour les afficher ou les masquer",
    bind: card => {
      const btns = [...card.querySelectorAll(".yr[data-i]")];
      const sync = () => { btns.forEach(b => b.setAttribute("aria-pressed", ch.isDatasetVisible(+b.dataset.i))); ch.update(); };
      btns.forEach(b => b.onclick = e => { e.stopPropagation(); const i = +b.dataset.i; ch.setDatasetVisibility(i, !ch.isDatasetVisible(i)); sync(); });
      card.querySelectorAll(".yrs-q [data-q]").forEach(b => b.onclick = e => {
        e.stopPropagation();
        const n = b.dataset.q === "all" ? years.length : +b.dataset.q;
        years.forEach((y, i) => ch.setDatasetVisibility(i, i >= years.length - n));
        sync();
      });
    } };
}

// ───────── Totaux annuels ─────────
function yearly(d, body, { fam }) {
  const c = familyColor(fam === "all" ? "run" : fam), now = new Date().getFullYear();
  charts.push(mk(canvas(body), { type: "bar", data: { labels: d.map(y => y.year), datasets: [{ data: d.map(y => y.km), backgroundColor: d.map(y => y.year === now ? c : alpha(c, .4)), maxBarThickness: 56 }] },
    options: { layout: { padding: { top: 18 } }, scales: { x: axis.x({}), y: axis.y({ display: false }) },
      plugins: { barValues: { fmt: v => fr(v, 0) }, tooltip: { displayColors: false, callbacks: { label: x => `${fr(x.raw, 0)} km · ${d[x.dataIndex].n} sorties` } } } } }));
  return { sub: "Kilomètres par année" };
}

// ───────── Petites distributions (une seule couleur, la valeur max est mise en avant) ─────────
const dist = (labels, data, unit, c, fmtTitle, vals = true) => (d, body) => { charts.push(mk(canvas(body), { type: "bar", data: { labels: labels(d), datasets: [{ data: data(d), backgroundColor: highlightMax(data(d), c()), maxBarThickness: 36 }] },
  options: { layout: { padding: { top: 18 } }, scales: { x: axis.x({ ticks: { maxTicksLimit: 24, autoSkip: !!fmtTitle, callback(v) { const l = this.getLabelForValue(v); return fmtTitle ? fmtTitle(l, v) : narrow() ? String(l).replace(/ km$/, "") : l; } } }), y: axis.y({ display: false }) },
    plugins: { barValues: vals ? { fmt: v => fr(v, v % 1 ? 1 : 0) } : {}, tooltip: { displayColors: false, callbacks: { label: x => `${fr(x.raw, x.raw % 1 ? 1 : 0)} ${unit}` } } } } })); return {}; };

// ───────── Podium / lieux ─────────
function podium(d, body, { big }) {
  const keys = Object.keys(d);
  if (!keys.length) { body.innerHTML = '<div class="empty">Aucune sortie.</div>'; return {}; }
  body.innerHTML = `<ol class="rank">${keys.length === 1 ? "" : ""}${keys.map(f => `${keys.length > 1 ? `<h4>${familyLabel(f)}</h4>` : ""}${(big ? d[f] : d[f].slice(0, keys.length > 1 ? 3 : 5)).map((a, i) =>
    `<li><span class="n">${i + 1}</span><a href="#/activity/${a.id}"><b>${esc(a.name || "Sans titre")}</b><span>${dateFr(a.date)}</span></a><span class="km">${fr(a.km, 1)} km</span></li>`).join("")}`).join("")}</ol>`;
  return {};
}
async function places(d, body, { card, ids, big }) {
  const L = d.filter(x => x.name !== "Non localisé");
  if (L.length < 2) {   // pas de géolocalisation : on affiche plutôt les meilleures semaines
    const w = await api.stat("weekly", ids), tot = w.labels.map((l, i) => [l, Object.values(w.series).reduce((s, a) => s + a[i], 0)]).filter(x => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, big ? 25 : 5);
    if (!tot.length) { if (big) body.innerHTML = '<div class="empty">Aucun lieu enregistré : lancez python geocode.py.</div>'; else card.remove(); return {}; }
    body.innerHTML = `<ol class="rank">${tot.map(([l, km], i) => `<li><span class="n">${i + 1}</span><div><b>Semaine du ${dateShort(l)}</b><span>${new Date(l + "T12:00").getFullYear()}</span></div><span class="km">${fr(km, 1)} km</span></li>`).join("")}</ol>`;
    return { title: "Meilleures semaines" };
  }
  const max = Math.max(...L.map(x => x.km));
  body.innerHTML = `<div class="hbars">${L.slice(0, big ? 200 : 7).map(x => `<div class="hbar"><span>${esc(x.name)}</span><div class="t"><i style="width:${x.km / max * 100}%"></i></div><b>${fr(x.km, 0)} km</b></div>`).join("")}</div>`;
  return {};
}


// ───────── Versions détaillées : tableaux et records ─────────
const table = (head, rows) => `<table class="tbl stbl2"><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map(r => `<tr>${r.map(c => `<td>${c}</td>`).join("")}</tr>`).join("")}</tbody></table>`;

function effortsChart(d, body, { opts }) {
  const label = opts.dist || "5 km", list = d[label] || [];
  if (!list.length) { body.innerHTML = '<div class="empty">Aucun segment de cette distance détecté par Garmin sur cette sélection.</div>'; return {}; }
  const ac = css("--ac"), km = list[0].km, pk = s => `${mmss(s / km)}/km`;
  const pts = list.map(e => ({ x: new Date(e.date + "T12:00").getTime(), y: e.time_s, e }));
  let best = Infinity;
  const steps = pts.filter(p => p.y < best && (best = p.y, true));          // chaque point = un record battu
  const line = [...steps, { x: pts.at(-1).x, y: best, e: null }];             // l'escalier se prolonge jusqu'à la dernière séance
  const bestE = steps.at(-1).e;
  charts.push(mk(canvas(body), { type: "line", data: { datasets: [
    { label: "Séances", data: pts, showLine: false, pointRadius: 3.5, pointHoverRadius: 7, backgroundColor: alpha(ac, .4), borderColor: "transparent", order: 2 },
    { label: "Record", data: line, stepped: "after", borderColor: ac, borderWidth: 2.5, backgroundColor: ac, pointRadius: line.map(p => p.e ? 5 : 0), pointHoverRadius: 7, pointBorderColor: css("--surface"), pointBorderWidth: 2, order: 1 }] },
    options: { interaction: { mode: "nearest", intersect: true },
      onClick: (_, els, ch) => { if (els.length) { const p = ch.data.datasets[els[0].datasetIndex].data[els[0].index]; if (p.e) location.hash = `#/activity/${p.e.id}`; } },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; },
      scales: { x: { ...axis.x({}), type: "linear", ticks: { padding: 8, maxTicksLimit: 9, callback: v => new Date(v).toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }) } },
        y: axis.y({ beginAtZero: false, reverse: true, width: 56, ticks: { callback: mmss } }) },
      plugins: { tooltip: { displayColors: false, filter: i => i.raw.e, callbacks: { title: i => `${dateFr(i[0].raw.e.date)} · ${i[0].raw.e.name}`, label: c => `${mmss(c.raw.y)} (${pk(c.raw.y)})${c.datasetIndex ? " · record battu" : ""}` } } } } }));
  return { sub: `${list.length} segments de ${label} · record : ${mmss(best)} (${pk(best)}) le ${dateFr(bestE.date)} · cliquez un point pour ouvrir la séance`,
    aside: legend([["Chaque séance", alpha(ac, .55)], ["Record battu", ac]]) };
}

function effortsTable(d, el, { opts }) {
  const label = opts.dist || "5 km", list = d[label] || [];
  if (!list.length) { el.innerHTML = ""; return; }
  const km = list[0].km, pk = s => `${mmss(s / km)}/km`, link = e => `<a class="lnk-strong" href="#/activity/${e.id}">${esc(e.name || "Sans titre")}</a>`;
  const top = [...list].sort((a, b) => a.time_s - b.time_s).slice(0, 10);
  let best = Infinity, prev = null;
  const prog = list.filter(e => e.time_s < best && (best = e.time_s, true)).map(e => { const gain = prev == null ? null : prev - e.time_s; prev = e.time_s; return [e, gain]; }).reverse();
  el.innerHTML = `<div class="grid" style="margin-top:16px">
    <section class="card flush c6"><header class="card-h" style="padding:22px 22px 0;margin-bottom:12px"><div><h3>Les 10 meilleurs temps</h3><p class="sub">${label}</p></div></header>
      <div class="scroll">${table(["#", "Temps", "Allure", "Date", "Séance"], top.map((e, i) => [i + 1, `<b>${mmss(e.time_s)}</b>`, pk(e.time_s), dateFr(e.date), link(e)]))}</div></section>
    <section class="card flush c6"><header class="card-h" style="padding:22px 22px 0;margin-bottom:12px"><div><h3>Progression du record</h3><p class="sub">Chaque fois que le record a été battu</p></div></header>
      <div class="scroll" style="max-height:440px">${table(["Date", "Nouveau record", "Gain", "Séance"], prog.map(([e, g]) => [dateFr(e.date), `<b>${mmss(e.time_s)}</b>`, g == null ? "–" : `<span class="good">−${mmss(g)}</span>`, link(e)]))}</div></section></div>`;
}

function yearlyTable(d, el) {
  el.innerHTML = `<section class="card flush" style="margin-top:16px"><div class="scroll">${table(["Année", "Sorties", "Distance", "Temps", "Dénivelé", "Km par sortie"],
    [...d].reverse().map(y => [`<b>${y.year}</b>`, fr(y.n), `${fr(y.km, 0)} km`, hm(y.hours * 3600), `${fr(y.elev)} m`, y.n ? `${fr(y.km / y.n, 1)} km` : "–"]))}</div></section>`;
}

function paceTable(d, el, { fam }) {
  const speed = isSpeedFamily(fam), vals = speed ? d.kmh : d.pace_s, fmt = x => x == null ? "–" : speed ? `${fr(x, 1)} km/h` : `${mmss(x)}/km`;
  const rows = d.labels.map((l, i) => {
    const prev = vals.slice(0, i).reverse().find(x => x != null), x = vals[i], dl = x != null && prev != null ? x - prev : null, better = speed ? dl > 0 : dl < 0;
    return [monthShort(l), `<b>${fmt(x)}</b>`, dl == null || dl === 0 ? "–" : `<span class="${better ? "good" : "bad"}">${dl > 0 ? "+" : "−"}${speed ? fr(Math.abs(dl), 1) + " km/h" : mmss(Math.abs(dl)) + "/km"}</span>`];
  }).reverse();
  el.innerHTML = `<section class="card flush" style="margin-top:16px"><div class="scroll" style="max-height:480px">${table(["Mois", speed ? "Vitesse moyenne" : "Allure moyenne", "Évolution"], rows)}</div></section>`;
}

const yearOptions = ({ acts }) => [["12m", "12 derniers mois"], ...[...new Set(acts.map(a => a.date.slice(0, 4)))].sort().reverse().map(y => [y, y])];

// scope : "view" = filtres actifs, "sport" = sport seul (ignore la période), "none" = toutes activités
// detail : ce qui change dans la page #/stat/<id> — controls (menus propres à la carte ; backend: true = envoyé au serveur),
//          stat (nom ou fonction des contrôles), draw, scope, extra (contenu sous le graphique), page (page entièrement personnalisée)
export const SECTIONS = [
  { id: "week", title: "Cette semaine", span: fam => fam === "run" || fam === "all" ? 7 : 12, stat: "current_week", scope: "sport", draw: week,
    detail: { controls: [{ key: "w", type: "week" }] } },
  { id: "fit", title: "Niveau et forme du moment", span: 5, stat: "fitness", scope: "none", draw: fitness, when: fam => fam === "run" || fam === "all",
    detail: { title: "VO₂max et prédictions de course", page: formePage } },
  { id: "volume", title: "Volume hebdomadaire", span: 8, stat: "weekly", scope: "view", draw: volume,
    detail: { title: "Volume d'entraînement", stat: o => o.by === "month" ? "monthly" : "weekly", controls: [{ key: "by", label: "Regrouper par", options: [["week", "Semaine"], ["month", "Mois"]], def: "week" }] } },
  { id: "pace", title: fam => isSpeedFamily(fam) ? "Vitesse moyenne" : "Allure moyenne", span: 4, stat: "pace", scope: "view", draw: paceTrend, detail: { extra: paceTable } },
  { id: "catvol", title: "Volume par catégorie", span: 12, stat: "category_volume", scope: "view", draw: catVolume, when: fam => fam === "run",
    detail: { extra: catVolumeTable } },
  { id: "catsplit", title: "Répartition par catégorie", span: 12, stat: "category_split", scope: "view", draw: catSplit, when: fam => fam === "run",
    detail: { extra: catSplitTable } },
  { id: "load", title: "Charge d'entraînement", span: 8, stat: "load", scope: "none", draw: loadChart,
    detail: { controls: [{ key: "days", label: "Période", options: [[90, "3 mois"], [180, "6 mois"], [365, "1 an"], [730, "2 ans"]], def: 180, backend: true }] } },
  { id: "rec", title: "Records", span: 4, stat: "best_efforts", scope: "sport", draw: records, when: fam => fam === "run" || fam === "all",
    detail: { title: "Records de course", stat: "efforts", scope: "view", draw: effortsChart, extra: effortsTable,
      controls: [{ key: "dist", label: "Distance", options: [["1 km", "1 km"], ["5 km", "5 km"], ["10 km", "10 km"], ["Semi-marathon", "Semi-marathon"]], def: "5 km" }] } },
  { id: "cal", title: "Régularité", span: 12, stat: "calendar", scope: "sport", draw: calendar,
    detail: { controls: [{ key: "year", label: "Année", options: yearOptions, def: "12m" }] } },
  { id: "cum", title: "Cumul annuel", span: 6, stat: "cumulative", scope: "sport", draw: cumulative, detail: {} },
  { id: "year", title: "Totaux par année", span: 6, stat: "yearly", scope: "sport", draw: yearly, detail: { extra: yearlyTable } },
  { id: "dist", title: "Distance des sorties", span: 4, stat: "distances", scope: "view", draw: dist(d => d.labels, d => d.n, "sorties", () => css("--ac")) },
  { id: "dow", title: "Jours préférés", span: 4, stat: "weekday", scope: "view", draw: dist(d => d.days, d => d.n, "sorties", () => css("--ac")) },
  { id: "hour", title: "Heure de départ", span: 4, stat: "hour_of_day", scope: "view", draw: dist(d => d.labels, d => d.n, "sorties", () => css("--ac"), l => parseInt(l) % 3 === 0 ? l : "", false) },
  { id: "podium", title: "Plus longues sorties", span: 6, stat: "podium", scope: "view", draw: podium,
    detail: { controls: [{ key: "top", label: "Afficher", options: [[10, "10"], [25, "25"], [50, "50"]], def: 25, backend: true }] } },
  { id: "places", title: "Où vous bougez", span: 6, stat: "regions", scope: "view", draw: places,
    detail: { title: "Où vous bougez", stat: o => o.by === "country" ? "countries" : "regions",
      controls: [{ key: "by", label: "Regrouper par", options: [["region", "Région"], ["country", "Pays"]], def: "region" }, { key: "top", label: "Afficher", options: [[10, "10"], [25, "25"], [100, "Tous"]], def: 25, backend: true }] } },
];
