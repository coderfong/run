"""Account recovery — end to end, against the real app and the dev DB.

    .venv/Scripts/python.exe test_recovery.py

Runs with the `log` mail backend and reads the code straight out of `auth_codes`
rather than out of a mailbox, so nothing here needs a mail provider. What it is
actually checking is that the code is only ever a key to the one thing it was
minted for:

  1  an account with no verified address is told so, plainly
  2  the happy path: forgot, verify, reset, and the new password works
  3  the old password stops working, and so does every session issued before it
  4  a code is single use
  5  a wrong code burns an attempt, and the attempts run out
  6  requesting a new code retires the old one
  7  a reset ticket cannot be replayed
  8  an access token is not a reset ticket
  9  a verify_email code cannot reset a password
  10 an account that signs in with Google is pointed at Google

Throwaway users are deleted at the end.
"""

import os
import sys
import uuid

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import text  # noqa: E402

from app.config import settings  # noqa: E402
from app.database import SessionLocal  # noqa: E402
from app.main import app  # noqa: E402
from app.security import hash_code  # noqa: E402

# The limiter would refuse the twentieth call in this file long before the
# assertions ran. The rules it enforces are configuration, not behaviour.
try:
    app.state.limiter.enabled = False
except Exception:
    pass

c = TestClient(app)
tag = uuid.uuid4().hex[:6]
fails = []
made = []


def check(label, cond, detail=""):
    print(("  PASS  " if cond else "  FAIL  ") + label + (f"   [{detail}]" if detail and not cond else ""))
    if not cond:
        fails.append(label)


def signup(name, password="firstpass1", email=None):
    body = {"username": name, "password": password}
    if email:
        body["email"] = email
    r = c.post("/auth/signup", json=body)
    assert r.status_code == 200, r.text
    made.append(name)
    return r.json()


def db_exec(sql, **params):
    s = SessionLocal()
    try:
        out = s.execute(text(sql), params).first()
        s.commit()
        return out
    finally:
        s.close()


def live_code(username, purpose, code="123456"):
    """The plaintext code cannot be read back (it is bcrypt at rest), so the
    test writes a KNOWN hash over the live row and returns the plaintext. That
    exercises every rule around the code without needing a mailbox.

    `code` is a parameter because two successive codes have to be DIFFERENT
    strings, or "the superseded one is refused" passes on the new row's hash.
    """
    row = db_exec(
        """
        UPDATE auth_codes SET code_hash = :h
        WHERE id = (
            SELECT ac.id FROM auth_codes ac
            JOIN users u ON u.id = ac.user_id
            WHERE u.username = :u AND ac.purpose = :p AND ac.used_at IS NULL
            ORDER BY ac.created_at DESC LIMIT 1
        )
        RETURNING id
        """,
        h=hash_code(code),
        u=username,
        p=purpose,
    )
    return code if row else None


def verify_address(username):
    """Mark the address confirmed the way the verify endpoint would."""
    db_exec(
        "UPDATE users SET email_verified_at = now() WHERE username = :u RETURNING id",
        u=username,
    )


# ---------------------------------------------------------------------------

print("\n[0] the mail backend under test")
check(
    "log backend, so no provider is needed",
    settings.mail_backend == "log" and settings.env != "production",
    f"backend={settings.mail_backend} env={settings.env}",
)

print("\n[1] an account with no address is told so")
bare = f"rec_bare_{tag}"
signup(bare)
r = c.post("/auth/forgot", json={"username": bare})
check("200, not an error", r.status_code == 200, r.status_code)
check("sent is false", r.json().get("sent") is False, r.json())
check("reason says there is no email", r.json().get("reason") == "no_email", r.json())

r = c.post("/auth/forgot", json={"username": f"nobody_{tag}"})
check(
    "an account that does not exist looks identical",
    r.status_code == 200 and r.json().get("sent") is False and r.json().get("reason") == "no_email",
    r.json(),
)

print("\n[2] the happy path")
name = f"rec_{tag}"
out = signup(name, email=f"{name}@example.com")
old_token = out["access_token"]
check("signup stored the address unverified", out["user"].get("email_verified") is False, out["user"])

# confirm the address through the real endpoint, using the code it just minted
code = live_code(name, "verify_email")
r = c.post(
    "/me/recovery/email/verify",
    json={"code": code},
    headers={"Authorization": f"Bearer {old_token}"},
)
check("the confirmation code confirms the address", r.status_code == 200, r.text)
r = c.get("/me/recovery", headers={"Authorization": f"Bearer {old_token}"})
check("can_recover is now true", r.json().get("can_recover") is True, r.json())

r = c.post("/auth/forgot", json={"username": name})
check("a code is sent", r.status_code == 200 and r.json().get("sent") is True, r.json())

code = live_code(name, "password_reset")
r = c.post("/auth/verify-reset-code", json={"username": name, "code": code})
check("the code buys a ticket", r.status_code == 200 and r.json().get("ticket"), r.text)
ticket = r.json().get("ticket")

r = c.post("/auth/reset-password", json={"ticket": ticket, "password": "secondpass2"})
check("the ticket sets the password", r.status_code == 200, r.text)
new_token = r.json().get("access_token")
check("and hands back a session", bool(new_token), r.json())

r = c.post("/auth/login", json={"username": name, "password": "secondpass2"})
check("the new password works", r.status_code == 200, r.text)

print("\n[3] what the reset invalidates")
r = c.post("/auth/login", json={"username": name, "password": "firstpass1"})
check("the old password does not", r.status_code == 401, r.status_code)
r = c.get("/me", headers={"Authorization": f"Bearer {old_token}"})
check("a session issued before the reset is dead", r.status_code == 401, r.status_code)
r = c.get("/me", headers={"Authorization": f"Bearer {new_token}"})
check("the session handed back by the reset works", r.status_code == 200, r.text)

print("\n[4] a code is single use")
r = c.post("/auth/verify-reset-code", json={"username": name, "code": code})
check("the same code a second time is refused", r.status_code == 400, r.status_code)

print("\n[5] guessing is bounded")
guess_user = f"rec_guess_{tag}"
signup(guess_user, email=f"{guess_user}@example.com")
verify_address(guess_user)
c.post("/auth/forgot", json={"username": guess_user})
live_code(guess_user, "password_reset")
statuses = []
for _ in range(settings.recovery_max_attempts):
    statuses.append(
        c.post("/auth/verify-reset-code", json={"username": guess_user, "code": "000000"}).status_code
    )
check("every wrong guess is a 400", set(statuses) == {400}, statuses)
r = c.post("/auth/verify-reset-code", json={"username": guess_user, "code": "123456"})
check(
    "the right code no longer works once the attempts are gone",
    r.status_code == 400 and "new code" in r.text,
    r.text,
)

print("\n[6] a new request retires the old code")
c.post("/auth/forgot", json={"username": guess_user})
first = live_code(guess_user, "password_reset", "111111")
c.post("/auth/forgot", json={"username": guess_user})
second = live_code(guess_user, "password_reset", "222222")
r = c.post("/auth/verify-reset-code", json={"username": guess_user, "code": first})
check("the superseded code is refused", r.status_code == 400, r.status_code)
r = c.post("/auth/verify-reset-code", json={"username": guess_user, "code": second})
check("the newest one works", r.status_code == 200, r.text)
ticket2 = r.json().get("ticket")

print("\n[7] a ticket is spent once")
r = c.post("/auth/reset-password", json={"ticket": ticket2, "password": "thirdpass3"})
check("first use sets the password", r.status_code == 200, r.text)
r = c.post("/auth/reset-password", json={"ticket": ticket2, "password": "fourthpass4"})
check("a replay is refused", r.status_code == 400, r.status_code)
r = c.post("/auth/login", json={"username": guess_user, "password": "thirdpass3"})
check("the replay changed nothing", r.status_code == 200, r.status_code)

print("\n[8] an access token is not a reset ticket")
victim = f"rec_victim_{tag}"
signup(victim)
session = c.post("/auth/login", json={"username": victim, "password": "firstpass1"}).json()["access_token"]
r = c.post("/auth/reset-password", json={"ticket": session, "password": "hijacked9"})
check("a session token cannot set a password", r.status_code == 400, r.status_code)
r = c.post("/auth/login", json={"username": victim, "password": "firstpass1"})
check("the password is untouched", r.status_code == 200, r.status_code)

print("\n[9] purposes do not cross")
mixer = f"rec_mix_{tag}"
tok = signup(mixer, email=f"{mixer}@example.com")["access_token"]
vcode = live_code(mixer, "verify_email")
r = c.post("/auth/verify-reset-code", json={"username": mixer, "code": vcode})
check("a confirmation code cannot start a reset", r.status_code == 400, r.status_code)

print("\n[10] a social account is pointed at its provider")
social = f"rec_oauth_{tag}"
db_exec(
    "INSERT INTO users (id, username, password_hash, oauth_provider, oauth_sub) "
    "VALUES (gen_random_uuid(), :u, NULL, 'google', :s) RETURNING id",
    u=social,
    s=f"sub_{tag}",
)
made.append(social)
r = c.post("/auth/forgot", json={"username": social})
check(
    "reason is oauth, with the provider named",
    r.json().get("reason") == "oauth" and r.json().get("provider") == "google",
    r.json(),
)

print("\n[11] the address is never handed to an unauthenticated caller")
bodies = [
    c.post("/auth/forgot", json={"username": name}).text,
    c.post("/auth/verify-reset-code", json={"username": name, "code": "000000"}).text,
]
check(
    "no response body carries the email",
    all("example.com" not in b for b in bodies),
    bodies,
)

# --- cleanup ---------------------------------------------------------------
s = SessionLocal()
try:
    for u in made:
        s.execute(text("DELETE FROM users WHERE username = :u"), {"u": u})
    s.commit()
finally:
    s.close()

print("\n" + ("ALL PASS" if not fails else f"{len(fails)} FAILED: " + ", ".join(fails)))
sys.exit(1 if fails else 0)
