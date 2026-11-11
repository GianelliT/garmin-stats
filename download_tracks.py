"""Télécharge le fichier FIT de chaque activité (rangé dans fit_files/), puis en extrait
la trace, les laps, la cadence... dans garmin.db (table tracks).

    python download_tracks.py --limit 5   # test
    python download_tracks.py             # nouvelles activités + celles sans laps
    python download_tracks.py --reparse   # tout relire depuis fit_files/ (après un changement du parsing)
    python download_tracks.py --id 12345678   # retélécharger le fichier FIT de cette activité et tout recalculer
"""
import argparse
import io
import json
import sqlite3
import zipfile
from pathlib import Path

import fitdecode
from garmin_personal_api.errors import GarminPersonalApiError, HttpError

from db import DB_PATH, ensure_tracks
from sync import call, get_client

FIT_DIR = Path("fit_files")
SEMI = 180 / 2**31   # semicircles -> degrés
MAX_PTS = 600
MAX_POLY = 200   # points du tracé simplifié (liste, vignettes, heatmap)

# clé interne -> noms possibles du champ FIT (le premier présent est utilisé)
RECORD_FIELDS = {"ts": ("timestamp",), "lat": ("position_lat",), "lon": ("position_long",),
                 "alt": ("enhanced_altitude", "altitude"), "hr": ("heart_rate",),
                 "spd": ("enhanced_speed", "speed"), "dist": ("distance",),
                 "cad": ("cadence",), "pwr": ("power",)}
LAP_FIELDS = {"ts": ("start_time",), "elapsed": ("total_elapsed_time",), "time": ("total_timer_time",),
              "dist": ("total_distance",), "spd": ("enhanced_avg_speed", "avg_speed"),
              "hr": ("avg_heart_rate",), "hr_max": ("max_heart_rate",), "up": ("total_ascent",),
              "down": ("total_descent",), "cad": ("avg_cadence",), "pwr": ("avg_power",)}


def rd(v, n=1):
    return None if v is None else round(v, n)


def _values(fr, fields):
    out = {}
    for key, names in fields.items():
        for n in names:
            if fr.has_field(n) and fr.get_value(n) is not None:
                out[key] = fr.get_value(n)
                break
    return out


def fit_bytes(c, aid, refresh=False):
    """Lit fit_files/<id>.fit, ou le télécharge (ZIP) puis le range sur disque.
    refresh=True retélécharge même si le fichier existe ; l'ancien n'est remplacé qu'une fois le nouveau bien reçu."""
    path = FIT_DIR / f"{aid}.fit"
    if refresh or not path.exists():
        z = zipfile.ZipFile(io.BytesIO(call(c.download_activity, aid)))
        name = next(n for n in z.namelist() if n.lower().endswith(".fit"))
        FIT_DIR.mkdir(exist_ok=True)
        path.write_bytes(z.read(name))
    return path.read_bytes()


def parse_fit(data):
    """Renvoie (records, laps) à partir des octets d'un fichier FIT."""
    recs, laps, sport = [], [], None
    with fitdecode.FitReader(io.BytesIO(data)) as fit:
        for fr in fit:
            if getattr(fr, "frame_type", None) != fitdecode.FIT_FRAME_DATA:
                continue
            if fr.name == "record":
                r = _values(fr, RECORD_FIELDS)
                if "ts" in r:
                    recs.append(r)
            elif fr.name == "lap":
                laps.append(_values(fr, LAP_FIELDS))
            elif fr.name == "session" and sport is None and fr.has_field("sport"):
                sport = fr.get_value("sport")
    return _finish(recs, laps, sport)


def _finish(recs, laps, sport):
    t0 = recs[0]["ts"] if recs else None
    mult = 2 if sport == "running" else 1    # FIT : cadence de course = foulées d'une seule jambe
    for r in recs:
        r["t"] = (r["ts"] - t0).total_seconds()
        for k in ("lat", "lon"):
            if k in r:
                r[k] *= SEMI
        if "cad" in r:
            r["cad"] *= mult
    out = [{"n": i, "t0": rd((l["ts"] - t0).total_seconds(), 0) if t0 and "ts" in l else None,
            "time": rd(l.get("time")), "elapsed": rd(l.get("elapsed")), "dist": rd(l.get("dist")),
            "spd": rd(l.get("spd"), 3), "hr": rd(l.get("hr"), 0), "hr_max": rd(l.get("hr_max"), 0),
            "up": rd(l.get("up"), 0), "down": rd(l.get("down"), 0),
            "cad": rd(l["cad"] * mult, 0) if "cad" in l else None, "pwr": rd(l.get("pwr"), 0)}
           for i, l in enumerate(laps, 1)]
    return recs, out


def km_splits(recs):
    out, cur, start_t, hrs = [], 1, 0.0, []
    for r in recs:
        if "dist" not in r:
            continue
        if r.get("hr"):
            hrs.append(r["hr"])
        if r["dist"] >= cur * 1000:
            out.append({"km": cur, "s": round(r["t"] - start_t),
                        "hr": round(sum(hrs) / len(hrs)) if hrs else None})
            start_t, hrs, cur = r["t"], [], cur + 1
    return out


def compact(recs):
    rs = recs[::max(1, len(recs) // MAX_PTS)]
    col = lambda k, n: [rd(x.get(k), n) for x in rs]
    pts = {"t": col("t", 0), "lat": col("lat", 5), "lon": col("lon", 5), "alt": col("alt", 1),
           "hr": col("hr", 0), "spd": col("spd", 2), "dist": col("dist", 0), "cad": col("cad", 0)}
    gps = [(x["lat"], x["lon"]) for x in rs if "lat" in x]
    poly = [[round(a, 5), round(b, 5)] for a, b in gps[::max(1, len(gps) // MAX_POLY)]]
    return pts, poly, bool(gps)


def save_track(conn, aid, recs, laps):
    pts, poly, gps = compact(recs) if recs else ({}, [], False)
    conn.execute("INSERT OR REPLACE INTO tracks (activity_id, has_gps, n_points, points, splits, poly, laps) "
                 "VALUES (?,?,?,?,?,?,?)",
                 (aid, int(gps), len(recs), json.dumps(pts), json.dumps(km_splits(recs)),
                  json.dumps(poly), json.dumps(laps)))
    conn.commit()


def reload_ids(conn, ids):
    """Retélécharge et retraite ces activités. Ne touche à rien si le téléchargement échoue. Renvoie 0 si tout va bien."""
    known = {r[0] for r in conn.execute("SELECT activity_id FROM activities")}
    missing = [i for i in ids if i not in known]
    if missing:
        print(f"Activité inconnue : {', '.join(map(str, missing))} (lancez d'abord python sync.py)")
        return 1
    code = 0
    with get_client() as c:
        for aid in ids:
            try:
                recs, laps = parse_fit(fit_bytes(c, aid, refresh=True))
            except (HttpError, GarminPersonalApiError) as e:
                status = getattr(e, "status_code", None)
                print(f"  ! {aid} : " + ("authentification Garmin refusée, relancez python sync.py" if status == 401
                                         else f"Garmin n'a pas fourni de fichier ({status or e})") + " ; données conservées")
                code = 1
                continue
            except Exception as e:
                print(f"  ! {aid} : échec ({e}) ; données conservées")
                code = 1
                continue
            save_track(conn, aid, recs, laps)
            print(f"  {aid} : {len(recs)} points, {len(laps)} tour{'s' if len(laps) > 1 else ''}")
            if recs and not laps:
                print("  Le fichier FIT ne contient aucun tour : Garmin n'en a pas enregistré pour cette activité.")
    return code


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int)
    ap.add_argument("--type", help="ex: running")
    ap.add_argument("--reparse", action="store_true", help="retraiter toutes les activités")
    ap.add_argument("--id", type=int, nargs="+", help="retélécharger et retraiter ces activités")
    args = ap.parse_args()

    conn = sqlite3.connect(DB_PATH)
    ensure_tracks(conn)
    if args.id:
        raise SystemExit(reload_ids(conn, args.id))
    conds, params = [], []
    if not args.reparse:
        conds.append("(t.activity_id IS NULL OR t.laps IS NULL)")
    if args.type:
        conds.append("a.type = ?")
        params.append(args.type)
    sql = ("SELECT a.activity_id FROM activities a LEFT JOIN tracks t ON t.activity_id = a.activity_id"
           + (" WHERE " + " AND ".join(conds) if conds else "") + " ORDER BY a.date DESC")
    todo = [r[0] for r in conn.execute(sql, params)][: args.limit]
    print(f"{len(todo)} activités à traiter")

    with get_client() as c:
        for n, aid in enumerate(todo, 1):
            try:
                recs, laps = parse_fit(fit_bytes(c, aid))
            except HttpError as e:
                if e.status_code == 401:
                    raise
                if e.status_code != 404:
                    print(f"  ! {aid} ignoré (HTTP {e.status_code})")
                    continue
                recs, laps = [], []
            except GarminPersonalApiError:
                recs, laps = [], []        # pas de fichier (activité manuelle)
            except Exception as e:      # réseau, ZIP tronqué... : on n'enregistre rien, l'activité sera retentée à la prochaine synchro
                print(f"  ! {aid} échec : {e}")
                continue
            save_track(conn, aid, recs, laps)
            if n % 10 == 0 or n == len(todo):
                print(f"  {n}/{len(todo)}", flush=True)


if __name__ == "__main__":
    main()
