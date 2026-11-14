"""Statistiques du dashboard : fonctions pures DataFrame -> données JSON.

Colonnes : id, name, type, family, category, date, hour, km, fast_km, duration_s, elevation_m, best_* (voir app.load_df).
Ajouter une stat : une fonction ici + une ligne dans STATS (app.py) + un widget dans dashboard.js.
"""
import pandas as pd

DAYS = ["Lun", "Mar", "Mer", "Jeu", "Ven", "Sam", "Dim"]
r1 = lambda v: round(float(v), 1)


def _stack(df, col, freq, fmt):
    """Totaux par période, empilés par famille de sport (périodes vides incluses)."""
    if df.empty:
        return {"labels": [], "series": {}}
    s = df.set_index("date")
    idx = s[col].resample(freq, label="left", closed="left").sum().index
    wide = (s.groupby("family")[col].resample(freq, label="left", closed="left").sum()
            .unstack(0).reindex(idx).fillna(0))
    return {"labels": [d.strftime(fmt) for d in idx], "series": {f: [r1(v) for v in wide[f]] for f in wide.columns}}


def weekly(df): return _stack(df, "km", "W-MON", "%Y-%m-%d")


# Hausse trop rapide du volume : une semaine est signalée quand ses km dépassent de ALERT_PCT % la moyenne des ALERT_WINDOW semaines
# précédentes. On compare à une moyenne (et non à la seule semaine d'avant) pour ne pas crier au loup après une semaine de repos.
# Les petits volumes sont ignorés : +50 % de 6 km à 9 km n'est pas un risque.
ALERT_WINDOW, ALERT_PCT, ALERT_HIGH_PCT = 4, 40, 60
ALERT_MIN_BASE_KM, ALERT_MIN_KM = 15, 20
CATEGORY_KEYS = ("course", "footing", "seance", "trail", "none")


def volume_alerts(totals):
    """Semaines (indices dans `totals`) dont le volume a trop augmenté : [{i, km, base, pct, level}]. level : « warn » ou « high »."""
    out = []
    for i in range(ALERT_WINDOW, len(totals)):
        base = sum(totals[i - ALERT_WINDOW:i]) / ALERT_WINDOW
        if base < ALERT_MIN_BASE_KM or totals[i] < ALERT_MIN_KM:
            continue
        pct = (totals[i] / base - 1) * 100
        if pct >= ALERT_PCT:
            out.append({"i": i, "km": r1(totals[i]), "base": r1(base), "pct": round(pct), "level": "high" if pct >= ALERT_HIGH_PCT else "warn"})
    return out


SPLIT_KEYS = ("footing", "trail", "course", "seance")


def _nuanced_km(run):
    """Kilomètres de course à pied découpés par catégorie, une ligne (date, cat, km) par morceau. Une séance ne compte que pour ses
    tours rapides (`fast_km`) ; le reste (échauffement, récupérations, retour au calme) est compté en footing. Les courses sans
    catégorie sont en « none ». Source unique pour l'anneau des km et le volume hebdomadaire : les deux affichent les mêmes valeurs."""
    cat = run["category"].fillna("none")
    is_s = cat == "seance"
    fast = run["fast_km"] if "fast_km" in run else pd.Series(0.0, index=run.index)
    fast = pd.concat([fast.clip(lower=0), run["km"]], axis=1).min(axis=1)      # jamais plus que la distance de l'activité
    main = pd.DataFrame({"date": run["date"], "cat": cat, "km": run["km"].where(~is_s, fast)})
    rest = pd.DataFrame({"date": run.loc[is_s, "date"], "cat": "footing", "km": (run["km"] - fast)[is_s]})
    return pd.concat([main, rest], ignore_index=True)


def category_split(df):
    """Répartition des courses classées entre footing, trail, course et séance : en nombre d'activités et en kilomètres.
    En kilomètres, une séance ne compte que pour ses tours rapides (`fast_km`) ; le reste (échauffement, récupérations, retour au calme)
    est compté en footing. Une séance sans tour rapide détecté (ou sans tours enregistrés) passe donc entièrement en footing."""
    run = df[df["family"] == "run"]
    if run.empty:
        return {}
    done = run[run["category"].isin(SPLIT_KEYS)]
    seance = done[done["category"] == "seance"]
    fast_col = seance["fast_km"] if "fast_km" in seance else pd.Series(0.0, index=seance.index)
    fast = pd.concat([fast_col, seance["km"]], axis=1).min(axis=1)      # jamais plus que la distance de la séance
    nuanced = _nuanced_km(done).groupby("cat")["km"].sum()
    km = {k: float(nuanced.get(k, 0.0)) for k in SPLIT_KEYS}
    seance_total = float(seance["km"].sum())
    return {"count": {k: int((done["category"] == k).sum()) for k in SPLIT_KEYS}, "km": {k: r1(v) for k, v in km.items()},
            "seance": {"n": len(seance), "km": r1(seance_total), "fast_km": r1(fast.sum()), "no_fast": int((fast <= 0).sum())},
            "unclassified": int(run["category"].isna().sum())}


def category_volume(df):
    """Km par semaine de course à pied, empilés par catégorie (course, footing, séance, trail, sans catégorie), et hausses trop rapides.
    Le total de la semaine est celui de toutes les courses : découper une séance entre séance et footing ne change pas le total."""
    df = df[df["family"] == "run"]
    rule = {"window": ALERT_WINDOW, "pct": ALERT_PCT, "high_pct": ALERT_HIGH_PCT, "min_base_km": ALERT_MIN_BASE_KM, "min_km": ALERT_MIN_KM}
    if df.empty:
        return {"labels": [], "series": {}, "alerts": [], "rule": rule}
    s = _nuanced_km(df).set_index("date")      # séance = tours rapides seulement, le reste en footing (comme l'anneau des km)
    idx = s["km"].resample("W-MON", label="left", closed="left").sum().index
    wide = s.groupby("cat")["km"].resample("W-MON", label="left", closed="left").sum().unstack(0).reindex(idx).fillna(0)
    labels = [d.strftime("%Y-%m-%d") for d in idx]
    alerts = volume_alerts([float(v) for v in wide.sum(axis=1)])
    for a in alerts:
        a["week"] = labels[a["i"]]
    return {"labels": labels, "series": {c: [r1(v) for v in wide[c]] for c in CATEGORY_KEYS if c in wide.columns}, "alerts": alerts, "rule": rule}
def monthly(df): return _stack(df, "km", "MS", "%Y-%m")
def hours_monthly(df): return _stack(df.assign(h=df["duration_s"] / 3600), "h", "MS", "%Y-%m")


def summary(df):
    km, sec = float(df["km"].sum()), float(df["duration_s"].sum())
    return {"n": len(df), "km": r1(km), "hours": r1(sec / 3600),
            "elev": int(df["elevation_m"].sum()), "longest": r1(df["km"].max()) if len(df) else 0,
            "pace_s": round(sec / km) if km > 0 else None,          # allure moyenne (s/km)
            "kmh": r1(km / (sec / 3600)) if km > 0 and sec > 0 else None}


def current_week(df, today=None):
    today = pd.Timestamp(today or pd.Timestamp.today()).normalize()      # today : une date « AAAA-MM-JJ » permet de consulter une autre semaine
    monday = today - pd.Timedelta(days=today.weekday())
    w = df[(df["date"] >= monday) & (df["date"] < monday + pd.Timedelta(days=7))]
    km = w.groupby(w["date"].dt.weekday)["km"].sum()
    last_monday = monday - pd.Timedelta(days=7)   # semaine précédente, jusqu'au même jour : comparaison à périmètre égal
    prev = df[(df["date"] >= last_monday) & (df["date"] <= last_monday + pd.Timedelta(days=today.weekday()))]
    return {"days": DAYS, "km": [r1(km.get(i, 0)) for i in range(7)], "total_km": r1(w["km"].sum()),
            "n": len(w), "hours": r1(w["duration_s"].sum() / 3600), "last_km": r1(prev["km"].sum()),
            "today": int(today.weekday()), "monday": monday.strftime("%Y-%m-%d")}


def pace_monthly(df):
    """Allure (s/km) et vitesse (km/h) moyennes par mois, pondérées par la distance."""
    d = df[df["km"] > 0]
    if d.empty:
        return {"labels": [], "pace_s": [], "kmh": []}
    g = d.set_index("date").resample("MS").agg({"km": "sum", "duration_s": "sum"})
    ok = [k > 0 and s > 0 for k, s in zip(g["km"], g["duration_s"])]
    return {"labels": [x.strftime("%Y-%m") for x in g.index],
            "pace_s": [round(float(s / k)) if o else None for k, s, o in zip(g["km"], g["duration_s"], ok)],
            "kmh": [r1(k / (s / 3600)) if o else None for k, s, o in zip(g["km"], g["duration_s"], ok)]}


def cumulative(df, today=None):
    """Km cumulés jour par jour, une courbe par année."""
    today = pd.Timestamp(today or pd.Timestamp.today()).normalize()
    out = {}
    for year, g in df.groupby(df["date"].dt.year):
        last = today.dayofyear if year == today.year else 366
        daily = g.groupby(g["date"].dt.dayofyear)["km"].sum().reindex(range(1, last + 1), fill_value=0)
        out[str(year)] = [r1(v) for v in daily.cumsum()]
    return out


def sports(df):
    g = (df.assign(h=df["duration_s"] / 3600).groupby("family")
         .agg(n=("id", "count"), km=("km", "sum"), hours=("h", "sum")).sort_values("km", ascending=False))
    return [{"family": f, "n": int(r["n"]), "km": r1(r["km"]), "hours": r1(r["hours"])} for f, r in g.iterrows()]


def weekday(df):
    g = df.groupby(df["date"].dt.weekday).agg(km=("km", "sum"), n=("id", "count"))
    return {"days": DAYS, "km": [r1(g["km"].get(i, 0)) for i in range(7)], "n": [int(g["n"].get(i, 0)) for i in range(7)]}


def hour_of_day(df):
    c = df["hour"].value_counts()
    return {"labels": [f"{h} h" for h in range(24)], "n": [int(c.get(h, 0)) for h in range(24)]}


BINS = [0, 5, 10, 15, 21.1, 30, 42.2, float("inf")]
BIN_LABELS = ["< 5 km", "5–10", "10–15", "15–21", "21–30", "30–42", "> 42 km"]


def distances(df):
    c = pd.cut(df.loc[df["km"] > 0, "km"], BINS, labels=BIN_LABELS, right=False).value_counts()
    return {"labels": BIN_LABELS, "n": [int(c.get(l, 0)) for l in BIN_LABELS]}


def yearly(df):
    g = (df.assign(h=df["duration_s"] / 3600).groupby(df["date"].dt.year)
         .agg(km=("km", "sum"), n=("id", "count"), hours=("h", "sum"), elev=("elevation_m", "sum")))
    return [{"year": int(y), "km": r1(r["km"]), "n": int(r["n"]), "hours": r1(r["hours"]), "elev": int(r["elev"])}
            for y, r in g.iterrows()]


def calendar(df):
    g = df.groupby(df["date"].dt.strftime("%Y-%m-%d")).agg(km=("km", "sum"), n=("id", "count"))
    return [{"d": d, "km": r1(r["km"]), "n": int(r["n"])} for d, r in g.iterrows()]


def streaks(df):
    """Séries de jours consécutifs et nombre d'Eddington (E jours à au moins E km)."""
    days = df.groupby("date")["km"].sum()
    if days.empty:
        return {"longest": 0, "current": 0, "eddington": 0, "to_next": 1}
    ds = sorted(d.date() for d in days.index)
    longest = run = 1
    for a, b in zip(ds, ds[1:]):
        run = run + 1 if (b - a).days == 1 else 1
        longest = max(longest, run)
    current = run if (pd.Timestamp.today().date() - ds[-1]).days <= 1 else 0
    km = sorted(days.values, reverse=True)
    e = sum(1 for i, v in enumerate(km, 1) if v >= i)
    return {"longest": longest, "current": current, "eddington": e, "to_next": int((e + 1) - sum(v >= e + 1 for v in km))}


EFFORTS = [("1 km", "best_1000"), ("5 km", "best_5000"), ("10 km", "best_10000"), ("Semi-marathon", "best_21098")]


def best_efforts(df):
    """Meilleurs segments de course détectés par Garmin dans vos sorties."""
    runs, out = df[df["family"] == "run"], []
    for label, col in EFFORTS:
        s = runs[col].dropna()
        if not s.empty:
            i = s.idxmin()
            out.append({"label": label, "time_s": round(float(s[i])), "id": int(runs.loc[i, "id"]),
                        "date": runs.loc[i, "date"].strftime("%Y-%m-%d")})
    return out


EFFORT_KM = {"1 km": 1.0, "5 km": 5.0, "10 km": 10.0, "Semi-marathon": 21.0975}


def efforts(df):
    """Tous les meilleurs segments (1 km, 5 km, 10 km, semi) détectés par Garmin, séance par séance : de quoi tracer la progression."""
    runs, out = df[df["family"] == "run"], {}
    for label, col in EFFORTS:
        s = runs[col].dropna()
        out[label] = [{"id": int(runs.loc[i, "id"]), "name": runs.loc[i, "name"], "date": runs.loc[i, "date"].strftime("%Y-%m-%d"),
                       "time_s": round(float(v)), "km": EFFORT_KM[label]} for i, v in s.items()]
        out[label].sort(key=lambda e: e["date"])
    return out


def podium(df, top=5):
    top = max(1, min(int(top), 100))
    return {f: [{"id": int(r["id"]), "name": r["name"], "date": r["date"].strftime("%Y-%m-%d"), "km": r1(r["km"])}
                for _, r in g.nlargest(top, "km").iterrows()]
            for f, g in df.groupby("family")}


def _by_place(df, col):
    g = (df.assign(h=df["duration_s"] / 3600).groupby(df[col].fillna("Non localisé"))
         .agg(n=("id", "count"), km=("km", "sum"), hours=("h", "sum")).sort_values("km", ascending=False))
    return [{"name": k, "n": int(r["n"]), "km": r1(r["km"]), "hours": r1(r["hours"])} for k, r in g.iterrows()]


def countries(df, top=12): return _by_place(df, "country")[:max(1, min(int(top), 200))]
def regions(df, top=12): return _by_place(df, "region")[:max(1, min(int(top), 200))]
