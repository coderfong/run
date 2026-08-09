"""PASERBY — the runners whose paths crossed yours.

Two people ran past each other. Neither noticed. Afterwards, both runs are
finished and stored, and this module is what turns that into a card with a
character on it.

WHAT IT MAY KNOW AND WHAT IT MAY SAY are deliberately different things.

To match at all it needs where and when, so a qualifying run is sampled down to
a point every ~25 seconds (`run_traces`) and those samples are kept for a
couple of days. That is the only location data the feature touches, it is
derived from `runs.path` which the app already stores, and no endpoint returns
a row of it.

What it says is far less: a name, a character, a club, "earlier today", and how
many times you have crossed. No coordinate, no route, no distance, no crossing
time, not even a timestamp on the encounter — the API's most precise temporal
answer is a broad phrase, which is why the encounter row stores a DATE and the
`created_at` it orders by is never serialised.

MATCHING. `process_run` takes ONE run's samples (tens to a few hundred rows)
and probes the trace table with them: a time window on an indexed column and
`ST_DWithin` on a GIST-indexed geography column. It is a bounded index probe
per sample, never a comparison of every point against every other point. Both
runs must have ENDED before a match can exist, because a trace is only written
when a run finishes.

WHAT STOPS IT BEING FARMED. Only verified runs that cleared the reward bar are
sampled, so the existing impossible-speed / spoofing / too-short checks gate
this feature for free. A pair can produce one encounter per cooldown window
(24h), so running tiny loops past the same person all afternoon produces one
card. A high five pays a token amount of XP, once per encounter, under a daily
ceiling — and nothing else: no coins, no energy, no territory, no rank.
"""

import math
from datetime import date, datetime, timedelta

from sqlalchemy import text

from . import economy, privacy
from .config import settings
from .database import SessionLocal
from .notifications import notify


# ---------------------------------------------------------------------------
# Familiar faces
# ---------------------------------------------------------------------------

# Labels only. Deliberately NOT a relationship system — the count is derived
# from encounters, and the label is derived from the count.
FAMILIARITY = [
    (10, "local_legend", "Local Legend"),
    (5, "running_regular", "Running Regular"),
    (2, "familiar_face", "Familiar Face"),
    (1, "crossed_paths", "Crossed Paths"),
]


def familiarity_for(times: int):
    """(key, label) for a pair that has crossed `times` times."""
    for threshold, key, label in FAMILIARITY:
        if (times or 0) >= threshold:
            return key, label
    return "crossed_paths", "Crossed Paths"


def crossed_paths_line(count: int) -> str:
    """The one sentence this feature is allowed to push.

    A count. No name, no place, no time — mirrored on the client in
    frontend/src/config/paserby.js so the notification and the reveal say the
    same thing.
    """
    n = int(count or 0)
    return f"You crossed paths with {n} {'PASER' if n == 1 else 'PASERs'} today."


# ---------------------------------------------------------------------------
# Time, broadly
# ---------------------------------------------------------------------------


def local_today() -> date:
    """The current LOCAL day (the same boundary the daily caps use)."""
    return (
        datetime.utcnow() + timedelta(hours=settings.daily_reset_utc_offset_hours)
    ).date()


def when_label(encounter_date, today: date | None = None) -> str:
    """The only temporal answer the API is allowed to give.

    Never a time, never a date — a phrase. "Earlier today" is as precise as
    this gets, because anything sharper narrows down where somebody was.
    """
    today = today or local_today()
    if encounter_date is None:
        return "Recently"
    days = (today - encounter_date).days
    if days <= 0:
        return "Earlier today"
    if days == 1:
        return "Yesterday"
    if days < 7:
        return "This week"
    return "A while back"


def _level(xp) -> int:
    return int(((xp or 0) / 100) ** 0.5)


# ---------------------------------------------------------------------------
# The setting
# ---------------------------------------------------------------------------


def enabled_for(db, user_id) -> bool:
    """Is this runner taking part? An absent row means the configured default."""
    row = db.execute(
        text("SELECT enabled FROM paserby_settings WHERE user_id = :u"),
        {"u": str(user_id)},
    ).fetchone()
    return bool(row[0]) if row else bool(settings.paserby_default_enabled)


def set_enabled(db, user_id, enabled: bool) -> bool:
    """Flip the switch.

    Turning it OFF deletes the runner's stored trace samples immediately — the
    location data this feature keeps exists only to find future crossings, so
    opting out has to take it with it. Past encounters are left alone: they
    carry no location, and they are the other runner's memory too. Anything a
    runner does not want to see there can be hidden, and blocking removes the
    pair's history outright.
    """
    db.execute(
        text(
            """
            INSERT INTO paserby_settings (user_id, enabled, updated_at)
            VALUES (:u, :e, now())
            ON CONFLICT (user_id) DO UPDATE SET enabled = :e, updated_at = now()
            """
        ),
        {"u": str(user_id), "e": bool(enabled)},
    )
    if not enabled:
        db.execute(
            text("DELETE FROM run_traces WHERE user_id = :u"), {"u": str(user_id)}
        )
    db.commit()
    return bool(enabled)


# ---------------------------------------------------------------------------
# Traces — the internal, short-lived samples matching runs on
# ---------------------------------------------------------------------------


def _metres(a, b) -> float:
    """Great-circle metres between two (lon, lat) pairs."""
    lon1, lat1 = a
    lon2, lat2 = b
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlam = math.radians(lon2 - lon1)
    h = math.sin(dphi / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dlam / 2) ** 2
    return 2 * 6_371_000.0 * math.asin(math.sqrt(h))


def _samples(cleaned, interval_s: float, cap: int, trim_m: float = 0.0, zones=()):
    """Thin a cleaned path down to (lon, lat, when) every `interval_s`.

    Time-based rather than vertex-based: the path is already simplified, so a
    straight kilometre may be two vertices and a lap of a park thirty. Sampling
    by the clock keeps the gap between samples bounded in the thing that
    matters — how far a runner can have moved between them.

    The runner's OWN route-privacy settings are applied first, and they matter
    more here than anywhere: an encounter is discovered where two people were,
    so a sample kept at the start of a run is a sample taken at somebody's
    front door. Both ends are trimmed and every privacy zone is cut out, and
    unlike the published-route version there is no stitching to do — the
    survivors are matched individually, so a gap in the middle costs nothing.
    """
    coords = list(cleaned.wgs_coords or [])
    times = list(cleaned.timestamps or [])
    n = min(len(coords), len(times))
    if n == 0:
        return []

    pairs = list(zip(coords[:n], times[:n]))

    if trim_m > 0 and len(pairs) >= 2:
        cum, total = [0.0], 0.0
        for a, b in zip(pairs, pairs[1:]):
            total += _metres(a[0], b[0])
            cum.append(total)
        if total <= 2 * trim_m:
            return []
        pairs = [p for p, d in zip(pairs, cum) if trim_m <= d <= total - trim_m]

    if zones:
        pairs = [
            (c, t)
            for c, t in pairs
            if not any(_metres(c, (z["lon"], z["lat"])) <= z["radius_m"] for z in zones)
        ]

    out = []
    last_at = None
    for i, (c, at) in enumerate(pairs):
        if last_at is None or (at - last_at).total_seconds() >= interval_s or i == len(pairs) - 1:
            out.append((c[0], c[1], at))
            last_at = at
    # A very long run still has a ceiling: keep an evenly spread subset rather
    # than the first `cap`, so the tail of the run is represented too.
    if len(out) > cap:
        stride = len(out) / float(cap)
        out = [out[int(i * stride)] for i in range(cap)]
    return out


def record_trace(db, run, cleaned) -> int:
    """Store this run's samples, if it is the kind of run that may be matched.

    The bars are the app's existing ones: the run has to be verified (so every
    anti-cheat rule already gates this feature), to have cleared the reward tier
    (so a 20 m walk is not a social event), and to be a public run — a run whose
    route the runner has chosen not to publish does not go looking for company
    either. The caller commits.
    """
    if run is None or cleaned is None:
        return 0
    if not run.verified:
        return 0
    if not economy.rewards_earned(run.tier or economy.UNQUALIFIED):
        return 0
    if not enabled_for(db, run.user_id):
        return 0
    # Read visibility from the ROW, not the mapped object: `runs.visibility`
    # arrived with the route-privacy pass and the ORM model does not carry it,
    # so an attribute read would answer "public" for every run forever. A run
    # marked private later is also dropped at match time — see the candidate
    # query — so both ends of the window are covered.
    visibility = db.execute(
        text("SELECT COALESCE(visibility, 'public') FROM runs WHERE id = :r"),
        {"r": str(run.id)},
    ).scalar()
    if visibility != privacy.PUBLIC:
        return 0

    prefs = privacy.load(db, run.user_id)
    rows = _samples(
        cleaned,
        settings.paserby_trace_interval_s,
        settings.paserby_trace_max_points,
        trim_m=prefs.get("trim_m", 0.0),
        zones=prefs.get("zones", ()),
    )
    if not rows:
        return 0

    # Re-running the same finished run must not double the samples.
    db.execute(text("DELETE FROM run_traces WHERE run_id = :r"), {"r": str(run.id)})
    db.execute(
        text(
            "INSERT INTO run_traces (run_id, user_id, at, geog) VALUES "
            "(:r, :u, :at, ST_SetSRID(ST_MakePoint(:lon, :lat), 4326)::geography)"
        ),
        [
            {"r": str(run.id), "u": str(run.user_id), "at": at, "lon": lon, "lat": lat}
            for lon, lat, at in rows
        ],
    )
    return len(rows)


def sweep_traces(db) -> None:
    """Drop samples past the retention window. Indexed on `at`, so it is cheap
    enough to do on the back of the matching that needs them."""
    db.execute(
        text("DELETE FROM run_traces WHERE at < now() - make_interval(days => :d)"),
        {"d": settings.paserby_trace_retention_days},
    )


# ---------------------------------------------------------------------------
# Matching
# ---------------------------------------------------------------------------

# One run's samples against the trace table. The `mine` CTE is small (tens to a
# few hundred rows) and everything on the right of the join is served by an
# index: `at` narrows to the minutes around each sample, ST_DWithin walks the
# GIST index. Filters after the join are the eligibility rules — both runs
# finished and verified, both users opted in, neither blocking the other, and
# the pair outside its cooldown.
_CANDIDATES_SQL = """
WITH mine AS (
    SELECT at, geog FROM run_traces WHERE run_id = :run
),
hits AS (
    SELECT DISTINCT t.run_id, t.user_id
    FROM run_traces t
    JOIN mine m
      ON t.at BETWEEN m.at - make_interval(secs => :win) AND m.at + make_interval(secs => :win)
     AND ST_DWithin(t.geog, m.geog, :radius)
    WHERE t.user_id <> :me
      AND t.at >= now() - make_interval(hours => :lookback)
)
SELECT h.run_id::text, h.user_id::text
FROM hits h
JOIN runs r ON r.id = h.run_id
WHERE r.ended_at IS NOT NULL
  AND r.verified
  AND COALESCE(r.visibility, 'public') = 'public'
  AND COALESCE(
        (SELECT s.enabled FROM paserby_settings s WHERE s.user_id = h.user_id),
        :default_enabled
      )
  AND NOT EXISTS (
        SELECT 1 FROM user_blocks b
        WHERE (b.blocker_id = CAST(:me AS uuid) AND b.blocked_id = h.user_id)
           OR (b.blocker_id = h.user_id AND b.blocked_id = CAST(:me AS uuid))
      )
  AND NOT EXISTS (
        SELECT 1 FROM paserby_pairs p
        WHERE p.lower_user_id = LEAST(CAST(:me AS uuid), h.user_id)
          AND p.higher_user_id = GREATEST(CAST(:me AS uuid), h.user_id)
          AND p.last_encounter_at > now() - make_interval(hours => :cooldown)
      )
ORDER BY h.run_id
LIMIT :cap
"""


def process_run(db, run_id) -> int:
    """Find this run's crossings and write them. Returns how many were new.

    Idempotent twice over: `runs.paserby_at` stops the work being repeated, and
    the unique index on the pair of runs means the same crossing processed from
    either side produces exactly one row.
    """
    run = db.execute(
        text(
            "SELECT user_id::text, ended_at, verified, paserby_at FROM runs WHERE id = :r"
        ),
        {"r": str(run_id)},
    ).fetchone()
    if not run or run[1] is None or run[3] is not None:
        return 0
    me, verified = run[0], bool(run[2])

    # Stamp first: a run that produces nothing must not be re-scanned on every
    # later request that asks about it.
    db.execute(
        text("UPDATE runs SET paserby_at = now() WHERE id = :r"), {"r": str(run_id)}
    )
    if not verified or not enabled_for(db, me):
        db.commit()
        return 0

    rows = db.execute(
        text(_CANDIDATES_SQL),
        {
            "run": str(run_id),
            "me": me,
            "win": settings.paserby_time_window_s,
            "radius": settings.paserby_radius_m,
            "lookback": settings.paserby_lookback_hours,
            "cooldown": settings.paserby_pair_cooldown_hours,
            "default_enabled": bool(settings.paserby_default_enabled),
            "cap": settings.paserby_max_encounters_per_run,
        },
    ).fetchall()

    # One encounter per PERSON, not per run of theirs we happened to touch.
    first_run_of = {}
    for other_run_id, other_user_id in rows:
        first_run_of.setdefault(other_user_id, other_run_id)

    today = local_today()
    created = 0
    for other_user_id, other_run_id in first_run_of.items():
        a, b = sorted([me, other_user_id])
        run_a, run_b = (str(run_id), other_run_id) if a == me else (other_run_id, str(run_id))
        made = db.execute(
            text(
                """
                INSERT INTO paserby_encounters
                    (user_a_id, user_b_id, run_a_id, run_b_id, encounter_date)
                VALUES (:a, :b, :ra, :rb, :d)
                ON CONFLICT (run_a_id, run_b_id) DO NOTHING
                RETURNING id::text
                """
            ),
            {"a": a, "b": b, "ra": run_a, "rb": run_b, "d": today},
        ).fetchone()
        if not made:
            continue
        created += 1
        # The counter and the cooldown live on the same row, so they can never
        # disagree about how many times these two have met.
        db.execute(
            text(
                """
                INSERT INTO paserby_pairs
                    (lower_user_id, higher_user_id, encounter_count, last_encounter_at)
                VALUES (:a, :b, 1, now())
                ON CONFLICT (lower_user_id, higher_user_id) DO UPDATE
                SET encounter_count = paserby_pairs.encounter_count + 1,
                    last_encounter_at = now()
                """
            ),
            {"a": a, "b": b},
        )

    sweep_traces(db)
    db.commit()
    return created


def process_run_task(run_id) -> None:
    """Background entry point: own session, never raises into the request.

    The OTHER side is the one told. The runner who just finished is looking at
    their result screen and gets the reveal there; the person who was already
    home has no idea any of this happened, and they are the one for whom a
    badge is worth lighting up. Exactly one encounter per person comes out of a
    single run (see `first_run_of`), so the wording is the singular case —
    a count and nothing else, no name, no place, no time.
    """
    db = SessionLocal()
    try:
        if not process_run(db, run_id):
            return
        others = db.execute(
            text(
                """
                SELECT CASE WHEN e.run_a_id = CAST(:r AS uuid) THEN e.user_b_id::text
                            ELSE e.user_a_id::text END
                FROM paserby_encounters e
                WHERE e.run_a_id = CAST(:r AS uuid) OR e.run_b_id = CAST(:r AS uuid)
                """
            ),
            {"r": str(run_id)},
        ).fetchall()
    except Exception:
        return
    finally:
        db.close()

    for uid in {row[0] for row in others}:
        notify([uid], "paserby", "Crossed paths", crossed_paths_line(1))


def ensure_processed(db, run_id) -> int:
    """Match this run now if the background task has not already.

    The reveal is the one place where "it will happen shortly" is not good
    enough — the runner is looking at the screen. `paserby_at` makes asking
    twice free.
    """
    stamped = db.execute(
        text("SELECT paserby_at FROM runs WHERE id = :r"), {"r": str(run_id)}
    ).fetchone()
    if stamped and stamped[0] is not None:
        return 0
    return process_run(db, run_id)


# ---------------------------------------------------------------------------
# Reading encounters
# ---------------------------------------------------------------------------

# Everything is phrased from the VIEWER's side, and the viewer's side is
# decided by the ordered pair rather than by anything the client sends.
_MINE = "CASE WHEN e.user_a_id = CAST(:me AS uuid) THEN {a} ELSE {b} END"

_ENCOUNTER_SELECT = f"""
SELECT e.id::text,
       ({_MINE.format(a='e.user_b_id', b='e.user_a_id')})::text AS other_id,
       e.encounter_date,
       ({_MINE.format(a='e.user_a_seen_at', b='e.user_b_seen_at')}) IS NOT NULL AS seen,
       ({_MINE.format(a='e.user_a_high_five_at', b='e.user_b_high_five_at')}) IS NOT NULL AS i_high_fived,
       ({_MINE.format(a='e.user_b_high_five_at', b='e.user_a_high_five_at')}) IS NOT NULL AS they_high_fived,
       COALESCE(p.encounter_count, 1) AS times,
       u.username, u.avatar, u.xp,
       COALESCE(u.rank_points, 0), u.rank_points_at,
       c.tag, c.name, c.color_key
FROM paserby_encounters e
JOIN users u
  ON u.id = ({_MINE.format(a='e.user_b_id', b='e.user_a_id')})
LEFT JOIN paserby_pairs p
  ON p.lower_user_id = e.user_a_id AND p.higher_user_id = e.user_b_id
LEFT JOIN clan_members cm ON cm.user_id = u.id
LEFT JOIN clans c ON c.id = cm.clan_id
WHERE (e.user_a_id = CAST(:me AS uuid) OR e.user_b_id = CAST(:me AS uuid))
  AND e.status = 'active'
  AND ({_MINE.format(a='e.user_a_hidden_at', b='e.user_b_hidden_at')}) IS NULL
  AND NOT EXISTS (
        SELECT 1 FROM user_blocks b
        WHERE (b.blocker_id = CAST(:me AS uuid) AND b.blocked_id = u.id)
           OR (b.blocker_id = u.id AND b.blocked_id = CAST(:me AS uuid))
      )
"""


def _card(row, today):
    """One row of `_ENCOUNTER_SELECT` as the client sees it.

    Note what is NOT here: no coordinate, no crossing time, no created_at, no
    run id. `when` is a phrase, and it is the only temporal field.
    """
    from . import ranks  # local: ranks imports config, this module is imported early
    from .clans_meta import color_triple

    times = int(row[6] or 1)
    key, label = familiarity_for(times)
    return {
        "id": row[0],
        "user_id": row[1],
        "username": row[7],
        "avatar": row[8],
        "level": _level(row[9]),
        "rank_key": ranks.key_for(row[10], row[11]),
        "clan_tag": row[12],
        "clan_name": row[13],
        "clan_color": color_triple(row[14]) if row[14] else None,
        "when": when_label(row[2], today),
        "times_crossed": times,
        "familiarity": key,
        "familiarity_label": label,
        "seen": bool(row[3]),
        "high_fived": bool(row[4]),
        "high_five_received": bool(row[5]),
    }


def encounters_for(db, user_id, limit: int = 50, offset: int = 0, run_id=None,
                   unseen_only: bool = False):
    """The viewer's encounters, newest first.

    Paged by offset rather than by a timestamp cursor on purpose: a cursor
    would have to be a real `created_at`, and handing the client the exact
    moment two people crossed is the one thing this feature must not do.
    """
    clauses = ""
    params = {"me": str(user_id), "lim": max(1, min(int(limit), 50)), "off": max(0, int(offset))}
    if run_id is not None:
        clauses += " AND (e.run_a_id = CAST(:run AS uuid) OR e.run_b_id = CAST(:run AS uuid))"
        params["run"] = str(run_id)
    if unseen_only:
        clauses += (
            " AND (CASE WHEN e.user_a_id = CAST(:me AS uuid) THEN e.user_a_seen_at"
            " ELSE e.user_b_seen_at END) IS NULL"
        )
    rows = db.execute(
        text(f"{_ENCOUNTER_SELECT}{clauses} ORDER BY e.created_at DESC LIMIT :lim OFFSET :off"),
        params,
    ).fetchall()
    today = local_today()
    return [_card(r, today) for r in rows]


def summary_for(db, user_id) -> dict:
    """What the Home badge needs: the switch, and how many are waiting."""
    row = db.execute(
        text(
            """
            SELECT COUNT(*) FILTER (
                       WHERE (CASE WHEN e.user_a_id = CAST(:me AS uuid)
                                   THEN e.user_a_seen_at ELSE e.user_b_seen_at END) IS NULL
                   ),
                   COUNT(*)
            FROM paserby_encounters e
            WHERE (e.user_a_id = CAST(:me AS uuid) OR e.user_b_id = CAST(:me AS uuid))
              AND e.status = 'active'
              AND (CASE WHEN e.user_a_id = CAST(:me AS uuid)
                        THEN e.user_a_hidden_at ELSE e.user_b_hidden_at END) IS NULL
            """
        ),
        {"me": str(user_id)},
    ).fetchone()
    return {
        "enabled": enabled_for(db, user_id),
        "unseen": int(row[0] or 0) if row else 0,
        "total": int(row[1] or 0) if row else 0,
    }


# ---------------------------------------------------------------------------
# Acting on an encounter
# ---------------------------------------------------------------------------
#
# Every mutation below finds the encounter BY the authenticated user's own id.
# A caller who is not one of the two people in it gets "not found" — there is
# no path where a user id off the wire decides whose row is touched.


def _side(db, user_id, encounter_id):
    """('a'|'b', other_user_id) for an encounter this user belongs to."""
    row = db.execute(
        text(
            "SELECT user_a_id::text, user_b_id::text FROM paserby_encounters "
            "WHERE id = CAST(:e AS uuid) AND status = 'active' "
            "AND (user_a_id = CAST(:me AS uuid) OR user_b_id = CAST(:me AS uuid))"
        ),
        {"e": str(encounter_id), "me": str(user_id)},
    ).fetchone()
    if not row:
        return None, None
    return ("a", row[1]) if row[0] == str(user_id) else ("b", row[0])


def mark_seen(db, user_id, ids=None) -> int:
    """Mark encounters as seen — all of them, or the listed ones."""
    where = (
        " AND id = ANY(CAST(:ids AS uuid[]))" if ids else ""
    )
    params = {"me": str(user_id)}
    if ids:
        params["ids"] = [str(i) for i in ids]
    n = db.execute(
        text(
            f"""
            UPDATE paserby_encounters
            SET user_a_seen_at = CASE WHEN user_a_id = CAST(:me AS uuid)
                                      THEN COALESCE(user_a_seen_at, now()) ELSE user_a_seen_at END,
                user_b_seen_at = CASE WHEN user_b_id = CAST(:me AS uuid)
                                      THEN COALESCE(user_b_seen_at, now()) ELSE user_b_seen_at END
            WHERE (user_a_id = CAST(:me AS uuid) OR user_b_id = CAST(:me AS uuid)){where}
            """
        ),
        params,
    ).rowcount
    db.commit()
    return int(n or 0)


def high_five(db, user_id, encounter_id, username: str | None = None):
    """Send a high five. Once per encounter, ever.

    The XP is a token: `paserby_high_five_xp`, under a daily social ceiling,
    reserved against the encounter in the same grant ledger every other payout
    uses — so a double-tap, a retry or two racing requests pay once. Being over
    the daily cap does NOT block the high five; it just pays nothing.
    """
    side, other_id = _side(db, user_id, encounter_id)
    if side is None:
        return None
    col = "user_a_high_five_at" if side == "a" else "user_b_high_five_at"
    sent = db.execute(
        text(
            f"UPDATE paserby_encounters SET {col} = now() "
            f"WHERE id = CAST(:e AS uuid) AND {col} IS NULL RETURNING id"
        ),
        {"e": str(encounter_id)},
    ).fetchone()
    if not sent:
        db.commit()
        return {"already": True, "high_fived": True, "xp_gained": 0, "user_id": other_id}

    allowance = max(
        0,
        settings.paserby_daily_social_xp_cap
        - economy.granted_today(db, user_id, economy.KIND_SOCIAL_XP),
    )
    xp = min(settings.paserby_high_five_xp, allowance)
    if xp > 0 and economy.grant_once(
        db, user_id, f"paserby:{encounter_id}:high_five", economy.KIND_SOCIAL_XP, xp
    ):
        db.execute(
            text("UPDATE users SET xp = COALESCE(xp, 0) + :g WHERE id = CAST(:u AS uuid)"),
            {"g": xp, "u": str(user_id)},
        )
    else:
        xp = 0
    db.commit()
    return {
        "already": False,
        "high_fived": True,
        "xp_gained": xp,
        "capped": xp == 0,
        "user_id": other_id,
        "username": username,
    }


def hide(db, user_id, encounter_id) -> bool:
    """Take one encounter off the viewer's own Crossroads. The other side keeps
    theirs — hiding is not a mutual act."""
    side, _other = _side(db, user_id, encounter_id)
    if side is None:
        return False
    col = "user_a_hidden_at" if side == "a" else "user_b_hidden_at"
    db.execute(
        text(f"UPDATE paserby_encounters SET {col} = now() WHERE id = CAST(:e AS uuid)"),
        {"e": str(encounter_id)},
    )
    db.commit()
    return True


def block(db, user_id, other_id) -> bool:
    """Block a runner, from either side of an encounter.

    A block is stronger than a hide: the pair's shared history goes, the
    familiar-faces counter goes with it, and the matcher will never pair them
    again (see `_CANDIDATES_SQL`). Deleting rather than tombstoning matches how
    the rest of the app handles a severed link.
    """
    if str(other_id) == str(user_id):
        return False
    db.execute(
        text(
            "INSERT INTO user_blocks (blocker_id, blocked_id) "
            "VALUES (CAST(:me AS uuid), CAST(:them AS uuid)) ON CONFLICT DO NOTHING"
        ),
        {"me": str(user_id), "them": str(other_id)},
    )
    a, b = sorted([str(user_id), str(other_id)])
    db.execute(
        text(
            "DELETE FROM paserby_encounters WHERE user_a_id = CAST(:a AS uuid) "
            "AND user_b_id = CAST(:b AS uuid)"
        ),
        {"a": a, "b": b},
    )
    db.execute(
        text(
            "DELETE FROM paserby_pairs WHERE lower_user_id = CAST(:a AS uuid) "
            "AND higher_user_id = CAST(:b AS uuid)"
        ),
        {"a": a, "b": b},
    )
    db.commit()
    return True


def unblock(db, user_id, other_id) -> bool:
    n = db.execute(
        text(
            "DELETE FROM user_blocks WHERE blocker_id = CAST(:me AS uuid) "
            "AND blocked_id = CAST(:them AS uuid)"
        ),
        {"me": str(user_id), "them": str(other_id)},
    ).rowcount
    db.commit()
    return bool(n)


def report(db, user_id, other_id, reason: str, detail=None, encounter_id=None) -> str:
    """File a report for moderation. Stored, never acted on automatically."""
    row = db.execute(
        text(
            """
            INSERT INTO user_reports
                (reporter_id, reported_id, surface, reason, detail, encounter_id)
            VALUES (CAST(:me AS uuid), CAST(:them AS uuid), 'paserby', :reason, :detail,
                    CAST(:enc AS uuid))
            RETURNING id::text
            """
        ),
        {
            "me": str(user_id),
            "them": str(other_id),
            "reason": reason,
            "detail": detail,
            "enc": str(encounter_id) if encounter_id else None,
        },
    ).fetchone()
    db.commit()
    return row[0]
