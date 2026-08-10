# Account recovery

Added 2026-08-09. Before this, a PASER account was a username and a bcrypt
hash: there was no second factor of identity in the database, so a forgotten
password was a deleted account. The only runners who could get back in were
the ones who had signed in with Google or Apple.

## What a runner sees

| Situation | What happens |
|---|---|
| Password account, confirmed email | Sign in screen → **Forgot your password?** → code by email → new password, signed straight in |
| Password account, no confirmed email | Told plainly on the first step that there is nowhere to send a code, and pointed at the profile if they are still signed in somewhere |
| Google / Apple account | Told to use that button. There is no PASER password to reset |

The address is set either at signup (an optional field, with the reason stated
next to it) or from **Profile → Account recovery**. It is not a recovery route
until a code sent to it has been typed back in, because an unconfirmed address
is a typo at best and somebody else's inbox at worst.

## The API

| Endpoint | Auth | Does |
|---|---|---|
| `POST /auth/forgot` | none | `{username}` → mails a code. Answers `{sent, reason}`; `reason` is `no_email` or `oauth` |
| `POST /auth/verify-reset-code` | none | `{username, code}` → `{ticket}`. Spends the code |
| `POST /auth/reset-password` | none | `{ticket, password}` → a full session, same shape as login |
| `GET /me/recovery` | session | `{email, verified, provider, can_recover, mail_available}` |
| `PUT /me/recovery/email` | session | `{email, current_password?}` → sends a confirmation code |
| `POST /me/recovery/email/verify` | session | `{code}` → the address becomes a recovery route |
| `POST /me/recovery/email/resend` | session | sends the confirmation code again |
| `DELETE /me/recovery/email` | session | drops it. Same password rule as replacing it |

Schema: migration `0028_account_recovery` adds `users.email`,
`users.email_verified_at`, `users.token_version` and the `auth_codes` table.
Logic is in `app/recovery.py`, delivery in `app/mailer.py`, endpoints in
`app/routes/auth.py`.

## The rules that make a 6 digit code safe

A million possibilities is only enough if guessing is bounded, so it is bounded
four ways, and all four are enforced server side:

- **15 minutes** (`RECOVERY_CODE_TTL_MINUTES`). A mail sitting in an inbox
  stops being a key.
- **5 attempts** (`RECOVERY_MAX_ATTEMPTS`), counted on the row, so a restart
  does not reset them. The sixth try burns the code even if it is correct.
- **Single use.** Accepting a code stamps `used_at` in the same transaction.
- **5 requests an hour per IP** (`RATE_LIMIT_RECOVERY`), which is also what
  stops these endpoints being used as a mail cannon.

Codes are bcrypt at rest and never logged. A new request retires the previous
code, so a mail from ten minutes ago cannot be used after a fresh one is asked
for.

## Two decisions worth knowing about

**A reset ends every other session.** Sessions are 30 day JWTs with no server
side record, so before this a stolen token kept working right through a
password change, which made a reset useless in exactly the case it is most
needed. Every token now carries a `tv` claim; `reset-password` bumps
`users.token_version`, and every previously issued token fails its next
request. Tokens minted before this shipped carry no `tv` and read as 0, so the
deploy did not sign anybody out.

**`/auth/forgot` answers honestly instead of always saying "check your
email".** The textbook anti-enumeration answer is the wrong one here: most
accounts have no address on them at all (nothing collected one before this
shipped), so a blanket "check your email" leaves people watching an inbox
forever. What is protected instead is the address itself, which is never
returned to an unauthenticated caller, not even masked. Whether a username
exists was already public from signup's 409.

## Configuration

Recovery is off until a mail transport is configured, and says so: the
endpoints return 501 and the app tells runners reset is not available rather
than accepting the request and dropping it.

```
MAIL_BACKEND=resend          # or smtp, or log (development only)
MAIL_FROM=PASER <recovery@yourdomain>
RESEND_API_KEY=re_...
```

`log` writes the code to the server log and sends nothing. It is the local
default and is never treated as configured in production, since that would mean
printing one time codes into a shared log while telling the caller the mail was
sent.

`MAIL_FROM` should be an address somebody reads: the mail sent to a runner's
OLD address when the recovery email changes asks them to reply to it if the
change was not theirs.

## Testing

```bash
cd backend && .venv/Scripts/python.exe test_recovery.py
```

Runs against the real app and the dev database with the `log` backend, so no
provider account is needed. It reads codes out of `auth_codes` rather than out
of a mailbox and covers the dead ends, the attempt ceiling, single use, ticket
replay, cross purpose codes, and that a reset really does kill older sessions.
