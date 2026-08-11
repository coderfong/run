"""Server-side UGC filter: ordinary running text passes; unsafe text does not."""

import unittest

from fastapi import HTTPException

from app import content_moderation


class ContentModerationTests(unittest.TestCase):
    def test_allows_normal_running_and_club_copy(self):
        for value in (
            "Great run around Marina Bay!",
            "Saturday easy pace at 7am",
            "north_side_runners",
        ):
            self.assertTrue(content_moderation.is_allowed(value), value)

    def test_rejects_objectionable_and_obfuscated_copy(self):
        for value in (
            "kill yourself",
            "f_u_c_k",
            "child porn",
        ):
            self.assertFalse(content_moderation.is_allowed(value), value)

    def test_rejection_is_a_client_error(self):
        with self.assertRaises(HTTPException) as raised:
            content_moderation.require_allowed_text("k y s", "comment")
        self.assertEqual(raised.exception.status_code, 400)


if __name__ == "__main__":
    unittest.main()
