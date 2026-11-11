"""Associe un pays, une région et une ville à chaque activité (géocodage inverse OpenStreetMap / Nominatim).

Les points de départ sont regroupés par cellule d'environ 1 km : peu d'appels, au rythme de 1 par seconde
(limite de Nominatim). Reprenable : les zones déjà connues ne sont pas redemandées.

    python geocode.py
"""
import json
import sqlite3
import time
import urllib.parse
import urllib.request

from db import DB_PATH, ensure_places, place_key

URL = "https://nominatim.openstreetmap.org/reverse?"
HEADERS = {"User-Agent": "garmin-stats-personal/1.0 (usage personnel)"}


def lookup(lat, lon):
    q = urllib.parse.urlencode({"format": "jsonv2", "lat": lat, "lon": lon, "zoom": 10, "accept-language": "fr"})
    with urllib.request.urlopen(urllib.request.Request(URL + q, headers=HEADERS), timeout=20) as r:
        a = json.load(r).get("address", {})
    city = next((a[k] for k in ("city", "town", "village", "municipality", "hamlet") if k in a), None)
    return a.get("country"), a.get("state") or a.get("region") or a.get("county"), city


def cells(conn):
    """Cellule -> (lat, lon) du premier départ rencontré, pour toutes les activités avec position."""
    out = {}
    for (raw,) in conn.execute("SELECT raw FROM activities"):
        r = json.loads(raw or "{}")
        lat, lon = r.get("startLatitude"), r.get("startLongitude")
        if lat is not None and lon is not None:
            out.setdefault(place_key(lat, lon), (lat, lon))
    return out


def main():
    conn = sqlite3.connect(DB_PATH)
    ensure_places(conn)
    known = {k for (k,) in conn.execute("SELECT key FROM places")}
    todo = {k: v for k, v in cells(conn).items() if k not in known}
    print(f"{len(todo)} zones à localiser ({len(known)} déjà connues)")
    for n, (key, (lat, lon)) in enumerate(todo.items(), 1):
        try:
            country, region, city = lookup(lat, lon)
        except Exception as e:
            print(f"  ! {key} : {e}")
            time.sleep(5)
            continue
        conn.execute("INSERT OR REPLACE INTO places VALUES (?,?,?,?)", (key, country, region, city))
        conn.commit()
        print(f"  {n}/{len(todo)}  {city}, {region}, {country}", flush=True)
        time.sleep(1.1)


if __name__ == "__main__":
    main()
