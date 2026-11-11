"""Teste quelles données de santé Garmin l'API personnelle expose réellement.

    python probe_garmin.py

Affiche, pour chaque donnée, OK (avec un extrait) ou le code HTTP renvoyé. Les chemins viennent des
services internes de Garmin Connect : certains peuvent ne pas être ouverts à l'API personnelle.
"""
from datetime import date

from garmin_personal_api.errors import GarminPersonalApiError

from sync import get_client

today = date.today().isoformat()

with get_client() as c:
    name = c.get_user_profile_settings().get("displayName", "")
    tests = {
        "VO2max": f"/metrics-service/metrics/maxmet/latest/{today}",
        "Prédicteur de course": f"/metrics-service/metrics/racepredictions/latest/{name}",
        "Statut d'entraînement (charge)": f"/metrics-service/metrics/trainingstatus/aggregated/{today}",
        "Disponibilité à l'entraînement": f"/metrics-service/metrics/trainingreadiness/{today}",
    }
    for label, path in tests.items():
        try:
            print(f"OK   {label}: {str(c.get(path))[:200]}")
        except GarminPersonalApiError as e:
            print(f"--   {label}: {getattr(e, 'status_code', e)}")
