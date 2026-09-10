from datetime import datetime, timezone
from typing import Annotated, List, Literal, Optional, Tuple

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer, field_validator


# Every datetime column in models.py is a NAIVE `DateTime` holding
# `datetime.utcnow()`, so without this the API emits `2026-08-18T02:00:00` —
# an ISO string with no zone at all. That is not merely untidy: the JavaScript
# date parser reads a zoneless date-time as LOCAL time, so the app rendered
# every timestamp shifted by the phone's UTC offset and a run that had just
# finished appeared on the feed as "8h ago" in Singapore and correct in London.
#
# The fix belongs here rather than only in the client, because the wire format
# was genuinely wrong: a bare naive string does not say what instant it means,
# and every consumer has to guess. Naive values are declared UTC (which is what
# they have always been) and aware ones are converted, so both come out as a
# single unambiguous `...Z`.
#
# JSON ONLY (`when_used="json"`). `model_dump()` with no mode keeps real
# datetime objects, which is what the internal callers that pass models around
# expect.
def _as_utc_iso(value: datetime) -> str:
    if value.tzinfo is None:
        value = value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


# Use this, not bare `datetime`, for every field that goes OUT to the app.
UtcDatetime = Annotated[
    datetime, PlainSerializer(_as_utc_iso, return_type=str, when_used="json")
]


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
    t: UtcDatetime = Field(..., alias="timestamp")
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

    @field_validator("t")
    @classmethod
    def _normalise_t(cls, v):
        # Match the server's naive UTC clock, including mixed ISO/epoch input.
        return v.astimezone(timezone.utc).replace(tzinfo=None) if v.tzinfo else v


class StartRunIn(BaseModel):
    started_at: Optional[UtcDatetime] = None


class StartRunOut(BaseModel):
    run_id: str
    started_at: UtcDatetime


class EndRunIn(BaseModel):
    run_id: str
    points: List[GpsPoint]
    # Cumulative pedometer steps during the run (anti-cheat stride check).
    step_count: Optional[int] = Field(None, ge=0)
    # Development harness marker. The route only honours this for a server-side
    # allowlisted dev account; ordinary clients cannot opt out of the daily
    # entitlement curve by sending the flag themselves.
    simulated: bool = False


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
    created_at: UtcDatetime
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
    # Defense strength: pace-based at claim, stacks on re-claims. Attacks on
    # this land only succeed when the attacker's claim strength beats the
    # total defense (this + overlapping club land).
    strength: float = 1.0
    # The owner's equipped cosmetics, so their character portrait can render
    # in the middle of the territory on the map (null → no portrait).
    avatar: Optional[dict] = None
    # 1.0 = freshly claimed, 0.0 = about to expire. Land decays over
    # strength × N days; the client fades the fill as this drops.
    freshness: float = 1.0
    # How many times the owner has re-run over this ground (0 = claimed once).
    # The client deepens the fill saturation as this rises, so repeat-claimed
    # land reads bolder on the board.
    reinforcements: int = 0
    # The owner's competitive rank tier at render time (decay already applied),
    # so the board can be scoped and banded by rank. `rank_tier` is the ladder
    # index (0 = Wood), matching `key`/`label` in ranks.RANK_TIERS 1:1.
    rank_key: str = "wood"
    rank_tier: int = 0
    rank_label: str = "Wood"
    # The OWNING CLUB's tier, which is a different ladder from the owner's own
    # (clubs carry their own zero-sum rating). Null for clubless land. The club
    # board is scoped on this, so a plot can sit in Gold on the solo board and
    # in Silver on the club one without either being wrong.
    clan_rank_key: Optional[str] = None
    clan_rank_tier: Optional[int] = None
    clan_rank_label: Optional[str] = None


class RunResultOut(BaseModel):
    run_id: str
    distance_m: float
    duration_s: float
    # LEGACY — territory is no longer created at end-run (circle-claim model);
    # kept so old clients degrade gracefully. Always False/None now.
    closed_loop: bool = False
    territory: Optional[TerritoryOut] = None
    # Land earned by this run — area is linear in distance. `claim_ring` is
    # the exact territory the run will take, grown around the route, so the
    # client can SHOW it before confirming; there is nothing to place any
    # more. `claim_radius_m` is only the fallback disc and is kept for old
    # clients that still draw a circle.
    claim_radius_m: float = 0.0
    claim_area_m2: float = 0.0
    claim_ring: List[Tuple[float, float]] = []
    # Steal summary (populated at claim time).
    stolen_m2: float = 0.0
    stolen_from: Optional[str] = None
    # Phase 6 fills these server-side; empty meanwhile.
    achievements: List[str] = []
    # XP awarded for this run (distance-based; 0 on flagged runs). Surfaced
    # on the result screen.
    xp_gained: int = 0
    # What this activity qualified as — one of `unqualified_for_rewards`,
    # `qualified_for_rewards_only`, `qualified_for_claim` or `shadow_flagged`.
    # The client must not re-derive this from distance and duration: the rules
    # live on the server and only the server knows all of them.
    tier: str = "qualified_for_claim"
    # A plain sentence for whichever bar was missed. Distinguishes "you earned
    # nothing" from "you earned rewards but cannot take ground" — a result
    # screen that silently pays nothing reads as a bug.
    qualification_reason: Optional[str] = None
    claim_eligible: bool = True
    # "verified" | "pending". A neutral status the runner can be shown for a
    # run whose public contribution is being withheld. It names no detector, no
    # threshold and no evidence — a flag that explains itself is a tutorial for
    # beating it — but it stops a silently-inert run reading as a broken server.
    verification_state: str = "verified"
    # Kept so older clients keep working; same value as
    # `qualification_reason`.
    gate_reason: Optional[str] = None
    # What the run actually paid, after the daily caps. `*_capped` means the
    # run earned more than the day had left, so the screen can say so rather
    # than looking broken.
    coins_gained: int = 0
    energy_gained: int = 0
    coins_capped: bool = False
    energy_capped: bool = False
    # True when this response is a replay of an already-finished run rather
    # than a fresh calculation. Nothing was paid a second time.
    replayed: bool = False

    def model_post_init(self, __context) -> None:  # pydantic v2 hook
        # One source of truth, two names on the wire.
        if self.gate_reason is None:
            object.__setattr__(self, "gate_reason", self.qualification_reason)


class PrivacyZone(BaseModel):
    """A circle the runner has drawn around somewhere they live or work.

    Any part of a route inside one is never published. The radius is clamped
    server-side: below ~100 m a circle round a house still says which house,
    and above the cap it stops being privacy and starts being a way to blank
    out a neighbourhood.
    """

    lat: float = Field(..., ge=-90.0, le=90.0)
    lon: float = Field(..., ge=-180.0, le=180.0)
    radius_m: float = 150.0
    label: str = ""


class PrivacyOut(BaseModel):
    # Metres cut from BOTH ends of a route before anyone else sees it.
    route_trim_m: float = 0.0
    # Hours a finished route is withheld from others, so "who is running where
    # right now" is not a query anyone can make.
    publish_delay_h: float = 0.0
    zones: List[PrivacyZone] = []
    # The bounds the server will enforce, so the client builds its controls
    # from these rather than hardcoding numbers that can drift.
    min_zone_radius_m: float = 100.0
    max_zone_radius_m: float = 1000.0
    max_zones: int = 10
    # True when age floors are in force. The values above are then MINIMUMS the
    # account cannot go below, and the screen should say so rather than letting
    # someone drag a control that quietly snaps back.
    minor: bool = False


class PrivacyIn(BaseModel):
    """Every field optional — a PATCH-shaped PUT, so a client can change the
    trim without having to resend the whole zone list."""

    route_trim_m: Optional[float] = Field(None, ge=0.0, le=5000.0)
    publish_delay_h: Optional[float] = Field(None, ge=0.0, le=168.0)
    zones: Optional[List[PrivacyZone]] = None


class RunVisibilityIn(BaseModel):
    visibility: str


class AvatarIn(BaseModel):
    """The client's equipped cosmetics loadout (a flat dict of slot→id/index)."""
    avatar: dict


class DevCrossroadsSeedIn(BaseModel):
    """DEV harness: populate the caller's Crossroads with synthetic crossings.

    `avatars` are full equipped loadouts the client generated
    (config/cosmetics.randomEquipped), one per runner meant to stand in the
    plaza — sending them is what makes the seeded characters wear real
    cosmetics instead of the default look. `count` overrides how many runners
    to seed; it falls back to the number of avatars, then to a sensible default.
    """
    avatars: Optional[List[dict]] = None
    count: Optional[int] = None


class RunDaysOut(BaseModel):
    """ISO dates (YYYY-MM-DD) the user completed a run — the streak calendar."""
    days: List[str] = []


class PlacementRival(BaseModel):
    """A runner one candidate placement would land on."""

    user_id: str
    username: str
    avatar: Optional[dict] = None
    area_m2: float = 0.0
    # True when their land out-defends this claim: the ground shows in the
    # preview as contested, but it would be carved back out of the claim.
    defended: bool = False


class ClaimPlacement(BaseModel):
    """One way the run's earned land could be deployed: a position along the
    route, turned to a heading.

    Every placement covers the SAME area — the choice is where it lands and
    which way it faces, not how much. The breakdown below is what makes that
    choice legible: empty ground taken, rival ground taken, and ground already
    yours (which is reinforcement, not expansion).

    `index` addresses this entry in the flat list; `placement` and `rotation`
    are the two axes it sits on, and are what /claim-territory is sent."""

    index: int
    placement: int = 0
    rotation: int = 0
    # Centre of the covered stretch, as a fraction of the route. Only used for
    # drawing the handle in the right place along the trail.
    t: float
    # How far the claim is turned from the route's own orientation. 0 is the
    # shape exactly as it was run.
    rotation_deg: float = 0.0
    # Share of this candidate sitting on ground the runner actually covered
    # (within `claim_route_attachment_buffer_m` of the trail). Heading 0 is
    # always 1.0 — it IS the shape as run. Below
    # `claim_min_route_attachment` the move is closed off: rotation is a
    # tactical choice, not a licence to claim streets you never saw.
    route_attachment: float = 1.0
    ring: List[Tuple[float, float]] = []
    # The ground this claim COVERS — the same for every placement, because the
    # run earns one fixed amount of land.
    area_m2: float = 0.0
    # What would actually be held: `area_m2` minus the defended ground, which
    # gets carved back out of the claim. Lower than `area_m2` only where a
    # rival's defence beats this run's strength.
    held_m2: float = 0.0
    new_m2: float = 0.0        # nobody's ground
    enemy_m2: float = 0.0      # rival ground this claim would take
    defended_m2: float = 0.0   # rival ground that would hold
    mine_m2: float = 0.0       # your own land, reinforced
    ally_m2: float = 0.0       # clubmates' land — never stolen, stacks defence
    rivals: List[PlacementRival] = []
    # What this move IS — "empty", "reinforce", "attack" or "fortified" — and
    # what it costs. Price follows the action: expanding into nobody's ground
    # is cheap, storming a defended border is not.
    action: str = "empty"
    energy_cost: int = 0
    # The full price story, so the client never re-derives it: what the action
    # costs before discounts, what was taken off, and what the meter will read
    # afterwards. `available` is false when a rule blocks this specific move
    # (today's neutral expansions used up, not enough energy) and `reason`
    # says which — in the same words the claim itself would refuse with.
    base_energy_cost: int = 0
    applied_discounts: List[str] = []
    energy_before: int = 0
    energy_after: int = 0
    available: bool = True
    unavailable_reason: Optional[str] = None
    # What this move is expected to pay. Estimates: the server recomputes at
    # claim time and the client must reconcile against the claim response,
    # because a daily cap may have been consumed in between.
    expected_xp: int = 0
    expected_rank_points: int = 0


class ClaimOptionsOut(BaseModel):
    """The placement choice offered after a run.

    The run grows ONE shape — `base_ring`, the silhouette of the whole route at
    the earned area — and the runner moves it rigidly: its centre slides along
    `route`, and it turns to any angle about that centre. Both axes are
    CONTINUOUS, so `placements` below is not the set of choices; it is a coarse
    sample of them, there to seed the first breakdown and to back the
    one-tap recommendations. Anything between samples is drawn by the client
    (transform `base_ring` about `base_centre`) and priced by /claim-preview.

    `recommendations` are indices into `placements`. Any of them may be null
    when no sample serves that goal (no rivals nearby → no steal to
    recommend)."""

    run_id: str
    claim_area_m2: float = 0.0
    # The one shape this run claims, as it sits unturned with its centre at
    # the middle of the route, and the centre it turns about. The client
    # rotates the ring about this point and translates it along `route`; the
    # server does exactly the same thing from `t` and `rotation_deg`, so the
    # preview and the claim are the same polygon.
    base_ring: List[Tuple[float, float]] = []
    base_centre: Optional[Tuple[float, float]] = None
    # Where along `route` the initial pose sits. Its centre is the route point
    # at this fraction; dragging maps every other fraction the same literal
    # way, including around a closed lap.
    base_t: float = 0.5
    # The route `t` addresses, cleaned and simplified — NOT the raw GPS path
    # the client recorded. Sent because t must mean the same thing on both
    # sides: interpolating along a different polyline would put the client's
    # preview somewhere the claim does not land.
    route: List[Tuple[float, float]] = []
    # Superseded by the continuous model; always 1.0. Kept so an older client
    # that reads it to decide whether to show the position control still does.
    window_frac: float = 1.0
    # The grid `placements` is laid out on, position-major: entry (p, r) sits
    # at index p * rotation_count + r. Either being 1 means that axis offers no
    # choice and its control should be hidden.
    placement_count: int = 1
    rotation_count: int = 1
    placements: List[ClaimPlacement] = []
    default_index: int = 0
    most_land_index: Optional[int] = None
    biggest_steal_index: Optional[int] = None
    best_defence_index: Optional[int] = None
    # The meter, so the chooser can show the cost against the balance without
    # a second request — and say "you need 6 more" instead of just refusing.
    energy: int = 0
    energy_max: int = 0
    # The first claim of each day is half price. Worth saying out loud: it is
    # the difference between "I can do something with this run" and not.
    first_claim_of_day: bool = False
    # Neutral expansions left in the game day. Attacks and reinforcement stay
    # available at zero — the limit rations painting the map, not playing.
    neutral_claims_remaining: int = 0
    # The floor a candidate's `route_attachment` must clear to be claimable.
    # Sent so the client can close those stops on its rotation rail by
    # comparing numbers, rather than by hardcoding the threshold or by matching
    # on the wording of a refusal message.
    min_route_attachment: float = 0.0
    # The rank tier this claim FIGHTS ON (0=Wood … 9=Mythic). Combat is scoped
    # to one tier, so a runner can only take ground off holders in this band —
    # everyone else's land is invisible to the claim. Sent so the placement map
    # can be drawn from the same board (`/map-polygons?rank=`) the breakdown is
    # computed against. Without it the map painted every tier at once while the
    # numbers counted one, and a circle sitting on six plots reported one rival.
    rank_tier: int = 0
    # What the run qualified as, repeated here so a client that only fetches
    # options still knows why it may not be able to claim.
    tier: str = "qualified_for_claim"
    qualification_reason: Optional[str] = None
    claim_eligible: bool = True


class ClaimPose(BaseModel):
    """Where the run's one claim shape is put: a point on the route and an
    angle. Both continuous — the runner drags and turns freely, so there is no
    grid to index into.

    This is safe to take from the client precisely because it is not geometry.
    The SHAPE is grown server-side from the stored route and can only be moved
    rigidly, `t` is clamped to the route's own length, and the shape's centre
    is placed ON the route at `t` — so no pair of numbers here can describe a
    claim anywhere but along the run that earned it, at the size it earned.
    """

    # Position along the route, 0 = start, 1 = finish. The claim's CENTRE goes
    # here; the shape itself naturally overhangs at the extremes.
    t: float = Field(0.5, ge=0.0, le=1.0)
    # Heading, degrees anticlockwise from the shape as it was run. Any angle:
    # a full turn about a centre that is on the route is still on the route.
    rotation_deg: float = Field(0.0, ge=-360.0, le=360.0)


class ClaimIn(BaseModel):
    """Place the run's claim.

    The territory is GROWN around the route itself, so the shape is never sent
    by the client — only its POSE. `t` (where along the route its centre sits)
    and `rotation_deg` (which way it faces) are continuous; the server rebuilds
    the shape from the stored route and moves it rigidly to that pose, so a
    claim can only ever be built from the run that earned it.

    `placement` and `rotation` are the superseded grid indices. They are still
    accepted so a client built against the old grid keeps working: when `t` is
    absent they are converted back to a pose. New clients send the pose and
    leave these null.

    (lat, lon) is only the fallback centre for a run whose trail can't carry a
    shape at all; the server uses the route's own midpoint when they don't."""
    run_id: str
    t: Optional[float] = Field(None, ge=0.0, le=1.0)
    rotation_deg: Optional[float] = Field(None, ge=-360.0, le=360.0)
    placement: Optional[int] = Field(None, ge=0, le=63)
    rotation: Optional[int] = Field(None, ge=0, le=63)
    lat: Optional[float] = Field(None, ge=-90.0, le=90.0)
    lon: Optional[float] = Field(None, ge=-180.0, le=180.0)


class ClaimPreviewIn(ClaimPose):
    """Ask what a pose would take, without taking it.

    The chooser needs this because the pose is continuous: there is no
    precomputed cell to read the breakdown out of once the runner has dragged
    the claim somewhere between two of them. The client transforms the ring
    locally for the picture and asks this for the numbers, debounced."""

    run_id: str


class ClaimVictim(BaseModel):
    """A runner this claim landed on — the faces on the payoff screen.

    `defended = True` means their land held (nothing was taken); `reclaimed`
    means they had taken land off the claimer before, which is what earns the
    "you took it back" framing.
    """

    user_id: str
    username: str
    avatar: Optional[dict] = None
    # Territorial rank — what the portrait's frame is drawn from.
    rank_key: str = "wood"
    clan_color: Optional[ClanColor] = None
    area_m2: float = 0.0
    defended: bool = False
    reclaimed: bool = False


class ClaimOut(BaseModel):
    # `territory` is what the runner HOLDS after this claim — the merged row,
    # which where a claim lands on their own land includes ground they have
    # been sitting on for weeks. That is the right thing to draw as their
    # territory and the wrong thing to celebrate as this run's take, so the
    # five fields under it say what this claim itself did.
    territory: TerritoryOut
    # The ground the claim covers once defended land is carved out of it.
    claimed_m2: float = 0.0
    # Of that, the part that was NOT already theirs: the borders that actually
    # moved. This is the number the result screen leads with.
    gained_m2: float = 0.0
    # And the part that was. Re-running your own block reinforces it — it
    # stacks strength and buys lifetime — but it wins no new ground.
    reinforced_m2: float = 0.0
    # Rings of the claim and of the gained part, so the reveal can animate the
    # ground that changed hands instead of the whole merged holding.
    claim_rings: List[List[Tuple[float, float]]] = []
    gained_rings: List[List[Tuple[float, float]]] = []
    stolen_m2: float = 0.0
    stolen_from: Optional[str] = None
    # Everyone this claim touched, biggest loss first. `stolen_from` is just
    # the top name — this is the whole story the result screen tells.
    victims: List[ClaimVictim] = []
    # XP awarded for placing this claim (base + area-scaled + steal), so the
    # result screen can show the reward the moment the claim lands.
    xp_gained: int = 0
    # Level state AFTER the claim, so the payoff can fill the XP bar (and
    # celebrate a level-up) without a second round trip.
    level: int = 0
    xp: int = 0
    next_level_xp: int = 100
    leveled_up: bool = False
    # Energy left after the claim's cost was deducted (claims are energy-gated).
    energy: int = 0
    energy_max: int = 0
    # What the move turned out to be and what it actually cost — the client
    # previewed these from /claim-options, and must reconcile against these
    # rather than trusting its own preview.
    action: str = "empty"
    energy_cost: int = 0
    # Neutral expansions left in the game day AFTER this claim.
    neutral_claims_remaining: int = 0
    # Rated result after this claim. Neutral/reinforcement claims leave both
    # deltas at zero; club values are null when the runner has no club.
    solo_elo: int = 1000
    solo_elo_delta: int = 0
    club_elo: Optional[int] = None
    club_elo_delta: int = 0
    # PROMOTION, decided here rather than on the device.
    #
    # The client could compare the tier before and after itself, but only by
    # keeping its own copy of the tier thresholds — and the moment those two
    # copies disagree the app either celebrates a promotion that did not happen
    # or, worse, stays silent through one that did. The server owns the ladder,
    # so it owns the answer.
    #
    # Both keys are always populated (they are equal on the ordinary claim that
    # changes nothing); `rank_up` is the flag the ceremony is gated on.
    rank_up: bool = False
    # DEMOTION, the same answer the other way round. A failed claim costs rank
    # points, and one that crosses a floor drops a tier; the client gates its
    # demotion screen on this flag for the same reason it gates on `rank_up`.
    rank_down: bool = False
    rank_key_before: str = "wood"
    rank_key_after: str = "wood"


class LeaderboardEntry(BaseModel):
    user_id: str
    username: str
    total_area_m2: float
    territory_count: int
    clan_tag: Optional[str] = None
    clan_color: Optional[ClanColor] = None
    # Populated on both boards now. The rank board ORDERS by this;
    # the land board orders by area and carries it as context, so a
    # row can show the same badge every other player surface shows.
    rank_points: Optional[int] = None
    rank_key: Optional[str] = None
    rank_label: Optional[str] = None
    # Explicit names for the new rating system. rank_* remains populated as a
    # compatibility alias for builds that shipped before Elo.
    solo_elo: int = 1000
    elo_matches: int = 0
    elo_wins: int = 0
    elo_losses: int = 0
    elo_draws: int = 0


class RunInsightsPro(BaseModel):
    """The rabbit hole under a finished run. PASER PRO only.

    Every field is a READ of runs, territories and the rivalry ledger. None of
    it changes what the runner can do next; it tells them what they just did
    and how it compares to what they usually do.
    """

    # Land of yours that is about to decay, and when the first of it goes.
    # The one genuinely actionable thing here, and deliberately not framed as
    # "under attack" — expiry is a fact, threat would be a guess.
    at_risk_m2: float = 0
    at_risk_count: int = 0
    soonest_expiry_at: Optional[UtcDatetime] = None

    # What the run was WORTH per kilometre, against the runner's own recent
    # form. The comparison is what makes the number mean anything.
    m2_per_km: Optional[float] = None
    m2_per_km_30d: Optional[float] = None

    # Recent output, for the same reason.
    claims_30d: int = 0
    stolen_m2_30d: float = 0
    distance_m_30d: float = 0

    # The biggest territory this runner has ever produced from one claim, and
    # whether this run beat it.
    best_territory_m2: Optional[float] = None
    is_personal_best: bool = False


class RunInsights(BaseModel):
    """What a run actually achieved, shown the moment it lands.

    The FREE half is the accomplishment: what was taken, from whom, how much.
    A runner never has to pay to find out what they just did, or where they
    stand — `standing_rank` comes from the same never-gated source as
    /leaderboard/standing. `pro` is the analysis of it, and is None otherwise.
    """

    run_id: str
    distance_m: float = 0
    duration_s: float = 0

    # This claim, exactly — the ground the claim COVERS, not the merged
    # territory it joined, which for a claim placed on the runner's own land
    # includes weeks of ground this run had nothing to do with.
    territory_m2: float = 0
    # And how much of that cover was NEW: the borders that actually moved.
    # NULL for runs claimed before this was measured — an honest gap rather
    # than a number quietly meaning something else.
    land_gained_m2: Optional[float] = None
    stolen_m2: float = 0
    rivals_taken: int = 0
    rivals_held: int = 0
    biggest_capture_m2: float = 0

    # Where the runner stands on the land board right now. Never gated.
    standing_rank: Optional[int] = None
    standing_field: int = 0

    pro: Optional[RunInsightsPro] = None


class LeaderboardStanding(BaseModel):
    """Where one runner stands on one board. Never gated — see routes/leaderboard.py.

    `rank` is None when the runner has not scored on this board at all, which
    is a real answer rather than a missing one: nothing done yet, and here is
    how big the field is if they start.
    """

    user_id: str
    username: str
    category: str
    window: str
    filter: str
    rank: Optional[int] = None
    field_size: int = 0
    value: float = 0


class SeasonLeaderboardEntry(BaseModel):
    """One row on a season board.

    Club and solo boards share the same metric fields so clients can switch
    categories without maintaining two subtly different value models.  The
    identity fields are populated for the selected scope.
    """

    user_id: Optional[str] = None
    username: Optional[str] = None
    # The runner's equipped cosmetics, so a solo row draws their character
    # portrait rather than two initials in a disc (null → the client falls
    # back to initials). Club rows carry a club badge instead and leave both
    # of these unset.
    avatar: Optional[dict] = None
    # Their territorial rank — the portrait's frame is drawn from it. Ships
    # with every avatar so a portrait is never shown without its border.
    rank_key: Optional[str] = None
    clan_id: Optional[str] = None
    name: Optional[str] = None
    tag: Optional[str] = None
    color: Optional[ClanColor] = None
    badge_icon: Optional[str] = None
    photo_url: Optional[str] = None
    league: Optional[str] = None
    member_count: int = 0
    total_area_m2: float = 0.0
    territory_count: int = 0
    claim_count: int = 0
    capture_count: int = 0
    defense_count: int = 0
    distance_m: float = 0.0


class MapPolygonsOut(BaseModel):
    territories: List[TerritoryOut]


# ---- feed + profile stats (Phase 4) --------------------------------------

class RunReaction(BaseModel):
    """One emote on a run, and how many people left it.

    `mine` saves the client a lookup: a card has to draw the viewer's own
    choice differently from everybody else's, and it should not have to scan
    the list for its own id to find out which one that is.
    """
    emote: str
    count: int = 0
    mine: bool = False


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
    created_at: UtcDatetime
    clan_tag: Optional[str] = None
    clan_color: Optional[ClanColor] = None
    kudos_count: int = 0
    kudoed: bool = False
    comment_count: int = 0
    # The author's equipped cosmetics, so their character portrait renders on
    # the card (null → the client falls back to initials).
    avatar: Optional[dict] = None
    # Their territorial rank — the portrait's frame is drawn from it. Ships
    # with every avatar so a portrait is never shown without its border.
    rank_key: str = "wood"
    # Simplified geometry for the card thumbnail: the claimed land (rings) and
    # the run trail (path). Both [lon, lat]; either may be empty.
    rings: List[List[Tuple[float, float]]] = []
    path: List[Tuple[float, float]] = []
    # Who this run took land from, and how much in total. The card plays the
    # steal out — the blast and their faces — so the moment lives in the feed
    # and not only on the claimer's own result screen. Successful takes only;
    # bounced attacks are the defender's story, not the feed's.
    victims: List[ClaimVictim] = []
    stolen_m2: float = 0.0
    # Emote reactions, folded to the distinct emotes with counts. Empty for a
    # run nobody has reacted to, which is the common case and costs nothing.
    reactions: List["RunReaction"] = []
    my_reaction: Optional[str] = None
    caption: Optional[str] = None
    media: List[str] = []


class FeedOut(BaseModel):
    items: List[FeedItem]
    next_cursor: Optional[UtcDatetime] = None


class MeStats(BaseModel):
    total_area_m2: float
    territory_count: int
    biggest_claim_m2: float
    runs_count: int
    career_distance_m: float
    current_streak_weeks: int
    current_streak_days: int = 0
    # XP / level (level = floor(sqrt(xp/100)); next level at 100*(lvl+1)^2)
    xp: int = 0
    level: int = 0
    next_level_xp: int = 100
    # Rank — territorial standing, and what the portrait border is drawn from.
    # Separate ladder to XP: points come from claiming/stealing/defending only,
    # and decay with inactivity. `rank_best` is the high-water mark.
    rank_points: int = 0
    rank_key: str = "wood"
    rank_label: str = "Wood"
    rank_next_points: Optional[int] = None
    rank_progress: float = 0.0
    rank_best_key: str = "wood"
    solo_elo: int = 1000
    solo_elo_peak: int = 1000
    solo_elo_matches: int = 0
    solo_elo_wins: int = 0
    solo_elo_losses: int = 0
    solo_elo_draws: int = 0
    solo_elo_next: Optional[int] = None
    solo_elo_next_label: Optional[str] = None
    solo_elo_points_to_next: int = 0


class NotificationItem(BaseModel):
    id: str
    category: str
    title: str
    body: str
    read: bool
    created_at: UtcDatetime
    # Whoever caused this — their portrait is what the row leads with. Null on
    # system notices (season, weekly recap) that nobody sent.
    actor_id: Optional[str] = None
    actor_username: Optional[str] = None
    actor_avatar: Optional[dict] = None
    actor_rank_key: str = "wood"
    actor_clan_color: Optional[ClanColor] = None
    # Event-specific context. Capture notices carry capture_id, taken_m2 and
    # the affected map point so the foreground client can animate and deep-link
    # without parsing human copy.
    data: dict = Field(default_factory=dict)


class NotificationsOut(BaseModel):
    items: List[NotificationItem]
    unread: int = 0


class RunSummary(BaseModel):
    run_id: str
    distance_m: float
    duration_s: float
    area_m2: float
    closed_loop: bool
    created_at: UtcDatetime
    caption: Optional[str] = None
    media: List[str] = []


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
    created_at: UtcDatetime
    clan_tag: Optional[str] = None
    clan_color: Optional[ClanColor] = None
    path: List[Tuple[float, float]] = []      # [lon, lat]
    territory_rings: List[List[Tuple[float, float]]] = []
    splits: List[RunSplit] = []
    kudos_count: int = 0
    kudoed: bool = False
    comment_count: int = 0
    reactions: List[RunReaction] = []
    my_reaction: Optional[str] = None
    caption: Optional[str] = None
    media: List[str] = []


class RunPostIn(BaseModel):
    caption: Optional[str] = Field(None, max_length=280)
    media: List[str] = Field(default_factory=list, max_length=4)

    @field_validator("caption")
    @classmethod
    def _clean_caption(cls, value):
        cleaned = (value or "").strip()
        return cleaned or None

    @field_validator("media")
    @classmethod
    def _validate_media(cls, values):
        out = []
        for value in values:
            if not isinstance(value, str):
                raise ValueError("post photos must be JPEG, PNG, or WebP images")
            # A photo already on the post comes back as its own URL, meaning
            # "keep it"; the route resolves it against what is stored.
            if value.startswith("/runs/"):
                out.append(value)
                continue
            if not value.startswith(
                ("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")
            ):
                raise ValueError("post photos must be JPEG, PNG, or WebP images")
            # About 2.25 MB decoded. Four compressed phone images stay useful
            # in the feed without allowing an unbounded JSON request/database row.
            if len(value) > 3_000_000:
                raise ValueError("each post photo must be smaller than 2.25 MB")
            out.append(value)
        return out


class RunPostOut(BaseModel):
    run_id: str
    caption: Optional[str] = None
    media: List[str] = []


# ---- run comments + club chat ---------------------------------------------

class RunCommentIn(BaseModel):
    """Discussion is text-only; emoji belong to the run reaction endpoint."""
    body: str = Field(..., min_length=1, max_length=280)

    @field_validator("body")
    @classmethod
    def _strip_and_require_text(cls, v):
        v = v.strip()
        if not v:
            raise ValueError("a comment needs text")
        return v


class RunReactionIn(BaseModel):
    """The emote to leave on a run, or null to take yours back off."""
    emote: Optional[str] = None


class RunReactionsOut(BaseModel):
    reactions: List[RunReaction] = []
    my_reaction: Optional[str] = None


class RunCommentOut(BaseModel):
    id: str
    user_id: str
    username: str
    is_you: bool = False
    body: str
    created_at: UtcDatetime


class ClanMessageIn(BaseModel):
    body: str = Field(..., min_length=1, max_length=500)


class ClanMessageOut(BaseModel):
    id: str
    user_id: Optional[str] = None
    username: str
    is_you: bool = False
    body: str
    created_at: UtcDatetime


class PushTokenIn(BaseModel):
    token: str
    platform: Optional[str] = None


class NotifPrefs(BaseModel):
    stolen: bool = True
    defended: bool = True
    captured: bool = True
    reminder: bool = True
    clan_goal: bool = True
    kudos: bool = True
    season: bool = True
    recap: bool = True
    pasers: bool = True
    paserby: bool = True


# ---------------------------------------------------------------------------
# PASERBY — crossed paths (migration 0024)
# ---------------------------------------------------------------------------
#
# WHAT IS NOT IN THIS SECTION IS THE POINT. There is no latitude, no longitude,
# no crossing time, no encounter timestamp, no run id and no distance on any of
# these models — an encounter is a person, a character, and a broad phrase. See
# app/paserby.py for the rules these shapes exist to keep.


class PaserbyEncounter(BaseModel):
    """One crossing, as the viewer sees it."""

    id: str
    user_id: str
    username: str
    avatar: Optional[dict] = None
    level: int = 0
    # Territorial rank — what the portrait's frame is drawn from.
    rank_key: str = "wood"
    clan_tag: Optional[str] = None
    clan_name: Optional[str] = None
    clan_color: Optional[ClanColor] = None
    # The ONLY temporal field, and deliberately a phrase: "Earlier today",
    # "Yesterday", "This week". Never a time, never a date.
    when: str = "Recently"
    times_crossed: int = 1
    # Familiar faces — labels only (crossed_paths / familiar_face /
    # running_regular / local_legend), derived from `times_crossed`.
    familiarity: str = "crossed_paths"
    familiarity_label: str = "Crossed Paths"
    seen: bool = False
    high_fived: bool = False          # the viewer has sent one
    high_five_received: bool = False  # the other runner sent one


class PaserbyEncountersOut(BaseModel):
    encounters: List[PaserbyEncounter] = []
    unseen: int = 0
    total: int = 0
    enabled: bool = True


class PaserbyRevealOut(BaseModel):
    """The post-run beat: up to `cast` characters, and how many are left over.

    `more_at_crossroads` is what the "+4 more at the Crossroads" line reads
    from, so the client never has to work it out from two counts.
    """

    encounters: List[PaserbyEncounter] = []
    new_count: int = 0
    more_at_crossroads: int = 0


class PaserbySettingsIn(BaseModel):
    enabled: bool


class PaserbySummary(BaseModel):
    """What the Home badge needs, in one small response."""

    enabled: bool = True
    unseen: int = 0
    total: int = 0


class PaserbySeenIn(BaseModel):
    # Omitted / empty = mark everything seen.
    ids: List[str] = []


class HighFiveOut(BaseModel):
    high_fived: bool = True
    # Already sent — the button was pressed twice, and the second press pays
    # nothing rather than erroring.
    already: bool = False
    xp_gained: int = 0
    # True when the day's social XP ceiling swallowed the reward. The high five
    # still landed.
    capped: bool = False


class BlockIn(BaseModel):
    user_id: str


class ReportIn(BaseModel):
    user_id: str
    reason: str = Field(..., min_length=2, max_length=64)
    detail: Optional[str] = Field(None, max_length=500)
    # Optional context so moderation knows which surface it came from.
    encounter_id: Optional[str] = None


# ---- pasers ---------------------------------------------------------------

# How the viewer relates to another runner. Drives which button the client
# shows, so every user-facing endpoint that names a runner returns one.
#   none      — no link; offer "Add paser"
#   pending_out — viewer asked, waiting on them; offer "Requested" (cancel)
#   pending_in  — they asked the viewer; offer "Accept" / "Decline"
#   paser     — accepted both ways; offer "Remove"
#   self      — the viewer
PaserState = Literal["none", "pending_out", "pending_in", "paser", "self"]


class RunnerCard(BaseModel):
    """A runner as they appear in a list — search results, pasers, requests."""

    user_id: str
    username: str
    avatar: Optional[dict] = None
    # Territorial rank — what the portrait's frame is drawn from.
    rank_key: str = "wood"
    clan_tag: Optional[str] = None
    clan_color: Optional[ClanColor] = None
    level: int = 0
    state: PaserState = "none"
    # Only set on rows that came from a request, so the client can act on it.
    request_id: Optional[str] = None


# ---------------------------------------------------------------------------
# Rivalries — head-to-head land history between two runners (migration 0016).
# ---------------------------------------------------------------------------

# What happened, from the VIEWER's side. `they_took` / `you_took` are
# successful steals; `you_held` / `they_held` are attacks that bounced off the
# defender's strength.
RivalEventKind = Literal["you_took", "they_took", "you_held", "they_held"]


class RivalEvent(BaseModel):
    kind: RivalEventKind
    area_m2: float
    lat: Optional[float] = None
    lon: Optional[float] = None
    at: UtcDatetime


class RivalCard(BaseModel):
    """One rivalry, always phrased from the requesting runner's side."""

    user_id: str
    username: str
    avatar: Optional[dict] = None
    # Territorial rank — what the portrait's frame is drawn from.
    rank_key: str = "wood"
    clan_tag: Optional[str] = None
    clan_color: Optional[ClanColor] = None
    level: int = 0

    # Career totals of land moved between the two, in m².
    you_took_m2: float = 0
    they_took_m2: float = 0
    # you_took - they_took. Positive = you're up on them.
    net_m2: float = 0

    # Event counts, for the "4 times" line under each bar.
    you_took_times: int = 0
    they_took_times: int = 0
    you_held_times: int = 0

    # Their land right now (m²) — the "3.8 km² vs 4.1 km²" comparison.
    your_land_m2: float = 0
    their_land_m2: float = 0

    last_event: Optional[RivalEvent] = None


class RivalsOut(BaseModel):
    rivals: List[RivalCard]


class RivalAnalytics(BaseModel):
    """The PASER PRO half of a rivalry: the same beats, read properly.

    Every number here is a READ of the rivalry ledger and the runs table.
    Nothing in it changes what either runner can do, and it is deliberately
    symmetrical — a subscriber learns nothing about their rival that the rival
    could not learn about them by subscribing too. Knowledge, not advantage.
    """

    # The whole history, both directions.
    total_beats: int = 0
    first_met: Optional[UtcDatetime] = None

    # Attacks that came to nothing, as a share of attacks faced. The honest
    # measure of a wall: a raw "held 4 times" flatters whoever is attacked most.
    your_defence_rate: Optional[float] = None
    their_defence_rate: Optional[float] = None

    # Consecutive takes in one runner's favour, counted back from the most
    # recent. Positive is your way, negative is theirs.
    streak: int = 0

    # Rolling 30 days, so the comparison is current form rather than career.
    your_distance_m_30d: float = 0
    their_distance_m_30d: float = 0
    your_beats_30d: int = 0
    their_beats_30d: int = 0

    # Where the rivalry actually happens: the centre of the contested ground,
    # and how many beats have landed near it.
    battleground_lat: Optional[float] = None
    battleground_lon: Optional[float] = None
    battleground_beats: int = 0


class RivalDetail(BaseModel):
    rival: RivalCard
    events: List[RivalEvent]
    # PRO only, None for everyone else — who still get the entire rivalry
    # above. The rivalry is the game; this is the analysis of it.
    analytics: Optional[RivalAnalytics] = None


class PaserRequestIn(BaseModel):
    user_id: str


class PaserListOut(BaseModel):
    pasers: List[RunnerCard]
    incoming: List[RunnerCard]
    outgoing: List[RunnerCard]


class RunnerProfile(BaseModel):
    """Another runner's public profile — the tap-through from a paser row."""

    user_id: str
    username: str
    avatar: Optional[dict] = None
    # Territorial rank — what the portrait's frame is drawn from.
    rank_key: str = "wood"
    solo_elo: int = 1000
    solo_elo_label: str = "Wood"
    clan_tag: Optional[str] = None
    clan_name: Optional[str] = None
    clan_color: Optional[ClanColor] = None
    state: PaserState = "none"
    # Set when state is pending_in/pending_out, so the profile can accept or
    # decline without a second round trip to find the link.
    request_id: Optional[str] = None
    paser_count: int = 0
    level: int = 0
    xp: int = 0
    total_area_m2: float = 0
    territory_count: int = 0
    biggest_claim_m2: float = 0
    runs_count: int = 0
    career_distance_m: float = 0
    current_streak_days: int = 0
    recent_runs: List[RunSummary] = []


# ---- clans (Phase 5) ------------------------------------------------------

def _validate_club_photo(value):
    """A club photo is a data URI, the same shape run post media uses.

    Empty means "no photo" on the way in and clears an existing one on a
    patch. The cap only has to bound the request: the server crops and
    downscales what it stores, so the phone can send its own idea of a photo.
    """
    if value is None:
        return None
    if not isinstance(value, str):
        raise ValueError("club photo must be an image")
    value = value.strip()
    if not value:
        return ""
    if not value.startswith(
        ("data:image/jpeg;base64,", "data:image/png;base64,", "data:image/webp;base64,")
    ):
        raise ValueError("the club photo must be a JPEG, PNG, or WebP image")
    # About 2.25 MB decoded, the same ceiling a run post photo has.
    if len(value) > 3_000_000:
        raise ValueError("the club photo must be smaller than 2.25 MB")
    return value


class ClanCreate(BaseModel):
    name: str = Field(..., min_length=3, max_length=24)
    tag: str = Field(..., min_length=2, max_length=5)
    description: Optional[str] = Field(None, max_length=140)
    color_key: str
    # Clubs are made with a photo now; the icon is only the fallback crest a
    # club without one is drawn with, so clients no longer have to send it.
    badge_icon: str = "shield"
    photo: Optional[str] = None
    privacy: str = "open"  # 'open' | 'invite_only'

    @field_validator("photo")
    @classmethod
    def _check_photo(cls, value):
        return _validate_club_photo(value)


class ClanUpdate(BaseModel):
    description: Optional[str] = Field(None, max_length=140)
    color_key: Optional[str] = None
    badge_icon: Optional[str] = None
    # None leaves the photo alone; "" removes it.
    photo: Optional[str] = None
    privacy: Optional[str] = None

    @field_validator("photo")
    @classmethod
    def _check_photo(cls, value):
        return _validate_club_photo(value)


class ClanMemberOut(BaseModel):
    user_id: str
    username: str
    role: str
    joined_at: UtcDatetime
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
    photo_url: Optional[str] = None
    privacy: str
    member_cap: int
    member_count: int
    created_by: Optional[str] = None
    created_at: UtcDatetime
    my_role: Optional[str] = None          # role of the requesting user, if a member
    league: Optional[str] = None
    season_area_m2: float = 0.0
    season_rank: Optional[int] = None
    members: List[ClanMemberOut] = []
    week_goal: Optional[WeekGoalOut] = None
    xp: int = 0                            # collective club XP (all members' earned XP)
    elo_rating: int = 1000
    elo_peak: int = 1000
    elo_matches: int = 0
    elo_wins: int = 0
    elo_losses: int = 0
    elo_draws: int = 0
    elo_key: str = "wood"
    elo_label: str = "Wood"
    elo_next_rating: Optional[int] = None
    elo_next_label: Optional[str] = None
    elo_points_to_next: int = 0
    elo_progress: float = 0.0


class ClanSummary(BaseModel):
    """Compact clan for search results / directory."""
    id: str
    name: str
    tag: str
    color: ClanColor
    badge_icon: str
    photo_url: Optional[str] = None
    privacy: str
    member_count: int
    league: Optional[str] = None
    season_area_m2: float = 0.0


class ClanInviteOut(BaseModel):
    code: str
    expires_at: Optional[UtcDatetime] = None
    max_uses: int
    uses: int
    url: str


class ClanLeaderboardEntry(BaseModel):
    clan_id: str
    name: str
    tag: str
    color: ClanColor
    badge_icon: str = "shield"
    photo_url: Optional[str] = None
    league: Optional[str] = None
    total_area_m2: float
    member_count: int
    elo_rating: int = 1000
    elo_matches: int = 0
    elo_wins: int = 0
    elo_losses: int = 0
    elo_draws: int = 0
    elo_key: str = "wood"
    elo_label: str = "Wood"
    elo_next_rating: Optional[int] = None
    elo_progress: float = 0.0


class MyClan(BaseModel):
    """The signed-in user's clan membership (drives the app accent)."""
    clan_id: Optional[str] = None
    tag: Optional[str] = None
    role: Optional[str] = None
    color: Optional[ClanColor] = None
    # The club's own standing, so the map can open the club board on the tier
    # this runner's club actually sits in rather than on every club at once.
    # Null when they are in no club, which is what puts that board on Wood.
    rank_key: Optional[str] = None
    rank_tier: Optional[int] = None
    rank_label: Optional[str] = None
    rank_points: Optional[int] = None
