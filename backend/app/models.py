import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.orm import relationship

from .database import Base


def _uuid():
    return str(uuid.uuid4())


class Clan(Base):
    """A run club. v1.1 will replace hash-based teams with clan colours;
    v1 only lays the schema + minimal API groundwork (no UI)."""

    __tablename__ = "clans"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    name = Column(String(32), unique=True, nullable=False)
    tag = Column(String(5), unique=True, nullable=False)
    color_fill = Column(Text, nullable=False)
    color_stroke = Column(Text, nullable=False)
    color_glow = Column(Text, nullable=False)
    created_by = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    username = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    clan_id = Column(UUID(as_uuid=False), ForeignKey("clans.id", ondelete="SET NULL"), nullable=True, index=True)
    # Equipped cosmetics (the client's loadout dict) — lets other users render
    # this runner's character portrait on feeds/cards.
    avatar = Column(JSONB, nullable=True)

    # Social sign-in identity (Google / Apple). Null for password accounts.
    oauth_provider = Column(Text, nullable=True)
    oauth_sub = Column(Text, nullable=True)
    # Sign in with Apple refresh token. It is obtained by exchanging the
    # single-use authorization code and revoked before account deletion.
    oauth_refresh_token = Column(Text, nullable=True)

    # Recovery address. Null for every account created before 0028 and for
    # anyone who declines to give one — such an account works normally but
    # cannot be recovered, and the app says so. Only a VERIFIED address
    # (email_verified_at set) is ever sent a reset code.
    email = Column(Text, nullable=True)
    email_verified_at = Column(DateTime, nullable=True)

    # Bumped by a password reset. Minted into every JWT as `tv` and checked on
    # each authenticated request, so a reset ends every session that existed
    # before it — including whoever's session prompted the reset.
    token_version = Column(Integer, nullable=False, default=0, server_default="0")

    # A seeded/simulated player (see bot_activity.py). Has no password, never
    # logs in — its runs and claims exist so the map and leaderboards aren't
    # empty for a new real player. Lets notify() and social surfaces skip it.
    is_bot = Column(Boolean, nullable=False, default=False, server_default="false")

    runs = relationship("Run", back_populates="user")
    territories = relationship("Territory", back_populates="user")


class BotAccount(Base):
    """Per-bot state for the run-simulation cron (bot_activity.py).

    Kept separate from User rather than bolted onto it because this is
    cron-internal bookkeeping — a home point to stay near and a schedule —
    not anything the API ever exposes to a client."""

    __tablename__ = "bot_accounts"

    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    home_lat = Column(Float, nullable=False)
    home_lon = Column(Float, nullable=False)
    region_key = Column(Text, nullable=True)
    # One of the bots allowed to run far enough from home to raid a real
    # player's territory instead of only reinforcing its own neighbourhood.
    attacker = Column(Boolean, nullable=False, default=False, server_default="false")
    next_run_at = Column(DateTime, nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)


class AuthCode(Base):
    """A short-lived numeric code mailed to a recovery address.

    Two purposes share the table: `verify_email` proves an address belongs to
    the account before it can receive resets, and `password_reset` proves the
    same thing in order to set a new password. A code is stored only as a hash,
    counts its own failed attempts, and can be used once.
    """

    __tablename__ = "auth_codes"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(
        UUID(as_uuid=False), ForeignKey("users.id", ondelete="CASCADE"), nullable=False
    )
    purpose = Column(Text, nullable=False)
    # Where it was sent. A reset stays bound to this address, so changing the
    # account's email cannot redirect a code that is already in flight.
    dest = Column(Text, nullable=False)
    code_hash = Column(Text, nullable=False)
    attempts = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)
    expires_at = Column(DateTime, nullable=False)
    used_at = Column(DateTime, nullable=True)


class Run(Base):
    """A single running session. Stores the raw recorded path as a LineString
    in WGS84 (SRID 4326). The path is geographically meaningful (lat/lon),
    but for area/length we always project to a local equal-area CRS — see
    geospatial.project_metric()."""

    __tablename__ = "runs"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False, index=True)
    started_at = Column(DateTime, nullable=False, default=datetime.utcnow)
    ended_at = Column(DateTime, nullable=True)

    # The cleaned/simplified path the runner actually traced.
    path = Column(Geometry(geometry_type="LINESTRING", srid=4326), nullable=True)

    # Cached metrics — recomputed at end-run time from the projected geometry.
    distance_m = Column(Float, nullable=True)
    duration_s = Column(Float, nullable=True)

    # When the run's circle claim was placed (null = not claimed yet). Sticky
    # even after territory rows merge/lose their run_id, so a run can never
    # be claimed twice.
    claimed_at = Column(DateTime, nullable=True)

    # Anti-cheat: shadow flag. Flagged runs look normal to the submitter but
    # their territories are hidden from everyone else. flag_reasons is
    # server-side only — never returned by the API.
    verified = Column(Boolean, nullable=False, default=True, server_default="true")
    flag_reasons = Column(ARRAY(Text), nullable=True)

    # What /end-run decided, frozen so a repeat call replays it rather than
    # recomputing (and re-paying) — see migration 0023.
    tier = Column(Text, nullable=True)
    gate_reason = Column(Text, nullable=True)
    reward_coins = Column(Integer, nullable=True)
    reward_energy = Column(Integer, nullable=True)
    reward_xp = Column(Integer, nullable=True)

    # The slice of the day's territorial entitlement this run consumed, and
    # the land it bought. Frozen at /end-run: a later run must never change
    # what an earlier one was worth.
    claim_distance_m = Column(Float, nullable=True)
    claim_area_m2 = Column(Float, nullable=True)

    # What the claim turned out to be, and the response it produced. The
    # action is what the neutral-expansion limit counts; the result is what a
    # retry gets back.
    claim_action = Column(Text, nullable=True)
    claim_result = Column(JSONB, nullable=True)

    # The runner's editable Home post. Media is a small array of compressed
    # image data URIs so the first version does not depend on a separate object
    # store; the API caps both count and encoded size before this reaches SQL.
    caption = Column(Text, nullable=True)
    post_media = Column(JSONB, nullable=False, default=list, server_default="'[]'::jsonb")

    user = relationship("User", back_populates="runs")
    territory = relationship("Territory", back_populates="run", uselist=False)


class Territory(Base):
    """A polygon claimed by a user as the result of a closed-loop run.
    Polygons are stored in WGS84 but kept simple, valid, and non-self-intersecting.
    Overlap resolution (one user steals from another) is handled at insert time
    by ST_Difference/ST_Intersection in the route layer, never here."""

    __tablename__ = "territories"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    user_id = Column(UUID(as_uuid=False), ForeignKey("users.id"), nullable=False, index=True)
    run_id = Column(UUID(as_uuid=False), ForeignKey("runs.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    # MultiPolygon: steals can shatter land; every surviving fragment is kept.
    polygon = Column(Geometry(geometry_type="MULTIPOLYGON", srid=4326), nullable=False)
    area_m2 = Column(Float, nullable=False)

    # Defense strength: effort-based at claim time (a narrow 0.85-1.20 band —
    # pace is a nudge, not the whole game); sums when the owner re-claims over
    # their own land. Clubmates' overlapping territories stack on top at
    # attack-resolution time (never stored merged).
    strength = Column(Float, nullable=False, default=1.0, server_default="1")

    # When this land decays. Computed at claim time from effort and upkeep and
    # STORED — it used to be derived as strength x 4 days, which made a fast
    # runner's territory live three times longer than a slow one's (0022).
    expires_at = Column(DateTime, nullable=True, index=True)
    # How many times the owner has re-run over this ground. Each one buys a
    # day of life, up to a cap.
    reinforcements = Column(Integer, nullable=False, default=0, server_default="0")

    # Mirrors the owning run's verified flag at claim time.
    verified = Column(Boolean, nullable=False, default=True, server_default="true")

    # Denormalized from the runner at claim time (nullable — no clan yet).
    clan_id = Column(UUID(as_uuid=False), ForeignKey("clans.id", ondelete="SET NULL"), nullable=True, index=True)

    user = relationship("User", back_populates="territories")
    run = relationship("Run", back_populates="territory")
