import { css, dateShort, monthShort } from "./format.js";

/** Ajoute de la transparence à une couleur hex #rrggbb. */
export const alpha = (hex, a) => hex.length === 7 ? hex + Math.round(a * 255).toString(16).padStart(2, "0") : hex;

/** Dégradé vertical sous une courbe (à passer en backgroundColor). */
export const fade = (color, top = 0.22) => ({ chart }) => {
  const a = chart.chartArea;
  if (!a) return "transparent";
  const g = chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
  g.addColorStop(0, alpha(color, top)); g.addColorStop(1, alpha(color, 0));
  return g;
};

/** Écrit la valeur au-dessus de chaque barre (option plugins.barValues = { fmt }). */
const barValues = {
  id: "barValues",
  afterDatasetsDraw(chart, _, o) {
    if (!o?.fmt) return;
    const { ctx } = chart;
    ctx.save();
    ctx.fillStyle = css("--ink-2"); ctx.font = `600 11px ${Chart.defaults.font.family}`;
    ctx.textAlign = "center"; ctx.textBaseline = "bottom";
    chart.getDatasetMeta(0).data.forEach((bar, i) => { const v = chart.data.datasets[0].data[i]; if (v) ctx.fillText(o.fmt(v), bar.x, bar.y - 5); });
    ctx.restore();
  },
};

/** Thème unique pour tous les graphiques : à rappeler quand le thème clair/sombre change. */
export function setup() {
  const D = Chart.defaults;
  D.color = css("--ink-3"); D.borderColor = css("--line");
  D.font.family = getComputedStyle(document.body).fontFamily; D.font.size = 12;
  D.responsive = true; D.maintainAspectRatio = false;
  D.animation = matchMedia("(prefers-reduced-motion: reduce)").matches ? false : { duration: 500, easing: "easeOutQuart" };
  D.animations.colors = false;   // les dégradés (CanvasGradient) ne sont pas interpolables
  D.elements.bar.borderRadius = 6;
  D.elements.line.tension = 0.35; D.elements.line.borderWidth = 2.5; D.elements.line.capBezierPoints = true;
  D.elements.point.radius = 0; D.elements.point.hoverRadius = 5; D.elements.point.hitRadius = 14; D.elements.point.hoverBorderWidth = 2;
  D.interaction = { mode: "index", intersect: false };
  D.plugins.legend.display = false;
  Object.assign(D.plugins.tooltip, {
    backgroundColor: css("--tip"), titleColor: css("--tip-ink"), bodyColor: css("--tip-ink"),
    padding: { x: 12, y: 10 }, cornerRadius: 10, caretSize: 0, boxPadding: 6, usePointStyle: true, boxWidth: 8, boxHeight: 8,
    titleFont: { weight: "600", size: 12 }, bodyFont: { size: 12 }, titleMarginBottom: 6,
  });
  if (!Chart.registry.plugins.get("barValues")) Chart.register(barValues);
}

export const narrow = () => matchMedia("(max-width: 600px)").matches;
const merge = (base, o) => ({ ...base, ...o, ticks: { ...base.ticks, ...o.ticks }, grid: { ...base.grid, ...o.grid } });
export const axis = {
  /** Axe horizontal : pas de quadrillage, libellés espacés. */
  x: (o = {}) => { const a = merge({ grid: { display: false }, border: { display: false }, ticks: { maxTicksLimit: 8, padding: 8, maxRotation: 0 } }, o); if (narrow()) a.ticks.maxTicksLimit = Math.min(a.ticks.maxTicksLimit ?? 8, 4); return a; },
  /** Axe vertical : quadrillage discret, largeur fixe pour aligner les graphiques empilés. */
  y: (o = {}) => merge({ beginAtZero: true, border: { display: false }, afterFit: s => { s.width = o.width ?? 44; },
    grid: { color: css("--line"), drawTicks: false }, ticks: { maxTicksLimit: 5, padding: 10, includeBounds: false } }, o),
};

const day = s => new Date((s.length === 7 ? s + "-01" : s) + "T12:00");
const MONTHS = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

/** Libellés de l'axe du temps (dates triées « 2026-10-14 » ou mois « 2026-10 »), adaptés à la durée affichée pour ne pas aligner
 *  des « 14 oct. » sans année sur plusieurs années. À fusionner dans `ticks` (callback, et autoSkip/maxRotation quand on choisit les repères).
 *    – jusqu'à ~14 mois : date courte (« 14 oct. »), ou « oct. 26 » pour des mois ;
 *    – jusqu'à ~2 ans et demi : un repère par trimestre, l'année en janvier (« avr. », « juil. », « oct. », « 2027 ») ;
 *    – au-delà : les années seules. Sur mobile, le passage aux années seules vient deux fois plus tôt (~15 mois). */
export function timeTicks(labels, { month = false } = {}) {
  const n = labels.length, days = n > 1 ? (day(labels[n - 1]) - day(labels[0])) / 864e5 : 0, k = narrow() ? 0.5 : 1;
  const mode = days > 900 * k ? "year" : days > 430 ? "quarter" : "date";
  if (mode === "date") return { callback: v => (month ? monthShort : dateShort)(labels[v]) };
  const first = new Set(), key = d => mode === "year" ? d.getFullYear() : d.getFullYear() * 4 + Math.floor(d.getMonth() / 3);
  let prev = null;
  labels.forEach((l, i) => { const g = key(day(l)); if (g !== prev) { first.add(i); prev = g; } });      // première barre de chaque année / trimestre
  return { autoSkip: false, maxRotation: 0, callback: v => {
    if (!first.has(v)) return "";
    const d = day(labels[v]);
    return mode === "year" || d.getMonth() < 3 ? String(d.getFullYear()) : MONTHS[Math.floor(d.getMonth() / 3) * 3];
  } };
}

/** Met en avant la plus grande valeur, estompe le reste. */
export const highlightMax = (arr, color) => { const m = Math.max(...arr); return arr.map(v => v === m && m > 0 ? color : alpha(color, 0.35)); };
export const mk = (canvas, cfg) => new Chart(canvas, cfg);
