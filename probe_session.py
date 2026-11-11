"""Compare les champs sans nom de la session FIT entre plusieurs courses, pour repérer
une éventuelle charge d'entraînement ou un temps de récupération.

    python probe_session.py
"""
import sqlite3
from pathlib import Path

import fitdecode

from db import DB_PATH

FIELDS = ["unknown_178", "unknown_196", "unknown_152", "unknown_151", "unknown_184", "unknown_138"]
rows = sqlite3.connect(DB_PATH).execute(
    "SELECT activity_id, date, distance_m, duration_s, aerobic_te FROM activities "
    "WHERE type = 'running' ORDER BY start_local DESC LIMIT 80").fetchall()

print(f"{'date':<12}{'km':>6}{'min':>6}{'TE':>5}" + "".join(f"{f.split('_')[1]:>8}" for f in FIELDS))
shown = 0
for aid, date, dist, dur, te in rows:
    path = Path("fit_files") / f"{aid}.fit"
    if not path.exists():
        continue
    session = {}
    with fitdecode.FitReader(str(path)) as fit:
        for fr in fit:
            if getattr(fr, "frame_type", None) == fitdecode.FIT_FRAME_DATA and fr.name == "session":
                session = {f.name: f.value for f in fr.fields}
    cells = "".join(f"{str(session.get(f)):>8}" for f in FIELDS)
    print(f"{date:<12}{(dist or 0) / 1000:>6.1f}{(dur or 0) / 60:>6.0f}{(te or 0):>5.1f}{cells}")
    shown += 1
    if shown == 15:
        break
if not shown:
    print("Aucun fichier dans fit_files/ : lancez d'abord python download_tracks.py")
