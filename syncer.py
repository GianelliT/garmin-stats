"""Synchronisation Garmin lancée depuis le dashboard : enchaîne sync.py, download_tracks.py et geocode.py
en tâche de fond (mêmes scripts qu'en ligne de commande), et expose l'avancement à l'interface."""
import os
import sqlite3
import subprocess
import sys
import threading
import time
from contextlib import closing
from pathlib import Path

from db import DB_PATH

HERE = Path(__file__).parent
# (libellé affiché, script, bloquant ?) : un échec de géocodage ne doit pas faire échouer toute la synchro
STEPS = [("Activités", "sync.py", True), ("Tracés GPS", "download_tracks.py", True),
         ("VO₂max Garmin", "connect_sync.py", False), ("Lieux", "geocode.py", False)]

_lock = threading.Lock()
_log = []
_state = {"state": "idle", "step": None, "i": 0, "n": len(STEPS), "line": "", "error": None, "new": 0, "finished": None, "notice": None}


def _count():
    try:
        with closing(sqlite3.connect(DB_PATH)) as c:
            return c.execute("SELECT COUNT(*) FROM activities").fetchone()[0]
    except sqlite3.Error:
        return 0


def _last_sync():
    """Date (UTC, ISO) de la dernière synchronisation réussie enregistrée par sync.py."""
    try:
        with closing(sqlite3.connect(DB_PATH)) as c:
            v = c.execute("SELECT MAX(run_at) FROM sync_log").fetchone()[0]
        return v.replace(" ", "T") + "Z" if v else None
    except sqlite3.Error:
        return None


def _run():
    before = _count()
    try:
        for i, (label, script, blocking) in enumerate(STEPS, 1):
            with _lock:
                _state.update(step=label, i=i, line="")
            p = subprocess.Popen([sys.executable, "-u", str(HERE / script)], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                                 stdin=subprocess.DEVNULL, text=True, bufsize=1, env={**os.environ, "PYTHONIOENCODING": "utf-8"})
            for line in p.stdout:
                line = line.rstrip()
                if line:
                    with _lock:
                        _log.append(line)
                        del _log[:-60]
                        _state["line"] = line.strip()
            code = p.wait()
            if code and not blocking:     # étape facultative en échec : la synchro continue, l'interface affiche pourquoi
                with _lock:
                    _state["notice"] = f"{label} : {_state['line'] or 'échec'}"
            if code and blocking:
                tail = " | ".join(_log[-3:])
                raise RuntimeError(f"{script} a échoué (code {code}). {tail}")
        with _lock:
            _state.update(state="done", new=max(0, _count() - before), error=None)
    except Exception as e:      # noqa: BLE001 : l'erreur est renvoyée à l'interface
        with _lock:
            _state.update(state="error", error=str(e))
    finally:
        with _lock:
            _state["finished"] = time.time()


def start():
    """Démarre une synchronisation. Renvoie False si l'une est déjà en cours."""
    with _lock:
        if _state["state"] == "running":
            return False
        _log.clear()
        _state.update(state="running", step=STEPS[0][0], i=1, line="", error=None, new=0, finished=None, notice=None)
    threading.Thread(target=_run, daemon=True).start()
    return True


def status():
    with _lock:
        return {**_state, "log": _log[-20:], "last": _last_sync()}
