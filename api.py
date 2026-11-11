import os
from datetime import date, timedelta
from pathlib import Path

from garmin_personal_api import (
    GarminPersonalApiClient,
    PersonalApiAuthenticator,
    resolve_api_key,
)

def get_client() -> GarminPersonalApiClient:
    with PersonalApiAuthenticator() as auth:
        token = auth.obtain_token(resolve_api_key())
    return GarminPersonalApiClient(token.access_token)


def today() -> str:
    return date.today().isoformat()

def days_ago(n: int) -> str:
    return (date.today() - timedelta(days=n)).isoformat()


if __name__ == "__main__":
    with get_client() as c:
        # Profil
        print(c.get_user_profile_settings())

        # Données d'un jour précis
        print(c.get_daily_sleep(today()))
        print(c.get_daily_heart_rate(today()))
        print(c.get_daily_hrv(today()))
        print(c.get_daily_spo2(today()))
        print(c.get_fitness_age(today()))
        print(c.get_daily_food_logs(today()))

        # Données sur une plage de dates
        start, end = days_ago(7), today()
        print(c.get_daily_steps(start, end))
        print(c.get_daily_stress(start, end))
        print(c.get_daily_hydration(start, end))
        print(c.get_daily_body_battery(start, end))
        print(c.get_daily_summaries(start, end))
        print(c.get_daily_sleep_summaries(start, end))
        print(c.get_daily_hrv_summaries(start, end))
        print(c.get_weight_measurements(start, end))
        print(c.get_wellness_activity_summaries(start, end))
        print(c.get_heart_rate_zones())

        # Activités
        activities = c.search_activities(start=0, limit=20, start_date=days_ago(30))
        print(activities)

        # Détail et fichier d'une activité (le téléchargement renvoie un ZIP)
        # activity_id = ...  # à prendre dans la liste ci-dessus
        # print(c.get_activity(activity_id))
        # print(c.get_activity_workouts(activity_id))
        # Path(f"activity-{activity_id}.zip").write_bytes(c.download_activity(activity_id))

        # Endpoint sans wrapper (voir le Swagger)
        # c.get("/some-service/some-resource", params={"calendarDate": today()})