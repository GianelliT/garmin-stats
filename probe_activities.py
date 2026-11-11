"""Cherche si VO2max, charge d'entraînement, etc. se cachent dans le détail d'une activité ou dans son fichier FIT.

    python probe_activity.py                # dernière course
    python probe_activity.py 123456789      # activité précise
"""
import re
import sqlite3
import sys
from pathlib import Path

import fitdecode

from db import DB_PATH
from sync import get_client

KEYS = re.compile(r"vo2|load|recover|readiness|performance|lactate|race|effect|stamina|endurance", re.I)


def scan(obj, path=""):
    """Parcourt un JSON et renvoie (chemin, valeur) pour les clés qui ressemblent à ce qu'on cherche."""
    if isinstance(obj, dict):
        for k, v in obj.items():
            yield from scan(v, f"{path}.{k}" if path else k)
    elif isinstance(obj, list):
        for i, v in enumerate(obj[:3]):
            yield from scan(v, f"{path}[{i}]")
    elif KEYS.search(path.rsplit(".", 1)[-1]):
        yield path, obj


if len(sys.argv) > 1:
    aid = int(sys.argv[1])
else:
    aid = sqlite3.connect(DB_PATH).execute(
        "SELECT activity_id FROM activities WHERE type = 'running' ORDER BY start_local DESC LIMIT 1").fetchone()[0]
print(f"Activité {aid}\n\n== Détail de l'activité (get_activity) ==")
with get_client() as c:
    hits = list(scan(c.get_activity(aid)))
for p, v in hits[:40]:
    print(f"  {p} = {v}")
if not hits:
    print("  rien de pertinent")

print("\n== Fichier FIT ==")
path = Path("fit_files") / f"{aid}.fit"
if not path.exists():
    print("  fichier absent : lancez d'abord python download_tracks.py")
else:
    counts = {}
    with fitdecode.FitReader(str(path)) as fit:
        for fr in fit:
            if getattr(fr, "frame_type", None) != fitdecode.FIT_FRAME_DATA:
                continue
            counts[fr.name] = counts.get(fr.name, 0) + 1
            if fr.name == "session":
                for f in fr.fields:
                    if KEYS.search(f.name) or f.name.startswith("unknown"):
                        print(f"  session.{f.name} = {f.value}")
    print("  types de messages :", {k: v for k, v in counts.items() if k != "record"})