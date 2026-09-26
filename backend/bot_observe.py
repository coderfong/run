"""What the world looks like right now, read once per tick for the director.

Everything the activity director (bot_director.py) decides from comes out of
here, as plain Python objects, so the policy itself can be unit tested without
a database and the dry run can print exactly what the live tick would see.

Reads only. The one place the director writes is bot_activity.py.

All times are naive UTC, the repo's convention. The cron sets its session
time zone to UTC (see `utc_session`) so that `now()` and the naive columns
Python writes agree even on a machine whose Postgres runs in local time.
"""

from __future__ import annotations

import json
import math
import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from functools import lru_cache
from typing import Optional

from shapely.geometry import MultiPolygon, Point, Polygon
from shapely.prepared import prep
from sqlalchemy import text

from app import elo
from app.config import settings

REGION_KEYS = ("north", "south", "east", "west", "central")
_REGION_FILE = os.path.join(os.path.dirname(__file__), "sg_regions.json")


# ---------------------------------------------------------------------------
# Regions
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def regions() -> dict:
    """{key: {"name", "geom", "prepared"}} from the same file the map colours by."""
    with open(_REGION_FILE, encoding="utf-8") as f:
        data = json.load(f)
    out = {}
    for r in data["regions"]:
        polys = [Polygon(ring) for ring in r["polygons"] if len(ring) >= 4]
        polys = [p.buffer(0) for p in polys if p.is_valid or p.buffer(0).area > 0]
        geom = MultiPolygon([p for p in polys if p.geom_type == "Polygon"])
        out[r["key"]] = {"name": r["name"], "geom": geom, "prepared": prep(geom)}
    return out


def region_of(lat: Optional[float], lon: Optional[float]) -> Optional[str]:
    """The region a point is in, or the nearest one for a point just offshore
    (a GPS start on a jetty is still an East Coast run)."""
    if lat is None or lon is None:
        return None
    pt = Point(lon, lat)
    regs = regions()
    for key, r in regs.items():
        if r["prepared"].contains(pt):
            return key
    return min(regs, key=lambda k: regs[k]["geom"].distance(pt))


def land_for(region_key: Optional[str]):
    r = regions().get(region_key or "")
    return r["geom"] if r else None


def metres(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Equirectangular distance — fine across one city."""
    x = math.radians(lon2 - lon1) * math.cos(math.radians((lat1 + lat2) / 2))
    y = math.radians(lat2 - lat1)
    return 6_371_000.0 * math.hypot(x, y)


# ---------------------------------------------------------------------------
# Snapshot types
# ---------------------------------------------------------------------------

@dataclass
class RegionActivity:
    key: str
    # Last 60 minutes — what the controller compares against the targets.
    human_claims_1h: int = 0
    bot_claims_1h: int = 0
    human_runs_1h: int = 0
    human_battles_1h: int = 0
    bot_battles_1h: int = 0
    human_club_1h: int = 0
    bot_club_1h: int = 0
    # Slower signals — what decides a region's SHARE of the world target.
    human_runs_24h: int = 0
    human_claims_24h: int = 0
    human_territory: int = 0
    active_clubs: int = 0
    bot_population: int = 0
    combat_24h: int = 0
    hotspots: int = 0


@dataclass
class Territory:
    id: str
    owner_id: str
    owner_is_bot: bool
    owner_clan: Optional[str]
    attributed_clan: Optional[str]
    owner_tier: int
    lat: float
    lon: float
    area_m2: float
    strength: float

    @property
    def radius_m(self) -> float:
        return math.sqrt(max(self.area_m2, 1.0) / math.pi)


@dataclass
class Bot:
    user_id: str
    username: str
    clan_id: Optional[str]
    avatar: dict
    home_lat: float
    home_lon: float
    region_key: Optional[str]
    next_run_at: Optional[datetime]
    tier: int
    attacker: bool
    last_run_end: Optional[datetime]
    runs_7d: int
    runs_24h: int
    live_territories: int
    # (attacker_id, lat, lon, at) for land this bot LOST in the last 24h.
    losses: list = field(default_factory=list)


@dataclass
class PairHistory:
    """What has passed between two runners, from the steal ledger and the
    director's own intent log. Derived, not stored: the ledger IS the
    rivalry."""
    fights: int = 0
    fights_48h: int = 0
    last_at: Optional[datetime] = None
    a_took_m2: float = 0.0
    b_took_m2: float = 0.0
    recent_defended_streak: int = 0


@dataclass
class Human:
    user_id: str
    username: str
    clan_id: Optional[str]
    tier: int
    last_run_end: Optional[datetime]
    territories: list  # [Territory]
    interactions_24h: float = 0.0
    interactions_48h: float = 0.0
    bot_interactions_24h: int = 0
    last_interaction_at: Optional[datetime] = None
    last_bot_interaction_at: Optional[datetime] = None
    last_attacked_at: Optional[datetime] = None
    last_defended_at: Optional[datetime] = None
    first_land_at: Optional[datetime] = None
    pending_floor: int = 0
    recent_attackers: list = field(default_factory=list)  # bot ids, newest first


@dataclass
class HumanClaim:
    run_id: str
    user_id: str
    claimed_at: datetime
    lat: float
    lon: float
    stolen_from_bots: list  # [bot_id]


@dataclass
class Hotspot:
    id: Optional[str]
    region_key: Optional[str]
    lat: float
    lon: float
    radius_m: float
    multiplier: float
    label: str
    starts_at: datetime
    ends_at: datetime


@dataclass
class Intent:
    id: str
    kind: str
    stage: str
    source: str
    target_user_id: Optional[str]
    bot_user_id: Optional[str]
    lat: Optional[float]
    lon: Optional[float]
    region_key: Optional[str]
    due_at: datetime
    expires_at: datetime


@dataclass
class Snapshot:
    now: datetime
    regions: dict
    territories: list
    bots: list
    humans: list
    new_human_claims: list
    due_intents: list
    hotspots: list
    recent_hotspots: list
    pairs: dict  # (a_id, b_id) -> PairHistory, both orders present
    last_club_run: dict  # clan_id -> datetime
    human_run_points_24h: list  # [(lat, lon)]
    bot_claims_last_hour: int = 0

    def region(self, key: Optional[str]) -> RegionActivity:
        return self.regions.get(key or "") or self.regions["central"]


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------

def utc_session(db) -> None:
    """Pin this connection to UTC so now() matches the naive-UTC columns."""
    db.execute(text("SET TIME ZONE 'UTC'"))


def db_now(db) -> datetime:
    """The database's clock as naive UTC. Used for every decision in a tick,
    and constant inside a transaction, which is what lets the simulator move
    the world instead of the clock."""
    return db.execute(text("SELECT timezone('utc', now())")).scalar()


def _tier_of(rating) -> int:
    return elo.tier_for_rating(int(rating or elo.INITIAL_RATING))["tier"]


def _live_sql(alias: str) -> str:
    return (
        f"now() < COALESCE({alias}.expires_at, {alias}.created_at + "
        f"make_interval(secs => GREATEST({alias}.strength, 0.1) * :life_per * 86400))"
    )


def read_regions(db, now: datetime, hotspots: list) -> dict:
    h1, h24 = now - timedelta(hours=1), now - timedelta(hours=24)
    out = {k: RegionActivity(k) for k in REGION_KEYS}

    for is_bot, lat, lon, in_hour in db.execute(text(
        """
        SELECT u.is_bot, ST_Y(ST_StartPoint(r.path)), ST_X(ST_StartPoint(r.path)),
               r.claimed_at > :h1
        FROM runs r JOIN users u ON u.id = r.user_id
        WHERE r.claimed_at > :h24 AND r.claimed_at <= :now AND r.path IS NOT NULL
        """
    ), {"h1": h1, "h24": h24, "now": now}).fetchall():
        reg = out.get(region_of(lat, lon))
        if reg is None:
            continue
        if is_bot:
            reg.bot_claims_1h += 1 if in_hour else 0
        else:
            reg.human_claims_24h += 1
            reg.human_claims_1h += 1 if in_hour else 0

    for lat, lon, in_hour in db.execute(text(
        """
        SELECT ST_Y(ST_StartPoint(r.path)), ST_X(ST_StartPoint(r.path)), r.ended_at > :h1
        FROM runs r JOIN users u ON u.id = r.user_id
        WHERE NOT u.is_bot AND r.ended_at > :h24 AND r.ended_at <= :now
          AND r.path IS NOT NULL
        """
    ), {"h1": h1, "h24": h24, "now": now}).fetchall():
        reg = out.get(region_of(lat, lon))
        if reg is not None:
            reg.human_runs_24h += 1
            reg.human_runs_1h += 1 if in_hour else 0

    for attacker_bot, lat, lon, in_hour in db.execute(text(
        """
        SELECT a.is_bot, s.lat, s.lon, s.created_at > :h1
        FROM territory_steals s JOIN users a ON a.id = s.attacker_id
        WHERE s.created_at > :h24 AND s.created_at <= :now
        """
    ), {"h1": h1, "h24": h24, "now": now}).fetchall():
        reg = out.get(region_of(lat, lon))
        if reg is None:
            continue
        reg.combat_24h += 1
        if in_hour:
            if attacker_bot:
                reg.bot_battles_1h += 1
            else:
                reg.human_battles_1h += 1

    # A club event is one GROUP: clubmates' log rows from the same outing
    # collapse into one by club and a 20-minute bucket of start time.
    groups: dict = {}
    for is_bot, clan_id, lat, lon, started, in_hour in db.execute(text(
        """
        SELECT u.is_bot, cl.clan_id::text, ST_Y(ST_StartPoint(r.path)),
               ST_X(ST_StartPoint(r.path)), r.started_at, cl.logged_at > :h1
        FROM club_run_logs cl
        JOIN runs r ON r.id = cl.run_id
        JOIN users u ON u.id = cl.user_id
        WHERE cl.logged_at > :h7d AND cl.logged_at <= :now
        """
    ), {"h1": h1, "h7d": now - timedelta(days=7), "now": now}).fetchall():
        key = region_of(lat, lon)
        if key not in out:
            continue
        g = groups.setdefault((clan_id, int(started.timestamp() // 1200)), {
            "region": key, "human": False, "in_hour": False, "clan": clan_id,
        })
        g["human"] = g["human"] or not is_bot
        g["in_hour"] = g["in_hour"] or bool(in_hour)
    clubs_by_region: dict = {k: set() for k in REGION_KEYS}
    for g in groups.values():
        clubs_by_region[g["region"]].add(g["clan"])
        if g["in_hour"]:
            if g["human"]:
                out[g["region"]].human_club_1h += 1
            else:
                out[g["region"]].bot_club_1h += 1
    for k, clubs in clubs_by_region.items():
        out[k].active_clubs = len(clubs)

    for lat, lon in db.execute(text(
        f"""
        SELECT ST_Y(ST_Centroid(t.polygon)), ST_X(ST_Centroid(t.polygon))
        FROM territories t JOIN users u ON u.id = t.user_id
        WHERE NOT u.is_bot AND t.verified AND {_live_sql('t')}
        """
    ), {"life_per": settings.territory_life_days_per_strength}).fetchall():
        reg = out.get(region_of(lat, lon))
        if reg is not None:
            reg.human_territory += 1

    for key, n in db.execute(text(
        "SELECT region_key, count(*) FROM bot_accounts GROUP BY region_key"
    )).fetchall():
        if key in out:
            out[key].bot_population = int(n)

    for h in hotspots:
        if h.region_key in out:
            out[h.region_key].hotspots += 1
    return out


def read_territories(db) -> list:
    rows = db.execute(text(
        f"""
        SELECT t.id::text, t.user_id::text, u.is_bot, u.clan_id::text, t.clan_id::text,
               {elo.rating_sql('u')},
               ST_Y(ST_Centroid(t.polygon)), ST_X(ST_Centroid(t.polygon)),
               t.area_m2, t.strength
        FROM territories t JOIN users u ON u.id = t.user_id
        WHERE t.verified AND {_live_sql('t')}
        """
    ), {"life_per": settings.territory_life_days_per_strength}).fetchall()
    return [
        Territory(
            id=r[0], owner_id=r[1], owner_is_bot=bool(r[2]), owner_clan=r[3],
            attributed_clan=r[4], owner_tier=_tier_of(r[5]), lat=float(r[6]),
            lon=float(r[7]), area_m2=float(r[8] or 0), strength=float(r[9] or 1.0),
        )
        for r in rows
    ]


def read_bots(db, now: datetime, territories: list) -> list:
    live = {}
    for t in territories:
        if t.owner_is_bot:
            live[t.owner_id] = live.get(t.owner_id, 0) + 1
    rows = db.execute(text(
        f"""
        SELECT b.user_id::text, u.username, u.clan_id::text, u.avatar,
               b.home_lat, b.home_lon, b.region_key, b.next_run_at, b.attacker,
               {elo.rating_sql('u')},
               r.last_end, COALESCE(r.n7, 0), COALESCE(r.n24, 0)
        FROM bot_accounts b
        JOIN users u ON u.id = b.user_id AND u.is_bot
        LEFT JOIN (
            SELECT user_id, MAX(ended_at) AS last_end,
                   COUNT(*) FILTER (WHERE started_at > :d7) AS n7,
                   COUNT(*) FILTER (WHERE started_at > :d1) AS n24
            FROM runs
            WHERE started_at > :d14
            GROUP BY user_id
        ) r ON r.user_id = b.user_id
        """
    ), {"d14": now - timedelta(days=14), "d7": now - timedelta(days=7),
        "d1": now - timedelta(days=1)}).fetchall()
    bots = {
        r[0]: Bot(
            user_id=r[0], username=r[1], clan_id=r[2], avatar=r[3] or {},
            home_lat=float(r[4]), home_lon=float(r[5]), region_key=r[6],
            next_run_at=r[7], attacker=bool(r[8]), tier=_tier_of(r[9]),
            last_run_end=r[10], runs_7d=int(r[11]), runs_24h=int(r[12]),
            live_territories=live.get(r[0], 0),
        )
        for r in rows
    }
    for victim, attacker, lat, lon, at in db.execute(text(
        """
        SELECT s.victim_id::text, s.attacker_id::text, s.lat, s.lon, s.created_at
        FROM territory_steals s JOIN users v ON v.id = s.victim_id AND v.is_bot
        WHERE NOT s.defended AND s.created_at > :d1
        ORDER BY s.created_at DESC
        """
    ), {"d1": now - timedelta(days=1)}).fetchall():
        if victim in bots:
            bots[victim].losses.append((attacker, lat, lon, at))
    return list(bots.values())


def read_pairs(db, now: datetime) -> dict:
    """Rivalry between every pair that has fought in two weeks, both orders,
    plus the director's own record of runs aimed at a human that clipped
    nothing (a near miss is still an encounter for cooldown purposes)."""
    pairs: dict = {}

    def get(a, b) -> PairHistory:
        return pairs.setdefault((a, b), PairHistory())

    for a, b, defended, area, at in db.execute(text(
        """
        SELECT attacker_id::text, victim_id::text, defended, area_m2, created_at
        FROM territory_steals
        WHERE created_at > :d14
        ORDER BY created_at
        """
    ), {"d14": now - timedelta(days=14)}).fetchall():
        for x, y in ((a, b), (b, a)):
            p = get(x, y)
            p.fights += 1
            if at > now - timedelta(hours=48):
                p.fights_48h += 1
            p.last_at = at if p.last_at is None or at > p.last_at else p.last_at
        if not defended:
            get(a, b).a_took_m2 += float(area or 0)
            get(b, a).b_took_m2 += float(area or 0)
        # Consecutive bounces by this attacker on this victim.
        ab = get(a, b)
        ab.recent_defended_streak = ab.recent_defended_streak + 1 if defended else 0

    for bot_id, target, at, has_steal in db.execute(text(
        """
        SELECT i.bot_user_id::text, i.target_user_id::text, i.resolved_at,
               EXISTS (SELECT 1 FROM territory_steals s WHERE s.run_id = i.run_id)
        FROM bot_world_intents i
        WHERE i.status = 'done' AND i.target_user_id IS NOT NULL
          AND i.bot_user_id IS NOT NULL AND i.resolved_at > :d7
        """
    ), {"d7": now - timedelta(days=7)}).fetchall():
        if has_steal:
            continue  # already counted from the ledger
        for x, y in ((bot_id, target), (target, bot_id)):
            p = get(x, y)
            p.fights += 1
            if at > now - timedelta(hours=48):
                p.fights_48h += 1
            p.last_at = at if p.last_at is None or at > p.last_at else p.last_at
    return pairs


def read_humans(db, now: datetime, territories: list, active_days: float,
                organic_weight: float) -> list:
    by_owner: dict = {}
    for t in territories:
        if not t.owner_is_bot:
            by_owner.setdefault(t.owner_id, []).append(t)
    if not by_owner:
        return []
    rows = db.execute(text(
        f"""
        SELECT u.id::text, u.username, u.clan_id::text, {elo.rating_sql('u')},
               (SELECT MAX(r.ended_at) FROM runs r WHERE r.user_id = u.id),
               (SELECT MIN(t.created_at) FROM territories t WHERE t.user_id = u.id)
        FROM users u
        WHERE NOT u.is_bot AND u.id = ANY(CAST(:ids AS uuid[]))
        """
    ), {"ids": list(by_owner)}).fetchall()
    humans = {}
    for uid, name, clan, rating, last_end, first_land in rows:
        if last_end is None or last_end < now - timedelta(days=active_days):
            continue
        humans[uid] = Human(
            user_id=uid, username=name, clan_id=clan, tier=_tier_of(rating),
            last_run_end=last_end, territories=by_owner[uid], first_land_at=first_land,
        )
    if not humans:
        return []
    ids = list(humans)

    seen_runs: dict = {h: set() for h in ids}
    for a, v, a_bot, v_bot, defended, at, run_id in db.execute(text(
        """
        SELECT s.attacker_id::text, s.victim_id::text, a.is_bot, v.is_bot,
               s.defended, s.created_at, s.run_id::text
        FROM territory_steals s
        JOIN users a ON a.id = s.attacker_id
        JOIN users v ON v.id = s.victim_id
        WHERE s.created_at > :d2
          AND (s.attacker_id = ANY(CAST(:ids AS uuid[])) OR s.victim_id = ANY(CAST(:ids AS uuid[])))
        ORDER BY s.created_at DESC
        """
    ), {"d2": now - timedelta(hours=48), "ids": ids}).fetchall():
        for me, other_bot in ((a, v_bot), (v, a_bot)):
            h = humans.get(me)
            if h is None or run_id in seen_runs[me]:
                continue
            seen_runs[me].add(run_id)
            weight = 1.0 if other_bot else organic_weight
            h.interactions_48h += weight
            if at > now - timedelta(hours=24):
                h.interactions_24h += weight
                if other_bot:
                    h.bot_interactions_24h += 1
            h.last_interaction_at = max(filter(None, [h.last_interaction_at, at]))
            if other_bot:
                h.last_bot_interaction_at = max(filter(None, [h.last_bot_interaction_at, at]))
            if me == v:
                if defended:
                    h.last_defended_at = max(filter(None, [h.last_defended_at, at]))
                else:
                    h.last_attacked_at = max(filter(None, [h.last_attacked_at, at]))
                if a_bot and a not in h.recent_attackers:
                    h.recent_attackers.append(a)

    for target, bot_id, at, run_id in db.execute(text(
        """
        SELECT target_user_id::text, bot_user_id::text, resolved_at, run_id::text
        FROM bot_world_intents
        WHERE status = 'done' AND resolved_at > :d2
          AND target_user_id = ANY(CAST(:ids AS uuid[]))
        ORDER BY resolved_at DESC
        """
    ), {"d2": now - timedelta(hours=48), "ids": ids}).fetchall():
        h = humans.get(target)
        if h is None:
            continue
        if bot_id and bot_id not in h.recent_attackers:
            h.recent_attackers.append(bot_id)
        h.last_bot_interaction_at = max(filter(None, [h.last_bot_interaction_at, at]))
        if run_id in seen_runs[target]:
            continue
        seen_runs[target].add(run_id)
        h.interactions_48h += 1.0
        h.last_interaction_at = max(filter(None, [h.last_interaction_at, at]))
        if at > now - timedelta(hours=24):
            h.interactions_24h += 1.0
            h.bot_interactions_24h += 1

    for target, n in db.execute(text(
        """
        SELECT target_user_id::text, count(*) FROM bot_world_intents
        WHERE status = 'pending' AND stage = 'floor'
          AND target_user_id = ANY(CAST(:ids AS uuid[]))
        GROUP BY 1
        """
    ), {"ids": ids}).fetchall():
        humans[target].pending_floor = int(n)
    return list(humans.values())


def read_new_human_claims(db, now: datetime, lookback_h: float = 6.0) -> list:
    """Human claims the director has not yet decided how the world reacts to."""
    rows = db.execute(text(
        """
        SELECT r.id::text, r.user_id::text, r.claimed_at,
               ST_Y(ST_StartPoint(r.path)), ST_X(ST_StartPoint(r.path)),
               ARRAY(SELECT s.victim_id::text FROM territory_steals s
                     JOIN users v ON v.id = s.victim_id AND v.is_bot
                     WHERE s.run_id = r.id AND NOT s.defended)
        FROM runs r JOIN users u ON u.id = r.user_id
        WHERE NOT u.is_bot AND r.verified AND r.path IS NOT NULL
          AND r.claimed_at > :since AND r.claimed_at <= :now
          AND NOT EXISTS (
              SELECT 1 FROM bot_world_intents i WHERE i.source = 'claim:' || r.id::text
          )
        ORDER BY r.claimed_at
        """
    ), {"since": now - timedelta(hours=lookback_h), "now": now}).fetchall()
    return [HumanClaim(r[0], r[1], r[2], float(r[3]), float(r[4]), list(r[5] or [])) for r in rows]


def read_due_intents(db, now: datetime, limit: int = 60, lock: bool = False) -> list:
    rows = db.execute(text(
        """
        SELECT id::text, kind, stage, source, target_user_id::text, bot_user_id::text,
               lat, lon, region_key, due_at, expires_at
        FROM bot_world_intents
        WHERE status = 'pending' AND due_at <= :now AND expires_at > :now
        ORDER BY due_at
        LIMIT :n
        """ + (" FOR UPDATE SKIP LOCKED" if lock else "")
    ), {"now": now, "n": limit}).fetchall()
    return [Intent(*r) for r in rows]


def read_hotspots(db, now: datetime) -> tuple:
    rows = db.execute(text(
        """
        SELECT id::text, region_key, lat, lon, radius_m, multiplier, label, starts_at, ends_at
        FROM bot_hotspots
        WHERE ends_at > :d1
        ORDER BY starts_at
        """
    ), {"d1": now - timedelta(hours=24)}).fetchall()
    spots = [Hotspot(*r) for r in rows]
    active = [h for h in spots if h.starts_at <= now < h.ends_at]
    recent = [h for h in spots if h.ends_at <= now]
    return active, recent


def read_last_club_runs(db, now: datetime) -> dict:
    return {
        r[0]: r[1] for r in db.execute(text(
            "SELECT clan_id::text, MAX(logged_at) FROM club_run_logs "
            "WHERE logged_at > :d14 GROUP BY 1"
        ), {"d14": now - timedelta(days=14)}).fetchall()
    }


def read_human_run_points(db, now: datetime) -> list:
    return [
        (float(r[0]), float(r[1])) for r in db.execute(text(
            """
            SELECT ST_Y(ST_StartPoint(r.path)), ST_X(ST_StartPoint(r.path))
            FROM runs r JOIN users u ON u.id = r.user_id
            WHERE NOT u.is_bot AND r.ended_at > :d1 AND r.path IS NOT NULL
            """
        ), {"d1": now - timedelta(hours=24)}).fetchall()
    ]


def snapshot(db, now: datetime, cfg) -> Snapshot:
    active, recent = read_hotspots(db, now)
    territories = read_territories(db)
    regs = read_regions(db, now, active)
    return Snapshot(
        now=now,
        regions=regs,
        territories=territories,
        bots=read_bots(db, now, territories),
        humans=read_humans(db, now, territories, cfg.human_active_days, cfg.human_organic_weight),
        new_human_claims=read_new_human_claims(db, now),
        due_intents=read_due_intents(db, now),
        hotspots=active,
        recent_hotspots=recent,
        pairs=read_pairs(db, now),
        last_club_run=read_last_club_runs(db, now),
        human_run_points_24h=read_human_run_points(db, now),
        bot_claims_last_hour=sum(r.bot_claims_1h for r in regs.values()),
    )


def target_geometry(db, territory_id: str, near_lat: float, near_lon: float):
    """The edge of one territory nearest a point, a point inside it, and its
    (simplified) outline — or None if it has gone since the snapshot."""
    row = db.execute(text(
        f"""
        SELECT ST_Y(p), ST_X(p), ST_Y(c), ST_X(c), wkt
        FROM (
            SELECT ST_ClosestPoint(t.polygon, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)) AS p,
                   ST_PointOnSurface(t.polygon) AS c,
                   ST_AsText(ST_SimplifyPreserveTopology(t.polygon, 0.00003)) AS wkt
            FROM territories t
            WHERE t.id = CAST(:tid AS uuid) AND t.verified AND {_live_sql('t')}
        ) s
        """
    ), {"tid": territory_id, "lat": near_lat, "lon": near_lon,
        "life_per": settings.territory_life_days_per_strength}).fetchone()
    if row is None:
        return None
    return {"edge": (float(row[0]), float(row[1])), "inside": (float(row[2]), float(row[3])),
            "wkt": row[4]}
