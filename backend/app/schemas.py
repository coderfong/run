from datetime import datetime
from typing import List, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field, field_validator


# A GPS sample. The client may send the moment as either `t` (canonical) or
# `timestamp` (legacy/RN convention) — we accept both and normalise to a
# datetime.
class GpsPoint(BaseModel):
    model_config = ConfigDict(populate_by_name=True)

    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    t: datetime = Field(..., alias="timestamp")
    # Sensor metadata for anti-cheat — all optional so old clients still work.
    accuracy_m: Optional[float] = None
    mocked: Optional[bool] = None       # Android mock-provider flag; iOS false
    speed_mps: Optional[float] = None   # platform-reported speed if available

    @field_validator("t", mode="before")
    @classmethod
    def _coerce_t(cls, v):
        # Accept ms-since-epoch ints/floats too — RN sends Date.now().
        if isinstance(v, (int, float)):
            return datetime.utcfromtimestamp(v / 1000.0 if v > 1e12 else v)
        return v


class StartRunIn(BaseModel):
    started_at: Optional[datetime] = None


class StartRunOut(BaseModel):
    run_id: str
    started_at: datetime


class EndRunIn(BaseModel):
    run_id: str
    points: List[GpsPoint]
    # Cumulative pedometer steps during the run (anti-cheat stride check).
    step_count: Optional[int] = Field(None, ge=0)


# A single live-stream submission. The frontend can call /submit-path
# repeatedly during the run and we'll detect closure server-side.
class SubmitPathIn(BaseModel):
    run_id: str
    points: List[GpsPoint]


class TerritoryOut(BaseModel):
    id: str
    user_id: str
    username: str
    area_m2: float
    created_at: datetime
    # GeoJSON-style ring: list of [lon, lat] pairs (exterior only — we don't
    # currently emit holes since territories are stored as simple polygons).
    polygon: List[Tuple[float, float]]


class RunResultOut(BaseModel):
    run_id: str
    distance_m: float
    duration_s: float
    closed_loop: bool
    territory: Optional[TerritoryOut] = None


class LeaderboardEntry(BaseModel):
    user_id: str
    username: str
    total_area_m2: float
    territory_count: int


class MapPolygonsOut(BaseModel):
    territories: List[TerritoryOut]
