import argparse
import json
import sqlite3
import time
from datetime import date, timedelta

from garmin_personal_api import (
    GarminPersonalApiClient,
    PersonalApiAuthenticator,
    resolve_api_key,
)
from garmin_personal_api.errors import HttpError

DB_PATH = "garmin.db"
MAX_CALLS_PER_MIN = 90   # Garmin a répondu limit=100 ; on garde de la marge

SCHEMA = """
CREATE TABLE IF NOT EXISTS activities (
    activity_id   INTEGER PRIMARY KEY,
    date          TEXT,
    start_local   TEXT,
    name          TEXT,
    type          TEXT,
    distance_m    REAL,
    duration_s    REAL,
    avg_hr        REAL,
    max_hr        REAL,
    elevation_m   REAL,
    calories      REAL,
    avg_cadence   REAL,
    aerobic_te    REAL,
    anaerobic_te  REAL,
    raw           TEXT
);
CREATE TABLE IF NOT EXISTS daily (
    date              TEXT PRIMARY KEY,
    steps             INTEGER,
    step_goal         INTEGER,
    distance_m        REAL,
    resting_hr        INTEGER,
    min_hr            INTEGER,
    max_hr            INTEGER,
    stress_avg        INTEGER,
    body_battery_min  INTEGER,
    body_battery_max  INTEGER,
    calories_total    INTEGER,
    calories_active   INTEGER,
    intensity_moderate INTEGER,
    intensity_vigorous INTEGER,
    raw               TEXT
);
CREATE TABLE IF NOT EXISTS sleep (
    date         TEXT PRIMARY KEY,
    sleep_s      INTEGER,
    deep_s       INTEGER,
    light_s      INTEGER,
    rem_s        INTEGER,
    awake_s      INTEGER,
    avg_resp     REAL,
    raw          TEXT
);
CREATE TABLE IF NOT EXISTS sync_log (
    run_at TEXT DEFAULT CURRENT_TIMESTAMP,
    start_date TEXT, end_date TEXT,
    n_activities INTEGER, n_days INTEGER, n_sleep INTEGER
);

CREATE VIEW IF NOT EXISTS runs AS
SELECT *,
       distance_m / 1000.0 AS km,
       duration_s / 60.0 / (distance_m / 1000.0) AS pace_min_km
FROM activities
WHERE type = 'running' AND distance_m > 0;
"""


# ---------- appels API avec limitation de débit ----------

_recent_calls: list[float] = []


def call(fn, *args, **kwargs):
    """Appelle l'API en respectant la limite, et réessaie sur HTTP 429."""
    for _ in range(10):
        now = time.monotonic()
        while _recent_calls and now - _recent_calls[0] > 60:
            _recent_calls.pop(0)
        if len(_recent_calls) >= MAX_CALLS_PER_MIN:
            time.sleep(max(0, 61 - (now - _recent_calls[0])))
            continue
        _recent_calls.append(time.monotonic())
        try:
            return fn(*args, **kwargs)
        except HttpError as e:
            if e.status_code != 429:
                raise
            try:
                wait = int(json.loads(e.response_text).get("retryInSeconds", 60))
            except Exception:
                wait = 60
            print(f"  limite atteinte (429), pause de {wait + 2}s...", flush=True)
            time.sleep(wait + 2)
            _recent_calls.clear()
    raise RuntimeError("Trop d'erreurs 429 consécutives, réessayez plus tard.")


def get_client() -> GarminPersonalApiClient:
    with PersonalApiAuthenticator() as auth:
        token = auth.obtain_token(resolve_api_key())
    return GarminPersonalApiClient(token.access_token)


# ---------- utilitaires base ----------

def upsert(conn, table, row, pk):
    cols = list(row)
    updates = ",".join(f"{c}=excluded.{c}" for c in cols if c != pk)
    conn.execute(
        f"INSERT INTO {table} ({','.join(cols)}) VALUES ({','.join('?' * len(cols))}) "
        f"ON CONFLICT({pk}) DO UPDATE SET {updates}",
        [row[c] for c in cols],
    )


def chunks(start: date, end: date, days=30):
    cur = start
    while cur <= end:
        nxt = min(cur + timedelta(days=days - 1), end)
        yield cur, nxt
        cur = nxt + timedelta(days=1)


def _dig(d, *keys):
    for k in keys:
        if not isinstance(d, dict):
            return None
        d = d.get(k)
    return d


def chunk_done(conn, table, end: date) -> bool:
    """Une plage est considérée faite si sa date de fin est déjà en base."""
    return conn.execute(
        f"SELECT 1 FROM {table} WHERE date = ?", (end.isoformat(),)
    ).fetchone() is not None


# ---------- synchronisations ----------

def sync_activities(conn, c, start, end):
    """start=None → toutes les activités, sans filtre de date."""
    n, offset = 0, 0
    while True:
        kwargs = {"start": offset, "limit": 100}
        if start is not None:
            kwargs["start_date"] = start.isoformat()
            kwargs["end_date"] = end.isoformat()
        batch = call(c.search_activities, **kwargs)
        if not batch:
            break
        for a in batch:
            upsert(conn, "activities", {
                "activity_id": a["activityId"],
                "date": a["startTimeLocal"][:10],
                "start_local": a["startTimeLocal"],
                "name": a.get("activityName"),
                "type": (a.get("activityType") or {}).get("typeKey"),
                "distance_m": a.get("distance"),
                "duration_s": a.get("duration"),
                "avg_hr": a.get("averageHR"),
                "max_hr": a.get("maxHR"),
                "elevation_m": a.get("elevationGain"),
                "calories": a.get("calories"),
                "avg_cadence": a.get("averageRunningCadenceInStepsPerMinute"),
                "aerobic_te": a.get("aerobicTrainingEffect"),
                "anaerobic_te": a.get("anaerobicTrainingEffect"),
                "raw": json.dumps(a),
            }, "activity_id")
            n += 1
        conn.commit()
        print(f"  activités : {n} récupérées...", flush=True)
        if len(batch) < 100:
            break
        offset += 100
    return n


def sync_daily(conn, c, start, end, skip_done=False):
    n = 0
    plages = list(chunks(start, end))
    for i, (s, e) in enumerate(plages, 1):
        if skip_done and chunk_done(conn, "daily", e):
            continue
        try:
            data = (call(c.get_daily_summaries, s, e) or {}).get("data", [])
        except HttpError as ex:
            if ex.status_code == 401:
                raise
            print(f"  ! jours {s}→{e} ignoré : {ex.status_code}")
            continue
        for d in data:
            g = lambda *keys: _dig(d, *keys)
            upsert(conn, "daily", {
                "date": d["calendarDate"],
                "steps": g("movement", "steps", "value"),
                "step_goal": g("movement", "steps", "goal"),
                "distance_m": g("movement", "steps", "distanceInMeters"),
                "resting_hr": g("heartRate", "restingValue"),
                "min_hr": g("heartRate", "minValue"),
                "max_hr": g("heartRate", "maxValue"),
                "stress_avg": g("stress", "avgLevel"),
                "body_battery_min": g("bodyBattery", "minValue"),
                "body_battery_max": g("bodyBattery", "maxValue"),
                "calories_total": g("calories", "burnedTotal"),
                "calories_active": g("calories", "burnedActive"),
                "intensity_moderate": g("intensityMinutes", "moderate"),
                "intensity_vigorous": g("intensityMinutes", "vigorous"),
                "raw": json.dumps(d),
            }, "date")
            n += 1
        conn.commit()
        print(f"  jours : plage {i}/{len(plages)} ({s} → {e})", flush=True)
    return n


def sync_sleep(conn, c, start, end, skip_done=False):
    n = 0
    plages = list(chunks(start, end))
    for i, (s, e) in enumerate(plages, 1):
        if skip_done and chunk_done(conn, "sleep", e):
            continue
        try:
            data = call(c.get_daily_sleep_summaries, s, e) or []
        except HttpError as ex:
            if ex.status_code == 401:
                raise
            print(f"  ! sommeil {s}→{e} ignoré : {ex.status_code}")
            continue
        for x in data:
            upsert(conn, "sleep", {
                "date": x["calendarDate"],
                "sleep_s": x.get("sleepTimeSeconds"),
                "deep_s": x.get("deepSleepSeconds"),
                "light_s": x.get("lightSleepSeconds"),
                "rem_s": x.get("remSleepSeconds"),
                "awake_s": x.get("awakeSleepSeconds"),
                "avg_resp": x.get("averageRespirationValue"),
                "raw": json.dumps(x),
            }, "date")
            n += 1
        conn.commit()
        print(f"  sommeil : plage {i}/{len(plages)} ({s} → {e})", flush=True)
    return n


# ---------- main ----------

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--full", action="store_true",
                   help="tout l'historique ; reprenable si interrompu")
    p.add_argument("--since", help="date de début YYYY-MM-DD pour jours/sommeil")
    p.add_argument("--days", type=int, default=90,
                   help="historique jours/sommeil si la base est vide (défaut 90)")
    args = p.parse_args()

    conn = sqlite3.connect(DB_PATH)
    conn.executescript(SCHEMA)
    today = date.today()

    last_act = conn.execute("SELECT MAX(date) FROM activities").fetchone()[0]
    last_day = conn.execute("SELECT MAX(date) FROM daily").fetchone()[0]

    with get_client() as c:
        # --- Activités ---
        if args.full or not last_act:
            print("Activités : historique complet")
            act_start = None
        else:
            act_start = date.fromisoformat(last_act) - timedelta(days=3)
        na = sync_activities(conn, c, act_start, today)

        # --- Jours / sommeil ---
        if args.since:
            start = date.fromisoformat(args.since)
        elif args.full:
            first = conn.execute("SELECT MIN(date) FROM activities").fetchone()[0]
            start = date.fromisoformat(first) if first else today - timedelta(days=args.days)
        elif last_day:
            start = date.fromisoformat(last_day) - timedelta(days=3)
        else:
            start = today - timedelta(days=args.days)

        print(f"Jours/sommeil : {start} → {today}")
        nd = sync_daily(conn, c, start, today, skip_done=args.full)
        ns = sync_sleep(conn, c, start, today, skip_done=args.full)

    conn.execute(
        "INSERT INTO sync_log (start_date, end_date, n_activities, n_days, n_sleep) "
        "VALUES (?,?,?,?,?)",
        (start.isoformat(), today.isoformat(), na, nd, ns),
    )
    conn.commit()
    print(f"Terminé : {na} activités, {nd} jours, {ns} nuits")


if __name__ == "__main__":
    main()