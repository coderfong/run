"""Pure tests for the Sign in with Apple server-token plumbing."""

import unittest

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec
from jose import jwt

from app.routes import auth


class AppleTokenLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.previous = {
            key: getattr(auth.settings, key)
            for key in ("apple_client_id", "apple_team_id", "apple_key_id", "apple_private_key")
        }
        key = ec.generate_private_key(ec.SECP256R1())
        pem = key.private_bytes(
            serialization.Encoding.PEM,
            serialization.PrivateFormat.PKCS8,
            serialization.NoEncryption(),
        ).decode()
        auth.settings.apple_client_id = "com.pacerrun.app"
        auth.settings.apple_team_id = "TEAM123"
        auth.settings.apple_key_id = "KEY123"
        auth.settings.apple_private_key = pem

    def tearDown(self):
        for key, value in self.previous.items():
            setattr(auth.settings, key, value)

    def test_client_secret_has_apple_claims(self):
        client_id, token = auth._apple_client_secret()
        claims = jwt.get_unverified_claims(token)
        header = jwt.get_unverified_header(token)
        self.assertEqual(client_id, "com.pacerrun.app")
        self.assertEqual(claims["iss"], "TEAM123")
        self.assertEqual(claims["sub"], "com.pacerrun.app")
        self.assertEqual(claims["aud"], "https://appleid.apple.com")
        self.assertEqual(header["kid"], "KEY123")
        self.assertEqual(header["alg"], "ES256")
        self.assertGreater(claims["exp"], claims["iat"])

    def test_revoke_uses_refresh_token_hint(self):
        calls = []
        original = auth._apple_form
        auth._apple_form = lambda url, values: calls.append((url, values)) or {}
        try:
            auth._revoke_apple_token("refresh-value")
        finally:
            auth._apple_form = original
        self.assertEqual(calls[0][0], auth.APPLE_REVOKE_URL)
        self.assertEqual(calls[0][1]["token"], "refresh-value")
        self.assertEqual(calls[0][1]["token_type_hint"], "refresh_token")


class AppleCodeExchangeIsBestEffortTests(unittest.TestCase):
    """The exchange must never be able to fail a valid sign-in.

    App Review rejected 2.1.0 for "an error message was displayed when we used
    Sign in with Apple". Every branch below used to raise out of POST /auth/apple
    and become that message, even though the identity token had already proved
    who the runner was.
    """

    def _swap(self, **attrs):
        previous = {k: getattr(auth, k) for k in attrs}
        for k, v in attrs.items():
            setattr(auth, k, v)
        self.addCleanup(lambda: [setattr(auth, k, v) for k, v in previous.items()])

    def test_missing_code_is_not_an_error(self):
        self.assertIsNone(auth._try_exchange_apple_code(None, "sub-1"))
        self.assertIsNone(auth._try_exchange_apple_code("", "sub-1"))

    def test_apple_rejecting_the_exchange_is_swallowed(self):
        def boom(code):
            raise auth.HTTPException(502, "Apple could not validate the authorization")

        self._swap(_exchange_apple_code=boom)
        self.assertIsNone(auth._try_exchange_apple_code("code-1", "sub-1"))

    def test_unconfigured_signing_key_is_swallowed(self):
        def boom(code):
            raise auth.HTTPException(503, "Sign in with Apple token lifecycle is not configured")

        self._swap(_exchange_apple_code=boom)
        self.assertIsNone(auth._try_exchange_apple_code("code-1", "sub-1"))

    def test_unexpected_failure_is_swallowed(self):
        def boom(code):
            raise RuntimeError("socket went away")

        self._swap(_exchange_apple_code=boom)
        self.assertIsNone(auth._try_exchange_apple_code("code-1", "sub-1"))

    def test_token_for_another_subject_is_dropped(self):
        self._swap(
            _exchange_apple_code=lambda code: ("refresh-value", "id-token"),
            _verify_apple=lambda token: {"sub": "somebody-else"},
        )
        self.assertIsNone(auth._try_exchange_apple_code("code-1", "sub-1"))

    def test_good_exchange_still_returns_the_refresh_token(self):
        self._swap(
            _exchange_apple_code=lambda code: ("refresh-value", "id-token"),
            _verify_apple=lambda token: {"sub": "sub-1"},
        )
        self.assertEqual(auth._try_exchange_apple_code("code-1", "sub-1"), "refresh-value")


class AppleSigningKeyCacheTests(unittest.TestCase):
    """The keys must not be a live dependency of every sign-in."""

    def setUp(self):
        self.previous = dict(auth._APPLE_KEYS)
        self.addCleanup(lambda: auth._APPLE_KEYS.update(self.previous))
        auth._APPLE_KEYS.update({"keys": [], "at": 0.0})
        self.fetches = []

    def _serve(self, keys):
        def fetch(url):
            self.fetches.append(url)
            return {"keys": keys}

        previous = auth._http_json
        auth._http_json = fetch
        self.addCleanup(lambda: setattr(auth, "_http_json", previous))

    def test_second_lookup_reuses_the_cache(self):
        self._serve([{"kid": "K1"}])
        self.assertEqual(auth._apple_key("K1"), {"kid": "K1"})
        self.assertEqual(auth._apple_key("K1"), {"kid": "K1"})
        self.assertEqual(len(self.fetches), 1)

    def test_unknown_kid_forces_one_refetch(self):
        self._serve([{"kid": "K1"}])
        auth._apple_key("K1")
        self.fetches.clear()
        self._serve([{"kid": "K1"}, {"kid": "K2"}])
        self.assertEqual(auth._apple_key("K2"), {"kid": "K2"})
        self.assertEqual(len(self.fetches), 1)

    def test_apple_being_unreachable_falls_back_to_cached_keys(self):
        self._serve([{"kid": "K1"}])
        auth._apple_key("K1")

        def boom(url):
            raise OSError("apple unreachable")

        auth._http_json = boom
        auth._APPLE_KEYS["at"] = 0.0  # force the refresh path
        self.assertEqual(auth._apple_key("K1"), {"kid": "K1"})


if __name__ == "__main__":
    unittest.main()
