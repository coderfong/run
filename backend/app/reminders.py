"""Scheduled, actionable game reminders.

This module only decides who is due and builds the event payload. The API
route queues ``notify`` as a background task; the Render cron calls it
synchronously. Keeping the selection here gives both entry points identical
deduplication and copy.
"""

from datetime import date, timedelta

from sqlalchemy import text


LOCAL_TIME_ZONE = "Asia/Singapore"


def _consecutive_streak(run_dates, today: date) -> int:
    """Consecutive run days ending yesterday; reminders only run before the
    current local day ends, so today's missing run is the point of the nudge."""
    have = set(run_dates or [])
    cursor = today - timedelta(days=1)
    streak = 0
    while cursor in have:
        streak += 1
        cursor -= timedelta(days=1)
    return streak


def scheduled_reminders(db) -> list[dict]:
    """Return reminders due now, already deduplicated for the local day."""
    today = db.execute(
        text("SELECT (now() AT TIME ZONE :tz)::date"), {"tz": LOCAL_TIME_ZONE}
    ).scalar()

    run_rows = db.execute(
        text(
            """
            SELECT u.id::text,
                   ARRAY_AGG(
                       DISTINCT (r.ended_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date
                       ORDER BY (r.ended_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date DESC
                   )
            FROM users u
            JOIN runs r ON r.user_id = u.id
            WHERE NOT COALESCE(u.is_bot, false)
              AND r.ended_at >= now() - interval '60 days'
              AND NOT EXISTS (
                  SELECT 1 FROM notifications n
                  WHERE n.user_id = u.id
                    AND n.category = 'reminder'
                    AND n.data ->> 'kind' = 'streak_at_risk'
                    AND (n.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date = :today
              )
            GROUP BY u.id
            HAVING MAX(
                (r.ended_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date
            ) = :yesterday
            """
        ),
        {"tz": LOCAL_TIME_ZONE, "today": today, "yesterday": today - timedelta(days=1)},
    ).fetchall()

    reminders = []
    for uid, run_dates in run_rows:
        streak = _consecutive_streak(run_dates, today)
        if streak <= 0:
            continue
        lead = f"Your {streak}-day streak is at risk. " if streak >= 2 else "You ran yesterday. "
        reminders.append(
            {
                "user_id": uid,
                "title": "Keep your streak alive",
                "body": f"{lead}A short loop tonight keeps it going.",
                "data": {
                    "kind": "streak_at_risk",
                    "screen": "record",
                    "streak_days": streak,
                },
            }
        )

    # One grouped alert per owner. The centroid is only a map focus; the map
    # fetches current polygons when opened, so the payload stays small and does
    # not carry stale geometry.
    territory_rows = db.execute(
        text(
            """
            SELECT t.user_id::text, COUNT(*), COALESCE(SUM(t.area_m2), 0),
                   ST_Y(ST_Centroid(ST_Collect(t.polygon))),
                   ST_X(ST_Centroid(ST_Collect(t.polygon)))
            FROM territories t
            JOIN users u ON u.id = t.user_id
            WHERE NOT COALESCE(u.is_bot, false)
              AND t.verified
              AND t.expires_at > now()
              AND t.expires_at <= now() + interval '36 hours'
              AND NOT EXISTS (
                  SELECT 1 FROM notifications n
                  WHERE n.user_id = t.user_id
                    AND n.category = 'reminder'
                    AND n.data ->> 'kind' = 'territory_expiring'
                    AND (n.created_at AT TIME ZONE 'UTC' AT TIME ZONE :tz)::date = :today
              )
            GROUP BY t.user_id
            """
        ),
        {"tz": LOCAL_TIME_ZONE, "today": today},
    ).fetchall()

    for uid, count, area_m2, lat, lon in territory_rows:
        plots = int(count or 0)
        noun = "plot" if plots == 1 else "plots"
        reminders.append(
            {
                "user_id": uid,
                "title": "Territory expires soon",
                "body": (
                    f"{plots} {noun} ({float(area_m2 or 0) / 1_000_000:.3f} km²) "
                    "will expire soon. Reinforce the area with a run."
                ),
                "data": {
                    "kind": "territory_expiring",
                    "screen": "map",
                    "plots": plots,
                    "area_m2": float(area_m2 or 0),
                    "lat": float(lat) if lat is not None else None,
                    "lon": float(lon) if lon is not None else None,
                },
            }
        )

    return reminders


def deliver_scheduled_reminders(db, enqueue) -> dict:
    """Send/queue all due events with the supplied notify-compatible call."""
    items = scheduled_reminders(db)
    counts = {"streak": 0, "territory": 0}
    for item in items:
        enqueue(
            [item["user_id"]],
            "reminder",
            item["title"],
            item["body"],
            item["data"],
        )
        key = "territory" if item["data"]["kind"] == "territory_expiring" else "streak"
        counts[key] += 1
    counts["total"] = len(items)
    return counts
