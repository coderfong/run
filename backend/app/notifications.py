"""Push notifications via Expo's push service. Sent on a background task so
the request never blocks on the HTTP call. Each category is gated by the
recipient's notif_prefs. Best-effort — failures are swallowed.

Categories: stolen | clan_goal | kudos | season | recap.
"""

import json
import urllib.request

from sqlalchemy import text

from .database import SessionLocal

EXPO_URL = "https://exp.host/--/api/v2/push/send"


def _expo_send(messages):
    if not messages:
        return
    try:
        req = urllib.request.Request(
            EXPO_URL,
            data=json.dumps(messages).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        urllib.request.urlopen(req, timeout=5).read()
    except Exception:
        pass  # best-effort


def notify(user_ids, category, title, body, data=None, actor_id=None):
    """Open an own session (runs post-response), respect prefs, write the
    in-app inbox row, then push.

    `actor_id` is the user who CAUSED this — the runner who took your land,
    gave you kudos, sent the request. The inbox shows their portrait, so pass
    it wherever there is a person behind the event; leave it off for system
    notices (season, recap) that nobody sent."""
    if not user_ids:
        return
    db = SessionLocal()
    try:
        allowed = []
        for uid in set(user_ids):
            pref = db.execute(
                text(f"SELECT COALESCE((SELECT {category} FROM notif_prefs WHERE user_id = :u), true)"),
                {"u": uid},
            ).scalar()
            if pref:
                allowed.append(uid)
        if not allowed:
            return
        # Inbox rows (the bell) — written for every allowed recipient even if
        # they have no push token registered.
        for uid in allowed:
            db.execute(
                text(
                    "INSERT INTO notifications (user_id, category, title, body, actor_id) "
                    "VALUES (:u, :c, :t, :b, CAST(:a AS uuid))"
                ),
                {"u": uid, "c": category, "t": title, "b": body,
                 # never point a row at its own recipient — "you did this to
                 # yourself" would just be your own face staring back
                 "a": str(actor_id) if actor_id and str(actor_id) != str(uid) else None},
            )
        db.commit()
        # user_id is uuid; the bound list arrives as text[] — cast the column.
        rows = db.execute(
            text("SELECT token FROM device_tokens WHERE user_id::text = ANY(:ids)"),
            {"ids": allowed},
        ).fetchall()
        messages = [
            {"to": r[0], "title": title, "body": body, "data": data or {}, "sound": "default"}
            for r in rows
            if r[0]
        ]
        _expo_send(messages)
    finally:
        db.close()
