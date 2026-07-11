from datetime import datetime
from typing import List, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field, field_validator


class ClanColor(BaseModel):
    fill: str
    stroke: str
    glow: str


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
    # LEGACY field — the exterior ring of the LARGEST piece, kept populated
    # so pre-MultiPolygon clients keep working. New clients should read
    # `rings` instead.
    polygon: List[Tuple[float, float]]
    # All exterior rings of the (Multi)Polygon: [[[lon, lat], ...], ...].
    rings: List[List[Tuple[float, float]]] = []
    # Claimed within the contested window (the map "heat" signal).
    contested: bool = False
    # Owning clan (null for solo runners → the client renders neutral grey).
    clan_tag: Optional[str] = None
    clan_color: Optional[ClanColor] = None
    # Defenders = members of the owning clan (1 for solo).
    defenders: int = 1


class RunResultOut(BaseModel):
    run_id: str
    distance_m: float
    duration_s: float
    # LEGACY — territory is no longer created at end-run (circle-claim model);
    # kept so old clients degrade gracefully. Always False/None now.
    closed_loop: bool = False
    territory: Optional[TerritoryOut] = None
    # Circle claim earned by this run: circumference = distance run. The
    # client places it along the trail via /claim-territory.
    claim_radius_m: float = 0.0
    claim_area_m2: float = 0.0
    # Steal summary (populated at claim time).
    stolen_m2: float = 0.0
    stolen_from: Optional[str] = None
    # Phase 6 fills these server-side; empty meanwhile.
    achievements: List[str] = []


class ClaimIn(BaseModel):
    """Place the run's circle claim. (lat, lon) is the circle centre and must
    lie on (within claim_snap_tolerance_m of) the run's recorded trail."""
    run_id: str
    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)


class ClaimOut(BaseModel):
    territory: TerritoryOut
    stolen_m2: float = 0.0
    stolen_from: Optional[str] = None


class LeaderboardEntry(BaseModel):
    user_id: str
    username: str
    total_area_m2: float
    territory_count: int
    clan_tag: Optional[str] = None
    clan_color: Optional[ClanColor] = None


class MapPolygonsOut(BaseModel):
    territories: List[TerritoryOut]


# ---- feed + profile stats (Phase 4) --------------------------------------

class FeedItem(BaseModel):
    id: str
    kind: str = "run"  # 'run' | (Phase 5) 'claim' | 'clan' | 'goal'
    user_id: str
    username: str
    is_you: bool = False
    distance_m: float
    duration_s: float
    area_m2: float = 0.0
    closed_loop: bool = False
    created_at: datetime
    clan_tag: Optional[str] = None
    clan_color: Optional[ClanColor] = None
    kudos_count: int = 0
    kudoed: bool = False
    comment_count: int = 0
    # Simplified geometry for the card thumbnail: the claimed land (rings) and
    # the run trail (path). Both [lon, lat]; either may be empty.
    rings: List[List[Tuple[float, float]]] = []
    path: List[Tuple[float, float]] = []


class FeedOut(BaseModel):
    items: List[FeedItem]
    next_cursor: Optional[datetime] = None


class MeStats(BaseModel):
    total_area_m2: float
    territory_count: int
    biggest_claim_m2: float
    runs_count: int
    career_distance_m: float
    current_streak_weeks: int
    # XP / level (level = floor(sqrt(xp/100)); next level at 100*(lvl+1)^2)
    xp: int = 0
    level: int = 0
    next_level_xp: int = 100


class NotificationItem(BaseModel):
    id: str
    category: str
    title: str
    body: str
    read: bool
    created_at: datetime


class NotificationsOut(BaseModel):
    items: List[NotificationItem]
    unread: int = 0


class RunSummary(BaseModel):
    run_id: str
    distance_m: float
    duration_s: float
    area_m2: float
    closed_loop: bool
    created_at: datetime


class RunSplit(BaseModel):
    km: int
    seconds: float


class RunDetail(BaseModel):
    run_id: str
    user_id: str
    username: str
    is_you: bool
    distance_m: float
    duration_s: float
    area_m2: float
    closed_loop: bool
    created_at: datetime
    clan_tag: Optional[str] = None
    clan_color: Optional[ClanColor] = None
    path: List[Tuple[float, float]] = []      # [lon, lat]
    territory_rings: List[List[Tuple[float, float]]] = []
    splits: List[RunSplit] = []
    kudos_count: int = 0
    kudoed: bool = False
    comment_count: int = 0


# ---- run comments + club chat ---------------------------------------------

class RunCommentIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=280)


class RunCommentOut(BaseModel):
    id: str
    user_id: str
    username: str
    is_you: bool = False
    body: str
    created_at: datetime


class ClanMessageIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=500)


class ClanMessageOut(BaseModel):
    id: str
    user_id: Optional[str] = None
    username: str
    is_you: bool = False
    body: str
    created_at: datetime


class PushTokenIn(BaseModel):
    token: str
    platform: Optional[str] = None


class NotifPrefs(BaseModel):
    stolen: bool = True
    clan_goal: bool = True
    kudos: bool = True
    season: bool = True
    recap: bool = True


# ---- clans (Phase 5) ------------------------------------------------------

class ClanCreate(BaseModel):
    name: str = Field(..., min_length=3, max_length=24)
    tag: str = Field(..., min_length=2, max_length=5)
    description: Optional[str] = Field(None, max_length=140)
    color_key: str
    badge_icon: str
    privacy: str = "open"  # 'open' | 'invite_only'


class ClanUpdate(BaseModel):
    description: Optional[str] = Field(None, max_length=140)
    color_key: Optional[str] = None
    badge_icon: Optional[str] = None
    privacy: Optional[str] = None


class ClanMemberOut(BaseModel):
    user_id: str
    username: str
    role: str
    joined_at: datetime
    week_distance_m: float = 0.0
    week_claims: int = 0


class WeekGoalOut(BaseModel):
    week_start: str
    target_distance_m: float
    target_claims: int
    progress_distance_m: float
    progress_claims: int
    reached: bool
    my_distance_m: float = 0.0
    my_claims: int = 0


class ClanOut(BaseModel):
    id: str
    name: str
    tag: str
    description: Optional[str] = None
    color_key: str
    color: ClanColor
    badge_icon: str
    privacy: str
    member_cap: int
    member_count: int
    created_by: Optional[str] = None
    created_at: datetime
    my_role: Optional[str] = None          # role of the requesting user, if a member
    league: Optional[str] = None
    season_area_m2: float = 0.0
    season_rank: Optional[int] = None
    members: List[ClanMemberOut] = []
    week_goal: Optional[WeekGoalOut] = None


class ClanSummary(BaseModel):
    """Compact clan for search results / directory."""
    id: str
    name: str
    tag: str
    color: ClanColor
    badge_icon: str
    privacy: str
    member_count: int
    league: Optional[str] = None
    season_area_m2: float = 0.0


class ClanInviteOut(BaseModel):
    code: str
    expires_at: Optional[datetime] = None
    max_uses: int
    uses: int
    url: str


class ClanLeaderboardEntry(BaseModel):
    clan_id: str
    name: str
    tag: str
    color: ClanColor
    badge_icon: str = "shield"
    league: Optional[str] = None
    total_area_m2: float
    member_count: int


class MyClan(BaseModel):
    """The signed-in user's clan membership (drives the app accent)."""
    clan_id: Optional[str] = None
    tag: Optional[str] = None
    role: Optional[str] = None
    color: Optional[ClanColor] = None
