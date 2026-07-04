import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import Boolean, Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import ARRAY, UUID
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

    runs = relationship("Run", back_populates="user")
    territories = relationship("Territory", back_populates="user")


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

    # Anti-cheat: shadow flag. Flagged runs look normal to the submitter but
    # their territories are hidden from everyone else. flag_reasons is
    # server-side only — never returned by the API.
    verified = Column(Boolean, nullable=False, default=True, server_default="true")
    flag_reasons = Column(ARRAY(Text), nullable=True)

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

    # Mirrors the owning run's verified flag at claim time.
    verified = Column(Boolean, nullable=False, default=True, server_default="true")

    # Denormalized from the runner at claim time (nullable — no clan yet).
    clan_id = Column(UUID(as_uuid=False), ForeignKey("clans.id", ondelete="SET NULL"), nullable=True, index=True)

    user = relationship("User", back_populates="territories")
    run = relationship("Run", back_populates="territory")
