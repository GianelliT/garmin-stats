import inspect
import json
import os
import re
import sqlite3
import subprocess
import sys

from pathlib import Path

import pandas as pd
from flask import Flask, abort, jsonify, request, send_from_directory

import fitness
import stats
import syncer
from contextlib import closing

import series
from db import DB_PATH, ensure_fitness, ensure_meta, ensure_places, ensure_tracks, place_key
from sports import family

app = Flask(__name__, static_folder="static")

# nom de l'URL -> fonction de stats.py (ajouter une stat = une ligne ici)
STATS = {
    "summary": stats.summary, "efforts": stats.efforts, "fitness_history": fitness.estimate_history, "pace": stats.pace_monthly, "current_week": stats.current_week, "sports": stats.sports,
    "weekday": stats.weekday, "hour_of_day": stats.hour_of_day, "weekly": stats.weekly,
    "monthly": stats.monthly, "hours": stats.hours_monthly, "cumulative": stats.cumulative,
    "yearly": stats.yearly, "countries": stats.countries, "regions": stats.regions, "calendar": stats.calendar, "distances": stats.distances,
    "streaks": stats.streaks, "best_efforts": stats.best_efforts, "podium": stats.podium,
    "load": fitness.load, "fitness": fitness.estimate,
}
# champs du JSON brut de l'activité utilisés par les stats
RAW = {**{f"z{i}": f"hrTimeInZone_{i}" for i in range(1, 6)},
       **{f"best_{d}": f"fastestSplit_{d}" for d in (1000, 5000, 10000, 21098)}}
_cache = {}
TRACKS_SCRIPT = Path(__file__).parent / "download_tracks.py"


def q(sql, args=()):
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    try:
        return [dict(r) for r in conn.execute(sql, args)]
    finally:
        conn.close()


def init_db():
    with sqlite3.connect(DB_PATH) as c:  # la table existe même avant download_tracks.py
        ensure_tracks(c)
        ensure_places(c)
        ensure_fitness(c)
        ensure_meta(c)
        migrate_legacy(c)


def load_df():
    """Toutes les activités en DataFrame (mis en cache tant que la base ne change pas)."""
    m = os.path.getmtime(DB_PATH)
    if _cache.get("m") != m:
        df = pd.DataFrame(q("SELECT a.activity_id AS id, a.start_local, COALESCE(NULLIF(m.name, ''), a.name) AS name, a.type, "
                            "a.distance_m, a.duration_s, a.elevation_m, a.avg_hr, a.raw FROM activities a "
                            "LEFT JOIN activity_meta m ON m.activity_id = a.activity_id"),
                          columns=["id", "start_local", "name", "type", "distance_m", "duration_s",
                                   "elevation_m", "avg_hr", "raw"])
        raw = df.pop("raw").map(lambda s: json.loads(s or "{}"))
        for col, key in RAW.items():
            df[col] = pd.to_numeric(raw.map(lambda r, k=key: r.get(k)), errors="coerce")
        lat = pd.to_numeric(raw.map(lambda r: r.get("startLatitude")), errors="coerce")
        lon = pd.to_numeric(raw.map(lambda r: r.get("startLongitude")), errors="coerce")
        df["place_key"] = [place_key(a, b) if pd.notna(a) and pd.notna(b) else None for a, b in zip(lat, lon)]
        df["date"] = pd.to_datetime(df["start_local"].str[:10])
        df["hour"] = pd.to_numeric(df["start_local"].str[11:13], errors="coerce").fillna(0).astype(int)
        df["family"] = df["type"].map(family)
        df["km"] = df["distance_m"].fillna(0) / 1000
        df["duration_s"] = df["duration_s"].fillna(0)
        df["elevation_m"] = df["elevation_m"].fillna(0)
        places = pd.DataFrame(q("SELECT key AS place_key, country, region, city FROM places"),
                              columns=["place_key", "country", "region", "city"])
        df = df.merge(places, on="place_key", how="left")
        _cache.update(m=m, df=df)
    return _cache["df"]


def carto_key():
    """Clé gratuite CARTO (carto.com/basemaps/apikey) : variable CARTO_API_KEY ou ~/.config/garmin/carto-api-key."""
    f = Path.home() / ".config" / "garmin" / "carto-api-key"
    return os.environ.get("CARTO_API_KEY", "").strip() or (f.read_text().strip() if f.exists() else "")


@app.get("/api/config")
def config():
    return jsonify({"carto_key": carto_key()})


@app.get("/api/garmin_fitness")
def garmin_fitness():
    """VO2max et prédictions de course mesurés par la montre (voir connect_sync.py) ; null si jamais récupérés."""
    rows = q("SELECT date, vo2max, t5k, t10k, thalf, tmarathon FROM garmin_fitness ORDER BY date")
    vo2 = [r for r in rows if r["vo2max"]]
    race = [r for r in rows if any(r[k] for k in ("t5k", "t10k", "thalf", "tmarathon"))]
    if not vo2 and not race:
        return jsonify(None)
    return jsonify({"rows": rows, "vo2max": {"value": vo2[-1]["vo2max"], "date": vo2[-1]["date"], "history": [{"d": r["date"], "v": r["vo2max"]} for r in vo2]} if vo2 else None,
                    "race": {"date": race[-1]["date"], "times": {k: race[-1][k] for k in ("t5k", "t10k", "thalf", "tmarathon")}} if race else None})


@app.get("/api/sync")
def sync_status():
    return jsonify(syncer.status())


@app.post("/api/sync")
def sync_start():
    started = syncer.start()
    return jsonify({**syncer.status(), "started": started}), (202 if started else 200)


@app.get("/")
def index():
    return send_from_directory("static", "index.html")


CATEGORIES = {"course": "Course", "footing": "Footing", "seance": "Séance", "trail": "Trail"}
WITH_SUB = ("course", "seance", "trail")    # le footing n'a pas de précision ; une course, une séance ou un trail en a une (10 km, 10x400, UTMB…)
MODES = {"footing": "average", "course": "splits", "seance": "laps", "trail": "splits"}   # comment comparer : moyenne seule / km par km / tour par tour


def clean_tag(t):
    """« #10 X 400  » -> « 10x400 » : une précision s'écrit toujours de la même façon, pour que les séances se regroupent."""
    t = " ".join(str(t).strip().lstrip("#").lower().split())[:40]
    return re.sub(r"(\d)\s*[x×]\s*(\d)", r"\1x\2", t)      # 10 x 400, 10×400 -> 10x400


def clean_sub(t):
    """Précision d'une course ou d'une séance. « 10km », « 10 k » et « 10 KM » deviennent « 10 km »."""
    t = clean_tag(t)
    return re.sub(r"^(\d+(?:[.,]\d+)?)\s*k(?:m)?$", r"\1 km", t)


def suggest_category(tag):
    """Catégorie évidente d'un ancien tag libre (« footing », « trail », « 10x400 », « semi-marathon »), sinon None."""
    t = clean_tag(tag)
    if t in ("footing", "trail"):
        return t
    if re.match(r"^\d+x\d+", t):
        return "seance"
    if re.match(r"^(\d+(?:[.,]\d+)?\s?k(?:m)?|semi([- ]marathon)?|marathon)$", t):
        return "course"
    return None


def clean_subs(value):
    """Liste de précisions propre (sans doublon, 10 au plus). Accepte une liste ou un texte « 10x400, piste »."""
    items = re.split(r"[,;]", value) if isinstance(value, str) else (value or [])
    return list(dict.fromkeys(s for s in (clean_sub(x)[:40] for x in items if isinstance(x, str)) if s))[:10]


def subs_by_activity():
    out = {}
    for r in q("SELECT activity_id, sub FROM activity_subs ORDER BY sub"):
        out.setdefault(r["activity_id"], []).append(r["sub"])
    return out


def apply_category(c, ids, category, subs):
    """Range ces activités dans une catégorie (avec leurs précisions) si elles n'en ont pas encore."""
    subs = clean_subs(subs) if category in WITH_SUB else []
    for aid in ids:
        c.execute("INSERT OR IGNORE INTO activity_meta (activity_id) VALUES (?)", (aid,))
        if c.execute("UPDATE activity_meta SET category = ? WHERE activity_id = ? AND category IS NULL", (category, aid)).rowcount:
            c.executemany("INSERT OR IGNORE INTO activity_subs (activity_id, sub) VALUES (?, ?)", [(aid, s) for s in subs])


def migrate_legacy(c):
    """Au démarrage : les anciens tags libres dont le sens est sans ambiguïté deviennent catégorie + précision. Le reste est
    proposé dans « À classer » (page Séries). Rien n'est supprimé."""
    prio = {"seance": 0, "trail": 1, "course": 2, "footing": 3}
    rows = c.execute("SELECT g.tag, g.activity_id FROM activity_tags g LEFT JOIN activity_meta m ON m.activity_id = g.activity_id "
                     "WHERE m.category IS NULL").fetchall()
    for tag, aid in sorted(((t, i) for t, i in rows if suggest_category(t)), key=lambda r: prio[suggest_category(r[0])]):
        cat = suggest_category(tag)
        apply_category(c, [aid], cat, [] if clean_tag(tag) == cat else [tag])     # le tag « trail » devient la catégorie, pas une précision
    keep_secondary_tags(c)


def keep_secondary_tags(c):
    """Une seule fois : les autres anciens tags d'une course ou d'une séance déjà classée (« piste », « côte », une 2e distance…)
    deviennent des précisions. Avant, seul le premier tag reconnu était repris et les autres n'apparaissaient plus nulle part.
    Fait une seule fois (marqueur dans tag_meta) pour qu'une précision retirée à la main ne revienne pas au redémarrage."""
    if c.execute("SELECT 1 FROM tag_meta WHERE tag = '__migrated_secondary_tags'").fetchone():
        return
    skip = set(CATEGORIES) | {v.lower() for v in CATEGORIES.values()} | {"seance", "séance"}
    rows = c.execute("SELECT g.activity_id, g.tag FROM activity_tags g JOIN activity_meta m ON m.activity_id = g.activity_id "
                     "WHERE m.category IN ('course', 'seance')").fetchall()
    c.executemany("INSERT OR IGNORE INTO activity_subs (activity_id, sub) VALUES (?, ?)",
                  [(aid, clean_sub(t)) for aid, t in rows if clean_sub(t) and clean_sub(t) not in skip])
    c.execute("INSERT OR IGNORE INTO tag_meta (tag, pinned) VALUES ('__migrated_secondary_tags', 0)")
    c.commit()


def meta_of(aid):
    """Nom affiché, nom Garmin d'origine, note, catégorie et précisions d'une activité."""
    a = q("SELECT a.name AS garmin_name, COALESCE(NULLIF(m.name, ''), a.name) AS name, COALESCE(m.note, '') AS note, m.category "
          "FROM activities a LEFT JOIN activity_meta m ON m.activity_id = a.activity_id WHERE a.activity_id = ?", (aid,))
    if not a:
        abort(404)
    return {**a[0], "subtags": subs_by_activity().get(aid, [])}


@app.patch("/api/activity/<int:aid>/meta")
def set_meta(aid):
    """Renomme, annote ou classe une activité. Champs facultatifs : name (vide = nom Garmin), note, category
    (course / footing / seance / trail / vide), subtags (liste de précisions : 10 km, 10x400, piste…)."""
    body = request.get_json(silent=True) or {}
    cur = meta_of(aid)    # 404 si l'activité n'existe pas
    if body.get("category") not in (None, "", *CATEGORIES):
        abort(400)
    with closing(sqlite3.connect(DB_PATH)) as c, c:
        c.execute("INSERT OR IGNORE INTO activity_meta (activity_id) VALUES (?)", (aid,))
        if "name" in body:
            c.execute("UPDATE activity_meta SET name = ? WHERE activity_id = ?", ((body["name"] or "").strip()[:120] or None, aid))
        if "note" in body:
            c.execute("UPDATE activity_meta SET note = ? WHERE activity_id = ?", ((body["note"] or "").strip()[:5000] or None, aid))
        if "category" in body or "subtags" in body or "subtag" in body:
            cat = (body.get("category") or None) if "category" in body else cur["category"]
            subs = clean_subs(body["subtags"]) if "subtags" in body else clean_subs(body["subtag"]) if "subtag" in body else cur["subtags"]
            subs = subs if cat in WITH_SUB else []                                  # un footing n'a pas de précision
            c.execute("UPDATE activity_meta SET category = ?, subtag = NULL WHERE activity_id = ?", (cat, aid))
            c.execute("DELETE FROM activity_subs WHERE activity_id = ?", (aid,))
            c.executemany("INSERT INTO activity_subs (activity_id, sub) VALUES (?, ?)", [(aid, s) for s in subs])
        c.execute("UPDATE activity_meta SET updated_at = CURRENT_TIMESTAMP WHERE activity_id = ?", (aid,))
        c.execute("DELETE FROM activity_meta WHERE activity_id = ? AND name IS NULL AND note IS NULL AND category IS NULL", (aid,))
    return jsonify(meta_of(aid))


@app.post("/api/activity/<int:aid>/reload")
def reload_activity(aid):
    """Retélécharge le fichier FIT de cette activité sur Garmin et recalcule tracé, kilomètres et tours."""
    meta_of(aid)    # 404 si inconnue
    if syncer.status()["state"] == "running":
        return jsonify(error="Une synchronisation est en cours, réessayez dans un instant."), 409
    try:
        r = subprocess.run([sys.executable, "-u", str(TRACKS_SCRIPT), "--id", str(aid)], capture_output=True, text=True, timeout=180)
    except subprocess.TimeoutExpired:
        return jsonify(error="Garmin n'a pas répondu à temps."), 504
    lines = [ln.strip() for ln in (r.stdout + r.stderr).splitlines() if ln.strip()]
    if r.returncode:
        return jsonify(error=lines[-1] if lines else "Échec du rechargement.", log=lines[-8:]), 502
    t = q("SELECT n_points, laps FROM tracks WHERE activity_id = ?", (aid,))
    return jsonify(ok=True, points=t[0]["n_points"] if t else 0, laps=len(json.loads(t[0]["laps"] or "[]")) if t else 0, log=lines)


@app.get("/api/series")
def series_index():
    """Vue d'ensemble : les catégories avec leurs précisions, et ce qu'il reste à classer (anciens tags, courses sans catégorie)."""
    cats = {k: {"key": k, "label": v, "count": 0, "last": "", "nosub": 0, "subs": {}} for k, v in CATEGORIES.items()}
    subs_of = subs_by_activity()
    for r in q("SELECT m.activity_id AS id, m.category, a.date FROM activity_meta m JOIN activities a ON a.activity_id = m.activity_id WHERE m.category IS NOT NULL"):
        c = cats.get(r["category"])
        if not c:
            continue
        c["count"] += 1
        c["last"] = max(c["last"], r["date"])
        mine = subs_of.get(r["id"], []) if r["category"] in WITH_SUB else []
        for sub in mine:                       # une séance compte dans chacune de ses précisions
            s = c["subs"].setdefault(sub, {"sub": sub, "count": 0, "last": ""})
            s["count"] += 1
            s["last"] = max(s["last"], r["date"])
        if not mine:
            c["nosub"] += 1
    out = []
    for c in cats.values():
        c["subs"] = sorted(c["subs"].values(), key=lambda s: (-s["count"], s["sub"]))
        out.append(c)
    legacy = [{**r, "suggest": suggest_category(r["tag"])} for r in q(
        "SELECT g.tag, COUNT(*) AS count FROM activity_tags g JOIN activities a ON a.activity_id = g.activity_id "
        "LEFT JOIN activity_meta m ON m.activity_id = g.activity_id WHERE m.category IS NULL GROUP BY g.tag ORDER BY count DESC, g.tag")]
    unclassified = sum(1 for r in q("SELECT a.type FROM activities a LEFT JOIN activity_meta m ON m.activity_id = a.activity_id WHERE m.category IS NULL")
                       if family(r["type"]) == "run")
    return jsonify({"categories": out, "legacy": legacy, "unclassified": unclassified})


@app.get("/api/serie/<category>")
@app.get("/api/serie/<category>/<path:sub>")
def serie(category, sub=None):
    """Séances d'une catégorie (et d'une précision), de la plus ancienne à la plus récente, avec de quoi les comparer :
    séance -> tours + tours d'effort détectés ; course et trail -> kilomètres ; footing -> moyenne seule."""
    if category not in CATEGORIES:
        abort(404)
    sub = clean_sub(sub) if sub else None
    rows = q("""SELECT a.activity_id AS id, a.date, a.start_local, COALESCE(NULLIF(m.name, ''), a.name) AS name, a.type, a.distance_m,
                       a.duration_s, a.avg_hr, a.elevation_m, COALESCE(m.note, '') AS note, m.category, t.laps, t.splits
                FROM activity_meta m JOIN activities a ON a.activity_id = m.activity_id LEFT JOIN tracks t ON t.activity_id = a.activity_id
                WHERE m.category = ? AND (? IS NULL OR EXISTS (SELECT 1 FROM activity_subs s WHERE s.activity_id = m.activity_id AND s.sub = ?))
                ORDER BY a.start_local""", (category, sub, sub))
    subs_of = subs_by_activity()
    mode = MODES[category]
    for r in rows:
        laps, splits = json.loads(r.pop("laps") or "[]"), json.loads(r.pop("splits") or "[]")
        fast = series.split_efforts(laps) if mode == "laps" else []
        pace, hr = series.effort_summary(laps, fast) if fast else (None, None)
        r.update(family=family(r["type"]), subtags=subs_of.get(r["id"], []), fast=fast, fast_pace_s=pace, fast_hr=hr,
                 laps=[{k: l.get(k) for k in ("n", "dist", "time", "spd", "hr")} for l in laps] if mode == "laps" else [],
                 splits=[{"km": s.get("km"), "s": s.get("s"), "hr": s.get("hr")} for s in splits] if mode == "splits" else [])
    return jsonify({"category": category, "label": CATEGORIES[category], "sub": sub, "mode": mode, "sessions": rows})


def _with_sub(c, category, sub):
    """Identifiants des séances de cette catégorie qui portent cette précision."""
    return [r[0] for r in c.execute("SELECT s.activity_id FROM activity_subs s JOIN activity_meta m ON m.activity_id = s.activity_id "
                                    "WHERE m.category = ? AND s.sub = ?", (category, sub))]


@app.patch("/api/serie/<category>/<path:sub>")
def rename_sub(category, sub):
    """Renomme une précision. Si le nouveau nom existe déjà, les deux séries n'en font qu'une."""
    if category not in WITH_SUB:
        abort(404)
    new = clean_sub((request.get_json(silent=True) or {}).get("name") or "")
    if not new:
        abort(400)
    with closing(sqlite3.connect(DB_PATH)) as c, c:
        for aid in _with_sub(c, category, clean_sub(sub)):        # fusion automatique si la séance avait déjà le nouveau nom
            c.execute("INSERT OR IGNORE INTO activity_subs (activity_id, sub) VALUES (?, ?)", (aid, new))
            c.execute("DELETE FROM activity_subs WHERE activity_id = ? AND sub = ?", (aid, clean_sub(sub)))
    return jsonify({"sub": new})


@app.delete("/api/serie/<category>/<path:sub>")
def delete_sub(category, sub):
    """Retire cette précision de ses séances (elles gardent leur catégorie et leurs autres précisions)."""
    if category not in WITH_SUB:
        abort(404)
    with closing(sqlite3.connect(DB_PATH)) as c, c:
        ids = _with_sub(c, category, clean_sub(sub))
        c.executemany("DELETE FROM activity_subs WHERE activity_id = ? AND sub = ?", [(i, clean_sub(sub)) for i in ids])
    return jsonify({"cleared": len(ids)})


@app.post("/api/classify")
def classify():
    """Range en une fois toutes les séances d'un ancien tag libre : {tag, category, subtags?}. Ne touche pas aux séances déjà classées."""
    body = request.get_json(silent=True) or {}
    if body.get("category") not in CATEGORIES or not body.get("tag"):
        abort(400)
    with closing(sqlite3.connect(DB_PATH)) as c, c:
        ids = [r[0] for r in c.execute("SELECT g.activity_id FROM activity_tags g LEFT JOIN activity_meta m ON m.activity_id = g.activity_id "
                                       "WHERE g.tag = ? AND m.category IS NULL", (body["tag"],))]
        apply_category(c, ids, body["category"], body.get("subtags", body.get("subtag")))
    return jsonify({"classified": len(ids)})


@app.delete("/api/legacy/<path:tag>")
def drop_legacy(tag):
    """Ignore un ancien tag libre : il disparaît de « À classer »."""
    with closing(sqlite3.connect(DB_PATH)) as c, c:
        n = c.execute("DELETE FROM activity_tags WHERE tag = ?", (tag,)).rowcount
    return jsonify({"removed": n})


@app.get("/api/activities")
def activities():
    rows = q("""
        SELECT a.activity_id AS id, a.date, a.start_local, COALESCE(NULLIF(m.name, ''), a.name) AS name, a.name AS garmin_name,
               a.type, a.distance_m, a.duration_s, a.avg_hr, a.elevation_m, COALESCE(t.has_gps, 0) AS gps, COALESCE(m.note, '') AS note, m.category
        FROM activities a LEFT JOIN tracks t ON t.activity_id = a.activity_id
        LEFT JOIN activity_meta m ON m.activity_id = a.activity_id
        ORDER BY a.start_local DESC""")
    place = load_df().set_index("id")[["country", "region", "city"]].to_dict("index")
    subs = subs_by_activity()
    for r in rows:
        r["family"] = family(r["type"])
        r["subtags"] = subs.get(r["id"], [])
        r.update({k: v if isinstance(v, str) else None for k, v in place.get(r["id"], {}).items()})
    return jsonify(rows)


@app.get("/api/tracks")
def tracks():
    rows = q("SELECT activity_id AS id, poly FROM tracks WHERE has_gps = 1")
    for r in rows:
        r["poly"] = json.loads(r["poly"])
    return jsonify(rows)


@app.get("/api/activity/<int:aid>")
def activity(aid):
    rows = q("SELECT * FROM activities WHERE activity_id = ?", (aid,))
    if not rows:
        abort(404)
    a = rows[0]
    a.update(meta_of(aid))
    raw = json.loads(a.pop("raw") or "{}")
    a["id"] = a.pop("activity_id")
    a["max_hr"] = raw.get("maxHR")
    a["zones"] = [raw.get(f"hrTimeInZone_{z}") for z in range(1, 6)]
    t = q("SELECT points, splits, laps FROM tracks WHERE activity_id = ?", (aid,))
    a["track"] = json.loads(t[0]["points"]) if t else None
    a["splits"] = json.loads(t[0]["splits"]) if t else []
    a["laps"] = json.loads(t[0]["laps"] or "[]") if t else []
    return jsonify(a)


@app.post("/api/stats/<name>")
def stat(name):
    """Le navigateur envoie les ids des activités filtrées ({"ids": [...]}, ou null pour tout)."""
    fn = STATS.get(name) or abort(404)
    body = request.get_json(silent=True) or {}
    ids, args = body.get("ids"), body.get("args") or {}
    # paramètres facultatifs (ex. top=25, days=365) : seuls ceux que la fonction déclare sont transmis
    params = inspect.signature(fn).parameters
    kwargs = {k: v for k, v in args.items() if k in params and k != "df" and isinstance(v, (int, str)) and not isinstance(v, bool)}
    df = load_df()
    try:
        return jsonify(fn(df if ids is None else df[df["id"].isin(ids)], **kwargs))
    except (ValueError, TypeError):
        abort(400)


init_db()
if __name__ == "__main__":
    app.run(host="0.0.0.0", port=4999, use_reloader=True)   # redémarre seul quand un fichier .py change