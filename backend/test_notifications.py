import json
import uuid
import unittest
from unittest.mock import patch

from app import notifications


class _Result:
    def __init__(self, *, scalar=None, rows=None):
        self._scalar = scalar
        self._rows = rows or []

    def scalar(self):
        return self._scalar

    def fetchall(self):
        return self._rows


class _Session:
    def __init__(self, *, pref=True):
        self.inserts = []
        self.deletes = []
        self.committed = False
        self.closed = False
        self.pref = pref

    def execute(self, statement, params=None):
        sql = str(statement)
        if "notif_prefs" in sql:
            return _Result(scalar=self.pref)
        if "INSERT INTO notifications" in sql:
            self.inserts.append(params)
            return _Result()
        if "FROM device_tokens" in sql and "DELETE" not in sql:
            # token, user_id::text, unread count — see notifications.notify.
            return _Result(rows=[("ExponentPushToken[test]", "user-id", 3)])
        if "DELETE FROM device_tokens" in sql:
            self.deletes.append(params)
            return _Result()
        raise AssertionError(sql)

    def commit(self):
        self.committed = True

    def close(self):
        self.closed = True


class NotificationTest(unittest.TestCase):
    def test_context_is_shared_by_inbox_and_push(self):
        session = _Session()
        sent = []
        actor_id = uuid.uuid4()
        with (
            patch.object(notifications, "SessionLocal", lambda: session),
            patch.object(notifications, "_expo_send", lambda messages: sent.extend(messages)),
        ):
            notifications.notify(
                [str(uuid.uuid4())],
                "stolen",
                "Your land was captured",
                "A rival took 120 m².",
                {"capture_id": "run:victim", "attacker_id": actor_id, "taken_m2": 120.5},
                actor_id,
            )

        stored = json.loads(session.inserts[0]["d"])
        self.assertEqual(stored, sent[0]["data"])
        self.assertEqual(stored["category"], "stolen")
        self.assertEqual(stored["attacker_id"], str(actor_id))
        self.assertEqual(sent[0]["badge"], 3)
        self.assertEqual(sent[0]["channelId"], "territory-alerts")
        self.assertTrue(session.committed and session.closed)

    def test_muted_category_stays_in_inbox_without_push(self):
        session = _Session(pref=False)
        sent = []
        with (
            patch.object(notifications, "SessionLocal", lambda: session),
            patch.object(notifications, "_expo_send", lambda messages: sent.extend(messages)),
        ):
            notifications.notify([str(uuid.uuid4())], "reminder", "Time to run", "Keep your streak alive.")

        self.assertEqual(len(session.inserts), 1)
        self.assertEqual(sent, [])
        self.assertTrue(session.committed and session.closed)

    def test_unknown_category_is_dropped_before_touching_the_db(self):
        with patch.object(notifications, "SessionLocal") as session_local:
            notifications.notify([str(uuid.uuid4())], "not_a_real_category", "t", "b")
        session_local.assert_not_called()

    def test_dead_token_reported_by_expo_is_pruned(self):
        session = _Session()
        with (
            patch.object(notifications, "SessionLocal", lambda: session),
            patch.object(notifications, "_expo_send", lambda messages: ["ExponentPushToken[test]"]),
        ):
            notifications.notify([str(uuid.uuid4())], "stolen", "t", "b")

        self.assertEqual(session.deletes[0]["t"], ["ExponentPushToken[test]"])


class ExpoSendTest(unittest.TestCase):
    """_expo_send talks to Expo's push service directly — a ticket-level
    error looks identical to a 200 at the transport layer, which is exactly
    what used to hide a dead token forever."""

    def test_device_not_registered_ticket_is_reported_as_dead(self):
        body = json.dumps({
            "data": [
                {"status": "ok", "id": "abc"},
                {"status": "error", "message": "not registered",
                 "details": {"error": "DeviceNotRegistered"}},
            ]
        }).encode()

        class _Response:
            def read(self):
                return body

        messages = [
            {"to": "ExponentPushToken[live]", "title": "t", "body": "b"},
            {"to": "ExponentPushToken[dead]", "title": "t", "body": "b"},
        ]
        with patch.object(notifications.urllib.request, "urlopen", return_value=_Response()):
            dead = notifications._expo_send(messages)

        self.assertEqual(dead, ["ExponentPushToken[dead]"])

    def test_transport_failure_reports_no_dead_tokens(self):
        with patch.object(notifications.urllib.request, "urlopen", side_effect=OSError("boom")):
            dead = notifications._expo_send([{"to": "x", "title": "t", "body": "b"}])

        self.assertEqual(dead, [])


if __name__ == "__main__":
    unittest.main()
