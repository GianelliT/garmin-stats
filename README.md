# Garmin Stats

Tableau de bord **local** pour explorer ses propres données Garmin : activités, tracés GPS, séries d'entraînement, forme physique (VO₂max, VDOT), meilleurs efforts, cartes de chaleur…

Les données sont récupérées depuis votre compte Garmin Connect, stockées dans une base SQLite **sur votre machine**, et affichées par une petite application web (Flask + JavaScript sans framework). Rien n'est envoyé à un serveur tiers, hormis les appels à Garmin et le chargement des fonds de carte.

> ⚠️ Projet personnel, non affilié à Garmin. Le dépôt ne contient **aucune donnée** : chacun synchronise et héberge ses propres données.

## Fonctionnalités

- **Synchronisation** des activités, du détail journalier (pas, FC repos, stress, Body Battery) et du sommeil via la [Personal API de Garmin](https://developer.garmin.com/gc-developer-program/personal/personal-api)
- **Téléchargement et analyse des fichiers `.fit`** : tracé GPS, tours (laps), cadence, kilomètres intermédiaires
- **VO₂max et prédictions de course** (5 km, 10 km, semi, marathon) mesurés par la montre, avec historique complet
- **Pages de l'interface** : tableau de bord personnalisable, liste des activités avec vignettes de tracé, détail d'une activité (carte, graphiques, tours), comparaison d'activités, séries (footings, courses, séances classées par type), carte de chaleur, forme physique, VDOT
- **Statistiques** : volume hebdomadaire / mensuel / annuel, cumul, régularité (séries de jours), meilleurs efforts, podium, répartition par jour et heure, zones de FC, pays et régions parcourus
- **Organisation personnelle** : noms, notes, tags, catégories (course / footing / séance) et précisions (10 km, 10×400…) stockés à part, donc jamais écrasés par une synchronisation
- Thème clair / sombre automatique

## Architecture

```
Garmin Connect ──► sync.py ───────────┐   activités, jours, sommeil   (Personal API, clé API)
                   download_tracks.py ┤   fichiers .fit → tracés, laps (Personal API)
                   connect_sync.py ───┤   VO₂max, prédictions          (garminconnect, identifiants + MFA)
                   geocode.py ────────┤   lieux (pays / région / ville)
                                      ▼
                               garmin.db (SQLite) + fit_files/
                                      ▲
                      app.py (Flask, API JSON) ◄── static/ (HTML + JS modules + Chart.js + Leaflet)
```

| Fichier | Rôle |
|---|---|
| `app.py` | Serveur Flask : routes `/api/*` et service de l'interface |
| `stats.py`, `series.py`, `fitness.py`, `sports.py` | Calculs (statistiques, séries, charge d'entraînement, VDOT, familles de sports) |
| `db.py` | Chemin de la base et schémas des tables |
| `sync.py` | Synchronisation activités / jours / sommeil |
| `download_tracks.py` | Téléchargement et analyse des `.fit` |
| `connect_sync.py`, `garmin_backfill.py` | VO₂max et prédictions de course (historique complet) |
| `geocode.py` | Géocodage des lieux de départ des activités |
| `syncer.py` | Enchaîne les étapes de synchro en tâche de fond (bouton *Synchroniser*) |
| `api.py`, `probe_*.py` | Scripts d'exploration de l'API Garmin |
| `dashboard.py` | Ancienne version Streamlit (optionnelle) |
| `static/` | Interface web (une page par fichier dans `static/js/pages/`) |

## Prérequis

- Python **3.12+** (requis par le client officiel Garmin)
- Un compte Garmin Connect
- Une **clé Personal API** Garmin (gratuite, voir ci-dessous)

## Installation

```bash
git clone https://github.com/GianelliT/garmin-stats.git
cd garmin-stats
python3 -m venv .venv
source .venv/bin/activate        # Windows : .venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

## Configuration

### 1. Clé Personal API (activités, jours, sommeil, fichiers FIT)

1. Dans Garmin Connect (version web), ouvrez **Paramètres → Personal API** et créez une clé. Garmin ne l'affiche qu'une fois, et elle expire (30 jours à un an selon votre choix).
2. Enregistrez-la, au choix :
   ```bash
   export GARMIN_PERSONAL_API_KEY='votre-cle'
   ```
   ou dans le fichier `~/.config/garmin/connect-personal-api-key` (droits `600`). Ce fichier est celui que lit aussi l'outil officiel `gc-personal`.

### 2. Connexion Garmin Connect (VO₂max et prédictions de course)

Ces données ne sont pas exposées par la Personal API ; elles passent par la bibliothèque non officielle [`garminconnect`](https://github.com/cyberjunky/python-garminconnect) :

```bash
python connect_sync.py --login   # une seule fois : e-mail, mot de passe, code MFA éventuel
```

Le mot de passe n'est **jamais enregistré**, seuls des jetons le sont (`~/.config/garmin/connect-tokens`, emplacement modifiable avec `GARMINTOKENS`). Cette étape est facultative : sans elle, le reste fonctionne. Ce n'est pas l'API officielle, Garmin peut limiter ou bloquer ces connexions.

### 3. Fond de carte CARTO (facultatif)

Sans clé, la carte utilise OpenStreetMap. Avec une [clé CARTO gratuite](https://carto.com/basemaps/apikey), les vignettes sont plus épurées :

```bash
export CARTO_API_KEY='votre-cle'     # ou fichier ~/.config/garmin/carto-api-key
```

## Utilisation

**Première synchronisation** (peut être longue : l'API est limitée à environ 100 appels par minute, le script gère les pauses) :

```bash
python sync.py --full            # tout l'historique
python download_tracks.py        # fichiers .fit → tracés et tours
python connect_sync.py           # VO₂max et prédictions
python geocode.py                # pays / régions / villes
python garmin_backfill.py --years 20   # (optionnel) historique complet VO₂max / prédictions
```

**Lancer l'application :**

```bash
python app.py
```

Ouvrez ensuite <http://127.0.0.1:4999>. Les synchronisations suivantes se font depuis l'interface (bouton *Synchroniser*), qui enchaîne les mêmes scripts.

### Options utiles

| Commande | Effet |
|---|---|
| `python sync.py --since 2026-01-01` | Jours et sommeil à partir d'une date |
| `python sync.py --days 30` | Fenêtre glissante de N jours |
| `python download_tracks.py --limit 5` | Test sur 5 activités |
| `python download_tracks.py --reparse` | Relire tous les `.fit` locaux après un changement du parsing |
| `python download_tracks.py --id <ID> …` | Retélécharger et recalculer des activités précises |
| `python probe_garmin.py` | Tester quelles données la Personal API expose |

## Données et vie privée

Tout est stocké localement et **ignoré par Git** (voir `.gitignore`) :

| Élément | Contenu |
|---|---|
| `garmin.db` | Base SQLite : `activities`, `daily`, `sleep`, `tracks`, `places`, `garmin_fitness`, `activity_meta`, `activity_tags`, `activity_subs`, `tag_meta`, `sync_log` |
| `fit_files/` | Fichiers `.fit` bruts (**contiennent vos positions GPS précises**) |
| `~/.config/garmin/` | Clé API, jetons de connexion, clé CARTO (hors du dépôt) |

À savoir :

- Les tracés GPS révèlent en général votre domicile et vos habitudes. Ne publiez jamais la base, les `.fit` ni des captures d'écran sans avoir masqué les cartes.
- Le serveur n'a **pas d'authentification** et expose des routes d'écriture (`PATCH`, `DELETE`, `POST /api/sync`). Il écoute par défaut sur `127.0.0.1` uniquement ; ne l'exposez pas sur un réseau ou Internet sans protection.

## Limites connues

- Dépend de la Personal API Garmin (clé à renouveler) et, pour le VO₂max, d'une bibliothèque non officielle susceptible de casser.
- Interface et messages en français.
- Les valeurs VDOT / prédictions de la page *Forme* sont des **estimations** calculées à partir de vos meilleurs segments ; elles peuvent différer de celles de la montre.

## Licence

Ce projet est distribué sous licence [MIT](LICENSE).

## Remerciements

- [Garmin Connect Personal API](https://developer.garmin.com/gc-developer-program/personal/personal-api) et son [client Python officiel](https://pypi.org/project/garmin-connect-personal-api-python/)
- [python-garminconnect](https://github.com/cyberjunky/python-garminconnect)
- [fitdecode](https://github.com/polyvertex/fitdecode), [Flask](https://flask.palletsprojects.com/), [pandas](https://pandas.pydata.org/), [Chart.js](https://www.chartjs.org/), [Leaflet](https://leafletjs.com/), © contributeurs [OpenStreetMap](https://www.openstreetmap.org/copyright)
