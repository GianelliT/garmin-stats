import { api } from "../api.js";
import { filterBar, matches, periodLabel, store } from "../filters.js";
import { SECTIONS, destroyCharts } from "./widgets.js";
import { dateShort, familyLabel, fr } from "../format.js";

let token = 0;
export function destroy() { token++; destroyCharts(); }

const CHEV = '<svg viewBox="0 0 24 24"><path d="m15 18-6-6 6-6"/></svg>';
const titleOf = (s, fam) => typeof s.title === "function" ? s.title(fam) : s.title;
const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const isEmpty = d => d == null || (Array.isArray(d) ? !d.length : "labels" in d ? !d.labels.length : !Object.keys(d).length);

/** Dimanche de la semaine décalée de `w` semaines (w ≤ 0) : sert à demander une semaine passée au serveur. */
function sundayOf(w) {
  const t = new Date(); t.setHours(12, 0, 0, 0);
  t.setDate(t.getDate() - (t.getDay() + 6) % 7 + 6 + 7 * w);
  return iso(t);
}

function controlsHtml(controls, opts, acts) {
  return controls.map(c => {
    if (c.type === "week") return `<div class="grp wknav"><button type="button" class="btn icon sm" data-w="-1" aria-label="Semaine précédente">${CHEV}</button><b id="wklabel">Cette semaine</b>
      <button type="button" class="btn icon sm" data-w="1" id="wknext" aria-label="Semaine suivante" style="transform:scaleX(-1)">${CHEV}</button><button type="button" class="btn sm" data-w="0">Cette semaine</button></div>`;
    const options = typeof c.options === "function" ? c.options({ acts }) : c.options;
    return `<div class="grp"><span>${c.label}</span>` + (options.length <= 5
      ? `<div class="seg" data-key="${c.key}">${options.map(([v, l]) => `<button type="button" data-v="${v}" class="${String(v) === String(opts[c.key]) ? "on" : ""}">${l}</button>`).join("")}</div>`
      : `<select data-key="${c.key}">${options.map(([v, l]) => `<option value="${v}" ${String(v) === String(opts[c.key]) ? "selected" : ""}>${l}</option>`).join("")}</select>`) + "</div>";
  }).join("");
}

/** Version détaillée d'une carte du dashboard : même dessin en plus grand, filtres, contrôles propres à la carte et tableaux. */
export async function render(el, id) {
  const base = SECTIONS.find(s => s.id === id);
  if (!base) { el.innerHTML = '<p class="msg">Statistique introuvable</p>'; return; }
  const spec = { ...base, ...base.detail }, controls = spec.controls || [];
  const acts = await api.activities(), fam = store.family, title = titleOf(spec, fam);
  const opts = Object.fromEntries(controls.filter(c => c.key).map(c => [c.key, c.type === "week" ? 0 : c.def]));
  const famText = fam === "all" ? "Tous les sports" : familyLabel(fam);

  el.innerHTML = `<a class="back" href="#/dashboard">${CHEV}Aperçu</a>
    <header class="page"><div><h1>${title}</h1><p class="sub" id="ctx">${famText}</p></div><div id="f"></div></header>
    <div class="stat-page">${spec.page ? '<div id="pg"></div>' : `${controls.length ? `<div class="ctl" id="ctl">${controlsHtml(controls, opts, acts)}</div>` : ""}
      <section class="card" id="card"><header class="card-h"><div><p class="sub" id="csub"></p></div><div class="aside" id="aside"></div></header><div class="body" id="body"></div></section><div id="extra"></div>`}</div>`;

  if (spec.page) { await spec.page(el.querySelector("#pg"), { acts, fam }); return; }
  const [ctx, card, body, extra, csub, aside] = ["#ctx", "#card", "#body", "#extra", "#csub", "#aside"].map(s => el.querySelector(s));
  let read = null;

  async function load() {
    const my = ++token;
    destroyCharts();
    const f = read ? read() : { family: fam === "all" ? "" : fam, period: "all" };
    const ids = acts.filter(a => matches(a, f)).map(a => a.id);
    ctx.textContent = spec.scope === "none" ? famText : `${famText} · ${periodLabel(f.period)} · ${fr(ids.length)} sortie${ids.length > 1 ? "s" : ""}`;
    const args = {};
    for (const c of controls) {
      if (c.type === "week" && opts.w < 0) args.today = sundayOf(opts.w);
      else if (c.backend) args[c.key] = opts[c.key];
    }
    const name = typeof spec.stat === "function" ? spec.stat(opts) : spec.stat;
    body.innerHTML = '<p class="msg">Chargement…</p>'; extra.innerHTML = ""; csub.textContent = ""; aside.innerHTML = "";
    try {
      const d = await api.stat(name, spec.scope === "none" ? null : ids, args);
      if (my !== token) return;
      if (isEmpty(d) && spec.id !== "places") { body.innerHTML = '<div class="empty">Pas de données pour cette sélection.</div>'; return; }
      const ctxArg = { fam, card, f, ids, big: true, opts, args };
      const r = (await spec.draw(d, body, ctxArg)) || {};
      if (my !== token) return;
      if (r.sub) csub.innerHTML = r.sub;
      if (r.aside) aside.innerHTML = r.aside;
      r.bind?.(card);
      if (d?.monday) el.querySelector("#wklabel").textContent = opts.w === 0 ? "Cette semaine" : `Semaine du ${dateShort(d.monday)}`;
      const nx = el.querySelector("#wknext"); if (nx) nx.disabled = opts.w >= 0;
      await spec.extra?.(d, extra, ctxArg);
    } catch (e) {
      console.error(e);
      if (my === token) body.innerHTML = `<div class="empty">Cette statistique n'a pas pu être chargée.<br>${e.message}<br>Redémarrez le serveur (python app.py).</div>`;
    }
  }

  const ctl = el.querySelector("#ctl");
  if (ctl) {
    ctl.addEventListener("click", e => {
      const w = e.target.closest("button[data-w]"), v = e.target.closest(".seg button[data-v]");
      if (w) { opts.w = +w.dataset.w === 0 ? 0 : Math.min(0, opts.w + +w.dataset.w); load(); }
      else if (v) { opts[v.parentElement.dataset.key] = v.dataset.v; v.parentElement.querySelectorAll("button").forEach(b => b.classList.toggle("on", b === v)); load(); }
    });
    ctl.addEventListener("change", e => { if (e.target.matches("select[data-key]")) { opts[e.target.dataset.key] = e.target.value; load(); } });
  }
  if (spec.scope !== "none") read = filterBar(el.querySelector("#f"), acts, () => load(), { search: false, period: spec.scope === "view" });
  await load();
}
