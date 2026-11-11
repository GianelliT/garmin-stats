"""VO2max et prédictions de course calculés par la montre, lus sur Garmin Connect avec vos identifiants
(bibliothèque `garminconnect`, comme le fait garmin-grafana). Les valeurs sont rangées dans garmin.db (table garmin_fitness).

    pip install garminconnect
    python connect_sync.py --login   # une seule fois : e-mail, mot de passe (+ code MFA si votre compte en a un)
    python connect_sync.py           # ensuite : sans mot de passe, c'est ce que lance le bouton Synchroniser

Le mot de passe n'est jamais enregistré : seuls des jetons de connexion le sont (~/.config/garmin/connect-tokens,
lisibles par vous seul). Variable GARMINTOKENS pour changer l'emplacement ; GARMIN_EMAIL / GARMIN_PASSWORD acceptées
en secours si les jetons ont expiré. Ce n'est pas l'API officielle : Garmin peut limiter ou bloquer les connexions.
"""
import argparse
import getpass
import os
import sqlite3
import sys
from datetime import date, timedelta
from pathlib import Path

from db import DB_PATH, ensure_fitness

TOKENS = Path(os.environ.get("GARMINTOKENS") or Path.home() / ".config" / "garmin" / "connect-tokens")
NOT_CONFIGURED = 3     # code de sortie « pas encore de connexion » (le bouton Synchroniser l'affiche sans le traiter en échec)
HISTORY_DAYS = 730     # historique (VO2max et prédictions) récupéré à la première synchronisation
RACES = (("t5k", "time5K", "5 km"), ("t10k", "time10K", "10 km"), ("thalf", "timeHalfMarathon", "Semi"), ("tmarathon", "timeMarathon", "Marathon"))


def _num(v):
    try:
        v = float(v)
    except (TypeError, ValueError):
        return None
    return v if v > 0 else None


def _hms(sec):
    h, r = divmod(int(sec), 3600)
    return f"{h}:{r // 60:02d}:{r % 60:02d}" if h else f"{r // 60}:{r % 60:02d}"


def parse_vo2(resp):
    """Réponse « max metrics » (un jour ou une plage) -> {date: (vo2max course, vo2max vélo)}."""
    items = resp if isinstance(resp, list) else [resp] if isinstance(resp, dict) else []
    out = {}
    for it in items:
        if not isinstance(it, dict):
            continue
        run, bike = it.get("generic") or {}, it.get("cycling") or {}
        day = run.get("calendarDate") or bike.get("calendarDate")
        v = _num(run.get("vo2MaxPreciseValue") or run.get("vo2MaxValue"))
        b = _num(bike.get("vo2MaxPreciseValue") or bike.get("vo2MaxValue"))
        if day and (v or b):
            out[str(day)[:10]] = (v, b)
    return out


def parse_race(resp):
    """Réponse « race predictions » -> (date, {t5k, t10k, thalf, tmarathon} en secondes) ou None."""
    if isinstance(resp, list):
        resp = max((r for r in resp if isinstance(r, dict)), key=lambda r: str(r.get("calendarDate")), default=None)
    if not isinstance(resp, dict):
        return None
    times = {col: _num(resp.get(field)) for col, field, _ in RACES}
    return (str(resp.get("calendarDate") or date.today())[:10], times) if any(times.values()) else None


def parse_race_history(resp):
    """Réponse « race predictions » sur une plage -> {date: {t5k, t10k, thalf, tmarathon}}."""
    items = resp if isinstance(resp, list) else [resp] if isinstance(resp, dict) else []
    out = {}
    for it in items:
        r = parse_race(it)
        if r:
            out[r[0]] = r[1]
    return out


def save(conn, day, **cols):
    """Enregistre les colonnes connues pour ce jour sans effacer les autres."""
    cols = {k: v for k, v in cols.items() if v is not None}
    if cols:
        names = ["date", *cols]
        conn.execute(f"INSERT INTO garmin_fitness ({','.join(names)}) VALUES ({','.join('?' * len(names))}) "
                     f"ON CONFLICT(date) DO UPDATE SET {','.join(f'{k}=excluded.{k}' for k in cols)}", [day, *cols.values()])


def connect(interactive):
    try:
        from garminconnect import Garmin
    except ImportError:
        sys.exit("La bibliothèque garminconnect manque : pip install garminconnect")
    email, password = os.environ.get("GARMIN_EMAIL"), os.environ.get("GARMIN_PASSWORD")
    if interactive:
        email = email or input("E-mail Garmin : ").strip()
        password = password or getpass.getpass("Mot de passe : ")
        g = Garmin(email, password, prompt_mfa=lambda: input("Code de vérification (MFA) : ").strip())
    elif not TOKENS.exists() and not (email and password):
        print("Valeurs Garmin non configurées : lancez une fois « python connect_sync.py --login »", flush=True)
        sys.exit(NOT_CONFIGURED)
    else:
        g = Garmin(email, password)
    g.login(str(TOKENS))
    return g


def run(g):
    today = date.today()
    conn = sqlite3.connect(DB_PATH)
    ensure_fitness(conn)
    known = conn.execute("SELECT COUNT(*) FROM garmin_fitness WHERE vo2max IS NOT NULL").fetchone()[0]
    start = today - timedelta(days=HISTORY_DAYS if known < 5 else 14)   # première fois : historique ; ensuite : 2 semaines
    got = 0

    cur = start
    while cur <= today:
        end = min(cur + timedelta(days=89), today)
        try:
            for day, (v, b) in parse_vo2(g.connectapi(f"{g.garmin_connect_metrics_url}/{cur}/{end}")).items():
                save(conn, day, vo2max=v, vo2max_cycling=b)
                got += 1
        except Exception as e:                      # noqa: BLE001 : on tente au moins la valeur du jour
            print(f"  VO2max {cur} → {end} : plage indisponible ({e})", flush=True)
            try:
                for day, (v, b) in parse_vo2(g.get_max_metrics(today.isoformat())).items():
                    save(conn, day, vo2max=v, vo2max_cycling=b)
                    got += 1
            except Exception as e2:                 # noqa: BLE001
                print(f"  VO2max indisponible : {e2}", flush=True)
        cur = end + timedelta(days=1)
    conn.commit()
    last = conn.execute("SELECT date, vo2max FROM garmin_fitness WHERE vo2max IS NOT NULL ORDER BY date DESC LIMIT 1").fetchone()
    print(f"  VO2max : {last[1]:.1f} ({last[0]})" if last else "  VO2max : aucune valeur (votre montre n'en fournit peut-être pas)", flush=True)

    known_race = conn.execute("SELECT COUNT(*) FROM garmin_fitness WHERE t5k IS NOT NULL OR t10k IS NOT NULL").fetchone()[0]
    if known_race < 30:      # première fois : historique des prédictions (jour par jour la dernière année, mois par mois l'année d'avant)
        for lo, hi, kind in ((today - timedelta(days=360), today, "daily"), (today - timedelta(days=720), today - timedelta(days=361), "monthly")):
            try:
                for day, times in parse_race_history(g.get_race_predictions(lo.isoformat(), hi.isoformat(), kind)).items():
                    save(conn, day, **times)
                    got += 1
            except Exception as e:                  # noqa: BLE001 : l'historique est un plus
                print(f"  Historique des prédictions {lo} → {hi} indisponible : {e}", flush=True)
        conn.commit()
    try:
        race = parse_race(g.get_race_predictions())
    except Exception as e:                          # noqa: BLE001
        race = None
        print(f"  Prédictions indisponibles : {e}", flush=True)
    if race:
        save(conn, race[0], **race[1])
        got += 1
        print("  Prédictions : " + ", ".join(f"{lab} {_hms(race[1][c])}" for c, _, lab in RACES if race[1][c]), flush=True)
    elif got == 0:
        print("  Prédictions : aucune valeur", flush=True)
    conn.commit()
    conn.close()
    return got


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--login", action="store_true", help="se connecter (identifiants + MFA) et mémoriser les jetons")
    args = ap.parse_args()
    try:
        from garminconnect import GarminConnectAuthenticationError, GarminConnectTooManyRequestsError
    except ImportError:
        sys.exit("La bibliothèque garminconnect manque : pip install garminconnect")
    try:
        got = run(connect(args.login))
    except GarminConnectAuthenticationError as e:
        sys.exit(f"Connexion Garmin refusée ou expirée ({e}). Relancez : python connect_sync.py --login")
    except GarminConnectTooManyRequestsError:
        sys.exit("Garmin limite temporairement les connexions (429). Réessayez dans une heure.")
    except Exception as e:                          # noqa: BLE001
        sys.exit(f"Garmin Connect : {e}")
    print(f"Terminé : {got} valeur(s) enregistrée(s)")


if __name__ == "__main__":
    main()
