import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from .database import Base


def _uuid():
    return str(uuid.uuid4())


class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=False), primary_key=True, default=_uuid)
    username = Column(String(64), unique=True, nullable=False, index=True)
    password_hash = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

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

    polygon = Column(Geometry(geometry_type="POLYGON", srid=4326), nullable=False)
    area_m2 = Column(Float, nullable=False)

    user = relationship("User", back_populates="territories")
    run = relationship("Run", back_populates="territory")
