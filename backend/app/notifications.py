"""Push notifications via Expo's push service. Sent on a background task so
the request never blocks on the HTTP call. Each category is gated by the
recipient's notif_prefs. Delivery is best-effort — a failed push never fails
the request that triggered it — but failures are now logged and a token
Expo reports as dead is pruned, instead of being silently retried forever.

Categories: stolen | captured | clan_goal | kudos | season | recap | pasers |
paserby.
"""

import json
import logging
import urllib.error
import urllib.request

from sqlalchemy import text

from .database import SessionLocal

log = logging.getLogger("app.notifications")

EXPO_URL = "https://exp.host/--/api/v2/push/send"

# The only columns notif_prefs actually has. `category` is spliced straight
# into the SQL below (Postgres has no clean way to parameterise a column
# name) — every call site today passes a hardcoded literal, but this
# whitelist is what keeps that true instead of just assumed.
CATEGORIES = {
    "stolen", "captured", "clan_goal", "kudos", "season", "recap", "pasers", "paserby",
}


def _expo_send(messages):
    """POST to Expo, log what actually happened, and report which tokens Expo
    says are dead so the caller can stop sending to them.

    Expo replies 200 with a per-message ticket array even when individual
    sends failed — a `DeviceNotRegistered` ticket looks identical to a 200 at
    the transport level, which is exactly what used to hide it."""
    if not messages:
        return []
    try:
        req = urllib.request.Request(
            EXPO_URL,
            data=json.dumps(messages).encode(),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        raw = urllib.request.urlopen(req, timeout=5).read()
    except urllib.error.HTTPError as e:
        log.warning("expo push HTTP %s: %s", e.code, e.read()[:500])
        return []
    except Exception:
        log.warning("expo push request failed", exc_info=True)
        return []

    try:
        tickets = json.loads(raw).get("data") or []
    except Exception:
        log.warning("expo push: unparseable response %r", raw[:500])
        return []

    dead = []
    for message, ticket in zip(messages, tickets):
        if ticket.get("status") != "ok":
            error = (ticket.get("details") or {}).get("error")
            log.warning("expo push ticket error: %s (%s)", ticket.get("message"), error)
            if error == "DeviceNotRegistered":
                dead.append(message["to"])
    return dead


def notify(user_ids, category, title, body, data=None, actor_id=None):
    """Open an own session (runs post-response), respect prefs, write the
    in-app inbox row, then push.

    `actor_id` is the user who CAUSED this — the runner who took your land,
    gave you kudos, sent the request. The inbox shows their portrait, so pass
    it wherever there is a person behind the event; leave it off for system
    notices (season, recap) that nobody sent."""
    if not user_ids:
        return
    if category not in CATEGORIES:
        log.warning("notify: unknown category %r, dropping", category)
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
        # Category always rides inside the structured payload too. Expo push
        # listeners receive only `data`, while the inbox has a first-class
        # category column; keeping both views identical lets the foreground
        # client recognise the same capture whichever path arrives first.
        # Round-trip through JSON once so UUIDs passed by older call sites are
        # converted to strings for both Postgres JSONB and Expo's encoder.
        event_json = json.dumps({"category": category, **(data or {})}, default=str)
        event_data = json.loads(event_json)
        # Inbox rows (the bell) — written for every allowed recipient even if
        # they have no push token registered.
        for uid in allowed:
            db.execute(
                text(
                    "INSERT INTO notifications (user_id, category, title, body, actor_id, data) "
                    "VALUES (:u, :c, :t, :b, CAST(:a AS uuid), CAST(:d AS jsonb))"
                ),
                {"u": uid, "c": category, "t": title, "b": body,
                 # never point a row at its own recipient — "you did this to
                 # yourself" would just be your own face staring back
                 "a": str(actor_id) if actor_id and str(actor_id) != str(uid) else None,
                 "d": event_json},
            )
        db.commit()
        # user_id is uuid; the bound list arrives as text[] — cast the column.
        rows = db.execute(
            text("SELECT token FROM device_tokens WHERE user_id::text = ANY(:ids)"),
            {"ids": allowed},
        ).fetchall()
        messages = [
            {"to": r[0], "title": title, "body": body, "data": event_data, "sound": "default"}
            for r in rows
            if r[0]
        ]
        dead = _expo_send(messages)
        if dead:
            db.execute(text("DELETE FROM device_tokens WHERE token = ANY(:t)"), {"t": dead})
            db.commit()
    finally:
        db.close()
