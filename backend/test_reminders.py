from datetime import date
from pathlib import Path
import unittest
from unittest.mock import patch

from app import reminders


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
        self.sql = []

    def execute(self, statement, params=None):
        sql = str(statement)
        self.sql.append((sql, params or {}))
        if "SELECT (now() AT TIME ZONE" in sql:
            return _Result(scalar=date(2026, 9, 5))
        if "ARRAY_AGG" in sql:
            return _Result(
                rows=[
                    (
                        "runner-1",
                        [date(2026, 9, 4), date(2026, 9, 3), date(2026, 9, 2)],
                    )
                ]
            )
        if "ST_Y(ST_Centroid" in sql:
            return _Result(rows=[("runner-1", 2, 12500.0, 1.30, 103.80)])
        raise AssertionError(sql)


class ReminderTest(unittest.TestCase):
    def test_cron_entrypoint_is_copied_into_the_runtime_image(self):
        dockerfile = Path(__file__).with_name("Dockerfile").read_text(encoding="utf-8")
        self.assertRegex(dockerfile, r"COPY[^\n]*\breminders\.py\b")

    def test_consecutive_streak_stops_at_a_gap(self):
        today = date(2026, 9, 5)
        self.assertEqual(
            reminders._consecutive_streak(
                [date(2026, 9, 4), date(2026, 9, 3), date(2026, 9, 1)], today
            ),
            2,
        )

    def test_builds_actionable_streak_and_territory_reminders(self):
        session = _Session()
        items = reminders.scheduled_reminders(session)

        self.assertEqual([item["data"]["kind"] for item in items], [
            "streak_at_risk",
            "territory_expiring",
        ])
        self.assertEqual(items[0]["data"]["screen"], "record")
        self.assertEqual(items[0]["data"]["streak_days"], 3)
        self.assertEqual(items[1]["data"]["screen"], "map")
        self.assertEqual(items[1]["data"]["plots"], 2)

        # Both selection queries suppress a same-kind reminder already written
        # today, which makes retries safe.
        selection_sql = "\n".join(sql for sql, _ in session.sql[1:])
        self.assertIn("n.data ->> 'kind' = 'streak_at_risk'", selection_sql)
        self.assertIn("n.data ->> 'kind' = 'territory_expiring'", selection_sql)
        self.assertIn("AT TIME ZONE 'UTC' AT TIME ZONE", selection_sql)

    def test_delivery_uses_the_reminder_category(self):
        item = {
            "user_id": "runner-1",
            "title": "Keep your streak alive",
            "body": "Run tonight.",
            "data": {"kind": "streak_at_risk", "screen": "record"},
        }
        sent = []
        with patch.object(reminders, "scheduled_reminders", return_value=[item]):
            result = reminders.deliver_scheduled_reminders(object(), lambda *args: sent.append(args))

        self.assertEqual(sent[0][1], "reminder")
        self.assertEqual(sent[0][4]["screen"], "record")
        self.assertEqual(result, {"streak": 1, "territory": 0, "total": 1})


if __name__ == "__main__":
    unittest.main()
