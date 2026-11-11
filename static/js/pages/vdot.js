import { api } from "../api.js";
import { fr, mmss } from "../format.js";
import { wheelPicker } from "../wheel.js";

export function destroy() {}

/* ───────── Formules de Jack Daniels (mêmes que fitness.py) ───────── */
const MILE = 1609.344;
const vdotOf = (dm, ts) => {
  const t = ts / 60, v = dm / t;
  return (-4.60 + 0.182258 * v + 0.000104 * v * v) / (0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t));
};
/** Temps (s) qu'un coureur de cette VDOT met sur `dm` mètres (dichotomie, vdotOf décroît avec le temps). */
function timeFor(vdot, dm) {
  let lo = dm / 10, hi = dm / 0.8;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; vdotOf(dm, mid) > vdot ? lo = mid : hi = mid; }
  return (lo + hi) / 2;
}
/** Allure (s/km) à laquelle on consomme `frac` × VDOT de VO₂. */
function paceAt(vdot, frac) {
  const vo2 = vdot * frac + 4.60, a = 0.000104, b = 0.182258;
  const v = (-b + Math.sqrt(b * b + 4 * a * vo2)) / (2 * a);   // m/min
  return 60000 / v;
}

/* ───────── Données ───────── */
const DIST = [["400 m", 400], ["800 m", 800], ["1 000 m", 1000], ["1 200 m", 1200], ["1 500 m", 1500], ["1 600 m", 1600], ["1 mile", MILE], ["2 000 m", 2000], ["3 000 m", 3000], ["5 km", 5000], ["10 km", 10000],
  ["15 km", 15000], ["20 km", 20000], ["Semi", 21097.5], ["30 km", 30000], ["Marathon", 42195]];
DIST.sort((a, b) => a[1] - b[1]);
const EQUIV = ["1 500 m", "1 mile", "3 000 m", "5 km", "10 km", "15 km", "Semi", "Marathon"].map(l => DIST.find(d => d[0] === l));
const PACE_COLS = ["5 km", "10 km", "15 km", "20 km", "Semi", "30 km", "Marathon"].map(l => DIST.find(d => d[0] === l));
const VDOT_COLS = ["1 500 m", "5 km", "10 km", "Semi", "Marathon"].map(l => DIST.find(d => d[0] === l));

const ok = x => x > 0 && isFinite(x);
const km = m => m / 1000;
const hms = s => mmss(s);
const pace = s => ok(s) ? mmss(s) : "–";
const mile = s => ok(s) ? mmss(s * MILE / 1000) : "–";
const kmh = s => ok(s) ? fr(3600 / s, 1) : "–";
const dFmt = d => ok(d) ? String(+d.toFixed(4)).replace(".", ",") : "";

/** « 1:23:45 », « 23:45 », « 45 » (minutes) → secondes. */
function parseTime(str) {
  const p = String(str).trim().replace(/[hH'’]/g, ":").replace(/["″”s]/g, "").replace(/,/g, ".").split(":");
  if (p.length > 3 || p.some(x => x.trim() === "")) return null;
  const n = p.map(Number);
  if (n.some(x => !isFinite(x) || x < 0)) return null;
  const s = n.length === 1 ? n[0] * 60 : n.length === 2 ? n[0] * 60 + n[1] : n[0] * 3600 + n[1] * 60 + n[2];
  return ok(s) ? s : null;
}
/** « 10 », « 10,5 », « 400 m », « 1 mi » → kilomètres. */
function parseDist(str) {
  const m = String(str).trim().toLowerCase().replace(",", ".").match(/^(\d+(?:\.\d+)?)\s*(km|m|mi|mile|miles)?$/);
  if (!m) return null;
  const v = +m[1], u = m[2] || "km";
  const k = u === "km" ? v : u === "m" ? v / 1000 : v * MILE / 1000;
  return ok(k) ? k : null;
}

const FIELDS = ["dist", "time", "pace"];
const MAX_ROWS = 600;

export async function render(el) {
  const state = {
    v: { dist: 10, time: 3000, pace: 300 },   // km, s, s/km
    order: ["dist", "time"],                  // les deux derniers champs saisis : le troisième est calculé
    vdot: null, mode: "pace", step: 10, tstep: 0, tdist: 10000, custom: false,   // tstep 0 = pas automatique selon la distance
  };
  let mine = null;
  const solve = () => {
    const calc = FIELDS.find(k => !state.order.includes(k)), { dist, time, pace: p } = state.v;
    if (calc === "pace") state.v.pace = ok(dist) && ok(time) ? time / dist : null;
    else if (calc === "time") state.v.time = ok(dist) && ok(p) ? Math.round(dist * p) : null;
    else state.v.dist = ok(time) && ok(p) ? Math.round(time / p * 1000) / 1000 : null;
  };

  el.innerHTML = `<header class="page"><div><h1>Allures &amp; VDOT</h1><p class="sub">Convertissez temps, distance et allure, et retrouvez vos allures d'entraînement (méthode Jack Daniels)</p></div></header>
    <div class="grid">
      <section class="card c12"><header class="card-h"><div><h3>Convertisseur</h3><p class="sub">Renseignez deux champs, le troisième se calcule tout seul.</p></div>
        <div class="actions"><button type="button" class="btn sm" id="mine" hidden></button><button type="button" class="btn sm" id="reset">Réinitialiser</button></div></header>
        <div class="vd-fields">
          <div class="vd-f"><label for="in-dsel">Distance</label>
            <span class="vd-in"><select id="in-dsel">${DIST.map(([l, m]) => `<option value="${m}">${l}</option>`).join("")}<option value="custom">Personnalisée…</option></select></span>
            <span class="vd-in" id="dcustom" hidden><input id="in-dist" inputmode="decimal" autocomplete="off" placeholder="10" aria-label="Distance personnalisée"><em>km</em></span></div>
          <label>Temps<span class="vd-in"><input id="in-time" inputmode="numeric" autocomplete="off" placeholder="h:mm:ss"><em>h:mm:ss</em></span></label>
          <label>Allure<span class="vd-in"><input id="in-pace" inputmode="numeric" autocomplete="off" placeholder="m:ss"><em>/km</em></span></label>
        </div>
        <p class="sub" id="hint" style="margin-top:10px"></p></section>
      <section class="card flush c12"><dl class="kpis k4" id="kp"></dl></section>
      <section class="card c6"><header class="card-h"><div><h3>Temps équivalents</h3><p class="sub">Ce que vaut cette performance sur les autres distances</p></div>
        <label class="vd-vdot">VDOT<input id="in-vdot" inputmode="decimal" autocomplete="off"></label></header><div id="eq"></div></section>
      <section class="card c6"><header class="card-h"><div><h3>Allures d'entraînement</h3><p class="sub">Calculées d'après la VDOT, à ajuster selon le terrain et la météo</p></div></header><div id="tp"></div></section>
      <section class="card flush c12"><header class="card-h" style="padding:22px 22px 0;margin-bottom:12px"><div><h3>Tables de correspondance</h3><p class="sub" id="tsub"></p></div>
        <div class="actions" id="tctl"></div></header>
        <div class="vd-tabs"><div class="seg" id="mode"><button data-v="pace">Par allure</button><button data-v="time">Par temps</button><button data-v="vdot">Par VDOT</button></div></div>
        <div class="scroll vd-scroll" id="tb"></div></section>
    </div>`;
  const $ = s => el.querySelector(s);
  const input = { dist: $("#in-dist"), time: $("#in-time"), pace: $("#in-pace") };
  const vin = $("#in-vdot"), dsel = $("#in-dsel");

  const writeFields = except => {
    const val = { dist: dFmt(state.v.dist), time: ok(state.v.time) ? hms(state.v.time) : "", pace: ok(state.v.pace) ? pace(state.v.pace) : "" };
    for (const k of FIELDS) if (k !== except) input[k].value = val[k];
    syncDist();
  };
  /* le sélecteur de distance suit la valeur ; « Personnalisée » affiche le champ de saisie libre */
  const presetIdx = () => ok(state.v.dist) ? DIST.findIndex(([, m]) => Math.abs(m / 1000 - state.v.dist) < 1e-3) : -1;
  function syncDist() {
    const i = presetIdx();
    dsel.value = state.custom || i < 0 ? "custom" : String(DIST[i][1]);
    $("#dcustom").hidden = dsel.value !== "custom";
  }

  /* ───────── Affichage ───────── */
  function refresh() {
    const { dist, time, pace: p } = state.v, d = dist * 1000;
    const perf = ok(dist) && ok(time) && d >= 1000 && d <= 100000 && time >= 180 && time <= 18000 ? vdotOf(d, time) : null;
    if (perf) { state.vdot = perf; if (document.activeElement !== vin) vin.value = fr(perf, 1); }
    const v = state.vdot;

    const calc = FIELDS.find(k => !state.order.includes(k));
    $("#hint").textContent = ok(dist) && ok(time) && ok(p) ? `Calculé : ${{ dist: "distance", time: "temps", pace: "allure" }[calc]}.`
      : "Saisissez deux valeurs valides : par exemple une distance et un temps.";
    if (ok(dist) && ok(time) && !perf) $("#hint").textContent += " La VDOT n'est estimée que pour des efforts de 1 à 100 km, entre 3 min et 5 h.";

    const kp = (val, lab, d2 = "") => `<div class="kpi"><div><dd>${val}</dd><dt>${lab}</dt></div><span class="d">${d2}</span></div>`;
    $("#kp").innerHTML = [
      kp(kmh(p), "Vitesse (km/h)"),
      kp(mile(p), "Allure au mile (/mi)"),
      kp(ok(dist) ? fr(dist / (MILE / 1000), 2) : "–", "Distance en miles"),
      kp(perf ? fr(perf, 1) : "–", "VDOT de cette performance", perf ? "" : "hors plage"),
    ].join("");

    if (!v) { $("#eq").innerHTML = $("#tp").innerHTML = '<div class="empty">Entrez une distance et un temps pour calculer la VDOT.</div>'; }
    else {
      $("#eq").innerHTML = `<table class="tbl"><thead><tr><th>Distance</th><th>Temps</th><th>Allure /km</th></tr></thead><tbody>${EQUIV.map(([l, m]) => {
        const t = timeFor(v, m);
        return `<tr><td>${l}</td><td>${hms(t)}</td><td>${pace(t / km(m))}</td></tr>`;
      }).join("")}</tbody></table>`;
      const mp = timeFor(v, 42195) / 42.195;
      const rows = [["Facile (E)", paceAt(v, .74), paceAt(v, .65)], ["Marathon (M)", mp], ["Seuil (T)", paceAt(v, .88)], ["Intervalle (I)", paceAt(v, .98)], ["Répétition (R)", paceAt(v, 1.05)]];
      $("#tp").innerHTML = `<table class="tbl"><thead><tr><th>Allure</th><th>/km</th><th>/mile</th><th>400 m</th><th>1 000 m</th></tr></thead><tbody>${rows.map(([l, a, b]) => b
        ? `<tr><td>${l}</td><td>${pace(a)} – ${pace(b)}</td><td>${mile(a)} – ${mile(b)}</td><td>–</td><td>–</td></tr>`
        : `<tr><td>${l}</td><td>${pace(a)}</td><td>${mile(a)}</td><td>${hms(a * .4)}</td><td>${hms(a)}</td></tr>`).join("")}</tbody></table>`;
    }
    drawTable();
  }

  const nearest = (rows, target, f) => rows.reduce((best, r, i) => Math.abs(f(r) - target) < Math.abs(f(rows[best]) - target) ? i : best, 0);

  function drawTable() {
    const mode = state.mode, p = state.v.pace, v = state.vdot;
    el.querySelectorAll("#mode button").forEach(b => b.classList.toggle("on", b.dataset.v === mode));
    let head, rows, hl = -1;

    if (mode === "pace") {
      $("#tctl").innerHTML = `<div class="seg" id="step">${[1, 5, 10, 15, 30].map(s => `<button data-v="${s}" class="${state.step === s ? "on" : ""}">${s} s</button>`).join("")}</div>`;
      $("#tsub").textContent = "Temps de passage pour une allure constante, de 3:00 à 8:00 /km";
      const list = []; for (let s = 180; s <= 480; s += state.step) list.push(s);
      head = `<th>Allure /km</th><th>km/h</th><th>/mile</th>${PACE_COLS.map(([l]) => `<th>${l}</th>`).join("")}`;
      rows = list.map(s => `<td>${pace(s)}</td><td>${kmh(s)}</td><td>${mile(s)}</td>${PACE_COLS.map(([, m]) => `<td>${hms(s * km(m))}</td>`).join("")}`);
      if (ok(p) && p >= 180 - state.step && p <= 480 + state.step) hl = nearest(list, p, x => x);
    } else if (mode === "time") {
      const dm = state.tdist, d = DIST.find(x => x[1] === dm);
      $("#tctl").innerHTML = `<div class="seg" id="tstep">${[[0, "Auto"], [1, "1 s"], [5, "5 s"], [10, "10 s"], [30, "30 s"], [60, "1 min"]].map(([s, l]) => `<button data-v="${s}" class="${state.tstep === s ? "on" : ""}">${l}</button>`).join("")}</div>
        <select id="td" aria-label="Distance">${DIST.map(([l, m]) => `<option value="${m}" ${m === dm ? "selected" : ""}>${l}</option>`).join("")}</select>`;
      $("#tsub").textContent = `Allure nécessaire pour chaque temps sur ${d[0]}`;
      const step = state.tstep || (dm <= 1700 ? 5 : dm <= 3000 ? 10 : dm <= 5000 ? 30 : dm <= 10000 ? 60 : dm <= 21100 ? 120 : 300);
      const from = Math.ceil(timeFor(85, dm) / step) * step;   // niveau VDOT 85
      const to = Math.floor(dm / 1000 * 480 / step) * step;                                      // jusqu'à 8:00 /km
      const list = []; for (let t = Math.max(step, from); t <= to; t += step) list.push(t);
      head = `<th>Temps</th><th>Allure /km</th><th>/mile</th><th>km/h</th><th>VDOT</th>`;
      rows = list.map(t => { const vd = dm >= 1000 && t >= 180 && t <= 18000 ? vdotOf(dm, t) : null;
        return `<td>${hms(t)}</td><td>${pace(t / km(dm))}</td><td>${mile(t / km(dm))}</td><td>${kmh(t / km(dm))}</td><td>${vd ? fr(vd, 1) : "–"}</td>`; });
      if (ok(p)) hl = nearest(list, p * km(dm), x => x);
      // pas très fin sur une longue distance : on n'affiche qu'une fenêtre de lignes autour du temps saisi
      if (list.length > MAX_ROWS) {
        const start = Math.min(Math.max(0, (hl < 0 ? 0 : hl) - MAX_ROWS / 2), list.length - MAX_ROWS);
        rows = rows.slice(start, start + MAX_ROWS); hl = hl < 0 ? -1 : hl - start;
        $("#tsub").textContent += ` (${MAX_ROWS} lignes autour de votre temps)`;
      }
    } else {
      $("#tctl").innerHTML = "";
      $("#tsub").textContent = "Temps équivalents et allures d'entraînement pour chaque VDOT (30 à 85)";
      const list = []; for (let x = 30; x <= 85; x++) list.push(x);
      head = `<th>VDOT</th>${VDOT_COLS.map(([l]) => `<th>${l}</th>`).join("")}<th>Facile</th><th>Seuil</th><th>Intervalle</th>`;
      rows = list.map(x => `<td>${x}</td>${VDOT_COLS.map(([, m]) => `<td>${hms(timeFor(x, m))}</td>`).join("")}<td>${pace(paceAt(x, .65))}</td><td>${pace(paceAt(x, .88))}</td><td>${pace(paceAt(x, .98))}</td>`);
      if (v) hl = nearest(list, v, x => x);
    }
    $("#tb").innerHTML = `<table class="tbl vd-tbl"><thead><tr>${head}</tr></thead><tbody>${rows.map((r, i) => `<tr class="${i === hl ? "vd-hl" : ""}">${r}</tr>`).join("")}</tbody></table>`;
    const row = $("#tb .vd-hl"), box = $("#tb");
    if (row) box.scrollTop = Math.max(0, row.offsetTop - box.clientHeight / 2 + row.offsetHeight / 2);
  }

  /* ───────── Interactions ───────── */
  const touch = k => { state.order = [...state.order.filter(x => x !== k), k].slice(-2); solve(); if (!state.order.includes("dist")) state.custom = presetIdx() < 0; writeFields(k); refresh(); };
  input.dist.addEventListener("input", () => { state.custom = true; state.v.dist = parseDist(input.dist.value); touch("dist"); });
  input.time.addEventListener("input", () => { state.v.time = parseTime(input.time.value); touch("time"); });
  input.pace.addEventListener("input", () => { state.v.pace = parseTime(input.pace.value); touch("pace"); });
  for (const k of FIELDS) input[k].addEventListener("change", () => writeFields());   // « 45 » → « 45:00 » une fois la saisie terminée
  input.dist.addEventListener("keydown", e => { if (e.key === "Enter") input.time.focus(); });

  dsel.onchange = () => {
    if (dsel.value === "custom") { state.custom = true; syncDist(); input.dist.focus(); return; }
    state.custom = false; state.v.dist = +dsel.value / 1000; touch("dist");
    writeFields();   // le champ distance n'est pas saisi à la main ici : il faut l'afficher aussi
  };

  /* écrans tactiles : pas de clavier (il n'a pas de « : »), on ouvre des roues h / min / s */
  if (matchMedia("(pointer: coarse)").matches) {
    const WHEELS = {
      time: { title: "Temps", cols: [{ n: 24, label: "h" }, { n: 60, label: "min" }, { n: 60, label: "s" }], def: 1800,
        to: s => [Math.floor(s / 3600), Math.floor(s % 3600 / 60), Math.round(s % 60)], from: ([h, m, sec]) => h * 3600 + m * 60 + sec },
      pace: { title: "Allure /km", cols: [{ n: 30, label: "min" }, { n: 60, label: "s" }], def: 300,
        to: s => [Math.floor(s / 60), Math.round(s % 60)], from: ([m, sec]) => m * 60 + sec },
    };
    for (const k of ["time", "pace"]) {
      const w = WHEELS[k], inp = input[k];
      inp.readOnly = true; inp.inputMode = "none";
      inp.addEventListener("click", () => wheelPicker({
        title: w.title, cols: w.cols, value: w.to(ok(state.v[k]) ? state.v[k] : w.def),
        onDone: v => { state.v[k] = w.from(v) || null; touch(k); writeFields(); },
      }));
    }
  }
  $("#reset").onclick = () => { state.v = { dist: 10, time: 3000, pace: 300 }; state.order = ["dist", "time"]; state.custom = false; writeFields(); refresh(); };

  vin.addEventListener("input", () => {
    const x = parseFloat(vin.value.replace(",", "."));
    if (x >= 20 && x <= 90) { state.vdot = x; refresh(); }
  });
  vin.addEventListener("change", () => { if (state.vdot) vin.value = fr(state.vdot, 1); });

  $("#mode").onclick = e => { const b = e.target.closest("button"); if (b) { state.mode = b.dataset.v; drawTable(); } };
  $("#tctl").onclick = e => {
    const b = e.target.closest("#step button, #tstep button"); if (!b) return;
    if (b.parentElement.id === "step") state.step = +b.dataset.v; else state.tstep = +b.dataset.v;
    drawTable();
  };
  $("#tctl").onchange = e => { if (e.target.id === "td") { state.tdist = +e.target.value; drawTable(); } };

  // la forme estimée à partir des séances (calculée côté serveur) pré-remplit le convertisseur
  const useMine = () => {
    state.v = { dist: 10, time: mine.time, pace: null };
    state.order = ["dist", "time"]; state.custom = false; solve(); writeFields(); refresh();
  };
  $("#mine").onclick = useMine;

  solve(); writeFields(); refresh();
  try {
    // priorité à la prédiction 10 km de la montre ; à défaut, forme estimée par formule à partir des séances
    const [g, f] = await Promise.all([api.garminFitness().catch(() => null), api.stat("fitness", null).catch(() => null)]);
    const t10 = g?.race?.times?.t10k, b = $("#mine");
    if (ok(t10)) {
      mine = { time: Math.round(t10), vdot: vdotOf(10000, t10) };
      b.textContent = `Ma forme Garmin (10 km en ${hms(mine.time)})`;
    } else if (f?.vdot) {
      mine = { time: Math.round(timeFor(f.vdot, 10000)), vdot: f.vdot };
      b.textContent = `Ma forme estimée (VDOT ${fr(f.vdot, 1)})`;
    }
    if (mine) { b.hidden = false; b.title = `VDOT ${fr(mine.vdot, 1)}`; }
  } catch { /* pas de données de forme : le convertisseur reste utilisable seul */ }
}
