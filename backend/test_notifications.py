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
    def __init__(self):
        self.inserts = []
        self.committed = False
        self.closed = False

    def execute(self, statement, params=None):
        sql = str(statement)
        if "notif_prefs" in sql:
            return _Result(scalar=True)
        if "INSERT INTO notifications" in sql:
            self.inserts.append(params)
            return _Result()
        if "SELECT token FROM device_tokens" in sql:
            return _Result(rows=[("ExponentPushToken[test]",)])
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
        self.assertTrue(session.committed and session.closed)


if __name__ == "__main__":
    unittest.main()
