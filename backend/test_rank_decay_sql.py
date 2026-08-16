"""`ranks.DECAY_SQL` must agree with `ranks.effective_points`, always.

    .venv/Scripts/python.exe test_rank_decay_sql.py

There are two copies of the rank decay formula, for a reason given at
DECAY_SQL: Python cannot rank one runner against the whole table, and SQL is
where that has to happen. Two copies of a rule is a liability, and this is the
thing that makes it survivable — it drives both over the same inputs and fails
on any disagreement.

If this fails, DO NOT relax it. The visible symptom of the two drifting is a
runner being told they are 40th on a board that lists them 38th, which reads
as the leaderboard being broken, and there is no version of that worth having.
"""
import os, sys
from datetime import datetime, timedelta

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from sqlalchemy import text

from app import ranks
from app.database import SessionLocal

db = SessionLocal()
fails = []

# Points paired with how long ago they were last earned. The interesting ones
# are the boundaries: the grace edge, and each week rolling over.
CASES = [
    (0, 0), (0, 100), (-5, 30),
    (1000, 0), (1000, 1), (1000, 6.9),
    (1000, 7), (1000, 7.001),          # the grace edge
    (1000, 8), (1000, 13.9), (1000, 14), (1000, 14.1),
    (1000, 21), (1000, 60), (1000, 365),
    (1, 400), (7, 90), (30000, 200), (12345, 45.5),
]


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


print("\n== python and SQL agree on every case ==")
for points, days_idle in CASES:
    # Both sides must judge against the SAME instant, or a case sitting exactly
    # on a week boundary flips on clock skew rather than on the formula.
    # Postgres `now()` is the TRANSACTION timestamp, so it freezes while this
    # loop runs and falls behind `datetime.utcnow()` — hence the rollback for a
    # fresh snapshot, and hence reading the reference time back out of the same
    # query that uses it.
    db.rollback()
    row = db.execute(
        text(
            # CAST(...) not `::`, because SQLAlchemy's text() parser reads
            # `:p::int` as a parameter named `p:` and leaves it unbound.
            f"""
            SELECT u.rank_points_at, timezone('utc', now()), {ranks.DECAY_SQL}
            FROM (SELECT CAST(:p AS int) AS rank_points,
                         timezone('utc', now()) - CAST(:idle AS interval)
                             AS rank_points_at) u
            """
        ),
        {"p": points, "idle": f"{days_idle} days"},
    ).fetchone()
    at, ref, sql = row[0], row[1], int(row[2] or 0)
    py = ranks.effective_points(points, at, now=ref)
    check(f"{points} points, idle {days_idle}d", py == sql, f"python {py} vs sql {sql}")

print("\n== a null timestamp decays nothing, on both sides ==")
py = ranks.effective_points(500, None)
sql = int(
    db.execute(
        text(
            f"SELECT {ranks.DECAY_SQL} FROM (SELECT CAST(500 AS int) AS rank_points, "
            f"CAST(NULL AS timestamp) AS rank_points_at) u"
        )
    ).scalar()
    or 0
)
check("never-earned points are untouched", py == sql == 500, f"python {py} vs sql {sql}")

db.close()
print("\n" + "=" * 46)
print(f"{'ALL PASSED' if not fails else str(len(fails)) + ' FAILED: ' + ', '.join(fails)}")
sys.exit(1 if fails else 0)
