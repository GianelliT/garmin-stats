"""Chemin de la base et schéma de la table tracks (partagés par app.py et download_tracks.py)."""
DB_PATH = "garmin.db"

TRACKS_DDL = """CREATE TABLE IF NOT EXISTS tracks (
  activity_id INTEGER PRIMARY KEY, has_gps INTEGER, n_points INTEGER,
  points TEXT, splits TEXT, poly TEXT, laps TEXT)"""


def ensure_tracks(conn):
    """Crée la table tracks et ajoute les colonnes manquantes (bases créées avant les laps)."""
    conn.execute(TRACKS_DDL)
    if "laps" not in {r[1] for r in conn.execute("PRAGMA table_info(tracks)")}:
        conn.execute("ALTER TABLE tracks ADD COLUMN laps TEXT")
    conn.commit()

PLACES_DDL = """CREATE TABLE IF NOT EXISTS places (key TEXT PRIMARY KEY, country TEXT, region TEXT, city TEXT)"""


def ensure_places(conn):
    conn.execute(PLACES_DDL)
    conn.commit()


def place_key(lat, lon):
    """Cellule d'environ 1 km : le géocodage est mis en cache par cellule, pas par activité."""
    return f"{lat:.2f},{lon:.2f}"


FITNESS_DDL = """CREATE TABLE IF NOT EXISTS garmin_fitness (
  date TEXT PRIMARY KEY, vo2max REAL, vo2max_cycling REAL,
  t5k REAL, t10k REAL, thalf REAL, tmarathon REAL)"""


def ensure_fitness(conn):
    """VO2max et prédictions de course mesurés par la montre (remplie par connect_sync.py)."""
    conn.execute(FITNESS_DDL)
    conn.commit()


META_DDL = """CREATE TABLE IF NOT EXISTS activity_meta (
  activity_id INTEGER PRIMARY KEY, name TEXT, note TEXT, updated_at TEXT DEFAULT CURRENT_TIMESTAMP)"""
TAGS_DDL = """CREATE TABLE IF NOT EXISTS activity_tags (
  activity_id INTEGER NOT NULL, tag TEXT NOT NULL, PRIMARY KEY (activity_id, tag))"""


SUBS_DDL = """CREATE TABLE IF NOT EXISTS activity_subs (
  activity_id INTEGER NOT NULL, sub TEXT NOT NULL, PRIMARY KEY (activity_id, sub))"""
TAG_META_DDL = "CREATE TABLE IF NOT EXISTS tag_meta (tag TEXT PRIMARY KEY, pinned INTEGER NOT NULL DEFAULT 0)"


def ensure_meta(conn):
    """Nom, note et tags personnels : tables séparées de `activities`, donc jamais écrasées par la synchronisation Garmin."""
    conn.execute(META_DDL)
    conn.execute(TAGS_DDL)
    conn.execute(TAG_META_DDL)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_activity_tags_tag ON activity_tags (tag)")
    cols = {r[1] for r in conn.execute("PRAGMA table_info(activity_meta)")}
    for col in ("category", "subtag"):      # classement : catégorie (course / footing / seance) et précision (10 km, 10x400…)
        if col not in cols:
            conn.execute(f"ALTER TABLE activity_meta ADD COLUMN {col} TEXT")
    conn.execute(SUBS_DDL)
    conn.execute("CREATE INDEX IF NOT EXISTS idx_activity_subs_sub ON activity_subs (sub)")
    # une séance peut avoir plusieurs précisions : l'ancienne colonne `subtag` (une seule) est reprise dans la nouvelle table
    conn.execute("INSERT OR IGNORE INTO activity_subs (activity_id, sub) SELECT activity_id, subtag FROM activity_meta WHERE subtag IS NOT NULL AND subtag != ''")
    conn.execute("UPDATE activity_meta SET subtag = NULL WHERE subtag IS NOT NULL")
    conn.commit()
