const cache = new Map();

function cached(key, request) {
  if (!cache.has(key)) {
    cache.set(key, request().then(r => {
      if (!r.ok) throw new Error(`${key.slice(0, 60)} → HTTP ${r.status}`);
      return r.json();
    }));
  }
  return cache.get(key);
}
const get = url => cached(url, () => fetch(url));
const post = (url, body) => cached(url + JSON.stringify(body),
  () => fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }));

// la synchronisation n'est jamais mise en cache : on veut toujours l'état courant
const json = r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); };

export const api = {
  sync: { status: () => fetch("/api/sync").then(json), start: () => fetch("/api/sync", { method: "POST" }).then(json) },
  garminFitness: () => get("/api/garmin_fitness"),
  /** Oublie les données déjà chargées (à appeler après une synchronisation). */
  refresh: () => cache.clear(),
  config: () => get("/api/config"),
  activities: () => get("/api/activities"),
  tracks: () => get("/api/tracks"),
  activity: id => get(`/api/activity/${id}`),
  /** Retélécharge une activité depuis Garmin (tracé, km, tours) et oublie les données déjà chargées. */
  async reloadActivity(id) {
    const r = await fetch(`/api/activity/${id}/reload`, { method: "POST" }), d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
    cache.clear();
    return d;
  },
  /** Vue d'ensemble des séries (jamais en cache : elle change à chaque classement). */
  series: () => fetch("/api/series").then(json),
  /** Courses sans catégorie pour lesquelles une catégorie évidente existe (jamais en cache). */
  suggestions: () => fetch("/api/suggestions").then(json),
  /** Accepte la catégorie proposée pour ces activités ; le serveur la recalcule. */
  async acceptSuggestions(ids) {
    const d = await fetch("/api/suggestions/accept", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids }) }).then(json);
    cache.clear();
    return d;
  },
  serie: (cat, sub) => fetch(`/api/serie/${cat}${sub ? "/" + encodeURIComponent(sub) : ""}`).then(json),
  async subRename(cat, sub, name) {
    const d = await fetch(`/api/serie/${cat}/${encodeURIComponent(sub)}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) }).then(json);
    cache.clear();
    return d;
  },
  async subDelete(cat, sub) {
    const d = await fetch(`/api/serie/${cat}/${encodeURIComponent(sub)}`, { method: "DELETE" }).then(json);
    cache.clear();
    return d;
  },
  /** Range d'un coup les séances d'un ancien tag libre dans une catégorie. */
  async classify(tag, category, subtag) {
    const d = await fetch("/api/classify", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag, category, subtag }) }).then(json);
    cache.clear();
    return d;
  },
  async dropLegacy(tag) { return fetch(`/api/legacy/${encodeURIComponent(tag)}`, { method: "DELETE" }).then(json); },
  /** Renomme / annote / tague une activité ({ name, note, tags }) et met à jour les données déjà chargées. */
  async patchActivity(id, body) {
    const m = await fetch(`/api/activity/${id}/meta`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then(json);
    const sync = o => { for (const k of ["name", "garmin_name", "note", "category", "subtags"]) o[k] = m[k]; };
    cache.get("/api/activities")?.then(l => { const a = l.find(x => x.id === +id); if (a) sync(a); });
    cache.get(`/api/activity/${id}`)?.then(sync);
    for (const k of [...cache.keys()]) if (k.startsWith("/api/stats/")) cache.delete(k);   // des noms apparaissent dans certains classements
    return m;
  },
  /** ids : activités à prendre en compte (null = toutes). */
  /** Statistique calculée par le serveur. `args` : paramètres facultatifs (ex. { top: 25 }, { days: 365 }, { today: "2026-10-25" }). */
  stat: (name, ids, args) => post(`/api/stats/${name}`, args && Object.keys(args).length ? { ids, args } : { ids }),
};
