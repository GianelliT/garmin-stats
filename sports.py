"""Regroupe les types d'activité Garmin (typeKey) en familles de sports.
Source unique du regroupement : l'API renvoie `family` pour chaque activité."""

FAMILIES = {
    "run": ("running", "trail_running", "treadmill_running", "track_running", "virtual_run", "street_running"),
    "bike": ("cycling", "road_biking", "mountain_biking", "gravel_cycling", "indoor_cycling", "virtual_ride",
             "cyclocross", "e_bike_fitness", "e_bike_mountain", "e_bike_road", "track_cycling"),
    "swim": ("lap_swimming", "open_water_swimming", "swimming"),
    "walk": ("walking", "hiking", "casual_walking", "speed_walking"),
    "strength": ("strength_training", "hiit", "cardio", "indoor_cardio", "yoga", "pilates", "elliptical",
                 "stair_stepper", "fitness_equipment"),
}
# mots-clés pour les types inconnus (ex. un futur « e_bike_gravel »)
KEYWORDS = (("run", "run"), ("bike", "bik"), ("bike", "cycl"), ("bike", "ride"), ("swim", "swim"),
            ("walk", "walk"), ("walk", "hik"))


def family(type_key):
    for fam, keys in FAMILIES.items():
        if type_key in keys:
            return fam
    t = (type_key or "").lower()
    return next((fam for fam, kw in KEYWORDS if kw in t), "other")
