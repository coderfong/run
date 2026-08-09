"""Outbound email. One function, three transports, no new dependency.

The only mail this app sends is account recovery, so this is deliberately the
smallest thing that can do that job honestly:

  * `resend`  — an HTTPS POST to the Resend API. Chosen as the default hosted
                option because it needs nothing but an API key and a verified
                sender domain, and it works from Render without an SMTP port.
  * `smtp`    — for a deployment that already has a mail host. STARTTLS unless
                `mail_smtp_ssl` is set.
  * `log`     — writes the message to the application log instead of sending
                it. The DEVELOPMENT default, and the reason the reset flow is
                testable locally with no provider account: the code appears in
                the uvicorn output.

`configured()` is what the routes ask before offering recovery at all. An
unconfigured production deployment returns 501 from the recovery endpoints
rather than accepting a request and dropping it on the floor, because a reset
that silently goes nowhere is worse than one that says it is unavailable: the
runner waits for a mail that will never arrive and files a support ticket
instead of using the path that does work (social sign-in).

`log` is never treated as configured in production. It would mean printing
one-time codes into a shared log and telling the caller the mail was sent.
"""

import json
import logging
import smtplib
import urllib.error
import urllib.request
from email.message import EmailMessage

from .config import settings

log = logging.getLogger("app.mailer")

RESEND_ENDPOINT = "https://api.resend.com/emails"


class MailError(RuntimeError):
    """A transport failure. Callers translate this into a 502; it must never
    reach the client as text, since provider errors quote the address."""


def configured() -> bool:
    """True when this deployment can actually deliver a message."""
    backend = (settings.mail_backend or "").strip().lower()
    if backend == "resend":
        return bool(settings.resend_api_key and settings.mail_from)
    if backend == "smtp":
        return bool(settings.mail_smtp_host and settings.mail_from)
    if backend == "log":
        # Fine for development; in production this is an unconfigured mailer.
        return settings.env != "production"
    return False


def _send_resend(to: str, subject: str, body: str) -> None:
    payload = json.dumps(
        {"from": settings.mail_from, "to": [to], "subject": subject, "text": body}
    ).encode()
    req = urllib.request.Request(
        RESEND_ENDPOINT,
        data=payload,
        headers={
            "Authorization": f"Bearer {settings.resend_api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=settings.mail_timeout_s) as r:
            if r.status >= 300:
                raise MailError(f"resend returned {r.status}")
    except urllib.error.HTTPError as e:
        # Body can carry the recipient address, so it is logged and not raised.
        detail = ""
        try:
            detail = e.read().decode()[:500]
        except Exception:
            pass
        log.warning("resend rejected a message: %s %s", e.code, detail)
        raise MailError(f"resend returned {e.code}")
    except MailError:
        raise
    except Exception as e:
        log.warning("resend transport failed: %s", type(e).__name__)
        raise MailError("could not reach the mail provider")


def _send_smtp(to: str, subject: str, body: str) -> None:
    msg = EmailMessage()
    msg["From"] = settings.mail_from
    msg["To"] = to
    msg["Subject"] = subject
    msg.set_content(body)
    try:
        if settings.mail_smtp_ssl:
            client = smtplib.SMTP_SSL(
                settings.mail_smtp_host,
                settings.mail_smtp_port,
                timeout=settings.mail_timeout_s,
            )
        else:
            client = smtplib.SMTP(
                settings.mail_smtp_host,
                settings.mail_smtp_port,
                timeout=settings.mail_timeout_s,
            )
        with client:
            if not settings.mail_smtp_ssl:
                try:
                    client.starttls()
                except smtplib.SMTPException:
                    # A host that cannot do STARTTLS would carry the code in
                    # the clear. Refuse rather than downgrade.
                    raise MailError("mail host does not support STARTTLS")
            if settings.mail_smtp_user:
                client.login(settings.mail_smtp_user, settings.mail_smtp_password)
            client.send_message(msg)
    except MailError:
        raise
    except Exception as e:
        log.warning("smtp transport failed: %s", type(e).__name__)
        raise MailError("could not reach the mail host")


def send(to: str, subject: str, body: str) -> None:
    """Deliver one plain text message, or raise MailError."""
    backend = (settings.mail_backend or "").strip().lower()
    if backend == "resend":
        _send_resend(to, subject, body)
    elif backend == "smtp":
        _send_smtp(to, subject, body)
    elif backend == "log":
        if settings.env == "production":
            raise MailError("mail is not configured")
        log.warning("[mail:log] to=%s subject=%s\n%s", to, subject, body)
    else:
        raise MailError("mail is not configured")
