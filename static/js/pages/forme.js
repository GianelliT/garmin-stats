import { api } from "../api.js";
import { alpha, axis, fade, mk, timeTicks } from "../charts.js";
import { css, dateFr, fr, mmss } from "../format.js";

let charts = [];
export function destroyForme() { charts.forEach(c => c.destroy()); charts = []; }

const DIST = [["t5k", "5 km", 5], ["t10k", "10 km", 10], ["thalf", "Semi", 21.0975], ["tmarathon", "Marathon", 42.195]];
const COLOR = () => [css("--ac"), css("--cmp-c"), css("--cmp-b"), css("--cmp-d")];
const PERIODS = [["90", "3 mois"], ["180", "6 mois"], ["365", "1 an"], ["730", "2 ans"], ["all", "Tout"]];
const hms = s => { const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = Math.round(s % 60); return h ? `${h}:${String(m).padStart(2, "0")}:${String(x).padStart(2, "0")}` : `${m}:${String(x).padStart(2, "0")}`; };
const isoDaysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Page « Forme » : VO₂max et prédictions de course, historique complet (valeurs Garmin ou estimation calculée ici). */
export async function formePage(box) {
  const [g, est] = await Promise.all([api.garminFitness().catch(() => null), api.stat("fitness_history", null).catch(() => [])]);
  // Garmin ne publie une nouvelle VO₂max que de temps en temps : on reporte la dernière valeur connue d'un jour sur l'autre
  const carry = rows => { const last = {}; return rows.map(r => { for (const k of ["vo2", "t5k", "t10k", "thalf", "tmarathon"]) { if (r[k] != null) last[k] = r[k]; else if (last[k] != null) r[k] = last[k]; } return r; }); };
  const garmin = carry((g?.rows || []).map(r => ({ date: r.date, vo2: r.vo2max, t5k: r.t5k, t10k: r.t10k, thalf: r.thalf, tmarathon: r.tmarathon })));
  const estimate = est.map(r => ({ date: r.date, vo2: r.vdot, t5k: r.t5k, t10k: r.t10k, thalf: r.thalf, tmarathon: r.tmarathon }));
  if (!garmin.length && !estimate.length) {
    box.innerHTML = '<section class="card"><div class="empty">Pas encore de données de forme.<br>Pour les valeurs de votre montre : <code>python connect_sync.py --login</code>, puis Synchroniser.<br>Sinon, il faut quelques courses avec des meilleurs temps.</div></section>';
    return;
  }
  const state = { source: garmin.length ? "garmin" : "est", period: "365", changes: true };

  box.innerHTML = `<div class="ctl"><div class="seg" id="src" ${garmin.length && estimate.length ? "" : "hidden"}><button data-v="garmin">Valeurs Garmin</button><button data-v="est">Estimation</button></div>
      <div class="seg" id="per">${PERIODS.map(([v, l]) => `<button data-v="${v}">${l}</button>`).join("")}</div></div>
    <p class="sub" id="note"></p>
    <div class="grid" style="margin-top:14px"><section class="card flush c12"><dl class="kpis" id="kp"></dl></section>
      <section class="card c12"><header class="card-h"><div><h3>VO₂max</h3><p class="sub" id="vsub"></p></div></header><div class="chart"><canvas id="cv"></canvas></div></section>
      <section class="card c12"><header class="card-h"><div><h3>Prédictions de course</h3><p class="sub">Allure prédite au kilomètre pour chaque distance, survolez pour voir les temps</p></div><div class="legend" id="lg"></div></header><div class="chart"><canvas id="cp"></canvas></div></section>
      <section class="card flush c12"><header class="card-h" style="padding:22px 22px 0;margin-bottom:12px"><div><h3>Historique</h3><p class="sub" id="tsub"></p></div>
        <div class="actions"><label class="chk"><input type="checkbox" id="chg" checked> Masquer les jours sans changement</label><button type="button" class="btn sm" id="csv">Exporter en CSV</button></div></header><div class="scroll" id="tb"></div></section></div>`;
  const $ = s => box.querySelector(s);

  const rowsNow = () => {
    const all = state.source === "garmin" ? garmin : estimate, cut = state.period === "all" ? "0000" : isoDaysAgo(+state.period);
    return all.filter(r => r.date >= cut);
  };
  const first = (rows, k) => rows.find(r => r[k] != null)?.[k], last = (rows, k) => [...rows].reverse().find(r => r[k] != null)?.[k];

  function draw() {
    destroyForme();
    const rows = rowsNow(), C = COLOR();
    box.querySelectorAll("#src button").forEach(b => b.classList.toggle("on", b.dataset.v === state.source));
    box.querySelectorAll("#per button").forEach(b => b.classList.toggle("on", b.dataset.v === state.period));
    $("#note").textContent = state.source === "garmin" ? "Valeurs de votre montre, lues sur Garmin Connect à chaque synchronisation." : "Estimation calculée ici à partir de vos meilleurs temps récents (formules de Jack Daniels), pas celle de votre montre.";
    if (!rows.length) { $("#kp").innerHTML = ""; $("#tb").innerHTML = '<div class="empty">Aucune donnée sur cette période.</div>'; return; }

    // chiffres clés : valeur actuelle et évolution depuis le début de la période
    const vo = [last(rows, "vo2"), first(rows, "vo2")], dv = vo[0] != null && vo[1] != null ? vo[0] - vo[1] : null;
    const kp = [`<div class="kpi"><div><dd>${vo[0] != null ? fr(vo[0], 1) : "–"}</dd><dt>VO₂max</dt></div><span class="d ${dv == null || Math.abs(dv) < .05 ? "" : dv > 0 ? "up" : "down"}">${dv == null ? "" : Math.abs(dv) < .05 ? "stable sur la période" : `${dv > 0 ? "+" : "−"}${fr(Math.abs(dv), 1)} sur la période`}</span></div>`];
    DIST.forEach(([k, l]) => {
      const a = last(rows, k), b = first(rows, k), d = a != null && b != null ? a - b : null;
      kp.push(`<div class="kpi"><div><dd>${a != null ? hms(a) : "–"}</dd><dt>${l}</dt></div><span class="d ${d == null || Math.abs(d) < 1 ? "" : d < 0 ? "up" : "down"}">${d == null ? "" : Math.abs(d) < 1 ? "stable sur la période" : `${d < 0 ? "−" : "+"}${hms(Math.abs(d))} sur la période`}</span></div>`);
    });
    kp.push(`<div class="kpi"><div><dd style="font-size:20px">${dateFr(rows.at(-1).date)}</dd><dt>Dernière valeur</dt></div><span class="d">${rows.length} point${rows.length > 1 ? "s" : ""} sur la période</span></div>`);
    $("#kp").innerHTML = kp.join("");

    const labels = rows.map(r => r.date), ac = C[0], v2 = rows.map(r => r.vo2).filter(v => v != null), spread = v2.length ? Math.max(...v2) - Math.min(...v2) : 0;
    const tick = { maxTicksLimit: 10, ...timeTicks(labels) };
    const title = i => dateFr(labels[i[0].dataIndex]);
    $("#vsub").textContent = state.source === "garmin" ? "Mesurée par votre montre" : "Estimée d'après vos meilleurs segments des 4 derniers mois";
    charts.push(mk($("#cv"), { type: "line", data: { labels, datasets: [{ data: rows.map(r => r.vo2), borderColor: ac, backgroundColor: fade(ac, .2), fill: true, spanGaps: true, borderWidth: 2.5, tension: 0.1 }] },
      options: { scales: { x: axis.x({ ticks: tick }), y: axis.y({ beginAtZero: false, width: 44, ticks: { callback: v => fr(v, spread < 8 ? 1 : 0) } }) },
        plugins: { tooltip: { displayColors: false, callbacks: { title, label: c => `VO₂max : ${fr(c.raw, 1)}` } } } } }));

    $("#lg").innerHTML = DIST.map(([, l], i) => `<span><i style="--c:${C[i]}"></i>${l}</span>`).join("");
    charts.push(mk($("#cp"), { type: "line", data: { labels, datasets: DIST.map(([k, l, km], i) => ({ label: l, data: rows.map(r => r[k] != null ? r[k] / km : null), borderColor: C[i], spanGaps: true, borderWidth: 2.25, tension: .25 })) },
      options: { scales: { x: axis.x({ ticks: tick }), y: axis.y({ beginAtZero: false, reverse: true, width: 52, ticks: { callback: mmss } }) },
        plugins: { tooltip: { callbacks: { title, label: c => { const [, , km] = DIST[c.datasetIndex]; return ` ${c.dataset.label} : ${hms(c.raw * km)} (${mmss(c.raw)}/km)`; } } } } } }));

    // tableau : du plus récent au plus ancien ; on peut masquer les jours où rien n'a changé
    const key = r => [r.vo2, r.t5k, r.t10k, r.thalf, r.tmarathon].join("|");
    let list = [...rows].reverse();
    if (state.changes) list = list.filter((r, i, a) => i === a.length - 1 || key(r) !== key(a[i + 1]));
    $("#tsub").textContent = `${list.length} ligne${list.length > 1 ? "s" : ""}${state.changes && list.length < rows.length ? ` (sur ${rows.length} jours enregistrés)` : ""}`;
    $("#tb").innerHTML = `<div class="scroll" style="max-height:520px"><table class="tbl stbl2"><thead><tr><th>Date</th><th>VO₂max</th>${DIST.map(([, l]) => `<th>${l}</th>`).join("")}</tr></thead><tbody>${list.map(r =>
      `<tr><td>${dateFr(r.date)}</td><td>${r.vo2 != null ? fr(r.vo2, 1) : "–"}</td>${DIST.map(([k]) => `<td>${r[k] != null ? hms(r[k]) : "–"}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    $("#csv").onclick = () => {
      const csv = ["date;vo2max;5km_s;10km_s;semi_s;marathon_s", ...[...rows].map(r => [r.date, r.vo2, r.t5k, r.t10k, r.thalf, r.tmarathon].map(v => v == null ? "" : String(v).replace(".", ",")).join(";"))].join("\n");
      const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" })), download: `forme-${state.source}.csv` });
      a.click(); URL.revokeObjectURL(a.href);
    };
  }

  box.querySelector("#src").onclick = e => { const b = e.target.closest("button"); if (b) { state.source = b.dataset.v; draw(); } };
  box.querySelector("#per").onclick = e => { const b = e.target.closest("button"); if (b) { state.period = b.dataset.v; draw(); } };
  box.querySelector("#chg").onchange = e => { state.changes = e.target.checked; draw(); };
  draw();
}
