import * as activities from "./pages/activities.js";
import * as detail from "./pages/detail.js";
import * as compare from "./pages/compare.js";
import * as dashboard from "./pages/dashboard.js";
import * as heatmap from "./pages/heatmap.js";
import * as series from "./pages/series.js";
import * as stat from "./pages/stat.js";
import * as vdot from "./pages/vdot.js";
import { api } from "./api.js";
import { setup } from "./charts.js";
import { FAMILIES, familyColor } from "./format.js";
import { setFamily, store } from "./filters.js";

// Une page = un module exportant render(el, ...params) et, si besoin, destroy().
const ROUTES = [
  { re: /^#\/dashboard$/, page: dashboard, tab: "dashboard" },
  { re: /^#\/stat\/([a-z]+)$/, page: stat, tab: "dashboard" },
  { re: /^#\/activities$/, page: activities, tab: "activities" },
  { re: /^#\/activity\/(\d+)$/, page: detail, tab: "activities" },
  { re: /^#\/compare\/(\d+(?:\/\d+){0,4})$/, page: compare, tab: "activities" },   // 1 à 5 séances
  { re: /^#\/heatmap$/, page: heatmap, tab: "heatmap" },
  { re: /^#\/series$/, page: series, tab: "series" },
  { re: /^#\/vdot$/, page: vdot, tab: "vdot" },
  { re: /^#\/serie\/([a-z]+)(?:\/(.+))?$/, page: series, tab: "series" },
];
const I = p => `<svg viewBox="0 0 24 24" aria-hidden="true">${p}</svg>`;
const TABS = [
  ["dashboard", "Aperçu", I('<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>')],
  ["activities", "Activités", I('<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>')],
  ["series", "Séries", I('<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.2"/>')],
  ["vdot", "VDOT", I('<circle cx="12" cy="13" r="8"/><path d="M12 13l4-4M9 2h6"/>')],
  ["heatmap", "Carte", I('<path d="M9 4 3 6v14l6-2 6 2 6-2V4l-6 2-6-2zM9 4v14M15 6v14"/>')],
];
let current;

async function sportChips() {
  const acts = await api.activities(), count = {};
  acts.forEach(a => { count[a.family] = (count[a.family] || 0) + 1; });
  const others = Object.keys(FAMILIES).filter(f => f !== "run" && count[f]).sort((a, b) => count[b] - count[a]);
  const items = [...(count.run ? ["run"] : []), ...others, "all"];
  if (!items.includes(store.family)) store.family = items[0];
  const el = document.getElementById("sports");
  el.innerHTML = items.map(f => `<button data-f="${f}" class="${store.family === f ? "on" : ""}" aria-pressed="${store.family === f}">${f === "all" ? "Tous" : `<i style="--c:${familyColor(f)}"></i>${FAMILIES[f].label}`}</button>`).join("");
  el.querySelector(".on")?.scrollIntoView({ inline: "center", block: "nearest" });
  el.onclick = e => { const b = e.target.closest("button"); if (b && b.dataset.f !== store.family) { setFamily(b.dataset.f); sportChips(); } };
  // version téléphone : menu déroulant (affiché à la place des pastilles via le CSS)
  const lab = document.getElementById("sportsel"), sel = lab.querySelector("select");
  sel.innerHTML = items.map(f => `<option value="${f}"${store.family === f ? " selected" : ""}>${f === "all" ? "Tous les sports" : FAMILIES[f].label}</option>`).join("");
  lab.querySelector("i").style.setProperty("--c", store.family === "all" ? "var(--ink-3)" : familyColor(store.family));
  sel.onchange = () => { if (sel.value !== store.family) { setFamily(sel.value); sportChips(); } };
}

async function route() {
  const hash = location.hash || "#/dashboard", app = document.getElementById("app");
  const r = ROUTES.find(x => x.re.test(hash));
  current?.destroy?.();
  current = r?.page;
  document.getElementById("nav").innerHTML = TABS.map(([id, label, icon]) =>
    `<a href="#/${id}" class="${r?.tab === id ? "on" : ""}">${icon}${label}</a>`).join("");
  if (!r) { app.innerHTML = '<p class="msg">Page introuvable</p>'; return; }
  app.innerHTML = '<p class="msg">Chargement…</p>';
  scrollTo(0, 0);
  try {
    await r.page.render(app, ...hash.match(r.re).slice(1));
  } catch (e) {
    console.error(e);
    app.innerHTML = `<p class="msg err">${e.message}</p>`;
  }
}

setup();
addEventListener("hashchange", route);
addEventListener("sportchange", route);
addEventListener("datachange", () => { sportChips(); route(); });   // après une synchronisation
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { setup(); route(); });
sportChips().then(route, route);
