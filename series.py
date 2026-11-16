"""Séances fractionnées : repérer automatiquement les tours « rapides » (les répétitions) parmi tous les tours,
en laissant de côté l'échauffement, le retour au calme et les récupérations."""
from statistics import median

MIN_GAP = 0.12        # écart minimal (en vitesse) entre tours rapides et lents pour parler de fractionné
DIST_RANGE = (0.35, 2.5)   # une répétition a une longueur comparable aux autres (x médiane) : pyramide 200→800 m tolérée
EDGE_LONGER = 1.4     # tout premier/dernier tour de la séance : écarté s'il est plus long que ça (x médiane des répétitions)
EDGE_SLOWER = 0.90    # tour rapide en bout de liste : écarté s'il est plus lent que ça (x vitesse médiane des répétitions)
REST_STEP = 5         # les temps de récupération sont arrondis à 5 s


def _two_means(speeds):
    """k-means à 1 dimension, k = 2. Renvoie (centre lent, centre rapide) ou None."""
    c0, c1 = min(speeds), max(speeds)
    for _ in range(25):
        lo = [x for x in speeds if abs(x - c0) <= abs(x - c1)]
        hi = [x for x in speeds if abs(x - c0) > abs(x - c1)]
        if not lo or not hi:
            return None
        c0, c1 = sum(lo) / len(lo), sum(hi) / len(hi)
    return c0, c1


def split_efforts(laps):
    """Numéros (n) des tours d'effort, ou [] si la séance n'a pas de vraie alternance rapide/lent.

    1. Deux groupes de vitesse (k-means) : les répétitions se détachent des récupérations. Si les groupes sont trop
       proches (course régulière découpée au kilomètre), ce n'est pas un fractionné.
    2. Un tour rapide dont la distance sort de la fourchette des autres répétitions est écarté.
    3. On « épluche » les deux extrémités : tant que le premier (ou le dernier) tour rapide est nettement plus lent que
       les répétitions typiques, c'est de l'échauffement (ou du retour au calme) pris dans le groupe rapide : on l'enlève.
       S'il est aussi le tout premier (ou dernier) tour de la séance, on l'enlève aussi quand il est nettement plus long.
       Les tours du milieu ne sont jamais épluchés, donc une pyramide ou une répétition un peu moins bonne reste intacte."""
    pts = [l for l in laps if (l.get("spd") or 0) > 0 and (l.get("dist") or 0) > 0]
    if len(pts) < 3:
        return []
    centers = _two_means([l["spd"] for l in pts])
    if not centers or (centers[1] - centers[0]) / centers[1] < MIN_GAP:
        return []
    mid = sum(centers) / 2
    fast = [l for l in pts if l["spd"] > mid]
    if not fast:
        return []
    d_med, s_med = median(l["dist"] for l in fast), median(l["spd"] for l in fast)
    fast = [l for l in fast if DIST_RANGE[0] * d_med <= l["dist"] <= DIST_RANGE[1] * d_med]
    first, last = pts[0]["n"], pts[-1]["n"]

    def odd(l):
        edge_long = l["n"] in (first, last) and l["dist"] > EDGE_LONGER * d_med
        return l["spd"] < EDGE_SLOWER * s_med or edge_long

    while fast and odd(fast[0]):
        fast.pop(0)
    while fast and odd(fast[-1]):
        fast.pop()
    return [l["n"] for l in fast] if len(fast) >= 2 else []


def effort_summary(laps, fast):
    """(allure moyenne en s/km, FC moyenne) sur les tours d'effort, pondérées par la durée."""
    sel = [l for l in laps if l["n"] in set(fast) and (l.get("dist") or 0) > 0]
    dist = sum(l["dist"] for l in sel)
    time = sum(l.get("time") or l["dist"] / l["spd"] for l in sel)
    hrs = [(l["hr"], l.get("time") or 1) for l in sel if l.get("hr")]
    return (round(time / dist * 1000, 1) if dist and time else None,
            round(sum(h * w for h, w in hrs) / sum(w for _, w in hrs)) if hrs else None)


def _round_rest(s):
    return int(s / REST_STEP + 0.5) * REST_STEP      # arrondi « classique » (round() de Python arrondit 2,5 à 2)


def _lap_seconds(l):
    """Durée réelle d'un tour : temps écoulé (pauses comprises), à défaut temps chronométré, à défaut distance / vitesse."""
    t = l.get("elapsed") or l.get("time")
    if t:
        return t
    return l["dist"] / l["spd"] if (l.get("dist") or 0) > 0 and (l.get("spd") or 0) > 0 else 0


def effort_rests(laps, fast):
    """Récupération entre deux répétitions consécutives : tout ce qui se trouve entre la fin de l'une et le début de la suivante
    (un ou plusieurs tours, y compris un tour sans distance quand on s'arrête). Renvoie (récups arrondies à 5 s, moyenne arrondie à 5 s) ;
    ([], None) s'il y a moins de deux répétitions."""
    f = sorted(fast)
    raw = [sum(_lap_seconds(l) for l in laps if a < l["n"] < b) for a, b in zip(f, f[1:])]
    if not raw:
        return [], None
    return [_round_rest(x) for x in raw], _round_rest(sum(raw) / len(raw))
