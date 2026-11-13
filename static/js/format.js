/** Lit une variable CSS (couleurs du thème, y compris en mode sombre). */
export const css = n => getComputedStyle(document.documentElement).getPropertyValue(n).trim();

/** Échappe un texte saisi par l'utilisateur (nom, note, tag) avant de l'insérer dans du HTML. */
export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Classement d'une course : catégorie (Course, Footing, Séance, Trail) et, sauf pour Footing, une précision (10 km, 10x400, UTMB…). */
export const CATS = { course: "Course", footing: "Footing", seance: "Séance", trail: "Trail" };
export const WITH_SUB = ["course", "seance", "trail"];
/** Exemple de précision affiché dans le champ de saisie, selon la catégorie. */
export const SUB_HINT = { course: "ex. 10 km, semi", seance: "ex. 10x400, piste", trail: "ex. 42 km, UTMB" };
export const serieHref = (cat, sub) => `#/serie/${cat}${sub ? "/" + encodeURIComponent(sub) : ""}`;
/** Pastille de catégorie (avec sa couleur), suivie de la précision éventuelle. */
export const catPills = (cat, subs, cls = "sm") => !cat ? "" : `<span class="chip cat ${cls}" style="--c:var(--cat-${cat})"><i></i>${CATS[cat]}</span>${[].concat(subs || []).map(s => `<span class="chip ${cls}">${esc(s)}</span>`).join("")}`;

export const TYPE_LABELS = {
  running: "Course", trail_running: "Trail", treadmill_running: "Tapis de course", track_running: "Piste", virtual_run: "Course virtuelle", street_running: "Course",
  cycling: "Vélo", road_biking: "Vélo de route", mountain_biking: "VTT", indoor_cycling: "Vélo d'appartement", gravel_cycling: "Gravel",
  e_bike_mountain: "VTT électrique", e_bike_fitness: "Vélo électrique", walking: "Marche", hiking: "Randonnée",
  lap_swimming: "Natation", open_water_swimming: "Eau libre", swimming: "Natation", strength_training: "Musculation",
};
export const typeLabel = t => TYPE_LABELS[t] || (t || "?").replaceAll("_", " ").replace(/^./, c => c.toUpperCase());

export const FAMILIES = {
  run: { label: "Course" }, bike: { label: "Vélo" }, swim: { label: "Natation" },
  walk: { label: "Marche et rando" }, strength: { label: "Fitness" }, other: { label: "Autre" },
};
export const familyLabel = f => FAMILIES[f]?.label || f;
export const familyColor = f => css(`--sp-${FAMILIES[f] ? f : "other"}`);

const SPEED_TYPES = new Set(["cycling", "road_biking", "mountain_biking", "indoor_cycling", "gravel_cycling", "virtual_ride",
  "e_bike_fitness", "e_bike_mountain", "e_bike_road", "cyclocross", "track_cycling"]);
const SWIM_TYPES = new Set(["lap_swimming", "open_water_swimming", "swimming"]);
export const isSpeed = type => SPEED_TYPES.has(type);
export const isSpeedFamily = f => f === "bike";
/** Un type représentatif par famille, pour formater allure/vitesse au niveau « sport ». */
export const typeForFamily = f => ({ bike: "cycling", swim: "lap_swimming" })[f] || "running";

export const fr = (v, d = 0) => (v ?? 0).toLocaleString("fr-FR", { minimumFractionDigits: d, maximumFractionDigits: d });

export function mmss(s) {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), x = s % 60;
  return (h ? h + ":" + String(m).padStart(2, "0") : m) + ":" + String(x).padStart(2, "0");
}
export function hm(s) {
  s = Math.round(s || 0);
  const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60);
  return h ? `${h} h ${String(m).padStart(2, "0")}` : `${m} min`;
}

/** Vitesse (m/s) → [valeur, unité] selon le sport : min/km, km/h ou min/100 m. */
export function speedParts(ms, type) {
  if (!(ms > 0)) return ["–", ""];
  if (SPEED_TYPES.has(type)) return [fr(ms * 3.6, 1), "km/h"];
  if (SWIM_TYPES.has(type)) return [mmss(100 / ms), "/100 m"];
  return [mmss(1000 / ms), "/km"];
}
export const speedText = (ms, type) => { const [v, u] = speedParts(ms, type); return !u ? v : u[0] === "/" ? v + u : `${v} ${u}`; };
export const paceMs = a => a.distance_m > 0 && a.duration_s > 0 ? a.distance_m / a.duration_s : 0;
export const pace = a => speedText(paceMs(a), a.type);
export const paceParts = a => speedParts(paceMs(a), a.type);
export const paceLabel = type => SPEED_TYPES.has(type) ? "Vitesse" : "Allure";

const D = s => new Date(s.slice(0, 10) + "T12:00");
export const dateFr = s => D(s).toLocaleDateString("fr-FR", { day: "numeric", month: "short", year: "numeric" });
export const dateShort = s => D(s).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
export const dateLong = s => D(s).toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
export const monthLong = s => D(s + "-01").toLocaleDateString("fr-FR", { month: "long", year: "numeric" });
export const monthShort = s => D(s + "-01").toLocaleDateString("fr-FR", { month: "short", year: "2-digit" }).replace(".", "");

/** Rampe lent → rapide (même couleurs que la légende CSS). */
export function ramp(n) {
  const stops = [css("--r0"), css("--r1"), css("--r2")].map(h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)));
  const x = Math.min(1, Math.max(0, n)) * 2, i = Math.min(1, Math.floor(x)), t = x - i;
  return `rgb(${stops[i].map((c, k) => Math.round(c + (stops[i + 1][k] - c) * t)).join(",")})`;
}
