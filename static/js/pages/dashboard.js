import { api } from "../api.js";
import { stopSync, syncButton } from "../sync.js";
import { filterBar, matches, periodLabel, store } from "../filters.js";
import { SECTIONS, destroyCharts } from "./widgets.js";
import { familyLabel, fr, hm, isSpeedFamily, speedParts, typeForFamily } from "../format.js";

let token = 0;
export function destroy() { stopSync(); token++; destroyCharts(); }

// ───────── Bandeau de chiffres clés ─────────
const kpiList = (d, fam) => {
  const speed = isSpeedFamily(fam), [pv, pu] = speedParts(speed ? d.kmh / 3.6 : d.pace_s ? 1000 / d.pace_s : 0, typeForFamily(fam));
  return [["Distance", fr(d.km, 0), "km", d.km], ["Sorties", fr(d.n), "", d.n], ["Temps", hm(d.hours * 3600), "", d.hours],
    fam === "all" ? ["Distance moyenne", fr(d.n ? d.km / d.n : 0, 1), "km", null] : [speed ? "Vitesse moyenne" : "Allure moyenne", pv, pu, null],
    ["Dénivelé positif", fr(d.elev), "m", d.elev], ["Plus longue sortie", fr(d.longest, 1), "km", null]];
};
const CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 18 6-6-6-6"/></svg>';
const pct = (a, b) => b ? Math.round((a - b) / b * 100) : null;

export async function render(el) {
  const acts = await api.activities(), fam = store.family;
  el.innerHTML = `<header class="page"><div><h1>Aperçu</h1><p class="sub" id="ctx"></p></div><div class="actions"><div id="sync"></div><div id="f"></div></div></header>
    <div class="grid"><section class="card flush c12"><dl class="kpis" id="kpis"></dl></section><div id="secs" class="grid c12" style="padding:0"></div></div>`;
  const [ctx, kp, secs] = ["#ctx", "#kpis", "#secs"].map(s => el.querySelector(s));
  const list = SECTIONS.filter(s => !s.when || s.when(fam));
  secs.innerHTML = list.map(s => {
    const span = typeof s.span === "function" ? s.span(fam) : s.span, title = typeof s.title === "function" ? s.title(fam) : s.title;
    return `<section class="card c${span} link" id="w-${s.id}" data-id="${s.id}"><header class="card-h"><div><h3><a href="#/stat/${s.id}" title="Ouvrir le détail"><span class="t">${title}</span>${CHEVRON}</a></h3><p class="sub"></p></div><div class="aside"></div></header><div class="body"></div></section>`;
  }).join("");
  let read;
  secs.addEventListener("click", e => {   // toute la carte ouvre le détail, sauf ses liens et boutons internes
    const card = e.target.closest(".card.link");
    if (card && !e.target.closest("a, button, input, select")) location.hash = `#/stat/${card.dataset.id}`;
  });

  async function load() {
    const my = ++token;
    destroyCharts();
    const f = read(), ids = acts.filter(a => matches(a, f)).map(a => a.id);
    const sportIds = acts.filter(a => matches(a, { family: f.family })).map(a => a.id);
    ctx.textContent = `${fam === "all" ? "Tous les sports" : familyLabel(fam)} · ${periodLabel(f.period)} · ${fr(ids.length)} sortie${ids.length > 1 ? "s" : ""}`;

    const prevN = /^\d+$/.test(f.period) ? f.period : null;
    const prevIds = prevN ? acts.filter(a => matches(a, { family: f.family, period: "prev:" + prevN })).map(a => a.id) : null;
    Promise.all([api.stat("summary", ids), prevIds ? api.stat("summary", prevIds).catch(() => null) : null]).then(([d, p]) => {
      if (my !== token) return;
      const prev = p && p.n ? [p.km, p.n, p.hours, null, p.elev, null] : [];
      kp.innerHTML = kpiList(d, fam).map(([l, v, u, raw], i) => {
        const c = raw != null && prev[i] != null ? pct(raw, prev[i]) : null;
        return `<div class="kpi"><div><dd>${v}${u ? `<small>${u}</small>` : ""}</dd><dt>${l}</dt></div><span class="d">${c == null ? "" : `${c > 0 ? "+" : c < 0 ? "−" : ""}${Math.abs(c)} % vs période préc.`}</span></div>`;
      }).join("");
    }).catch(e => console.error(e));

    await Promise.all(list.map(async s => {
      const card = secs.querySelector(`#w-${s.id}`);
      try {
        const d = await api.stat(s.stat, s.scope === "none" ? null : s.scope === "sport" ? sportIds : ids);
        if (my !== token || !card.isConnected) return;
        const body = card.querySelector(".body"), empty = d == null || (Array.isArray(d) ? !d.length : "labels" in d ? !d.labels.length : !Object.keys(d).length);
        if (empty && s.id !== "fit" && s.id !== "places") { body.innerHTML = '<div class="empty">Pas de données pour cette sélection.</div>'; return; }
        card.querySelector("h3 .t").textContent = typeof s.title === "function" ? s.title(fam) : s.title;
        const r = (await s.draw(d, body, { fam, card, f, ids, opts: {} })) || {};
        if (my !== token) return;
        if (r.title) card.querySelector("h3 .t").textContent = r.title;
        if (r.sub) card.querySelector(".sub").innerHTML = r.sub;
        if (r.aside) card.querySelector(".aside").innerHTML = r.aside;
        r.bind?.(card);
      } catch (e) {   // une carte en erreur n'empêche pas les autres de s'afficher
        console.error(s.stat, e);
        if (my === token && card.isConnected) card.querySelector(".body").innerHTML = `<div class="empty">Cette statistique n'a pas pu être chargée.<br>${e.message}<br>Redémarrez le serveur (python app.py).</div>`;
      }
    }));
  }
  syncButton(el.querySelector("#sync"));
  read = filterBar(el.querySelector("#f"), acts, () => load(), { search: false });
  await load();
}
