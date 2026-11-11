import { CATS, FAMILIES, esc, typeLabel } from "./format.js";

const ls = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* stockage indisponible */ } } };
/** Sport et période choisis : conservés d'une page à l'autre et d'une visite à l'autre. La course est le sport par défaut. */
export const store = { family: ls.get("g.family") || "run", period: ls.get("g.period") || "365" };
export function setFamily(f) { store.family = f; ls.set("g.family", f); dispatchEvent(new Event("sportchange")); }

const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const daysAgo = n => { const d = new Date(); d.setDate(d.getDate() - n); return iso(d); };

/** period : "30" "90" "365" (derniers jours), "prev:N" (les N jours d'avant), "ytd", "all" ou une année. */
function inPeriod(a, p) {
  if (!p || p === "all") return true;
  if (/^\d{4}$/.test(p)) return a.date.startsWith(p);
  if (p === "ytd") return a.date.startsWith(String(new Date().getFullYear()));
  if (p.startsWith("prev:")) { const n = +p.slice(5); return a.date >= daysAgo(2 * n) && a.date < daysAgo(n); }
  return a.date >= daysAgo(+p);
}
export const periodLabel = p => ({ 30: "30 derniers jours", 90: "3 derniers mois", 365: "12 derniers mois", ytd: "Cette année", all: "Depuis le début" })[p] || p;

const WHEN = { morning: h => h < 10, midday: h => h >= 10 && h < 15, afternoon: h => h >= 15 && h < 18, evening: h => h >= 18 };
const WHEN_OPTIONS = [["", "Toute la journée"], ["morning", "Matin (avant 10 h)"], ["midday", "Midi (10–15 h)"], ["afternoon", "Après-midi (15–18 h)"], ["evening", "Soir (après 18 h)"]];
const DOW = { wk: d => d < 5, we: d => d >= 5 };
const DOW_OPTIONS = [["", "Tous les jours"], ["wk", "En semaine"], ["we", "Le week-end"],
  ...["Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"].map((l, i) => [String(i), l])];
const SAVED = {};
/** Préremplit des filtres avant d'ouvrir la liste (ex. { cat: "none" } = courses sans catégorie). */
export const presetFilter = o => Object.assign(SAVED, o);

/** Une seule logique de filtre, partagée par le dashboard, la liste et la carte. */
export function matches(a, f) {
  const km = (a.distance_m || 0) / 1000, min = (a.duration_s || 0) / 60, h = +a.start_local.slice(11, 13);
  const dow = (new Date(a.date + "T12:00").getDay() + 6) % 7;
  const within = (v, lo, hi) => (!lo || v >= +lo) && (!hi || v <= +hi);
  return (!f.family || a.family === f.family) && (!f.type || a.type === f.type) && (!f.cat || (f.cat === "none" ? !a.category : a.category === f.cat)) && (!f.sub || (a.subtags || []).includes(f.sub)) && (!f.country || a.country === f.country) && (!f.region || a.region === f.region) &&
    inPeriod(a, f.period) && (!f.from || a.date >= f.from) && (!f.to || a.date <= f.to) &&
    within(km, f.dmin, f.dmax) && within(min, f.tmin, f.tmax) && within(a.elevation_m || 0, f.emin, f.emax) &&
    within(a.avg_hr || 0, f.hmin, f.hmax) && (!f.when || WHEN[f.when](h)) &&
    (!f.dow || (DOW[f.dow] ? DOW[f.dow](dow) : dow === +f.dow)) &&
    (!f.q || [a.name, a.note, CATS[a.category], ...(a.subtags || [])].join(" ").toLowerCase().includes(f.q.toLowerCase()));
}

// un clic en dehors referme le panneau de filtres avancés
addEventListener("click", e => document.querySelectorAll(".adv[open]").forEach(d => { if (!d.parentElement.contains(e.target) || e.target === d) d.open = false; }));
addEventListener("keydown", e => { if (e.key === "Escape") document.querySelectorAll(".adv[open]").forEach(d => { d.open = false; }); });

const ICON_FILTER = '<svg viewBox="0 0 24 24"><path d="M4 6h16M7 12h10M10 18h4"/></svg>';

/** Barre de filtres : recherche, période, filtres avancés. Le sport se choisit en haut de page.
 *  Appelle onChange(filtres) ; renvoie read() pour l'état courant.
 *  periodKey : donne à la page sa propre période mémorisée (sans toucher à celle des autres pages), defaultPeriod : sa valeur initiale. */
export function filterBar(el, activities, onChange, { search = true, period = true, periodKey = "", defaultPeriod = "365" } = {}) {
  const pkey = periodKey ? "g.period." + periodKey : "g.period";
  const fam = store.family === "all" ? "" : store.family;
  const inFam = activities.filter(a => !fam || a.family === fam);
  const years = [...new Set(activities.map(a => a.date.slice(0, 4)))].sort().reverse();
  const types = [...new Set(inFam.map(a => a.type))].sort();
  const subCount = {};      // précisions utilisées (10 km, 10x400…), les plus fréquentes d'abord
  inFam.forEach(a => (a.subtags || []).forEach(t => { const k = a.category + "|" + t; subCount[k] = (subCount[k] || 0) + 1; }));
  const subOptions = ["course", "seance"].map(c => [c, Object.keys(subCount).filter(k => k.startsWith(c + "|")).sort((x, y) => subCount[y] - subCount[x]).map(k => [k.slice(c.length + 1), subCount[k]])]).filter(g => g[1].length);
  const hasCats = !fam || fam === "run";
  const uniq = k => [...new Set(inFam.map(a => a[k]).filter(Boolean))].sort();
  const sel = (name, items) => `<select name="${name}">${items.map(([v, l]) => `<option value="${v}">${l}</option>`).join("")}</select>`;
  const range = (n, label, unit) => `<label>${label} (${unit})<span><input name="${n}min" type="number" min="0" placeholder="min"><input name="${n}max" type="number" min="0" placeholder="max"></span></label>`;
  const periods = [["30", "30 derniers jours"], ["90", "3 derniers mois"], ["365", "12 derniers mois"], ["ytd", "Cette année"], ["all", "Depuis le début"], ...years.map(y => [y, y])];
  el.innerHTML = `<div class="fbar">${search ? '<input name="q" type="search" placeholder="Rechercher (nom, note, tag)">' : ""}
    ${period ? sel("period", periods) : ""}
    <details class="adv"><summary>${ICON_FILTER}Filtres<b></b></summary><div class="advgrid">
      ${hasCats ? `<label>Catégorie${sel("cat", [["", "Toutes"], ...Object.entries(CATS), ["none", "Sans catégorie"]])}</label>
      <label>Précision<select name="sub"><option value="">Toutes</option>${subOptions.map(([c, items]) => `<optgroup label="${CATS[c]}">${items.map(([v, n]) => `<option value="${esc(v)}">${esc(v)} (${n})</option>`).join("")}</optgroup>`).join("")}</select></label>` : ""}
      <label>Type précis${sel("type", [["", "Tous"], ...types.map(t => [t, typeLabel(t)])])}</label>
      <label>Pays${sel("country", [["", "Tous"], ...uniq("country").map(c => [c, c])])}</label><label>Région${sel("region", [["", "Toutes"], ...uniq("region").map(c => [c, c])])}</label>
      <label>Du<input name="from" type="date"></label><label>Au<input name="to" type="date"></label>
      ${range("d", "Distance", "km")}${range("t", "Durée", "min")}${range("e", "Dénivelé", "m")}${range("h", "FC moyenne", "bpm")}
      <label>Moment${sel("when", WHEN_OPTIONS)}</label><label>Jour${sel("dow", DOW_OPTIONS)}</label>
      <div class="foot"><button type="button" class="btn reset">Réinitialiser</button></div></div></details></div>`;
  const fields = [...el.querySelectorAll("[name]")], badge = el.querySelector("summary b");
  fields.forEach(i => { const v = i.name === "period" ? (periodKey ? ls.get(pkey) : store.period) || defaultPeriod : SAVED[i.name]; if (v) i.value = v; if (i.name === "period" && !i.value) i.value = defaultPeriod; });
  const read = () => {
    const f = Object.fromEntries(fields.map(i => [i.name, i.value]));
    if (!period) f.period = "all";
    f.family = fam;
    if (period) { if (!periodKey) store.period = f.period; ls.set(pkey, f.period); }
    for (const i of fields) if (i.name !== "period") SAVED[i.name] = i.value;
    const n = fields.filter(i => i.closest(".advgrid") && i.value).length;
    badge.textContent = n || ""; badge.classList.toggle("n", n > 0);
    return f;
  };
  read();
  el.addEventListener("input", () => onChange(read()));
  el.querySelector(".reset").onclick = () => { fields.filter(i => i.closest(".advgrid")).forEach(i => { i.value = ""; }); onChange(read()); };
  return read;
}