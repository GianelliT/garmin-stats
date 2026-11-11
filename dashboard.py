import json
import sqlite3

import pandas as pd
import streamlit as st

DB_PATH = "garmin.db"
SPLITS = [
    ("fastestSplit_1000", "1 km"),
    ("fastestSplit_1609", "1 mile"),
    ("fastestSplit_5000", "5 km"),
    ("fastestSplit_10000", "10 km"),
    ("fastestSplit_21098", "Semi"),
    ("fastestSplit_42195", "Marathon"),
]

st.set_page_config(page_title="Garmin dashboard", layout="wide")


# ---------- formats ----------

def fmt_pace(p):
    if p is None or pd.isna(p) or p <= 0:
        return "–"
    m, s = divmod(round(p * 60), 60)
    return f"{m}:{s:02d}"


def fmt_dur(sec):
    if sec is None or pd.isna(sec):
        return "–"
    h, r = divmod(round(sec), 3600)
    m, s = divmod(r, 60)
    return f"{h}:{m:02d}:{s:02d}" if h else f"{m}:{s:02d}"


# ---------- données ----------

@st.cache_data(ttl=300)
def load():
    conn = sqlite3.connect(DB_PATH)
    acts = pd.read_sql("SELECT * FROM activities", conn)
    daily = pd.read_sql("SELECT * FROM daily", conn)
    sleep = pd.read_sql("SELECT * FROM sleep", conn)
    last = conn.execute("SELECT MAX(run_at) FROM sync_log").fetchone()[0]
    conn.close()
    for df in (acts, daily, sleep):
        df["date"] = pd.to_datetime(df["date"])
    acts["km"] = acts["distance_m"] / 1000
    acts["pace"] = acts["duration_s"] / 60 / acts["km"].where(acts["km"] > 0)
    return acts, daily, sleep, last


def kpis(df):
    km = df["km"].sum()
    return {
        "km": km,
        "n": len(df),
        "pace": df["duration_s"].sum() / 60 / km if km > 0 else None,
        "hr": df["avg_hr"].mean(),
        "climb": df["elevation_m"].sum(),
    }


def line(title, s, bar=False):
    st.subheader(title)
    s = s.dropna().astype(float)
    if s.empty:
        st.info("Pas de données sur cette période.")
    elif bar:
        st.bar_chart(s)
    else:
        st.line_chart(s)


# ---------- page ----------

acts, daily, sleep, last_sync = load()
st.title("Dashboard Garmin")
st.caption(f"Dernière synchro : {last_sync}")

types = acts["type"].value_counts().index.tolist()
with st.sidebar:
    typ = st.selectbox("Type d'activité", types,
                       index=types.index("running") if "running" in types else 0)
    preset = st.radio("Période", ["30 jours", "90 jours", "1 an", "Tout"], index=2)

span = {"30 jours": 30, "90 jours": 90, "1 an": 365}.get(preset)
end = acts["date"].max()
start = end - pd.Timedelta(days=span - 1) if span else acts["date"].min()
length = end - start + pd.Timedelta(days=1)

sel = acts[acts["type"] == typ]
cur = sel[(sel["date"] >= start) & (sel["date"] <= end)]
prev = sel[(sel["date"] >= start - length) & (sel["date"] < start)]
k, p = kpis(cur), kpis(prev)

tab1, tab2, tab3 = st.tabs(["Activités", "Santé", "Records"])

with tab1:
    c1, c2, c3, c4, c5 = st.columns(5)
    d = (lambda a, b, f: f.format(a - b)) if span else (lambda a, b, f: None)
    c1.metric("Distance", f"{k['km']:.0f} km", d(k["km"], p["km"], "{:+.0f} km"))
    c2.metric("Sorties", k["n"], d(k["n"], p["n"], "{:+d}"))
    c3.metric("Allure moyenne", fmt_pace(k["pace"]) + " /km")
    c4.metric("FC moyenne", f"{k['hr']:.0f} bpm" if pd.notna(k["hr"]) else "–")
    c5.metric("Dénivelé", f"{k['climb']:.0f} m")

    if cur.empty:
        st.info("Aucune activité de ce type sur la période.")
    else:
        freq = "W" if span and span <= 90 else "MS"
        label = "semaine" if freq == "W" else "mois"
        g = cur.set_index("date").resample(freq)
        line(f"Distance par {label} (km)", g["km"].sum(), bar=True)

        agg = g.agg(dur=("duration_s", "sum"), km=("km", "sum"))
        pace = (agg["dur"] / 60 / agg["km"].where(agg["km"] > 0))
        line(f"Allure moyenne par {label} (min/km, en décimal : 5.5 = 5:30)", pace)

        st.subheader("Dernières activités")
        t = cur.sort_values("date", ascending=False).head(30)
        st.dataframe(pd.DataFrame({
            "date": t["start_local"].str[:16],
            "nom": t["name"],
            "km": t["km"].round(2),
            "durée": t["duration_s"].map(fmt_dur),
            "allure": t["pace"].map(fmt_pace),
            "FC moy": t["avg_hr"].round(),
            "D+ (m)": t["elevation_m"].round(),
        }), hide_index=True)

with tab2:
    dd = daily[(daily["date"] >= start) & (daily["date"] <= end)].set_index("date")
    ss = sleep[(sleep["date"] >= start) & (sleep["date"] <= end)].set_index("date")
    a, b = st.columns(2)
    with a:
        hr = dd["resting_hr"].where(dd["resting_hr"] > 0).dropna()
        line("FC au repos (moyenne glissante 7 j)", hr.rolling(7, min_periods=1).mean())
        line("Pas par semaine (moyenne/jour)", dd["steps"].resample("W").mean(), bar=True)
    with b:
        line("Sommeil (heures, moyenne glissante 7 j)",
             (ss["sleep_s"] / 3600).rolling(7, min_periods=1).mean())
        line("Stress moyen par semaine", dd["stress_avg"].resample("W").mean())
    line("Body Battery max (moyenne glissante 7 j)",
         dd["body_battery_max"].rolling(7, min_periods=1).mean())

with tab3:
    st.caption("Sur tout l'historique du type d'activité sélectionné.")
    rows = []
    for _, r in sel.iterrows():
        raw = json.loads(r["raw"])
        for key, lab in SPLITS:
            v = raw.get(key)
            if v:
                rows.append({"distance": lab, "temps_s": v,
                             "date": r["start_local"][:10], "activité": r["name"]})
    if rows:
        df = pd.DataFrame(rows)
        order = [lab for _, lab in SPLITS]
        best = (df.sort_values("temps_s").groupby("distance").head(1)
                  .assign(rang=lambda x: x["distance"].map(order.index))
                  .sort_values("rang"))
        st.subheader("Meilleurs temps")
        st.dataframe(pd.DataFrame({
            "distance": best["distance"],
            "temps": best["temps_s"].map(fmt_dur),
            "allure": [fmt_pace(t / 60 / km) for t, km in zip(
                best["temps_s"],
                best["distance"].map(dict(zip(order, [1, 1.609, 5, 10, 21.098, 42.195]))))],
            "date": best["date"],
            "activité": best["activité"],
        }), hide_index=True)
    else:
        st.info("Pas de meilleurs temps disponibles pour ce type d'activité.")

    if not sel.empty:
        st.subheader("Plus longues sorties")
        t = sel.sort_values("km", ascending=False).head(10)
        st.dataframe(pd.DataFrame({
            "date": t["start_local"].str[:10],
            "km": t["km"].round(2),
            "durée": t["duration_s"].map(fmt_dur),
            "allure": t["pace"].map(fmt_pace),
            "D+ (m)": t["elevation_m"].round(),
        }), hide_index=True)