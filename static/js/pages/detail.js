import { api } from "../api.js";
import { alpha, axis, fade, mk } from "../charts.js";
import { CATS, SUB_HINT, WITH_SUB, catPills, serieHref, css, dateLong, esc, familyColor, fr, isSpeed, mmss, paceLabel, paceParts, ramp, speedParts, speedText, typeLabel } from "../format.js";
import { osmMap } from "../map.js";

let map, hl, marker, bounds, charts = [];
export function destroy() { map?.remove(); map = hl = marker = bounds = null; charts.forEach(c => c.destroy()); charts = []; }

const plural = (n, w) => `${n} ${w}${n > 1 ? "s" : ""}`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);
const smooth = (arr, w) => arr.map((_, i) => {
  let s = 0, n = 0;
  for (let j = Math.max(0, i - w); j <= Math.min(arr.length - 1, i + w); j++) if (arr[j] != null) { s += arr[j]; n++; }
  return n ? s / n : null;
});
const pct = (arr, p) => { const s = arr.filter(v => v != null).sort((a, b) => a - b); return s[Math.floor((s.length - 1) * p)]; };
const CHEV = d => `<svg viewBox="0 0 24 24"><path d="${d}"/></svg>`;

// ───────── Chiffres clés ─────────
const stat = ([l, v, u]) => `<div><dt>${l}</dt><dd>${v}${u ? `<small>${u}</small>` : ""}</dd></div>`;
function keyStats(a) {
  const [pv, pu] = paceParts(a), cad = a.avg_cadence;
  return [["Distance", fr(a.distance_m / 1000, 2), "km"], ["Durée", mmss(a.duration_s)], [paceLabel(a.type), pv, pu],
    ["FC moyenne", a.avg_hr ? Math.round(a.avg_hr) : "–", a.avg_hr ? "bpm" : ""], ["Dénivelé positif", Math.round(a.elevation_m || 0), "m"],
    cad ? ["Cadence", Math.round(cad), "spm"] : ["Calories", Math.round(a.calories || 0), "kcal"]];
}

// ───────── Kilomètre par kilomètre ─────────
function splitsCard(a, S, gps) {
  const sp = S.map(s => 1 / s.s), vmax = Math.max(...sp), vmin = Math.min(...sp), best = sp.indexOf(vmax), hasHr = S.some(s => s.hr);
  const w = v => vmax === vmin ? 100 : 30 + 70 * (v - vmin) / (vmax - vmin);
  const rows = S.map((s, i) => `<div class="sr ${i === best ? "best" : ""}" data-i="${i}"><span class="k">${s.km}</span><span class="p">${speedText(1000 / s.s, a.type)}</span>
    <div><div class="t" style="width:${w(sp[i])}%"></div></div><span class="hr">${s.hr ? Math.round(s.hr) : ""}</span></div>`).join("");
  return `<section class="card splits c4 ${gps ? "hh" : ""}"><header class="card-h"><div><h3>Kilomètre par kilomètre</h3><p class="sub">Plus rapide : km ${S[best].km} en ${speedText(1000 / S[best].s, a.type)}</p></div></header>
    <div class="srows"><div class="sr h"><span>Km</span><span>${paceLabel(a.type)}</span><span></span><span>${hasHr ? "FC" : ""}</span></div>${rows}</div></section>`;
}

// ───────── Tours (intervalles) ─────────
function lapsCard(a, gps) {
  const laps = a.laps, cad = laps.some(l => l.cad), pwr = laps.some(l => l.pwr), n = (v, f = Math.round) => v == null ? "–" : f(v);
  const head = ["Tour", "Distance", "Temps", paceLabel(a.type), "FC moy", "FC max", "D+", "D−"].concat(cad ? ["Cadence"] : [], pwr ? ["Puissance"] : []);
  const rows = laps.map(l => `<tr data-i="${l.n - 1}"><td>${l.n}</td><td>${n(l.dist, v => fr(v / 1000, 2) + " km")}</td><td>${n(l.time, mmss)}</td><td>${speedText(l.spd, a.type)}</td>
    <td>${n(l.hr)}</td><td>${n(l.hr_max)}</td><td>${n(l.up, v => Math.round(v) + " m")}</td><td>${n(l.down, v => Math.round(v) + " m")}</td>
    ${cad ? `<td>${n(l.cad)}</td>` : ""}${pwr ? `<td>${n(l.pwr, v => Math.round(v) + " W")}</td>` : ""}</tr>`).join("");
  return `<section class="card flush lapsc c12"><header class="card-h" style="padding:22px 22px 0;margin-bottom:12px"><div><h3>Tours</h3><p class="sub">${gps ? "Cliquez sur une ligne pour la voir sur la carte" : "Découpage de la séance"}</p></div></header>
    <div class="scroll"><table><thead><tr>${head.map(h => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></section>`;
}

// ───────── Zones de fréquence cardiaque ─────────
const ZC = i => `var(--z${i + 1})`;
function zonesCard(a) {
  const z = a.zones.map(v => v || 0), tot = z.reduce((x, y) => x + y, 0);
  if (!tot) return "";
  const max = Math.max(...z);
  return `<section class="card c6"><header class="card-h"><div><h3>Zones de fréquence cardiaque</h3><p class="sub">Temps passé à chaque intensité</p></div></header><div class="zrows">
    ${[4, 3, 2, 1, 0].map(i => `<div class="zr" style="--c:${ZC(i)}"><span class="z">Z${i + 1}</span><div class="t"><i style="width:${z[i] / max * 100}%"></i></div><span class="tm">${mmss(z[i])}</span><span class="pc">${Math.round(100 * z[i] / tot)} %</span></div>`).join("")}</div></section>`;
}
function effortCard(a) {
  const te = (v, c) => v == null ? "–" : `${fr(v, 1)}<span class="te" style="--c:${c}">${[1, 2, 3, 4, 5].map(i => `<i class="${v >= i - .5 ? "on" : ""}"></i>`).join("")}</span>`;
  const rows = [["FC max", a.max_hr ? `${a.max_hr} bpm` : null], ["Calories", a.calories ? `${Math.round(a.calories)} kcal` : null],
    ["Effet aérobie", a.aerobic_te != null ? te(a.aerobic_te, "var(--ac)") : null], ["Effet anaérobie", a.anaerobic_te != null ? te(a.anaerobic_te, "var(--load)") : null]].filter(r => r[1]);
  return rows.length ? `<section class="card c6"><header class="card-h"><div><h3>Effort</h3><p class="sub">Ce que la séance a demandé à votre corps</p></div></header><dl class="frow">${rows.map(([l, v]) => `<div class="fr"><dt>${l}</dt><dd>${v}</dd></div>`).join("")}</dl></section>` : "";
}

// ───────── Carte : tracé coloré par allure, km, survol ─────────
function drawRoute(T) {
  const idx = T.t.map((_, i) => i).filter(i => T.lat[i] != null);
  const sp = smooth(T.spd, 5), vals = idx.map(i => sp[i]).filter(s => s > 0.5).sort((x, y) => x - y);
  const lo = vals[Math.floor(vals.length * 0.1)] ?? 0, hi = vals[Math.floor(vals.length * 0.9)] ?? 1;
  const p = idx.map(i => [T.lat[i], T.lon[i]]);
  L.polyline(p, { color: css("--surface"), weight: 9, opacity: .95, lineCap: "round", lineJoin: "round" }).addTo(map);
  for (let j = 1; j < idx.length; j++) {
    const [i0, i1] = [idx[j - 1], idx[j]], n = ((sp[i1] ?? lo) - lo) / ((hi - lo) || 1);
    L.polyline([[T.lat[i0], T.lon[i0]], [T.lat[i1], T.lon[i1]]], { color: ramp(n), weight: 5, lineCap: "round" }).addTo(map);
  }
  const max = Math.floor((T.dist.filter(d => d != null).at(-1) || 0) / 1000);
  for (let k = 1; k <= Math.min(max, 100); k++) {
    const i = T.dist.findIndex(d => d != null && d >= k * 1000);
    if (i > 0 && T.lat[i] != null) L.marker([T.lat[i], T.lon[i]], { interactive: false, keyboard: false, icon: L.divIcon({ className: "", html: `<div class="kmpin">${k}</div>`, iconSize: [20, 20] }) }).addTo(map);
  }
  const dot = (pt, c) => L.circleMarker(pt, { radius: 8, color: "#fff", weight: 3, fillColor: c, fillOpacity: 1 }).addTo(map);
  dot(p[0], css("--good")); dot(p.at(-1), css("--ink"));
  bounds = L.polyline(p).getBounds().pad(0.12);
  map.fitBounds(bounds);
  hl = L.layerGroup().addTo(map);
}
function highlight(pts) {
  hl.clearLayers();
  if (!pts || pts.length < 2) return map.fitBounds(bounds);
  hl.addLayer(L.polyline(pts, { color: css("--ink"), weight: 12, opacity: .28, lineCap: "round" }));
  hl.addLayer(L.polyline(pts, { color: "#fff", weight: 7, lineCap: "round" }));
  map.fitBounds(L.polyline(pts).getBounds().pad(0.5), { maxZoom: 17 });
}
const ptsBetween = (T, f) => T.t.map((t, i) => [t, i]).filter(([t, i]) => T.lat[i] != null && f(i, t)).map(([, i]) => [T.lat[i], T.lon[i]]);

// ───────── Courbes alignées sur la distance ─────────
const crosshair = { id: "xh", beforeDatasetsDraw(chart) {
  const a = chart.tooltip?.getActiveElements?.();
  if (!a?.length) return;
  const { top, bottom } = chart.chartArea, c = chart.ctx;
  c.save(); c.strokeStyle = css("--line-2"); c.lineWidth = 1.5; c.beginPath(); c.moveTo(a[0].element.x, top); c.lineTo(a[0].element.x, bottom); c.stroke(); c.restore();
} };

function metricCharts(box, a, T, color) {
  const speed = isSpeed(a.type), labels = T.dist.map(d => d == null ? null : +(d / 1000).toFixed(3)), sp = smooth(T.spd, 4);
  const pv = sp.map(s => !s || s < 0.8 ? null : speed ? s * 3.6 : Math.min(1000 / s, 900)), has = k => T[k]?.some(v => v != null && v > 0);
  const avg = k => { const v = T[k].filter(x => x != null && x > 0); return v.reduce((s, x) => s + x, 0) / (v.length || 1); };
  const lo = pct(pv, .03), hi = pct(pv, .97), pad = (hi - lo) * .08;
  const alt = T.alt.filter(v => v != null), gain = alt.reduce((g, v, i) => i && v > alt[i - 1] ? g + v - alt[i - 1] : g, 0);
  const defs = [
    has("spd") && { label: paceLabel(a.type), color, data: pv, reverse: !speed, min: lo - pad, max: hi + pad,
      tick: v => speed ? v : mmss(v), fmt: v => speed ? `${fr(v, 1)} km/h` : `${mmss(v)}/km`, sub: `moyenne ${speedText(a.distance_m / a.duration_s, a.type)}` },
    has("hr") && { label: "Fréquence cardiaque", color: css("--hr"), data: smooth(T.hr, 2), tick: v => Math.round(v), fmt: v => `${Math.round(v)} bpm`, sub: `moyenne ${Math.round(avg("hr"))} · max ${Math.max(...T.hr.filter(v => v != null))} bpm` },
    has("alt") && { label: "Altitude", color: css("--elev"), data: T.alt, fill: true, tick: v => Math.round(v), fmt: v => `${Math.round(v)} m`, sub: `+${Math.round(a.elevation_m || gain)} m de dénivelé` },
    has("cad") && { label: "Cadence", color: css("--r1"), data: smooth(T.cad, 3), tick: v => Math.round(v), fmt: v => `${Math.round(v)} spm`, sub: `moyenne ${Math.round(avg("cad"))} spm` },
  ].filter(Boolean);
  box.innerHTML = defs.map((d, i) => `<div class="mc"><div class="mc-h"><b><i style="--c:${d.color}"></i>${d.label}</b><span>${d.sub}</span></div><div class="chart" style="height:${i === defs.length - 1 ? 148 : 118}px"><canvas></canvas></div></div>`).join("");
  const all = [];
  const move = (src, idx) => {
    all.forEach(c => {
      if (c === src) return;
      const e = c.getDatasetMeta(0).data[idx];
      if (!e || !Number.isFinite(e.y)) return;
      c.setActiveElements([{ datasetIndex: 0, index: idx }]);
      c.tooltip.setActiveElements([{ datasetIndex: 0, index: idx }], { x: e.x, y: e.y });
      c.update("none");
    });
    if (map && T.lat[idx] != null) {
      marker ??= L.circleMarker([0, 0], { radius: 8, color: "#fff", weight: 3, fillColor: css("--ink"), fillOpacity: 1, interactive: false });
      marker.setLatLng([T.lat[idx], T.lon[idx]]).addTo(map);
    }
  };
  const clear = () => { all.forEach(c => { c.setActiveElements([]); c.tooltip.setActiveElements([], { x: 0, y: 0 }); c.update("none"); }); marker?.remove(); };
  box.querySelectorAll("canvas").forEach((cv, i) => {
    const d = defs[i], last = i === defs.length - 1;
    const c = mk(cv, { type: "line", plugins: [crosshair], data: { labels, datasets: [{ data: d.data, borderColor: d.color, borderWidth: 2, spanGaps: true, fill: !!d.fill, backgroundColor: d.fill ? fade(d.color, .28) : undefined, tension: .25 }] },
      options: { onHover: (_, els, chart) => { if (els.length) move(chart, els[0].index); },
        scales: { x: axis.x({ ticks: { display: last, maxTicksLimit: 8, callback(v) { return fr(+this.getLabelForValue(v), 1) + " km"; } } }),
          y: axis.y({ beginAtZero: false, reverse: !!d.reverse, min: d.min, max: d.max, width: 52, ticks: { maxTicksLimit: 4, callback: d.tick } }) },
        plugins: { tooltip: { displayColors: false, callbacks: { title: it => fr(+labels[it[0].dataIndex], 2) + " km", label: x => d.fmt(x.raw) } } } } });
    cv.addEventListener("mouseleave", clear);
    all.push(c); charts.push(c);
  });
}


// ───────── Nom, tags et note personnels (enregistrés localement, jamais envoyés à Garmin) ─────────
const RELOAD = '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 0 1-15.5 6.2M3 12a9 9 0 0 1 15.5-6.2"/><path d="M18.5 2v4h-4M5.5 22v-4h4"/></svg>';
const PENCIL = '<svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const displayName = a => a.name || typeLabel(a.type);

/** Message d'enregistrement discret, partagé par les tags et la description. */
function saver(el) {
  let t;
  return (txt, bad) => { const n = el.querySelector("#saved"); if (!n) return; n.textContent = txt; n.className = "save" + (bad ? " err" : ""); clearTimeout(t); if (txt && !bad) t = setTimeout(() => { n.textContent = ""; }, 2200); };
}

// ───────── Catégorie (Course / Footing / Séance / Trail) et précisions, à côté du titre ─────────
function wireCategory(el, a, say) {
  const box = el.querySelector("#tagline");
  let cat = a.category || null, subs = [...(a.subtags || [])];
  const sync = () => { cat = a.category || null; subs = [...(a.subtags || [])]; };       // le serveur normalise l'écriture (10 x 400 -> 10x400)
  const save = async body => {
    say("Enregistrement…");
    try { Object.assign(a, await api.patchActivity(a.id, body)); sync(); say("Enregistré ✓"); }
    catch (e) { say("Échec : " + e.message, true); }
  };
  const catChip = () => `<span class="chip cat" style="--c:var(--cat-${cat})"><a href="${serieHref(cat)}" title="Toutes les séances « ${CATS[cat]} »"><i></i>${CATS[cat]}</a></span>`;
  const subChips = removable => subs.map(t => `<span class="chip"><a href="${serieHref(cat, t)}" title="Comparer toutes les séances « ${esc(t)} »">${esc(t)}</a>` +
    (removable ? `<button type="button" data-t="${esc(t)}" aria-label="Retirer ${esc(t)}">×</button>` : "") + "</span>").join("");

  const show = () => {
    box.innerHTML = cat
      ? catChip() + subChips(false) + (WITH_SUB.includes(cat) ? `<button type="button" class="tagadd" id="addsub" title="Ajouter une précision (10x400, piste, côte…)">${subs.length ? "+" : "+ précision"}</button>` : "") +
        `<button type="button" class="tagadd" id="catedit" title="Changer ou retirer la catégorie">modifier</button>`
      : (a.suggest ? `<span class="suggest"><span class="why">Suggestion :</span>${catPills(a.suggest.category, [], "")}<span class="why">(${esc(a.suggest.reason)})</span><button type="button" class="tagadd" id="accept" title="Classer cette séance en ${esc(CATS[a.suggest.category])}">Accepter</button></span>` : "") +
        `<button type="button" class="tagadd" id="catedit" title="Classer cette séance : course, footing, séance ou trail">+ catégorie</button>`;
    box.querySelector("#catedit").onclick = pick;
    box.querySelector("#accept")?.addEventListener("click", async () => { await save({ category: a.suggest.category }); show(); });
    box.querySelector("#addsub")?.addEventListener("click", editSubs);
  };

  const pick = () => {
    box.innerHTML = `<div class="pick"><div class="seg">${Object.entries(CATS).map(([k, v]) => `<button type="button" data-c="${k}" class="${cat === k ? "on" : ""}"><i style="--c:var(--cat-${k})"></i>${v}</button>`).join("")}</div>
      ${cat ? '<button type="button" class="tagadd" id="clear">Retirer</button>' : ""}<button type="button" class="tagadd" id="cancel">Annuler</button></div>`;
    box.querySelector("#cancel").onclick = show;
    box.querySelector("#clear")?.addEventListener("click", async () => { await save({ category: null }); show(); });
    box.querySelectorAll(".seg button").forEach(b => { b.onclick = async () => {
      const c = b.dataset.c;
      if (!WITH_SUB.includes(c)) { await save({ category: c }); return show(); }          // footing : pas de précision
      await save({ category: c, subtags: c === cat ? subs : [] });                       // changer de catégorie repart de zéro
      editSubs();
    }; });
  };

  // précisions : on en ajoute autant qu'on veut (Entrée ou virgule), chacune est enregistrée tout de suite.
  // Le champ de saisie reste le même et se vide aussitôt (on peut taper la suite sans attendre) ; les enregistrements se font l'un après l'autre.
  const editSubs = () => {
    let known = [];
    box.innerHTML = catChip() + '<span class="subchips"></span>' +
      `<input class="taginput" list="sublist" maxlength="60" autocomplete="off" aria-label="Nouvelle précision" placeholder="${SUB_HINT[cat]}"><datalist id="sublist"></datalist>
       <button type="button" class="tagadd" id="done">Terminer</button>`;
    const chips = box.querySelector(".subchips"), input = box.querySelector("input"), list = box.querySelector("#sublist");
    let queue = Promise.resolve();
    const run = fn => { queue = queue.then(fn).then(paint); return queue; };
    const paint = () => {
      chips.innerHTML = subChips(true);
      list.innerHTML = known.filter(x => !subs.includes(x.sub)).map(x => `<option value="${esc(x.sub)}">${x.count} séance${x.count > 1 ? "s" : ""}</option>`).join("");
      chips.querySelectorAll("button[data-t]").forEach(b => { b.onclick = () => run(() => save({ subtags: subs.filter(t => t !== b.dataset.t) })); });
      chips.querySelectorAll(".chip a").forEach((el, i) => { el.title = "Cliquer pour modifier"; el.onclick = e => { e.preventDefault(); rename(i); }; });
    };
    // modifier une précision en place (même position, même séance) sans la supprimer puis la recréer
    const rename = i => {
      const old = subs[i], chip = chips.children[i], inp = document.createElement("input");
      inp.className = "taginput"; inp.maxLength = 60; inp.value = old; inp.setAttribute("aria-label", "Modifier la précision");
      chip.replaceWith(inp); inp.focus(); inp.select();
      let done = false;
      const commit = ok => {
        if (done) return; done = true;
        const v = inp.value.trim().replace(/^#+/, "");
        if (ok && v && v !== old) run(() => save({ subtags: subs.map((t, j) => j === i ? v : t) })); else paint();
      };
      inp.onkeydown = e => {
        if (e.key === "Enter") { e.preventDefault(); commit(true); }
        else if (e.key === "Escape") { e.stopPropagation(); commit(false); }
      };
      inp.onblur = () => commit(true);
    };
    const add = () => {
      const items = input.value.split(",").map(t => t.trim().replace(/^#+/, "")).filter(Boolean);
      input.value = "";                                                                // vidé tout de suite : la suite de la frappe va dans un champ propre
      if (items.length) run(() => save({ subtags: [...subs, ...items] }));
      return items.length > 0;
    };
    input.onkeydown = e => {
      if (e.key === "Enter" || e.key === ",") { e.preventDefault(); if (!add() && e.key === "Enter") queue.then(show); }
      else if (e.key === "Escape") queue.then(show);
      else if (e.key === "Backspace" && !input.value && subs.length) run(() => save({ subtags: subs.slice(0, -1) }));
    };
    input.onchange = add;                                                              // choix dans les suggestions
    input.onblur = () => { if (input.value.trim()) add(); };                           // texte tapé puis clic ailleurs : on ne le perd pas
    box.querySelector("#done").onclick = () => queue.then(show);
    paint();
    input.focus();
    api.series().then(d => { known = d.categories.find(x => x.key === cat).subs; paint(); }).catch(() => {});   // suggestions : chargées sans bloquer la saisie
  };
  show();
}

// ───────── Description : du texte, modifiable à la demande ─────────
function wireNote(el, a, say) {
  const box = el.querySelector("#descr");
  const show = () => {
    box.innerHTML = a.note
      ? `<div class="descr-row"><p class="descr" id="notetext">${esc(a.note)}</p><button type="button" class="btn icon sm" id="noteedit" title="Modifier la description" aria-label="Modifier la description">${PENCIL}</button></div>`
      : `<button type="button" class="lnk-btn" id="noteedit">+ Ajouter une description</button>`;
    box.querySelector("#noteedit").onclick = edit;
    box.querySelector("#notetext")?.addEventListener("dblclick", edit);
  };
  const edit = () => {
    box.innerHTML = `<textarea id="note" rows="3" maxlength="5000" placeholder="Sensations, météo, matériel…" aria-label="Description">${esc(a.note || "")}</textarea>
      <div class="descr-actions"><button type="button" class="btn pri sm" id="notesave">Enregistrer</button><button type="button" class="btn sm" id="notecancel">Annuler</button><span class="hint">Ctrl + Entrée pour enregistrer</span></div>`;
    const ta = box.querySelector("#note"), grow = () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight + 2, 320) + "px"; };
    ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length); grow(); ta.oninput = grow;
    const save = async () => {
      const v = ta.value.trim();
      if (v !== (a.note || "")) { say("Enregistrement…"); try { Object.assign(a, await api.patchActivity(a.id, { note: v })); say("Enregistré ✓"); } catch (e) { say("Échec : " + e.message, true); return; } }
      show();
    };
    box.querySelector("#notesave").onclick = save;
    box.querySelector("#notecancel").onclick = show;
    ta.onkeydown = e => { if (e.key === "Escape") show(); else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } };
  };
  show();
}

let reloadNote = null;   // résultat du dernier rechargement, affiché après le réaffichage de la page
function wireReload(el, a) {
  const btn = el.querySelector("#reload"), msg = el.querySelector("#rlmsg");
  if (reloadNote?.id === a.id && Date.now() - reloadNote.t < 12000) { msg.textContent = reloadNote.text; msg.className = "sync-msg" + (reloadNote.bad ? " err" : ""); }
  btn.onclick = async () => {
    btn.disabled = true; btn.querySelector("svg").classList.add("spin"); msg.className = "sync-msg"; msg.textContent = "Téléchargement depuis Garmin…";
    try {
      const r = await api.reloadActivity(a.id);
      reloadNote = { id: a.id, t: Date.now(), text: r.laps ? `${r.laps} tour${r.laps > 1 ? "s" : ""} importé${r.laps > 1 ? "s" : ""}` : (r.points ? "Rechargé, mais le fichier Garmin ne contient aucun tour" : "Rechargé, mais Garmin n'a fourni aucune donnée détaillée") };
      dispatchEvent(new Event("datachange"));
    } catch (e) {
      reloadNote = null; btn.disabled = false; btn.querySelector("svg").classList.remove("spin");
      msg.className = "sync-msg err"; msg.textContent = e.message; msg.title = e.message;
    }
  };
}

function wireTitle(el, a) {
  const bar = el.querySelector("#titlebar"), orig = el.querySelector("#orig");
  const paint = () => {
    bar.querySelector("#title").textContent = displayName(a);
    orig.innerHTML = a.garmin_name && a.name !== a.garmin_name ? `Nom Garmin d'origine : ${esc(a.garmin_name)} · <button type="button" class="lnk" id="revert">Rétablir</button>` : "";
    const r = orig.querySelector("#revert");
    if (r) r.onclick = async () => { Object.assign(a, await api.patchActivity(a.id, { name: "" })); paint(); };
  };
  const edit = () => {
    const h1 = bar.querySelector("#title"), btn = bar.querySelector("#rename"), input = document.createElement("input");
    input.className = "title-input"; input.value = displayName(a); input.maxLength = 120; input.setAttribute("aria-label", "Nom de la séance");
    h1.replaceWith(input); btn.hidden = true; input.focus(); input.select();
    let done = false;
    const finish = async ok => {
      if (done) return;
      done = true;
      const v = input.value.trim();
      if (ok && v && v !== displayName(a)) { try { Object.assign(a, await api.patchActivity(a.id, { name: v })); } catch (e) { alert("Renommage impossible : " + e.message); } }
      const h = document.createElement("h1"); h.id = "title"; input.replaceWith(h); btn.hidden = false; paint();
    };
    input.onkeydown = e => { if (e.key === "Enter") finish(true); else if (e.key === "Escape") finish(false); };
    input.onblur = () => finish(true);
  };
  bar.querySelector("#rename").onclick = edit;
  bar.ondblclick = e => { if (e.target.id === "title") edit(); };
  paint();
}

export async function render(el, id) {
  const [a, acts] = await Promise.all([api.activity(id), api.activities()]);
  const meta = acts.find(x => x.id === a.id) || {}, T = a.track, S = a.splits || [], laps = a.laps || [];
  const gps = !!T?.lat?.some(v => v != null), fam = a.family || meta.family, color = familyColor(meta.family || "run");
  const sameFam = acts.filter(x => x.family === meta.family), i = sameFam.findIndex(x => x.id === a.id);
  const newer = sameFam[i - 1], older = sameFam[i + 1], nav = (x, d, t) => `<a class="btn icon" ${x ? `href="#/activity/${x.id}"` : 'aria-disabled="true"'} title="${t}" aria-label="${t}">${CHEV(d)}</a>`;
  const showLaps = laps.length > 1;   // toujours afficher les tours (même s'ils recoupent les kilomètres) ; un seul tour = toute la séance, rien à montrer
  const where = [meta.city, meta.region].filter(Boolean)[0];

  el.innerHTML = `<a href="#/activities" class="back">${CHEV("m15 18-6-6 6-6")}Activités</a>
    <header class="page"><div class="head"><div class="titlebar" id="titlebar"><h1 id="title"></h1><button type="button" class="btn icon" id="rename" title="Renommer la séance" aria-label="Renommer la séance">${PENCIL}</button><div class="tagline" id="tagline"></div></div>
      <p class="sub">${cap(dateLong(a.start_local))} à ${a.start_local.slice(11, 16)} · ${typeLabel(a.type)}${where ? " · " + esc(where) : ""}</p><p class="sub" id="orig"></p>
      <div id="descr"></div><span class="save" id="saved" role="status"></span></div>
      <div class="actions"><span class="sync-msg" id="rlmsg" role="status"></span>${nav(older, "m15 18-6-6 6-6", "Séance précédente")}${nav(newer, "m9 18 6-6-6-6", "Séance suivante")}<a class="btn" href="#/compare/${a.id}">Comparer</a>
        <button type="button" class="btn icon" id="reload" title="Recharger les données de cette séance depuis Garmin (tracé, kilomètres, tours)" aria-label="Recharger depuis Garmin">${RELOAD}</button></div></header>
    <div class="grid" style="--route:${color}">
      <section class="card flush c12"><dl class="stats">${keyStats(a).map(stat).join("")}</dl></section>
      ${gps ? `<section class="card flush map-card c${S.length ? 8 : 12} hh"><div id="map" class="map"></div><div class="maplegend">Lent<i></i>Rapide</div>
        <div class="mapbtns"><button class="btn" id="fit">Tout le parcours</button></div></section>` : ""}
      ${S.length ? splitsCard(a, S, gps) : ""}
      ${showLaps ? lapsCard(a, gps) : ""}
      ${T?.dist ? `<section class="card c12"><header class="card-h"><div><h3>Pendant la séance</h3><p class="sub">Survolez une courbe pour suivre le même instant sur la carte</p></div></header><div id="mc"></div></section>` : ""}
      ${zonesCard(a)}${effortCard(a)}
    </div>`;

  const say = saver(el); wireTitle(el, a); if (meta.family === "run") wireCategory(el, a, say); else el.querySelector("#tagline").remove(); wireNote(el, a, say); wireReload(el, a);
  if (gps) {
    map = osmMap("map", { scrollWheelZoom: false }); drawRoute(T);
    el.querySelector("#fit").onclick = () => { hl.clearLayers(); el.querySelectorAll(".sel").forEach(r => r.classList.remove("sel")); map.fitBounds(bounds); };
    map.on("click", () => map.scrollWheelZoom.enable());
  }
  if (T?.dist) metricCharts(el.querySelector("#mc"), a, T, color);

  // km : un clic met le kilomètre en évidence sur la carte (un second clic revient au parcours entier), comme pour les tours
  const rows = el.querySelector(".srows");
  const clearSel = () => el.querySelectorAll(".sel").forEach(x => x.classList.remove("sel"));
  if (rows && gps) {
    const seg = r => { const k = +r.dataset.i; return ptsBetween(T, i => T.dist[i] != null && T.dist[i] >= k * 1000 && T.dist[i] <= (k + 1) * 1000); };
    rows.addEventListener("click", e => {
      const r = e.target.closest(".sr[data-i]"); if (!r) return;
      const on = !r.classList.contains("sel");
      clearSel();
      if (on) r.classList.add("sel");
      highlight(on ? seg(r) : null);
    });
  }
  el.querySelector(".lapsc tbody")?.addEventListener("click", e => {
    const tr = e.target.closest("tr[data-i]");
    if (!tr) return;
    const on = !tr.classList.contains("sel");
    clearSel();
    if (on) tr.classList.add("sel");
    if (gps) { const lap = a.laps[+tr.dataset.i], end = lap.t0 + (lap.elapsed || lap.time || 0); highlight(on ? ptsBetween(T, (_, t) => t >= lap.t0 && t <= end) : null); }
  });
}