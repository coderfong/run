"""What a landed claim does to everybody it touched.

Shared by the human `/claim-territory` endpoint and the seeded-world bot runs
(bot_activity.py), so a steal means exactly the same thing whoever made it:
the same rivalry ledger row, the same rank points both ways, the same Elo
match, and the same alert to a real victim. The two used to carry their own
copies of this block and had already drifted — a bot never told a human that
their defence held, and never earned the open-ground Elo a human does.

`_claim_territory` (app/routes/runs.py) decides the fight; this module only
records its consequences. Caller commits, and sends the notifications only
after that commit.
"""

from __future__ import annotations

from sqlalchemy import text

from . import economy, elo, ranks

# A steal smaller than this is a clipped polygon edge, not a rivalry beat.
# Defined here rather than in routes/runs.py so both claim paths can read it
# without importing the web layer into the simulation (runs.py re-exports it).
STEAL_LEDGER_MIN_M2 = 25.0


def counted(steal_events):
    """The events that are big enough to be a fight."""
    return [ev for ev in steal_events if ev["area_m2"] >= STEAL_LEDGER_MIN_M2]


def settle(
    db,
    *,
    user_id,
    run_id,
    action: str,
    steal_events,
    ground: dict,
    stolen_m2: float,
    rank_tier: int,
    club_id,
    centre,
) -> dict:
    """Ledger, legacy rank points and Elo for one landed claim.

    Returns the Elo result plus the tier either side of it, which the human
    payoff screen reports. Caller commits.
    """
    # Rivalry ledger (migration 0016) — one row per victim, takes AND bounced
    # attacks. There is no placed centre any more, so a steal is pinned to the
    # middle of the claim.
    for ev in counted(steal_events):
        db.execute(
            text(
                """
                INSERT INTO territory_steals
                    (attacker_id, victim_id, run_id, area_m2, defended, lat, lon)
                VALUES (:a, :v, :r, :area, :defended, :lat, :lon)
                """
            ),
            {
                "a": user_id, "v": ev["victim_id"], "r": run_id,
                "area": ev["area_m2"], "defended": ev["defended"],
                "lat": centre.y, "lon": centre.x,
            },
        )

    # Legacy rank points. The flat per-claim award is rationed daily: it is the
    # one territorial reward a player can repeat at will. Taking and defending
    # ground are contested outcomes and stay uncapped.
    claim_points = ranks.POINTS_CLAIM
    if action == economy.ACTION_EMPTY:
        claim_points = min(claim_points, economy.neutral_rank_allowance(db, user_id))
        if claim_points > 0:
            economy.claim_grant(db, user_id, run_id, economy.KIND_NEUTRAL_RANK, claim_points)
    if claim_points > 0:
        ranks.award(db, user_id, claim_points, "claim")
    # Both sides of every event are in `rank_tier`'s bracket by construction
    # (combat is rank-scoped), so it alone picks the tier-scaled rate.
    for ev in counted(steal_events):
        if ev["defended"]:
            ranks.award(db, ev["victim_id"], ranks.defend_reward(rank_tier), "defend")
        else:
            ranks.award(db, user_id, ranks.steal_reward(rank_tier), "steal")
            ranks.award(db, ev["victim_id"], ranks.loss_penalty(rank_tier), "lost_ground")

    # One weighted solo encounter per rival, plus one per opposing club, then
    # the small reward for painting ground nobody held.
    elo_result = elo.record_claim_matches(
        db, user_id, run_id, steal_events, attacker_clan_id=club_id,
        club_match=bool(club_id),
    )
    open_area = max(0.0, float(ground.get("gained_m2", 0.0)) - float(stolen_m2 or 0.0))
    open_points = elo.open_claim_reward(open_area)
    if open_points:
        elo_result["solo_rating"] = elo.apply_land_delta(db, user_id, open_points)
        elo_result["solo_delta"] += open_points
    rank_after = elo.tier_for_rating(elo_result["solo_rating"])
    rank_before = elo.tier_for_rating(elo_result["solo_rating"] - elo_result["solo_delta"])
    return {"elo": elo_result, "rank_before": rank_before, "rank_after": rank_after}


def victim_notifications(
    steal_events,
    *,
    run_id,
    attacker_id,
    attacker_username: str,
    attacker_avatar,
    territory_id,
    territory_ring,
    centre,
) -> list[tuple]:
    """`notify(*args)` argument tuples for every victim of this claim: one
    "stolen" per runner who lost ground, one "defended" per runner whose land
    held. Aggregated per person, because a claim can cut several rows of one
    owner's land."""
    taken: dict[str, float] = {}
    held: dict[str, float] = {}
    for ev in counted(steal_events):
        bucket = held if ev["defended"] else taken
        vid = str(ev["victim_id"])
        bucket[vid] = bucket.get(vid, 0.0) + float(ev["area_m2"])

    out = []
    for victim_id, taken_m2 in taken.items():
        out.append((
            [victim_id], "stolen", "Your land was captured",
            f"{attacker_username} took {taken_m2 / 1_000_000:.3f} km² of your territory.",
            {
                "kind": "territory_captured",
                "screen": "map",
                "capture_id": f"{run_id}:{victim_id}",
                "taken_m2": taken_m2,
                "lat": centre.y,
                "lon": centre.x,
                "attacker_id": str(attacker_id),
                "attacker_username": attacker_username,
                "attacker_avatar": attacker_avatar or {},
                "territory_id": str(territory_id) if territory_id else None,
                **({"territory_ring": territory_ring} if territory_ring else {}),
            },
            str(attacker_id),
        ))
    for victim_id, defended_m2 in held.items():
        out.append((
            [victim_id], "defended", "Your defense held",
            f"{attacker_username} attacked {defended_m2 / 1_000_000:.3f} km², "
            "but your territory held.",
            {
                "kind": "territory_defended",
                "screen": "map",
                "defended_m2": defended_m2,
                "lat": centre.y,
                "lon": centre.x,
                "attacker_id": str(attacker_id),
                "attacker_username": attacker_username,
                "attacker_avatar": attacker_avatar or {},
            },
            str(attacker_id),
        ))
    return out
