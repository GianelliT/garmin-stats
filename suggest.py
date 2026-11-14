"""Catégorie proposée pour une course à pied pas encore classée.

Règles volontairement prudentes : on ne propose que ce qui se déduit sans ambiguïté des données Garmin.
Course et Footing ne sont jamais proposés (rien dans l'activité ne les distingue de façon fiable).
  1. type Garmin « trail_running »  -> Trail
  2. type Garmin « track_running »  -> Séance (piste)
  3. alternance de tours rapides / lents détectée (series.split_efforts)  -> Séance
"""
import series


def suggest_for(type_key, laps):
    """{"category", "reason"} pour cette activité, ou None si rien d'évident."""
    if type_key == "trail_running":
        return {"category": "trail", "reason": "type d'activité Garmin : trail"}
    if type_key == "track_running":
        return {"category": "seance", "reason": "type d'activité Garmin : piste"}
    fast = series.split_efforts(laps or [])
    if fast:
        return {"category": "seance", "reason": f"{len(fast)} tours rapides détectés"}
    return None
