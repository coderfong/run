"""Planning the attack later: a finished run's land waits, for a while.

    .venv/Scripts/python.exe test_claim_later.py

The result screen lets a runner leave without placing their land. What makes
that "later" rather than "never" is the pair of endpoints Home and the run page
use to find the way back, and the window every claim endpoint applies:

  * /me/pending-claims lists exactly the runs whose land is still placeable:
    finished, unclaimed, earned ground, and inside `claim_defer_hours`;
  * /runs/{id}/claim-resume hands the claim screen the replayed result and the
    stored route, and refuses with a reason once there is nothing to place;
  * past the window claim-options, claim-preview and claim-territory all say
    410, and the refused claim costs no energy;
  * inside it the claim lands as usual, and the run leaves the list;
  * the run page flags its waiting land to its owner, and to nobody else;
  * a window of 0 means no limit at all.

Runs against the local dev Postgres, like the other route tests here. Runs are
inserted directly, with naive UTC timestamps computed in Python: `now()` in SQL
would pass through the session time zone on its way into these naive columns.
"""
import math
import os
import sys
import uuid
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app import economy
from app.config import settings
from app.database import SessionLocal
from app.main import app

c = TestClient(app)
db = SessionLocal()
tag = uuid.uuid4().hex[:6]
fails = []

# Open ocean, and unique per run, so nothing seeded, real, or planted by
# another route test shares the board.
LAT = -48.5 + (int(tag, 16) % 200) * 0.01
LON = -120.0 + (int(tag[:4], 16) % 200) * 0.01
AREA = 126000.0  # what 1.68 km earns at 75 m2 per metre


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


def purge(user_ids):
    """Delete the test users and every row that points at them.

    DELETE /me cannot be the cleanup: it fails for any user who owns runs. A
    hand list of tables goes stale as tables are added, so the foreign keys
    onto users, runs and territories are read from the catalogue, and each is
    cleared in its own savepoint, a few passes over, so the order children
    have to go in never needs writing down. The history tables name users
    without a foreign key, and are listed by hand.
    """
    user_ids = list(user_ids)
    if not user_ids:
        return
    db.rollback()
    ids = {
        "users": user_ids,
        "runs": [r[0] for r in db.execute(
            text("SELECT id::text FROM runs WHERE user_id::text = ANY(:u)"), {"u": user_ids})],
        "territories": [r[0] for r in db.execute(
            text("SELECT id::text FROM territories WHERE user_id::text = ANY(:u)"), {"u": user_ids})],
    }
    refs = db.execute(
        text(
            """
            SELECT DISTINCT kcu.table_name, kcu.column_name, ccu.table_name
            FROM information_schema.table_constraints tc
            JOIN information_schema.key_column_usage kcu
              ON kcu.constraint_name = tc.constraint_name
             AND kcu.table_schema = tc.table_schema
            JOIN information_schema.constraint_column_usage ccu
              ON ccu.constraint_name = tc.constraint_name
             AND ccu.table_schema = tc.table_schema
            WHERE tc.constraint_type = 'FOREIGN KEY'
              AND tc.table_schema = 'public'
              AND ccu.table_name IN ('users', 'runs', 'territories')
              AND ccu.column_name = 'id'
            """
        )
    ).fetchall()
    targets = [tuple(r) for r in refs] + [
        ("territory_events", "actor_id", "users"),
        ("territory_events", "victim_id", "users"),
        ("territory_steals", "attacker_id", "users"),
        ("territory_steals", "victim_id", "users"),
    ]
    for _ in range(4):
        for table, column, ref in targets:
            if table == "users" or not ids[ref]:
                continue
            try:
                with db.begin_nested():
                    db.execute(
                        text(f'DELETE FROM "{table}" WHERE "{column}"::text = ANY(:i)'),
                        {"i": ids[ref]},
                    )
            except Exception:
                pass  # still held by a child row; a later pass clears it
    try:
        db.execute(text("DELETE FROM users WHERE id::text = ANY(:u)"), {"u": user_ids})
        db.commit()
    except Exception as error:
        db.rollback()
        print(f"  WARN  could not remove test users: {str(error).splitlines()[0]}")


def mk(name):
    r = c.post("/auth/signup", json={"username": f"{name}{tag}", "password": "hunter2hunter2"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]["id"]


def lap_wkt(lat, lon, side_m=420.0, per_side=24):
    """A square lap 1.68 km round, densified like a real GPS trace."""
    dlat = side_m / 111320.0
    dlon = side_m / (111320.0 * math.cos(math.radians(lat)))
    corners = [(lon, lat), (lon + dlon, lat), (lon + dlon, lat + dlat), (lon, lat + dlat), (lon, lat)]
    pts = []
    for (x0, y0), (x1, y1) in zip(corners, corners[1:]):
        for i in range(per_side):
            f = i / per_side
            pts.append((x0 + (x1 - x0) * f, y0 + (y1 - y0) * f))
    pts.append(corners[-1])
    return "LINESTRING(" + ", ".join(f"{x:.7f} {y:.7f}" for x, y in pts) + ")"


def add_run(uid, ended_hours_ago, *, area=AREA, tier=economy.CLAIMABLE, claimed=False, spot=0):
    ended = datetime.utcnow() - timedelta(hours=ended_hours_ago)
    rid = db.execute(
        text(
            """
            INSERT INTO runs (user_id, started_at, ended_at, path, distance_m, duration_s,
                              verified, tier, claim_distance_m, claim_area_m2, claimed_at,
                              reward_xp, reward_coins, reward_energy)
            VALUES (:u, :started, :ended, ST_GeomFromText(:wkt, 4326), 1680, 720,
                    true, :tier, 1680, :area, :claimed, 84, 23, 4)
            RETURNING id::text
            """
        ),
        {
            "u": uid,
            "started": ended - timedelta(minutes=12),
            "ended": ended,
            "wkt": lap_wkt(LAT + spot * 0.02, LON),
            "tier": tier,
            "area": area,
            "claimed": ended + timedelta(minutes=5) if claimed else None,
        },
    ).scalar()
    db.commit()
    return rid


def pending_ids(headers):
    r = c.get("/me/pending-claims", headers=headers)
    assert r.status_code == 200, r.text
    return [x["run_id"] for x in r.json()], r.json()


# A run of this script that died before its cleanup leaves its two users
# behind, and their names are unmistakable.
purge([r[0] for r in db.execute(text(
    "SELECT id::text FROM users WHERE username ~ '^clo?[0-9a-f]{6}$' "
    "AND created_at > now() - interval '7 days'"
))])

print("\n== setup ==")
me_h, me = mk("cl")
other_h, other = mk("clo")
print(f"  me={me[:8]} other={other[:8]}")

try:
    fresh = add_run(me, 1)                                           # an hour ago, waiting
    older = add_run(me, 5, spot=1)                                   # also waiting, earlier
    stale = add_run(me, settings.claim_defer_hours + 6, spot=2)      # past the window
    spent = add_run(me, 1, claimed=True, spot=3)                     # already placed
    empty = add_run(me, 1, area=0.0, tier=economy.REWARDED, spot=4)  # earned no ground
    theirs = add_run(other, 1, spot=5)

    print("\n== the window itself ==")
    now = datetime.utcnow()
    hours = settings.claim_defer_hours
    check("the window is on by default", hours > 0, str(hours))
    deadline = economy.claim_deadline(now)
    check("the deadline is the end of the run plus the window",
          deadline == now + timedelta(hours=hours))
    check("still open a second before it",
          economy.claim_window_open(now, now=deadline - timedelta(seconds=1)))
    check("closed at it", not economy.claim_window_open(now, now=deadline))
    check("an unfinished run has no deadline", economy.claim_deadline(None) is None)

    print("\n== /me/pending-claims ==")
    ids, rows = pending_ids(me_h)
    check("newest first, exactly the two still waiting", ids == [fresh, older], str(ids))
    check("a run past its window is not offered", stale not in ids)
    check("a placed run is not offered", spent not in ids)
    check("a run that earned no ground is not offered", empty not in ids)
    check("another runner's run is not offered", theirs not in ids)
    row = next((x for x in rows if x["run_id"] == fresh), {})
    check("a row says how much land, and until when",
          row.get("claim_area_m2") == AREA and bool(row.get("claim_expires_at")), str(row))
    ids, _ = pending_ids(other_h)
    check("the other runner sees only their own", ids == [theirs], str(ids))

    print("\n== /runs/{id}/claim-resume ==")
    r = c.get(f"/runs/{fresh}/claim-resume", headers=me_h)
    check("reopens a waiting run", r.status_code == 200, r.text[:200])
    body = r.json() if r.status_code == 200 else {}
    res = body.get("result", {})
    check("with the resting ring the claim screen opens on", len(res.get("claim_ring", [])) >= 3)
    check("at the area the run froze", res.get("claim_area_m2") == AREA)
    check("as a replay, so nothing is paid twice", res.get("replayed") is True)
    check("still claimable, with its deadline",
          res.get("claim_eligible") is True and bool(res.get("claim_expires_at")))
    check("and the stored route to draw", len(body.get("path", [])) > 50, str(len(body.get("path", []))))
    for label, rid, want in (
        ("a run past its window is refused as expired", stale, 410),
        ("a placed run is refused", spent, 409),
        ("a run with no land is refused", empty, 422),
        ("somebody else's run is not found", theirs, 404),
    ):
        got = c.get(f"/runs/{rid}/claim-resume", headers=me_h).status_code
        check(label, got == want, f"got {got}")

    print("\n== past the window, every claim endpoint says so ==")
    r = c.get(f"/runs/{stale}/claim-options", headers=me_h)
    check("claim-options: 410", r.status_code == 410, f"{r.status_code} {r.text[:120]}")
    r = c.post(f"/runs/{stale}/claim-preview",
               json={"run_id": stale, "t": 0.5, "rotation_deg": 0}, headers=me_h)
    check("claim-preview: 410", r.status_code == 410, f"{r.status_code} {r.text[:120]}")
    before = c.get("/me/energy", headers=me_h).json()["energy"]
    r = c.post("/claim-territory", json={"run_id": stale, "t": 0.5, "rotation_deg": 0}, headers=me_h)
    check("claim-territory: 410", r.status_code == 410, f"{r.status_code} {r.text[:120]}")
    check("with the reason", economy.REASON_CLAIM_EXPIRED in r.text, r.text[:120])
    after = c.get("/me/energy", headers=me_h).json()["energy"]
    # >= rather than ==: a regen tick may land between the two reads, a spend
    # would take at least eight.
    check("and no energy spent", after >= before, f"{before} -> {after}")
    db.expire_all()
    check("the run is still unplaced",
          db.execute(text("SELECT claimed_at FROM runs WHERE id = :r"), {"r": stale}).scalar() is None)

    print("\n== the run page flags its own waiting land ==")
    d = c.get(f"/runs/{fresh}", headers=me_h).json()
    check("to its owner, with the deadline",
          d.get("claim_pending") is True and bool(d.get("claim_expires_at")),
          str({k: d.get(k) for k in ("claim_pending", "claim_expires_at")}))
    check("not once the window has closed",
          c.get(f"/runs/{stale}", headers=me_h).json().get("claim_pending") is False)
    check("not a placed run", c.get(f"/runs/{spent}", headers=me_h).json().get("claim_pending") is False)
    check("not to anybody else",
          c.get(f"/runs/{fresh}", headers=other_h).json().get("claim_pending") is False)

    print("\n== inside the window the claim lands as usual ==")
    r = c.get(f"/runs/{fresh}/claim-options", headers=me_h)
    check("claim-options answers", r.status_code == 200, f"{r.status_code} {r.text[:160]}")
    r = c.post("/claim-territory", json={"run_id": fresh}, headers=me_h)
    check("the claim lands", r.status_code == 200, f"{r.status_code} {r.text[:200]}")
    ids, _ = pending_ids(me_h)
    check("and the run leaves the list", ids == [older], str(ids))
    check("and its page stops offering it",
          c.get(f"/runs/{fresh}", headers=me_h).json().get("claim_pending") is False)

    print("\n== a window of 0 means no limit ==")
    saved = settings.claim_defer_hours
    try:
        settings.claim_defer_hours = 0
        ids, rows = pending_ids(me_h)
        check("the old run is offered again", stale in ids, str(ids))
        check("with no deadline on anything", all(x["claim_expires_at"] is None for x in rows), str(rows))
        got = c.get(f"/runs/{stale}/claim-resume", headers=me_h).status_code
        check("and it reopens", got == 200, f"got {got}")
    finally:
        settings.claim_defer_hours = saved
finally:
    purge([me, other])
    db.close()

print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
