import { api } from "../api.js";
import { alpha, axis, mk } from "../charts.js";
import { CATS, SUB_HINT, WITH_SUB, catPills, css, dateFr, dateShort, esc, fr, isSpeed, mmss, serieHref } from "../format.js";
import { presetFilter, store } from "../filters.js";

const MAX = 5;   // séances comparables d'un coup
let charts = [];
export function destroy() { charts.forEach(c => c.destroy()); charts = []; }

const CHEV = '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>';
const PEN = '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const BIN = '<svg viewBox="0 0 24 24"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';
const plural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;

// ───────── Vue d'ensemble : les 4 catégories, leurs précisions, et ce qu'il reste à classer ─────────
async function index(el) {
  if (!["run", "all"].includes(store.family)) {
    el.innerHTML = `<header class="page"><div><h1>Séries</h1></div></header><section class="card"><div class="empty">Les séries (course, footing, séance, trail) concernent la course à pied.<br>Choisissez « Course » en haut de page.</div></section>`;
    return;
  }
  let [d, sg] = await Promise.all([api.series(), api.suggestions()]);
  const st = { q: "", all: false, allSugg: false };
  el.innerHTML = `<header class="page"><div><h1>Séries</h1><p class="sub" id="sub"></p></div><div class="actions"><input id="q" type="search" placeholder="Filtrer les précisions" aria-label="Filtrer les précisions"></div></header>
    <div class="grid" id="cats"></div><div id="sugg"></div><div id="todo"></div>`;
  const $ = s => el.querySelector(s);
  const reload = async () => { [d, sg] = await Promise.all([api.series(), api.suggestions()]); draw(); };
  const act = async fn => { try { await fn(); } catch (e) { alert(e.message); } await reload(); };

  // ───────── Suggestions : une catégorie évidente (trail, piste, tours rapides) à accepter en un clic ─────────
  function drawSugg() {
    const box = $("#sugg");
    if (!sg.length) { box.innerHTML = ""; return; }
    const shown = st.allSugg ? sg : sg.slice(0, 5);
    const by = Object.entries(sg.reduce((m, s) => (m[s.category] = (m[s.category] || 0) + 1, m), {})).map(([k, n]) => `${n} ${CATS[k]}`).join(" · ");
    box.innerHTML = `<section class="card todo"><header class="card-h"><div><h3>Suggestions de classement</h3><p class="sub">${plural(sg.length, "course")} avec une catégorie évidente · ${by}</p></div>
      <button type="button" class="btn pri sm" id="acceptall">Tout accepter (${sg.length})</button></header>
      ${shown.map(s => `<div class="lg" data-id="${s.id}"><span class="lgname"><a href="#/activity/${s.id}" title="Ouvrir la séance"><b>${esc(s.name)}</b></a><small>${dateFr(s.date)} · ${esc(s.reason)}</small></span>
        <div class="lgctl">${catPills(s.category, [], "sm")}</div><button type="button" class="btn sm" data-accept>Accepter</button></div>`).join("")}
      ${sg.length > 5 ? `<button type="button" class="lnk-btn more" id="moresugg">${st.allSugg ? "Réduire" : `Voir les ${sg.length - 5} autres`}</button>` : ""}</section>`;
    $("#moresugg")?.addEventListener("click", () => { st.allSugg = !st.allSugg; drawSugg(); });
    $("#acceptall").onclick = () => { if (confirm(`Classer ${plural(sg.length, "course")} comme proposé (${by}) ?\nVous pourrez modifier chaque classement depuis la séance.`)) act(() => api.acceptSuggestions(sg.map(s => s.id))); };
    box.querySelectorAll("[data-accept]").forEach(b => { b.onclick = () => act(() => api.acceptSuggestions([+b.closest(".lg").dataset.id])); });
  }

  function drawTodo() {
    const L = d.legacy, box = $("#todo");
    if (!L.length && !d.unclassified) { box.innerHTML = ""; return; }
    const shown = st.all ? L : L.slice(0, 5);
    box.innerHTML = `<section class="card todo"><header class="card-h"><div><h3>À classer</h3><p class="sub">${[L.length ? `${L.length} ancien${L.length > 1 ? "s" : ""} tag${L.length > 1 ? "s" : ""} à ranger dans une catégorie` : "", d.unclassified ? `${plural(d.unclassified, "course")} sans catégorie` : ""].filter(Boolean).join(" · ")}</p></div>
      ${d.unclassified ? '<button type="button" class="btn sm" id="seeun">Voir les courses sans catégorie</button>' : ""}</header>
      ${shown.map(l => `<div class="lg" data-tag="${esc(l.tag)}"><span class="lgname"><b>${esc(l.tag)}</b><small>${plural(l.count, "séance")}</small></span>
        <div class="lgctl"><div class="seg">${Object.entries(CATS).map(([k, v]) => `<button type="button" data-c="${k}">${v}</button>`).join("")}</div></div>
        <button type="button" class="btn sm ghost" data-ignore title="Ne pas garder cet ancien tag">Ignorer</button></div>`).join("")}
      ${L.length > 5 ? `<button type="button" class="lnk-btn more" id="moreleg">${st.all ? "Réduire" : `Voir les ${L.length - 5} autres`}</button>` : ""}</section>`;
    $("#seeun")?.addEventListener("click", () => { presetFilter({ cat: "none" }); location.hash = "#/activities"; });
    $("#moreleg")?.addEventListener("click", () => { st.all = !st.all; drawTodo(); });
    box.querySelectorAll(".lg").forEach(row => {
      const tag = row.dataset.tag;
      row.querySelector("[data-ignore]").onclick = () => { if (confirm(`Ignorer l'ancien tag « ${tag} » ?\nLes séances ne sont pas modifiées.`)) act(() => api.dropLegacy(tag)); };
      row.querySelectorAll(".seg button").forEach(b => { b.onclick = () => {
        const c = b.dataset.c;
        if (!WITH_SUB.includes(c)) return act(() => api.classify(tag, c));          // footing : pas de précision
        const ctl = row.querySelector(".lgctl");
        ctl.innerHTML = `<div class="lgedit"><span class="chip cat sm" style="--c:var(--cat-${c})"><i></i>${CATS[c]}</span><input maxlength="40" value="${esc(tag)}" aria-label="Précision" placeholder="${SUB_HINT[c]}" title="Plusieurs précisions possibles, séparées par des virgules"><button type="button" class="btn pri sm" data-ok>Classer</button><button type="button" class="btn sm ghost" data-cancel>Annuler</button></div>`;
        const input = ctl.querySelector("input"); input.focus(); input.select();
        const go = () => act(() => api.classify(tag, c, input.value));
        ctl.querySelector("[data-ok]").onclick = go;
        ctl.querySelector("[data-cancel]").onclick = drawTodo;
        input.onkeydown = e => { if (e.key === "Enter") go(); else if (e.key === "Escape") drawTodo(); };
      }; });
    });
  }

  function drawCats() {
    const q = st.q.trim().toLowerCase();
    $("#cats").innerHTML = d.categories.map(c => {
      const subs = c.subs.filter(s => !q || s.sub.includes(q));
      let body;
      if (!c.count) body = `<p class="catnote">Aucune séance classée pour l'instant.<br>Ouvrez une séance et choisissez sa catégorie à côté du titre.</p>`;
      else if (!WITH_SUB.includes(c.key)) body = `<p class="catnote">Les footings se comparent sur leur vitesse moyenne, sans précision.</p><a class="btn" href="${serieHref(c.key)}">Voir et comparer les footings</a>`;
      else body = `<ul class="sublist">${subs.map(s => `<li data-sub="${esc(s.sub)}"><a href="${serieHref(c.key, s.sub)}" title="Dernière séance le ${dateFr(s.last)}"><b>${esc(s.sub)}</b></a><span class="n">${s.count}</span><span class="acts"><button type="button" class="starbtn" data-ren="${esc(s.sub)}" title="Renommer ou fusionner" aria-label="Renommer ${esc(s.sub)}">${PEN}</button><button type="button" class="starbtn" data-del="${esc(s.sub)}" data-n="${s.count}" title="Retirer cette précision" aria-label="Retirer ${esc(s.sub)}">${BIN}</button></span></li>`).join("")}
          ${!q && c.nosub ? `<li class="nosub"><span>Sans précision</span><span class="n">${c.nosub}</span></li>` : ""}</ul>${q && !subs.length ? '<p class="catnote">Aucune précision ne correspond.</p>' : ""}`;
      return `<section class="card catcard" style="--c:var(--cat-${c.key})" data-cat="${c.key}"><header class="card-h"><div><h3><a href="${serieHref(c.key)}"><i class="dot"></i>${c.label}</a></h3>
        <p class="sub">${plural(c.count, "séance")}${c.last ? ` · dernière le ${dateFr(c.last)}` : ""}</p></div></header>${body}${c.count ? `<a class="more-link" href="${serieHref(c.key)}">Toutes les séances ›</a>` : ""}</section>`;
    }).join("");
    el.querySelectorAll("[data-del]").forEach(b => { b.onclick = () => { const cat = b.closest("[data-cat]").dataset.cat;
      if (confirm(`Retirer la précision « ${b.dataset.del} » de ${plural(+b.dataset.n, "séance")} ?\nElles restent dans la catégorie ${CATS[cat]}.`)) act(() => api.subDelete(cat, b.dataset.del)); }; });
    el.querySelectorAll("[data-ren]").forEach(b => { b.onclick = () => {
      const cat = b.closest("[data-cat]").dataset.cat, old = b.dataset.ren, li = b.closest("li");
      li.innerHTML = `<input maxlength="40" value="${esc(old)}" aria-label="Nouveau nom">`;
      const input = li.querySelector("input"); input.focus(); input.select();
      let done = false;
      const finish = ok => {
        if (done) return; done = true;
        const name = input.value.trim();
        if (!ok || !name || name.toLowerCase() === old) return drawCats();
        const clash = d.categories.find(x => x.key === cat).subs.some(s => s.sub !== old && s.sub === name.toLowerCase().replace(/\s+/g, " "));
        if (clash && !confirm(`« ${name} » existe déjà.\nFusionner « ${old} » dedans ? Leurs séances seront regroupées.`)) return drawCats();
        act(() => api.subRename(cat, old, name));
      };
      input.onkeydown = e => { if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); };
      input.onblur = () => finish(true);
    }; });
  }

  function draw() {
    const total = d.categories.reduce((n, c) => n + c.count, 0);
    $("#sub").textContent = total ? `${plural(total, "séance")} classée${total > 1 ? "s" : ""}` + (d.unclassified ? ` · ${plural(d.unclassified, "course")} à classer` : "") : "Classez vos courses en Course, Footing, Séance ou Trail pour les comparer";
    drawSugg(); drawTodo(); drawCats();
  }
  $("#q").oninput = e => { st.q = e.target.value; drawCats(); };
  draw();
}

// ───────── Une série : évolution, détail, tableau ─────────
export async function render(el, cat, subParam) {
  if (!cat) return index(el);
  let sub = subParam;
  try { sub = subParam && decodeURIComponent(subParam); } catch { /* déjà décodé */ }
  let data;
  try { data = await api.serie(cat, sub); } catch { el.innerHTML = '<p class="msg">Série introuvable</p>'; return; }
  const { label: catName, mode, sessions: S } = data;
  const avgOnly = mode === "average", splitMode = mode === "splits";      // footing : moyenne seule ; course et trail : km par km ; séance : tours
  const name = sub ? `${catName} · ${sub}` : catName;
  if (!S.length) {
    el.innerHTML = `<a class="back" href="#/series">${CHEV}Séries</a><header class="page"><div><h1>${esc(name)}</h1></div></header><section class="card"><div class="empty">Aucune séance dans cette série.</div></section>`;
    return;
  }

  const speed = isSpeed(S[0].type), hasEff = S.some(s => s.fast.length);
  const toVal = secKm => secKm ? (speed ? 3600 / secKm : secKm) : null;             // s/km -> valeur affichée (km/h pour le vélo)
  const fmt = v => v == null ? "–" : speed ? `${fr(v, 1)} km/h` : `${mmss(v)}/km`;
  const overall = s => s.distance_m > 0 ? s.duration_s / (s.distance_m / 1000) : null;
  const focus = s => hasEff ? s.fast_pace_s : overall(s);                             // allure de référence : les tours rapides pour un fractionné
  const focusHr = s => hasEff ? s.fast_hr : s.avg_hr;
  const label = hasEff ? (speed ? "Vitesse des tours rapides" : "Allure des tours rapides") : (speed ? "Vitesse moyenne" : "Allure moyenne");
  const withFocus = S.filter(s => focus(s));
  const best = withFocus.length ? withFocus.reduce((b, s) => focus(s) < focus(b) ? s : b) : null;
  const first = withFocus[0], last = withFocus.at(-1);
  const delta = first && last && first !== last ? focus(last) - focus(first) : null;  // négatif = plus rapide
  const stable = delta != null && Math.abs(delta) < focus(first) * 0.015;             // moins de 1,5 % d'écart : du bruit, pas une tendance
  const deltaTxt = delta == null ? "" : speed ? `${delta < 0 ? "+" : "−"}${fr(Math.abs(toVal(focus(last)) - toVal(focus(first))), 1)} km/h` : `${delta < 0 ? "−" : "+"}${mmss(Math.abs(delta))}/km`;
  const withTime = s => splitMode && sub && s ? ` · ${mmss(s.duration_s)}` : "";    // course sur une distance précise : le temps final compte
  const repTitle = splitMode ? "Kilomètre par kilomètre" : "Répétition par répétition";
  const how = hasEff ? " · tours rapides détectés automatiquement" : avgOnly ? " · comparés sur leur vitesse moyenne" : splitMode ? " · comparées kilomètre par kilomètre" : "";

  el.innerHTML = `<a class="back" href="#/series">${CHEV}Séries</a>
    <header class="page"><div><h1>${esc(name)}</h1><p class="sub">${plural(S.length, "séance")} · du ${dateFr(S[0].date)} au ${dateFr(S.at(-1).date)}${how}</p></div>
      <div class="actions">${S.length > 1 ? `<a class="btn" href="#/compare/${S[0].id}/${S.at(-1).id}">Première vs dernière</a>` : ""}<a class="btn pri" id="cmp" aria-disabled="true" title="Cochez de 2 à 5 séances dans le tableau">Comparer la sélection</a></div></header>
    <div class="grid">
      <section class="card flush c12"><dl class="kpis k4">
        <div class="kpi"><div><dd>${S.length}</dd><dt>${S.length > 1 ? "Séances" : "Séance"}</dt></div><span class="d"></span></div>
        <div class="kpi"><div><dd>${best ? fmt(toVal(focus(best))) : "–"}</dd><dt>Meilleure : ${label.toLowerCase()}</dt></div><span class="d">${best ? dateFr(best.date) + withTime(best) : ""}</span></div>
        <div class="kpi"><div><dd>${last ? fmt(toVal(focus(last))) : "–"}</dd><dt>Dernière séance</dt></div><span class="d">${last ? dateFr(last.date) + withTime(last) : ""}</span></div>
        <div class="kpi"><div><dd class="${delta == null || stable ? "" : delta < 0 ? "good" : "bad"}">${deltaTxt || "–"}</dd><dt>Depuis la première séance</dt></div><span class="d">${delta == null ? "Il faut au moins 2 séances" : stable ? "Stable" : delta < 0 ? "Vous allez plus vite" : "Plus lent qu'au début"}</span></div>
      </dl></section>
      <section class="card c${avgOnly ? 12 : 6}"><header class="card-h"><div><h3>Évolution</h3><p class="sub">${label} à chaque séance · cliquez un point pour l'ouvrir</p></div></header><div class="chart"><canvas id="evo"></canvas></div></section>
      ${avgOnly ? "" : `<section class="card c6"><header class="card-h"><div><h3>${repTitle}</h3><p class="sub" id="repsub"></p></div><div class="seg" id="mode" ${hasEff ? "" : "hidden"}><button data-m="fast">Tours rapides</button><button data-m="all">Tous les tours</button></div></header><div class="chart" id="repbox"><canvas id="rep"></canvas></div></section>`}
      <section class="card flush c12" id="tbl"></section>
    </div>`;

  // évolution dans le temps ; l'axe garde une amplitude minimale pour ne pas transformer 3 secondes d'écart en grosse variation
  const evo = S.map(s => toVal(focus(s))), known = evo.filter(v => v != null), lo = Math.min(...known), hi = Math.max(...known);
  const span = Math.max(hi - lo, speed ? 1.5 : 15), mid = (hi + lo) / 2;
  const dates = S.map(s => dateShort(s.date) + " " + s.date.slice(2, 4));
  const ac = css("--ac");
  charts.push(mk(el.querySelector("#evo"), { type: "line", data: { labels: dates, datasets: [{ data: evo, tension: 0.15, borderColor: ac, backgroundColor: ac, pointRadius: 5, pointHoverRadius: 7, pointBorderColor: css("--surface"), pointBorderWidth: 2, spanGaps: true }] },
    options: { onClick: (_, els) => { if (els.length) location.hash = `#/activity/${S[els[0].index].id}`; },
      onHover: (e, els) => { e.native.target.style.cursor = els.length ? "pointer" : "default"; },
      scales: { x: axis.x({ ticks: { maxTicksLimit: 8 } }), y: axis.y({ beginAtZero: false, reverse: !speed, width: 52, min: mid - span * 0.75, max: mid + span * 0.75, ticks: { callback: v => speed ? fr(v, 0) : mmss(v) } }) },
      plugins: { tooltip: { displayColors: false, callbacks: { title: i => `${dateFr(S[i[0].dataIndex].date)} · ${S[i[0].dataIndex].name}`, label: c => fmt(c.raw) + withTime(S[c.dataIndex]),
        afterLabel: c => { const s = S[c.dataIndex]; return [focusHr(s) ? `FC ${focusHr(s)} bpm` : "", s.note ? `« ${s.note.slice(0, 80)}${s.note.length > 80 ? "…" : ""} »` : ""].filter(Boolean); } } } } } }));

  if (!avgOnly) {
    // une ligne par séance, plus foncée quand elle est récente : tours (séance) ou kilomètres (course)
    const items = s => splitMode ? s.splits : s.laps, withItems = S.filter(s => items(s).length);
    const unit = splitMode ? "Km" : "Tour";
    const drawReps = view => {
      charts.filter(c => c.canvas.id === "rep").forEach(c => { c.destroy(); charts = charts.filter(x => x !== c); });
      const box = el.querySelector("#repbox");
      if (!withItems.length) { box.innerHTML = `<div class="empty">${splitMode ? "Pas de kilomètres enregistrés pour ces séances." : "Pas de tours enregistrés pour ces séances."}</div>`; el.querySelector("#repsub").textContent = ""; return; }
      box.innerHTML = '<canvas id="rep"></canvas>';
      const pick = s => splitMode ? s.splits.map(x => x.s > 0 ? toVal(x.s) : null)
        : (view === "fast" && hasEff ? s.laps.filter(l => s.fast.includes(l.n)) : s.laps).map(l => l.spd > 0 ? toVal(1000 / l.spd) : null);
      const sets = withItems.map(pick), n = Math.max(...sets.map(x => x.length), 1), k = withItems.length, word = splitMode ? "Kilomètre" : view === "fast" && hasEff ? "Répétition" : "Tour";
      el.querySelector("#repsub").textContent = `${word} n° en abscisse · plus la ligne est foncée, plus la séance est récente`;
      charts.push(mk(box.querySelector("canvas"), { type: "line", data: { labels: Array.from({ length: n }, (_, i) => i + 1), datasets: withItems.map((s, i) => {
          const r = k === 1 ? 1 : i / (k - 1);
          return { label: `${dateFr(s.date)} · ${s.name}`, data: sets[i], borderColor: alpha(ac, 0.22 + 0.78 * r), backgroundColor: alpha(ac, 0.22 + 0.78 * r), borderWidth: 1.5 + 1.8 * r, pointRadius: 2.5 + 1.5 * r, pointHoverRadius: 6, tension: 0.15, spanGaps: true };
        }) },
        options: { interaction: { mode: "nearest", intersect: false },
          scales: { x: axis.x({ ticks: { maxTicksLimit: 12 } }), y: axis.y({ beginAtZero: false, reverse: !speed, width: 52, ticks: { callback: v => speed ? fr(v, 0) : mmss(v) } }) },
          plugins: { tooltip: { callbacks: { title: i => `${word} ${i[0].label}`, label: c => ` ${c.dataset.label} : ${fmt(c.raw)}` } } } } }));
    };
    const segBtns = [...el.querySelectorAll("#mode button")];
    const setMode = m => { segBtns.forEach(b => b.classList.toggle("on", b.dataset.m === m)); drawReps(m); };
    segBtns.forEach(b => { b.onclick = () => setMode(b.dataset.m); });
    setMode(hasEff ? "fast" : "all");
  }

  // tableau triable + sélection de 2 à 5 séances à comparer
  const hhmm = s => s.start_local.slice(11, 16);
  const COLS = [
    { k: "date", l: "Date", v: s => s.start_local, f: s => `${dateFr(s.date)}<span class="muted"> · ${hhmm(s)}</span>` },
    { k: "name", l: "Séance", v: s => s.name.toLowerCase(), f: s => `<a class="lnk-strong" href="#/activity/${s.id}">${esc(s.name)}</a>` },
    ...(WITH_SUB.includes(cat) ? [{ k: "sub", l: "Précisions", v: s => s.subtags.join(" "), f: s => s.subtags.length ? s.subtags.map(t => `<span class="chip sm">${esc(t)}</span>`).join("") : '<span class="muted">–</span>' }] : []),
    { k: "dist", l: "Distance", v: s => s.distance_m, f: s => `${fr(s.distance_m / 1000, 2)} km` },
    { k: "dur", l: "Durée", v: s => s.duration_s, f: s => mmss(s.duration_s) },
    { k: "pace", l: speed ? "Vitesse" : "Allure", v: overall, f: s => fmt(toVal(overall(s))), best: !hasEff },
    { k: "hr", l: "FC moy.", v: s => s.avg_hr, f: s => s.avg_hr ? `${Math.round(s.avg_hr)} bpm` : "–" },
    ...(hasEff ? [
      { k: "nfast", l: "Tours rapides", v: s => s.fast.length, f: s => s.fast.length || "–" },
      { k: "fpace", l: speed ? "Vitesse tours rapides" : "Allure tours rapides", v: s => s.fast_pace_s, f: s => fmt(toVal(s.fast_pace_s)), best: true },
      { k: "fhr", l: "FC tours rapides", v: s => s.fast_hr, f: s => s.fast_hr ? `${s.fast_hr} bpm` : "–" }] : []),
    { k: "note", l: "Note", v: s => s.note.toLowerCase(), f: s => s.note ? `<span class="trunc" title="${esc(s.note)}">${esc(s.note)}</span>` : "" },
  ];
  let sort = { k: "date", dir: -1 }, sel = [];
  const cmp = el.querySelector("#cmp");
  const updateCmp = () => {
    const ok = sel.length >= 2, picked = S.filter(s => sel.includes(s.id));   // de la plus ancienne (A) à la plus récente
    cmp.setAttribute("aria-disabled", !ok);
    cmp.href = ok ? `#/compare/${picked.map(s => s.id).join("/")}` : "#";
    cmp.textContent = ok ? `Comparer les ${picked.length} séances` : sel.length === 1 ? "Cochez au moins une 2ᵉ séance" : "Comparer la sélection";
  };
  const drawTable = () => {
    const col = COLS.find(c => c.k === sort.k), key = s => { const v = col.v(s); return v == null || v === "" ? null : v; };
    const rows = [...S].sort((p, q) => { const a = key(p), b = key(q); return a == null ? 1 : b == null ? -1 : (a < b ? -1 : a > b ? 1 : 0) * sort.dir; });
    el.querySelector("#tbl").innerHTML = `<div class="scroll"><table class="stbl"><thead><tr><th class="ck"></th>${COLS.map(c => `<th data-k="${c.k}" class="${c.k === sort.k ? "sorted" : ""}" aria-sort="${c.k === sort.k ? (sort.dir > 0 ? "ascending" : "descending") : "none"}"><button type="button">${c.l}<i>${c.k === sort.k ? (sort.dir > 0 ? "▲" : "▼") : ""}</i></button></th>`).join("")}</tr></thead>
      <tbody>${rows.map(s => `<tr class="${sel.includes(s.id) ? "sel" : ""}"><td class="ck"><input type="checkbox" data-id="${s.id}" ${sel.includes(s.id) ? "checked" : ""} aria-label="Sélectionner la séance du ${dateFr(s.date)}"></td>
        ${COLS.map(c => `<td>${c.f(s)}${c.best && best === s ? '<span class="pill-rec">Record</span>' : ""}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
    el.querySelectorAll("#tbl th[data-k] button").forEach(b => { b.onclick = () => { const k = b.parentElement.dataset.k; sort = { k, dir: sort.k === k ? -sort.dir : (k === "date" || k === "name" || k === "note" ? -1 : 1) }; drawTable(); }; });
    el.querySelectorAll("#tbl input[type=checkbox]").forEach(c => { c.onchange = () => {
      const id = +c.dataset.id;
      sel = c.checked ? [...sel, id].slice(-MAX) : sel.filter(x => x !== id);       // au plus 5 : une 6e coche remplace la plus ancienne
      updateCmp(); drawTable();
    }; });
  };
  cmp.onclick = e => { if (cmp.getAttribute("aria-disabled") === "true") e.preventDefault(); };
  updateCmp(); drawTable();
}
