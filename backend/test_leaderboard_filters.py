"""Leaderboard filters, and the line they must not cross.

    .venv/Scripts/python.exe test_leaderboard_filters.py

PASER PRO sells the ability to ask the board a different QUESTION — a shorter
window, a smaller field. It must never sell the ANSWER to "where do I stand",
because a runner who cannot see their own position cannot tell whether they
are losing to better runners or to somebody's subscription. So the load
bearing cases here are the free ones: a runner far outside the top of the
board still gets their exact place, on the free board, without paying.

Also covers: the default board is byte-for-byte the one shipped clients
already ask for (no params), PRO windows and fields, ties sharing a place,
and `local` refusing to quietly answer a different question when given no
point to be local to.
"""
import os, sys, uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient
from sqlalchemy import text

from app.database import SessionLocal
from app.main import app

c = TestClient(app)
tag = uuid.uuid4().hex[:6]
fails = []
# Remote, so the `local` case cannot be joined by real or seeded players.
LAT, LON = -47.3 + (int(tag, 16) % 200) * 0.01, -70.2


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


def signup(name):
    r = c.post("/auth/signup", json={"username": name, "password": "hunter2hunter2"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}, r.json()["user"]["id"]


def give_land(uid, area_m2, lat=LAT, lon=LON):
    """A verified, unexpired territory of a chosen size."""
    db.execute(
        text(
            """
            INSERT INTO territories (id, user_id, polygon, area_m2, created_at, verified,
                                     strength, reinforcements, expires_at)
            VALUES (gen_random_uuid(), CAST(:u AS uuid),
                    ST_Multi(ST_Buffer(ST_SetSRID(ST_Point(:lon, :lat), 4326)::geography, 60)::geometry),
                    :a, now(), true, 1, 0, now() + interval '30 days')
            """
        ),
        {"u": uid, "a": area_m2, "lat": lat, "lon": lon},
    )


def board(headers, **params):
    q = "&".join(f"{k}={v}" for k, v in params.items())
    return c.get(f"/leaderboard/season?scope=solo&{q}", headers=headers)


def standing(headers, **params):
    q = "&".join(f"{k}={v}" for k, v in params.items())
    return c.get(f"/leaderboard/standing?{q}", headers=headers)


db = SessionLocal()
h_me, me = signup(f"lbMe{tag}")
h_pal, pal = signup(f"lbPal{tag}")
h_str, stranger = signup(f"lbStr{tag}")

# I am deliberately the SMALLEST holder of the three, and far enough down that
# a top-N board would not carry me. That is the case that matters.
give_land(me, 1_000)
give_land(pal, 900_000)
give_land(stranger, 800_000)

# A mutual paser link, so the friends filter has something true to say.
db.execute(
    text("INSERT INTO paser_links (id, requester_id, addressee_id, status, created_at) "
         "VALUES (gen_random_uuid(), CAST(:a AS uuid), CAST(:b AS uuid), 'accepted', now())"),
    {"a": me, "b": pal},
)
db.commit()

print("\n== the free board is unchanged ==")
r = c.get("/leaderboard/season?scope=solo&category=land", headers=h_me)
check("no params still works", r.status_code == 200, r.text[:120])
ids = [row["user_id"] for row in r.json()]
check("it lists soloists", pal in ids and stranger in ids, str(len(ids)))

print("\n== where do I stand: free, at any position ==")
s = standing(h_me, category="land")
check("a free runner gets their standing", s.status_code == 200, s.text[:120])
body = s.json()
check("with a real place, not a blank", body["rank"] is not None, str(body))
check("and the size of the field", body["field_size"] >= 3, str(body["field_size"]))
# Not "exactly last": this runs against a shared dev database whose contents
# change. What must hold is that holding a thousandth of what the others hold
# puts me below both of them.
check("the place is honest: I am below both bigger holders", body["rank"] > 2, str(body))
check("and my own number is returned", abs(body["value"] - 1000) < 1, str(body["value"]))

print("\n== PRO gates the QUESTION, never the answer ==")
check("a free runner cannot change the window",
      board(h_me, category="land", window="week").status_code == 402)
check("a free runner cannot narrow the field",
      board(h_me, category="land", **{"filter": "pasers"}).status_code == 402)
check("but their own standing on the free board is never gated",
      standing(h_me, category="land").status_code == 200)

print("\n== with PRO ==")
c.post("/me/pro/subscribe", json={"product_id": "paser_pro_monthly"}, headers=h_me)
check("windows open", board(h_me, category="distance", window="week").status_code == 200)
check("all time opens", board(h_me, category="distance", window="all").status_code == 200)

r = board(h_me, category="land", **{"filter": "pasers"})
check("the pasers board loads", r.status_code == 200, r.text[:120])
ids = [row["user_id"] for row in r.json()]
check("it has my paser on it", pal in ids, str(ids))
check("it has ME on it", me in ids, "a friends board you are missing from cannot say who is winning")
check("and not a stranger", stranger not in ids, str(ids))

print("\n== local needs somewhere to be local to ==")
check("local without a point is refused, not silently global",
      board(h_me, category="land", **{"filter": "local"}).status_code == 400)
r = board(h_me, category="land", **{"filter": "local", "lat": LAT, "lon": LON})
check("local with a point works", r.status_code == 200, r.text[:120])
ids = [row["user_id"] for row in r.json()]
check("everyone nearby is on it", me in ids and pal in ids, str(ids))

print("\n== the whole field, not a subset ==")
# A club member is invisible on the solo LIST by design (soloists compete with
# soloists), but "you are 4th of 40" has to be true of the game, not of a
# slice the runner never asked about.
club = db.execute(
    text("INSERT INTO clans (id, name, tag, color_fill, color_stroke, color_glow, created_at) "
         "VALUES (gen_random_uuid(), :n, :t, '#fff', '#fff', '#fff', now()) RETURNING id::text"),
    {"n": f"LBC{tag}", "t": f"L{tag[:3]}"},
).scalar()
db.execute(
    text("INSERT INTO clan_members (clan_id, user_id, joined_at) "
         "VALUES (CAST(:c AS uuid), CAST(:u AS uuid), now())"),
    {"c": club, "u": stranger},
)
db.commit()
solo_ids = [row["user_id"] for row in c.get("/leaderboard/season?scope=solo&category=land", headers=h_me).json()]
check("the club member drops off the solo list", stranger not in solo_ids, str(solo_ids))
after = standing(h_me, category="land").json()
check("but is still counted in my standing",
      after["field_size"] == body["field_size"], f"{body['field_size']} -> {after['field_size']}")

print("\n== ties share a place ==")
give_land(pal, 0)  # no-op sized row, keeps pal where they are
tie_a, ta = signup(f"lbTieA{tag}")
tie_b, tb = signup(f"lbTieB{tag}")
give_land(ta, 500_000)
give_land(tb, 500_000)
db.commit()
sa = standing(tie_a, category="land").json()
sb = standing(tie_b, category="land").json()
check("two runners level on the metric are level on the board",
      sa["rank"] == sb["rank"], f"{sa['rank']} vs {sb['rank']}")

print("\n== a runner who has not started ==")
h_new, newbie = signup(f"lbNew{tag}")
s = standing(h_new, category="land").json()
check("unranked rather than missing", s["rank"] is None, str(s))
check("and told how big the field is", s["field_size"] > 0, str(s["field_size"]))

# cleanup
ids = [me, pal, stranger, ta, tb, newbie]
db.execute(text("DELETE FROM paser_links WHERE requester_id::text = ANY(:i) OR addressee_id::text = ANY(:i)"), {"i": ids})
db.execute(text("DELETE FROM clan_members WHERE user_id::text = ANY(:i)"), {"i": ids})
db.execute(text("DELETE FROM clans WHERE id::text = :c"), {"c": club})
for t in ("territories", "pro_subscriptions", "runs", "notif_prefs", "notifications"):
    db.execute(text(f"DELETE FROM {t} WHERE user_id::text = ANY(:i)"), {"i": ids})
db.execute(text("DELETE FROM users WHERE id::text = ANY(:i)"), {"i": ids})
db.commit()
db.close()

print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
