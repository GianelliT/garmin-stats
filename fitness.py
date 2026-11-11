"""Forme physique estimée à partir des séances : charge d'entraînement, VO2max (VDOT) et prédicteur de course.
Ce ne sont PAS les valeurs de la montre : ce sont des estimations (TRIMP d'Edwards, formules de Jack Daniels)."""
import math

import pandas as pd

ZONES = ["z1", "z2", "z3", "z4", "z5"]
BEST = [("best_5000", 5000.0), ("best_10000", 10000.0), ("best_21098", 21097.5)]
TARGETS = [("5 km", 5000.0), ("10 km", 10000.0), ("Semi-marathon", 21097.5), ("Marathon", 42195.0)]
LABELS = {5000.0: "5 km", 10000.0: "10 km", 21097.5: "semi-marathon"}


def _mmss(s):
    m, x = divmod(round(s), 60)
    return f"{m}:{x:02d}" if m < 60 else f"{m // 60}:{m % 60:02d}:{x:02d}"


def trimp(df):
    """Charge par séance : minutes passées dans chaque zone de FC × poids de la zone (1 à 5)."""
    z = df[ZONES].fillna(0)
    load = z.mul([1, 2, 3, 4, 5], axis=1).sum(axis=1) / 60
    return load.where(z.sum(axis=1) > 0, df["duration_s"].fillna(0) / 60 * 1.5)   # sans zones : estimation grossière


def load(df, days=180):
    days = max(30, min(int(days), 1100))
    """Fatigue (7 j), forme (42 j) et fraîcheur, comme dans le modèle de Banister."""
    end = pd.Timestamp.today().normalize()
    idx = pd.date_range(end - pd.Timedelta(days=days + 42), end)
    s = trimp(df).groupby(df["date"]).sum().reindex(idx, fill_value=0)
    atl = s.ewm(alpha=1 - math.exp(-1 / 7), adjust=False).mean()
    ctl = s.ewm(alpha=1 - math.exp(-1 / 42), adjust=False).mean()
    acute, chronic = s[-7:].sum(), s[-28:].sum() / 4
    r = lambda x: [round(float(v), 1) for v in x[-days:]]
    return {"labels": [d.strftime("%Y-%m-%d") for d in idx[-days:]], "load": r(s), "atl": r(atl), "ctl": r(ctl),
            "tsb": r(ctl - atl), "acute": round(float(acute)), "chronic": round(float(chronic)),
            "ratio": round(float(acute / chronic), 2) if chronic else None}


def _vdot(d, t_s):
    t = t_s / 60
    v = d / t
    vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v
    return vo2 / (0.8 + 0.1894393 * math.exp(-0.012778 * t) + 0.2989558 * math.exp(-0.1932605 * t))


def _time(vdot, d):
    lo, hi = d / 10, d / 0.8
    for _ in range(60):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if _vdot(d, mid) > vdot else (lo, mid)
    return (lo + hi) / 2


def estimate(df, window_days=120, asof=None):
    """VO2max estimée (VDOT) d'après vos meilleurs segments récents, et temps prédits.
    asof : se placer à une date passée (seules les séances jusque-là et les `window_days` précédents comptent)."""
    runs = df[df["family"] == "run"]
    if runs.empty:
        return None
    ref = pd.Timestamp(asof) if asof is not None else runs["date"].max()
    recent = runs[(runs["date"] <= ref) & (runs["date"] >= ref - pd.Timedelta(days=window_days))]
    if recent.empty:
        return None
    best = None
    for col, d in BEST:
        s = recent[col].dropna()
        if s.empty:
            continue
        i = s.idxmin()
        v = _vdot(d, float(s[i]))
        if best is None or v > best["vdot"]:
            best = {"vdot": round(v, 1), "basis": f"{LABELS[d]} en {_mmss(s[i])}",
                    "date": recent.loc[i, "date"].strftime("%Y-%m-%d"), "id": int(recent.loc[i, "id"])}
    if best is None:
        return None
    best["predictions"] = [{"label": l, "km": d / 1000, "time_s": round(_time(best["vdot"], d))} for l, d in TARGETS]
    return best


def estimate_history(df, step_days=7):
    """Évolution de la VO2max estimée et des temps prédits (un point par semaine), calculée avec la même méthode que estimate()."""
    runs = df[df["family"] == "run"]
    if runs.empty:
        return []
    end = pd.Timestamp.today().normalize()
    start = min(runs["date"].min() + pd.Timedelta(days=28), end)
    days = list(pd.date_range(start, end, freq=f"{step_days}D"))
    if days[-1] != end:
        days.append(end)
    out = []
    for d in days:
        e = estimate(df, asof=d)
        if e:
            out.append({"date": d.strftime("%Y-%m-%d"), "vdot": e["vdot"],
                        **{k: p["time_s"] for k, p in zip(("t5k", "t10k", "thalf", "tmarathon"), e["predictions"])}})
    return out
