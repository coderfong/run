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


if __name__ == "__main__":
    unittest.main()
