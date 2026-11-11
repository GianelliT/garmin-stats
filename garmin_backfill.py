"""Récupère tout l'historique VO2max et prédictions de course (5 km, 10 km, semi, marathon) de Garmin Connect.

Contrairement à connect_sync.py (qui ne remonte que 2 ans la première fois, puis 14 jours), cette fonction
interroge TOUJOURS toute la période demandée, quel que soit le contenu actuel de garmin.db. Les valeurs sont
enregistrées dans la table garmin_fitness : une ligne par jour, les valeurs existantes sont mises à jour, rien n'est
supprimé et rien n'est dupliqué — on peut donc la relancer sans risque.

    from connect_sync import connect
    from garmin_backfill import backfill_fitness
    stats = backfill_fitness(connect(interactive=False), years=20)

ou en ligne de commande :  python garmin_backfill.py [--years 20] [--login]
"""
import argparse
import sqlite3
import sys
import time
from datetime import date, timedelta

from connect_sync import connect, parse_race_history, parse_vo2, save
from db import DB_PATH, ensure_fitness

VO2_WINDOW = 89          # jours par requête « max metrics » (même plage que connect_sync.py)
RACE_WINDOW = 360        # jours par requête « race predictions »
GIVE_UP_AFTER = 730      # on s'arrête quand plus aucune valeur n'a été vue depuis ce nombre de jours (avant l'apparition de la fonction sur la montre)


def _call(label, fn, *args, retries=2, verbose=True):
    """Appelle l'API ; en cas de limitation (429) attend puis réessaie. Renvoie None si ça échoue."""
    for attempt in range(retries + 1):
        try:
            return fn(*args)
        except Exception as e:                      # noqa: BLE001
            if "TooManyRequests" in type(e).__name__ and attempt < retries:
                wait = 30 * (attempt + 1)
                if verbose:
                    print(f"  {label} : limite Garmin atteinte, pause {wait} s", flush=True)
                time.sleep(wait)
                continue
            if verbose:
                print(f"  {label} : indisponible ({e})", flush=True)
            return None


def backfill_fitness(g, years=20, db_path=DB_PATH, pause=0.4, verbose=True):
    """Télécharge VO2max (course et vélo) et prédicteur de course sur `years` années, en remontant le temps.

    g      : client garminconnect déjà connecté (voir connect_sync.connect)
    pause  : secondes d'attente entre deux requêtes, pour ne pas se faire limiter par Garmin
    Renvoie {"vo2max": jours enregistrés, "races": jours enregistrés, "first": date la plus ancienne, "last": la plus récente}.
    """
    today = date.today()
    limit = today - timedelta(days=round(years * 365.25))
    conn = sqlite3.connect(db_path)
    ensure_fitness(conn)
    n_vo2 = n_race = 0
    seen = set()

    # ── VO2max : fenêtres de 90 jours, de la plus récente à la plus ancienne ──
    end, oldest_seen = today, None
    while end >= limit:
        start = max(end - timedelta(days=VO2_WINDOW), limit)
        resp = _call(f"VO2max {start} → {end}", g.connectapi, f"{g.garmin_connect_metrics_url}/{start}/{end}", verbose=verbose)
        found = parse_vo2(resp) if resp is not None else {}
        for day, (v, b) in found.items():
            save(conn, day, vo2max=v, vo2max_cycling=b)
            n_vo2 += 1
            seen.add(day)
        if found:
            oldest_seen = start
        conn.commit()
        if verbose:
            print(f"  VO2max {start} → {end} : {len(found)} valeur(s)", flush=True)
        if oldest_seen and (oldest_seen - start).days >= GIVE_UP_AFTER:
            break                                   # plus rien depuis 2 ans : la montre n'en fournissait pas encore
        end = start - timedelta(days=1)
        time.sleep(pause)

    # ── Prédicteur de course : par année, « daily » si disponible, sinon « monthly » ──
    end, oldest_seen = today, None
    while end >= limit:
        start = max(end - timedelta(days=RACE_WINDOW), limit)
        found = {}
        for kind in ("daily", "monthly"):
            resp = _call(f"Prédictions {start} → {end} ({kind})", g.get_race_predictions, start.isoformat(), end.isoformat(), kind, verbose=verbose and kind == "monthly")
            found = parse_race_history(resp) if resp is not None else {}
            if found:
                break
            time.sleep(pause)
        for day, times in found.items():
            save(conn, day, **times)
            n_race += 1
            seen.add(day)
        if found:
            oldest_seen = start
        conn.commit()
        if verbose:
            print(f"  Prédictions {start} → {end} : {len(found)} valeur(s)", flush=True)
        if oldest_seen and (oldest_seen - start).days >= GIVE_UP_AFTER:
            break
        end = start - timedelta(days=1)
        time.sleep(pause)

    conn.close()
    result = {"vo2max": n_vo2, "races": n_race, "first": min(seen) if seen else None, "last": max(seen) if seen else None}
    if verbose:
        print(f"Terminé : {n_vo2} VO2max, {n_race} prédictions ({result['first']} → {result['last']})", flush=True)
    return result


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--years", type=int, default=20, help="nombre d'années à remonter (20 par défaut)")
    ap.add_argument("--login", action="store_true", help="se connecter (identifiants + MFA) et mémoriser les jetons")
    a = ap.parse_args()
    try:
        backfill_fitness(connect(a.login), years=a.years)
    except Exception as e:                          # noqa: BLE001
        sys.exit(f"Garmin Connect : {e}")
