"""Game events: one reading of what happened on the map, for every surface.

WHY ONE MODULE. The feed, Rivals, the map's territory card, run detail, the
club page and the notifications all describe the same beats. Five endpoints
each reconstructing "who attacked whom, for which club" would drift, and the
first place they drift is exactly the solo/club line this module exists to
hold. So every surface asks here, and nothing below is a new game system: it
is a READ of three ledgers that already exist.

  territory_events  every beat (claim, steal, defend, reinforce), with the
                    ground that changed hands and, since 0048, the defender's
                    club at that moment (`victim_clan_id`)
  club_run_logs     which runs counted for a club, and since 0047 which of them
                    were one club run (`session_id`)
  elo_events        what a club battle did to both clubs' ratings

SOLO OR CLUB, decided once, here (`classify`):

  * A beat is a CLUB beat when its run is in `club_run_logs`: the club ran it
    together, so the ground went to the club. Anything else is SOLO, whatever
    club badge the runner wears. This is attribution, and it is read through
    the log rather than stored on the event because the first finisher of a
    club run only becomes one when a clubmate comes in.
  * A defence is a CLUB defence when a club run attacked a member of another
    club. The defender's side is MEMBERSHIP (`victim_clan_id`), the same fact
    combat reads: clubmates' land stacks its defence, and the club rating
    moves on it (`elo.record_claim_matches`).

A CLUB BATTLE is a club run's claims against one other club's members, folded
per club run session. It is how Rivals, the club page, the feed and the
notifications all count "encounters", so a battle is never counted twice or
told two ways. Its elo delta is shown only where elo_events has one: the first
finisher of a club run claims before the group exists, and that claim was not
a rated club match, so it has no delta to show.

Everything here is phrased from a viewpoint (the viewer, or the viewer's club)
because the same beat is "we captured" on one side and "they attacked us" on
the other. `side` carries that, so no client has to compare ids to know.
"""

from __future__ import annotations

from collections import defaultdict
from datetime import datetime

from sqlalchemy import text

from . import elo, schemas
from .clans_meta import color_triple, photo_url
from .config import settings

# The event types. The client's copy (src/club/eventCopy.js) switches on these.
SOLO_CLAIM = "SOLO_CLAIM"
SOLO_STEAL = "SOLO_STEAL"
SOLO_DEFEND = "SOLO_DEFEND"
CLUB_RUN = "CLUB_RUN"
CLUB_CLAIM = "CLUB_CLAIM"
CLUB_STEAL = "CLUB_STEAL"
CLUB_DEFEND = "CLUB_DEFEND"
CLUB_GOAL_COMPLETED = "CLUB_GOAL_COMPLETED"

# Below this a beat is a clipped polygon edge. The same floor the rivalry
# ledger and the event log use.
MIN_BEAT_M2 = 25.0
# Below this a club battle is not worth telling members who were not in it.
# Participants and victims hear about every beat through their own alerts.
CLUB_ALERT_MIN_M2 = 1000.0

FEED_FILTERS = ("all", "you", "club", "rivals")

# Land is alive until it decays; the same test every board uses.
_LIVE = (
    "now() < COALESCE(t.expires_at, t.created_at + make_interval("
    "secs => GREATEST(t.strength, 0.1) * :life_per * 86400))"
)


# ---------------------------------------------------------------------------
# classification
# ---------------------------------------------------------------------------

def is_battle(actor_clan_id, victim_clan_id) -> bool:
    """A club run against somebody in another club."""
    return bool(actor_clan_id and victim_clan_id and str(actor_clan_id) != str(victim_clan_id))


def classify(kind: str, actor_clan_id=None, victim_clan_id=None) -> str | None:
    """The event type of one territory_events row. None for kinds no surface
    tells as a beat (expiry)."""
    club = bool(actor_clan_id)
    if kind in ("claim", "reinforce"):
        return CLUB_CLAIM if club else SOLO_CLAIM
    if kind == "steal":
        return CLUB_STEAL if club else SOLO_STEAL
    if kind == "defend":
        return CLUB_DEFEND if is_battle(actor_clan_id, victim_clan_id) else SOLO_DEFEND
    return None


def fmt_area(m2: float) -> str:
    """Copy for an area: "18,420 m²" under a square kilometre, km² above."""
    m2 = float(m2 or 0)
    if m2 >= 1_000_000:
        return f"{m2 / 1_000_000:.2f} km²"
    return f"{round(m2):,} m²"


# ---------------------------------------------------------------------------
# identities, fetched once per response
# ---------------------------------------------------------------------------

def people(db, ids, viewer_id=None) -> dict[str, schemas.EventPerson]:
    ids = sorted({str(i) for i in ids if i})
    if not ids:
        return {}
    rows = db.execute(
        text(
            "SELECT id::text, username, avatar, COALESCE(solo_elo, 1000) "
            "FROM users WHERE id = ANY(CAST(:ids AS uuid[]))"
        ),
        {"ids": ids},
    ).fetchall()
    return {
        r[0]: schemas.EventPerson(
            user_id=r[0], username=r[1] or "Runner", avatar=r[2],
            rank_key=elo.key_for(r[3]),
            is_you=viewer_id is not None and r[0] == str(viewer_id),
        )
        for r in rows
    }


def clubs(db, ids, viewer_clan_id=None) -> dict[str, schemas.ClubRef]:
    ids = sorted({str(i) for i in ids if i})
    if not ids:
        return {}
    rows = db.execute(
        text(
            "SELECT id::text, name, tag, color_key, badge_icon, photo_etag, "
            "COALESCE(elo_rating, :initial) FROM clans WHERE id = ANY(CAST(:ids AS uuid[]))"
        ),
        {"ids": ids, "initial": elo.INITIAL_RATING},
    ).fetchall()
    out = {}
    for r in rows:
        tier = elo.tier_for_rating(int(r[6]))
        out[r[0]] = schemas.ClubRef(
            clan_id=r[0], name=r[1], tag=r[2],
            color=schemas.ClanColor(**color_triple(r[3])),
            badge_icon=r[4] or "shield", photo_url=photo_url(r[0], r[5]),
            rank_key=tier["key"], rank_label=tier["label"],
            is_yours=viewer_clan_id is not None and r[0] == str(viewer_clan_id),
        )
    return out


def _session_members(db, session_keys) -> dict[str, list[str]]:
    """User ids per club run session, oldest start first. A key that is a bare
    run id (a club run logged before sessions existed) resolves to that run's
    own runner."""
    keys = sorted({str(k) for k in session_keys if k})
    if not keys:
        return {}
    rows = db.execute(
        text(
            """
            SELECT COALESCE(cr.session_id, cr.run_id)::text, cr.user_id::text
            FROM club_run_logs cr JOIN runs r ON r.id = cr.run_id
            WHERE cr.session_id = ANY(CAST(:k AS uuid[]))
               OR (cr.session_id IS NULL AND cr.run_id = ANY(CAST(:k AS uuid[])))
            ORDER BY r.started_at, cr.run_id
            """
        ),
        {"k": keys},
    ).fetchall()
    out: dict[str, list[str]] = defaultdict(list)
    for key, uid in rows:
        if uid not in out[key]:
            out[key].append(uid)
    return out


# ---------------------------------------------------------------------------
# beats: single territory_events rows
# ---------------------------------------------------------------------------

_BEAT_COLUMNS = """
    te.id::text AS id, te.kind, te.run_id::text AS run_id, te.created_at,
    te.area_m2, te.lat, te.lon, te.actor_id::text AS actor_id,
    te.victim_id::text AS victim_id, te.victim_clan_id::text AS victim_clan_id,
    cr.clan_id::text AS actor_clan_id,
    COALESCE(cr.session_id, cr.run_id)::text AS session_key
"""
_BEAT_FROM = """
    FROM territory_events te
    LEFT JOIN club_run_logs cr ON cr.run_id = te.run_id
"""


def beat_events(db, rows, *, viewer_id=None, viewer_clan_id=None) -> list[schemas.GameEvent]:
    """territory_events rows (selected with _BEAT_COLUMNS) as GameEvents.

    For a defence the HEADLINE belongs to the defender, so actor and target
    swap: the row stores the attacker as `actor_id` (see migration 0038), the
    event leads with whoever held.
    """
    ppl = people(db, [x for r in rows for x in (r.actor_id, r.victim_id)], viewer_id)
    cls = clubs(db, [x for r in rows for x in (r.actor_clan_id, r.victim_clan_id)], viewer_clan_id)
    me, my_club = (str(viewer_id) if viewer_id else None), (str(viewer_clan_id) if viewer_clan_id else None)
    out = []
    for r in rows:
        etype = classify(r.kind, r.actor_clan_id, r.victim_clan_id)
        if etype is None:
            continue
        attacker, attacker_club = r.actor_id, r.actor_clan_id
        victim = r.victim_id
        # The victim's club is only a CLUB fact in a battle; a club run taking
        # a solo runner's land is "we took Ryan's", not "we beat his club".
        victim_club = r.victim_clan_id if is_battle(attacker_club, r.victim_clan_id) else None
        if r.kind == "defend":
            actor, actor_club, target, target_club = victim, victim_club, attacker, attacker_club
            outcome = "held"
        else:
            actor, actor_club, target, target_club = attacker, attacker_club, victim, victim_club
            outcome = {"claim": "claimed", "reinforce": "reinforced"}.get(r.kind, "captured")
        club_event = etype.startswith("CLUB_")
        if club_event and my_club:
            side = "ours" if actor_club == my_club else "theirs" if target_club == my_club else "neutral"
        elif me:
            side = "ours" if actor == me else "theirs" if target == me else "neutral"
        else:
            side = "neutral"
        out.append(
            schemas.GameEvent(
                id=f"beat:{r.id}",
                event_type=etype,
                actor_type="club" if club_event and actor_club else "user",
                actor=ppl.get(actor),
                actor_club=cls.get(actor_club) if actor_club else None,
                target=ppl.get(target),
                target_club=cls.get(target_club) if target_club else None,
                outcome=outcome,
                side=side,
                area_m2=float(r.area_m2 or 0),
                run_id=r.run_id,
                session_id=r.session_key if attacker_club else None,
                lat=r.lat, lon=r.lon, at=r.created_at,
            )
        )
    return out


def personal_beats(db, viewer_id, viewer_clan_id, *, incoming_only: bool,
                   include_battles: bool, before=None, limit: int = 20):
    """Steals and defences between the viewer and another runner.

    `incoming_only`: only beats where the viewer was the one attacked. Their
    own attacks already have a run card in the feed, with its victims on it.
    `include_battles`: False drops beats that are part of a club battle, for
    the surfaces that show the battle itself instead.
    """
    rows = db.execute(
        text(
            f"""
            SELECT {_BEAT_COLUMNS}
            {_BEAT_FROM}
            WHERE te.kind IN ('steal', 'defend')
              AND te.victim_id IS NOT NULL
              AND te.area_m2 >= :floor
              AND (te.victim_id = CAST(:me AS uuid)
                   OR (NOT :incoming AND te.actor_id = CAST(:me AS uuid)))
              AND (:battles OR NOT (cr.clan_id IS NOT NULL
                                    AND te.victim_clan_id IS NOT NULL
                                    AND te.victim_clan_id <> cr.clan_id))
              AND (CAST(:before AS timestamp) IS NULL OR te.created_at < CAST(:before AS timestamp))
            ORDER BY te.created_at DESC
            LIMIT :lim
            """
        ),
        {"me": str(viewer_id), "incoming": incoming_only, "battles": include_battles,
         "before": before, "lim": limit, "floor": MIN_BEAT_M2},
    ).fetchall()
    # A personal beat is told from the viewer's side, never their club's.
    return beat_events(db, rows, viewer_id=viewer_id, viewer_clan_id=None)


# ---------------------------------------------------------------------------
# club battles
# ---------------------------------------------------------------------------

_BATTLES_SQL = """
WITH b AS (
    SELECT te.kind, te.run_id, te.created_at, te.area_m2, te.lat, te.lon,
           te.actor_id, te.victim_id, te.victim_clan_id,
           cr.clan_id AS actor_clan_id,
           COALESCE(cr.session_id, cr.run_id) AS session_key
    FROM territory_events te
    JOIN club_run_logs cr ON cr.run_id = te.run_id
    WHERE te.kind IN ('steal', 'defend')
      AND te.victim_clan_id IS NOT NULL
      AND te.victim_clan_id <> cr.clan_id
      AND te.area_m2 >= :floor
      AND {scope}
)
SELECT session_key::text, actor_clan_id::text, victim_clan_id::text,
       COALESCE(SUM(area_m2) FILTER (WHERE kind = 'steal'), 0) AS captured,
       COALESCE(SUM(area_m2) FILTER (WHERE kind = 'defend'), 0) AS held,
       MAX(created_at) AS at,
       ARRAY_AGG(DISTINCT victim_id::text) FILTER (WHERE kind = 'defend') AS holders,
       ARRAY_AGG(DISTINCT victim_id::text) FILTER (WHERE kind = 'steal') AS losers,
       ARRAY_AGG(DISTINCT run_id::text) AS run_ids,
       (ARRAY_AGG(lat ORDER BY area_m2 DESC))[1] AS lat,
       (ARRAY_AGG(lon ORDER BY area_m2 DESC))[1] AS lon
FROM b
GROUP BY session_key, actor_clan_id, victim_clan_id
HAVING CAST(:before AS timestamp) IS NULL OR MAX(created_at) < CAST(:before AS timestamp)
ORDER BY MAX(created_at) DESC
LIMIT :lim
"""


def battle_rows(db, *, clan_id=None, other_clan_id=None, session_key=None,
                run_ids=None, before=None, limit: int = 30):
    """Club battles, newest first, scoped by club, pair, session or runs."""
    scope, params = [], {"floor": MIN_BEAT_M2, "before": before, "lim": limit}
    if clan_id:
        scope.append("(cr.clan_id = CAST(:cid AS uuid) OR te.victim_clan_id = CAST(:cid AS uuid))")
        params["cid"] = str(clan_id)
    if other_clan_id:
        scope.append("(cr.clan_id = CAST(:oid AS uuid) OR te.victim_clan_id = CAST(:oid AS uuid))")
        params["oid"] = str(other_clan_id)
    if session_key:
        scope.append("COALESCE(cr.session_id, cr.run_id) = CAST(:sk AS uuid)")
        params["sk"] = str(session_key)
    if run_ids is not None:
        scope.append("te.run_id = ANY(CAST(:rids AS uuid[]))")
        params["rids"] = [str(r) for r in run_ids]
    sql = _BATTLES_SQL.format(scope=" AND ".join(scope) or "true")
    return db.execute(text(sql), params).fetchall()


def _battle_elo(db, rows) -> dict:
    """(attacker club, defender club, session) -> the attacker's summed delta."""
    run_to_battle = {}
    for b in rows:
        for rid in b.run_ids or []:
            run_to_battle[(rid, b.actor_clan_id, b.victim_clan_id)] = (b.actor_clan_id, b.victim_clan_id, b.session_key)
    rids = sorted({k[0] for k in run_to_battle})
    if not rids:
        return {}
    out: dict = {}
    for run_id, a, bb, delta in db.execute(
        text(
            "SELECT run_id::text, clan_a_id::text, clan_b_id::text, delta_a FROM elo_events "
            "WHERE scope = 'club' AND run_id = ANY(CAST(:r AS uuid[]))"
        ),
        {"r": rids},
    ).fetchall():
        key = run_to_battle.get((run_id, a, bb))
        if key:
            out[key] = out.get(key, 0) + int(delta or 0)
    return out


def battle_events(db, rows, *, viewer_id=None, viewer_clan_id=None) -> list[schemas.GameEvent]:
    """Battle rows as GameEvents, phrased from `viewer_clan_id`'s side.

    Any ground taken makes it a capture (CLUB_STEAL, led by the attackers);
    a battle where every attack bounced is a defence (CLUB_DEFEND, led by the
    club that held, with the members whose land held as its participants).
    """
    if not rows:
        return []
    members = _session_members(db, [b.session_key for b in rows])
    person_ids = set()
    for b in rows:
        person_ids.update(members.get(b.session_key, []))
        person_ids.update(b.holders or [])
    ppl = people(db, person_ids, viewer_id)
    cls = clubs(db, [x for b in rows for x in (b.actor_clan_id, b.victim_clan_id)], viewer_clan_id)
    deltas = _battle_elo(db, rows)
    my_club = str(viewer_clan_id) if viewer_clan_id else None
    out = []
    for b in rows:
        captured = float(b.captured or 0) > 0
        attackers = [ppl[u] for u in members.get(b.session_key, []) if u in ppl]
        holders = [ppl[u] for u in (b.holders or []) if u in ppl]
        if captured:
            etype, actor_club, target_club = CLUB_STEAL, b.actor_clan_id, b.victim_clan_id
            participants, area, outcome = attackers, float(b.captured), "captured"
        else:
            etype, actor_club, target_club = CLUB_DEFEND, b.victim_clan_id, b.actor_clan_id
            participants, area, outcome = holders, float(b.held), "held"
        # elo_events stores the ATTACKER's delta; the match is zero sum, so
        # the defender moved by its negative. Only a side of the battle has a
        # delta to show.
        raw = deltas.get((b.actor_clan_id, b.victim_clan_id, b.session_key))
        delta = None
        if raw is not None and my_club == b.actor_clan_id:
            delta = raw
        elif raw is not None and my_club == b.victim_clan_id:
            delta = -raw
        side = "neutral"
        if my_club:
            side = "ours" if actor_club == my_club else "theirs" if target_club == my_club else "neutral"
        out.append(
            schemas.GameEvent(
                id=f"battle:{b.session_key}:{b.actor_clan_id}:{b.victim_clan_id}",
                event_type=etype,
                actor_type="club",
                actor_club=cls.get(actor_club),
                target_club=cls.get(target_club),
                participants=participants[:8],
                participant_count=len(participants),
                outcome=outcome,
                side=side,
                area_m2=area,
                held_m2=float(b.held or 0) if captured else 0.0,
                elo_delta=delta,
                run_id=(b.run_ids or [None])[0],
                session_id=b.session_key,
                lat=b.lat, lon=b.lon, at=b.at,
            )
        )
    return out


def club_battles(db, clan_id, *, other_clan_id=None, before=None, limit=30, viewer_id=None):
    rows = battle_rows(db, clan_id=clan_id, other_clan_id=other_clan_id, before=before, limit=limit)
    return battle_events(db, rows, viewer_id=viewer_id, viewer_clan_id=clan_id)


def last_battle(db, clan_id, viewer_id=None) -> schemas.GameEvent | None:
    """The most recent battle that moved this club's rating, for the rank card.
    Falls back to the most recent battle at all only when it carries a delta,
    so "+18" is never shown for a battle that was not rated."""
    for ev in club_battles(db, clan_id, limit=5, viewer_id=viewer_id):
        if ev.elo_delta is not None:
            return ev
    return None


# ---------------------------------------------------------------------------
# club rivals
# ---------------------------------------------------------------------------

# How much history a rival list reads. A rivalry older than this many battles
# has long since established who it is with.
RIVAL_BATTLE_CAP = 500


def club_rivals(db, clan_id, *, viewer_id=None, other_clan_id=None, limit=25) -> list[schemas.ClubRivalCard]:
    """Every club this club has fought, newest battle first, from our side."""
    rows = battle_rows(db, clan_id=clan_id, other_clan_id=other_clan_id, limit=RIVAL_BATTLE_CAP)
    events = battle_events(db, rows, viewer_id=viewer_id, viewer_clan_id=clan_id)
    mine = str(clan_id)
    cards: dict[str, dict] = {}
    for row, ev in zip(rows, events):
        other = row.victim_clan_id if row.actor_clan_id == mine else row.actor_clan_id
        c = cards.setdefault(other, {
            "club": ev.target_club if ev.actor_club and ev.actor_club.clan_id == mine else ev.actor_club,
            "encounters": 0, "exchanged_m2": 0.0,
            "our_captures": 0, "their_captures": 0, "our_defences": 0, "their_defences": 0,
            "our_taken_m2": 0.0, "their_taken_m2": 0.0,
            "last_at": None, "last_battle": None, "recent_ground": [], "members": [],
        })
        captured = float(row.captured or 0)
        c["encounters"] += 1
        c["exchanged_m2"] += captured
        we_attacked = row.actor_clan_id == mine
        if we_attacked:
            if captured > 0:
                c["our_captures"] += 1
                c["our_taken_m2"] += captured
            else:
                c["their_defences"] += 1
        else:
            if captured > 0:
                c["their_captures"] += 1
                c["their_taken_m2"] += captured
            else:
                c["our_defences"] += 1
        if c["last_battle"] is None:
            c["last_battle"], c["last_at"] = ev, ev.at
        if len(c["recent_ground"]) < 3 and ev.lat is not None:
            c["recent_ground"].append(ev)
        # Our side of the recent battles: our runners when we attacked, our
        # members whose land held when we defended.
        if len(c["members"]) < 6 and ev.side == "ours":
            for p in ev.participants:
                if p.user_id not in {m.user_id for m in c["members"]}:
                    c["members"].append(p)
    out = []
    for c in cards.values():
        if c["club"] is None:
            continue
        members = c.pop("members")
        out.append(schemas.ClubRivalCard(**c, recent_members=members[:6]))
    out.sort(key=lambda c: c.last_at or datetime.min, reverse=True)
    return out[:limit]


# ---------------------------------------------------------------------------
# a run's story: what its claim did, and what its ground held off
# ---------------------------------------------------------------------------

def run_battles(db, run_id, owner_id, *, viewer_id=None, viewer_clan_id=None) -> list[schemas.GameEvent]:
    """For run detail: every beat this run's claim made against someone, plus
    attacks on the owner that bounced off ground this run still holds.

    The second half is bounded by what exists: once the run's ground is gone
    (expired, taken) there is nothing left to intersect, and older beats on it
    are simply not listed rather than guessed at.
    """
    rows = db.execute(
        text(
            f"""
            SELECT {_BEAT_COLUMNS}
            {_BEAT_FROM}
            WHERE te.run_id = CAST(:rid AS uuid)
              AND te.kind IN ('steal', 'defend')
              AND te.area_m2 >= :floor
            UNION ALL
            SELECT {_BEAT_COLUMNS}
            {_BEAT_FROM}
            WHERE te.kind = 'defend'
              AND te.victim_id = CAST(:owner AS uuid)
              AND te.area_m2 >= :floor
              AND te.ground IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM territories t
                  WHERE t.run_id = CAST(:rid AS uuid)
                    AND ST_Intersects(t.polygon, te.ground)
                    AND t.created_at <= te.created_at
              )
            ORDER BY created_at DESC
            LIMIT 20
            """
        ),
        {"rid": str(run_id), "owner": str(owner_id), "floor": MIN_BEAT_M2},
    ).fetchall()
    # Told from the RUNNER's side ("ours" = the runner did it), whoever is
    # looking: this is the run's story, not the viewer's.
    return beat_events(db, rows, viewer_id=owner_id, viewer_clan_id=None)


# ---------------------------------------------------------------------------
# the map: one plot's story
# ---------------------------------------------------------------------------

def territory_story(db, territory_id, *, lat=None, lon=None, viewer_id=None, viewer_clan_id=None):
    """Everything recorded about one plot, or None if it no longer exists.

    Territory ids do not survive a merge (the claim engine deletes and
    re-inserts rows), so a tap on a board fetched a minute ago can name a row
    that is gone. With the tapped point, the live plot under it answers
    instead. Old land degrades rather than inventing: a plot whose run is not
    in the club run log has no participants, and a plot older than the event
    log has no history.
    """
    from . import club_runs

    t = db.execute(
        text(
            f"""
            SELECT t.id::text, t.user_id::text, t.run_id::text, t.clan_id::text,
                   t.created_at, t.area_m2
            FROM territories t
            WHERE t.id = CAST(:tid AS uuid)
               OR (CAST(:lat AS float8) IS NOT NULL
                   AND t.verified
                   AND {_LIVE}
                   AND ST_Contains(t.polygon, ST_SetSRID(ST_Point(:lon, :lat), 4326)))
            ORDER BY (t.id = CAST(:tid AS uuid)) DESC, t.strength DESC
            LIMIT 1
            """
        ),
        {"tid": str(territory_id), "lat": lat, "lon": lon,
         "life_per": settings.territory_life_days_per_strength},
    ).fetchone()
    if not t:
        return None
    tid, owner_id, run_id, clan_id, created_at, area = t

    club_area = None
    if clan_id:
        club_area = float(db.execute(
            text(
                "SELECT COALESCE(SUM(t.area_m2), 0) FROM territories t "
                f"WHERE t.clan_id = CAST(:c AS uuid) AND t.verified AND {_LIVE}"
            ),
            {"c": clan_id, "life_per": settings.territory_life_days_per_strength},
        ).scalar() or 0)

    session = club_runs.session_for_run(db, run_id) if run_id else None
    participants = []
    if session:
        d = club_runs.describe_sessions(db, [session], viewer_id).get(session)
        participants = [
            schemas.ClubRunPerson(
                user_id=p["user_id"], username=p["username"], avatar=p.get("avatar"),
                rank_key=p.get("rank_key") or "wood", run_id=p.get("run_id"),
                distance_m=float(p.get("distance_m") or 0), is_you=bool(p.get("is_you")),
            )
            for p in (d or {}).get("participants", [])
        ]

    claimed_at = db.execute(
        text(
            "SELECT MIN(created_at) FROM territory_events WHERE run_id = CAST(:r AS uuid) "
            "AND actor_id = CAST(:u AS uuid) AND kind IN ('claim', 'steal', 'reinforce')"
        ),
        {"r": run_id, "u": owner_id},
    ).scalar() if run_id else None

    # Every beat on this ground, newest first. "On this ground" means more than
    # touching an edge: a neighbour's claim that shares a border is not part
    # of this plot's story.
    rows = db.execute(
        text(
            f"""
            SELECT {_BEAT_COLUMNS}
            {_BEAT_FROM}
            JOIN territories t ON t.id = CAST(:tid AS uuid)
            WHERE te.ground IS NOT NULL
              AND te.kind IN ('claim', 'steal', 'defend', 'reinforce')
              AND ST_Intersects(te.ground, t.polygon)
              AND ST_Area(ST_Intersection(te.ground, t.polygon)::geography) >= :floor
            ORDER BY te.created_at DESC
            LIMIT 25
            """
        ),
        {"tid": tid, "floor": MIN_BEAT_M2},
    ).fetchall()
    history = beat_events(db, rows, viewer_id=viewer_id, viewer_clan_id=viewer_clan_id)

    # Every kind selected above classifies, so `history` lines up with `rows`.
    captured_from = [
        ev for ev, r in zip(history, rows)
        if r.kind == "steal" and r.run_id == run_id and r.actor_id == owner_id
    ]
    since = claimed_at or created_at
    held = [
        (ev, r) for ev, r in zip(history, rows)
        if r.kind == "defend" and r.victim_id == owner_id and r.created_at >= since
    ]
    defended_by = {}
    for ev, _r in held:
        if ev.target_club and ev.target_club.clan_id not in defended_by:
            defended_by[ev.target_club.clan_id] = ev.target_club

    club = clubs(db, [clan_id], viewer_clan_id).get(clan_id) if clan_id else None
    return schemas.TerritoryClubStory(
        territory_id=tid,
        club_id=clan_id,
        club_name=club.name if club else None,
        club_tag=club.tag if club else None,
        club_color=club.color if club else None,
        club_run=bool(session),
        participants=participants,
        claimed_at=since,
        defended_count=len(held),
        owner=people(db, [owner_id], viewer_id).get(owner_id),
        area_m2=float(area or 0),
        club_area_m2=club_area,
        captured_from=captured_from,
        last_defended_at=held[0][0].at if held else None,
        defended_by_clubs=list(defended_by.values()),
        history=history,
    )


# ---------------------------------------------------------------------------
# the club page's activity stream
# ---------------------------------------------------------------------------

def club_activity(db, clan_id, *, viewer_id=None, viewer_clan_id=None, before=None, limit=20):
    """Club runs (one item per session), club battles and reached goals,
    newest first. Our own captures are told by the club run card they came
    from (its `captured_from`), so the battle stream carries only fights our
    club did NOT start plus the ones that bounced, and nothing is told twice.
    """
    from . import club_runs
    from .routes.club_run_status import status_model

    sessions = db.execute(
        text(
            """
            SELECT s.id::text, s.ended_at FROM club_run_sessions s
            WHERE s.clan_id = CAST(:c AS uuid)
              AND (CAST(:before AS timestamp) IS NULL OR s.ended_at < CAST(:before AS timestamp))
            ORDER BY s.ended_at DESC LIMIT :lim
            """
        ),
        {"c": str(clan_id), "before": before, "lim": limit + 1},
    ).fetchall()
    described = club_runs.describe_sessions(db, [s[0] for s in sessions], viewer_id)
    items = []
    for sid, ended in sessions:
        d = described.get(sid)
        if not d:
            continue
        d = {**d, "state": "confirmed", "qualified": True}
        items.append(schemas.ClubActivityItem(
            id=f"club_run:{sid}", kind="club_run", created_at=ended,
            club_run=status_model(db, d, viewer_id, viewer_clan_id),
        ))

    for ev in club_battles(db, clan_id, before=before, limit=limit + 1, viewer_id=viewer_id):
        if ev.event_type == CLUB_STEAL and ev.side == "ours":
            continue
        items.append(schemas.ClubActivityItem(id=ev.id, kind="battle", created_at=ev.at, event=ev))

    for gid, reached_at, dist, claims in db.execute(
        text(
            """
            SELECT id::text, reached_at, target_distance_m, target_claims
            FROM clan_week_goals
            WHERE clan_id = CAST(:c AS uuid) AND reached_at IS NOT NULL
              AND (CAST(:before AS timestamp) IS NULL OR reached_at < CAST(:before AS timestamp))
            ORDER BY reached_at DESC LIMIT :lim
            """
        ),
        {"c": str(clan_id), "before": before, "lim": limit + 1},
    ).fetchall():
        items.append(schemas.ClubActivityItem(
            id=f"goal:{gid}", kind="goal", created_at=reached_at,
            goal_distance_m=float(dist or 0), goal_claims=int(claims or 0),
        ))

    items.sort(key=lambda i: i.created_at, reverse=True)
    has_more = len(items) > limit
    items = items[:limit]
    return schemas.ClubActivityOut(
        items=items, next_cursor=items[-1].created_at if has_more and items else None
    )


def goal_events(db, clan_id, *, viewer_clan_id=None, before=None, limit=10) -> list[schemas.GameEvent]:
    """Reached weekly goals as feed events."""
    rows = db.execute(
        text(
            """
            SELECT id::text, reached_at, target_distance_m FROM clan_week_goals
            WHERE clan_id = CAST(:c AS uuid) AND reached_at IS NOT NULL
              AND (CAST(:before AS timestamp) IS NULL OR reached_at < CAST(:before AS timestamp))
            ORDER BY reached_at DESC LIMIT :lim
            """
        ),
        {"c": str(clan_id), "before": before, "lim": limit},
    ).fetchall()
    club = clubs(db, [clan_id], viewer_clan_id).get(str(clan_id))
    return [
        schemas.GameEvent(
            id=f"goal:{gid}", event_type=CLUB_GOAL_COMPLETED, actor_type="club",
            actor_club=club, outcome="completed", side="ours", distance_m=float(dist or 0),
            at=at,
        )
        for gid, at, dist in rows
    ]


# ---------------------------------------------------------------------------
# notifications: club battles, grouped and thresholded
# ---------------------------------------------------------------------------

def club_battle_notifications(db, *, run_id, attacker_clan_id, steal_events,
                              attacker_id, lat=None, lon=None) -> list[dict]:
    """`notify(**kwargs)` for the members of both clubs in a club battle.

    Who hears what, and why so few:
      * Only a CLUB run fighting another club's members is a club battle. A
        solo raid is the victim's own business and they already get told.
      * The runners in the club run and the members whose land was hit get
        their own personal alerts (captured / stolen / defended), so they are
        left out here. This is for everyone else in the two clubs.
      * Below CLUB_ALERT_MIN_M2 nobody else hears about it.
      * Grouped per club run session and outcome (`dedupe_key`): the second
        clubmate's claim in the same club run grows the first alert's number
        instead of sending another. Bots are never told anything.

    Called inside the claim's transaction, after its beats are written, so
    the totals include this claim.
    """
    if not attacker_clan_id:
        return []
    from .claim_consequences import counted
    from .routes.clans import clan_member_ids

    victim_ids = sorted({str(ev["victim_id"]) for ev in counted(steal_events)})
    if not victim_ids:
        return []
    hit = db.execute(
        text(
            "SELECT DISTINCT clan_id::text FROM users WHERE id = ANY(CAST(:v AS uuid[])) "
            "AND clan_id IS NOT NULL AND clan_id <> CAST(:a AS uuid)"
        ),
        {"v": victim_ids, "a": str(attacker_clan_id)},
    ).fetchall()
    if not hit:
        return []
    from . import club_runs
    session = club_runs.session_for_run(db, run_id) or str(run_id)
    runners = set(_session_members(db, [session]).get(session, [])) | {str(attacker_id)}
    cls = clubs(db, [attacker_clan_id] + [h[0] for h in hit])
    us = cls.get(str(attacker_clan_id))
    out = []
    for (victim_clan,) in hit:
        them = cls.get(victim_clan)
        rows = battle_rows(db, session_key=session, clan_id=attacker_clan_id,
                           other_clan_id=victim_clan, limit=5)
        row = next((r for r in rows if r.actor_clan_id == str(attacker_clan_id)
                    and r.victim_clan_id == victim_clan), None)
        if row is None or us is None or them is None:
            continue
        captured, held = float(row.captured or 0), float(row.held or 0)
        touched = set(row.holders or []) | set(row.losers or [])
        data = {"kind": "club_battle", "screen": "club_rival", "lat": lat, "lon": lon,
                "session_id": session}
        if captured >= CLUB_ALERT_MIN_M2:
            ours = [u for u in clan_member_ids(db, str(attacker_clan_id)) if u not in runners]
            theirs = [u for u in clan_member_ids(db, victim_clan) if u not in touched]
            key = f"club_battle:{session}:{attacker_clan_id}:{victim_clan}:captured"
            if ours:
                out.append(dict(
                    user_ids=ours, category="club_battles",
                    title=f"{us.name} captured land",
                    body=f"{us.name} took {fmt_area(captured)} from {them.name}.",
                    data={**data, "clan_id": victim_clan}, actor_id=str(attacker_id),
                    dedupe_key=key,
                ))
            if theirs:
                out.append(dict(
                    user_ids=theirs, category="club_battles",
                    title=f"{us.name} attacked {them.name}",
                    body=f"They took {fmt_area(captured)} of your club's ground.",
                    data={**data, "clan_id": str(attacker_clan_id)}, actor_id=str(attacker_id),
                    dedupe_key=key,
                ))
        elif held >= CLUB_ALERT_MIN_M2:
            theirs = [u for u in clan_member_ids(db, victim_clan) if u not in touched]
            if theirs:
                out.append(dict(
                    user_ids=theirs, category="club_battles",
                    title=f"{them.name} defended",
                    body=f"{us.name} attacked and your club held.",
                    data={**data, "clan_id": str(attacker_clan_id)}, actor_id=str(attacker_id),
                    dedupe_key=f"club_battle:{session}:{attacker_clan_id}:{victim_clan}:held",
                ))
    return out
