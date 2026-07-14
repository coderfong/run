"""Player progression: the level curve, energy caps, and the level 1..50
reward ladder.

Pure data + helpers — NO database access here. Callers pass in `xp` / `level`
and get back numbers or reward descriptors. The reward ladder is the single
source of truth the frontend renders and the claim/end-run paths grant against.

Level curve: to REACH level L costs XP_BASE * L² (quadratic — every level is
harder than the last). Capped at MAX_LEVEL. This matches the existing
`level = floor(sqrt(xp/100))` the profile already shows.
"""

from .config import settings

MAX_LEVEL = 50
XP_BASE = 100  # xp to reach level 1 = 100; level L = XP_BASE * L²


def level_from_xp(xp: int) -> int:
    if not xp or xp <= 0:
        return 0
    return min(MAX_LEVEL, int((xp / XP_BASE) ** 0.5))


def xp_for_level(level: int) -> int:
    """Total career XP required to reach `level`."""
    return XP_BASE * level * level


def energy_max(level: int) -> int:
    """Energy cap grows +5 every 10 levels (100 → 125 at L50)."""
    return settings.energy_base_max + 5 * (level // 10)


# ---------------------------------------------------------------------------
# The reward ladder
# ---------------------------------------------------------------------------
# Border tiers unlock at these levels (the always-visible "what level are you"
# ring on every portrait). Deterministic → the frontend derives the current
# tier straight from level; nothing to persist.
BORDER_TIERS = [
    (1, "wood", "Wood"), (5, "bronze", "Bronze"), (10, "silver", "Silver"),
    (15, "gold", "Gold"), (20, "platinum", "Platinum"), (25, "diamond", "Diamond"),
    (30, "onyx", "Onyx"), (36, "ember", "Ember"), (43, "prismatic", "Prismatic"),
    (50, "mythic", "Mythic"),
]
# Claim polygon shapes (the stamp your run leaves) and claim-land explosion FX.
SHAPE_UNLOCKS = {8: "hexagon", 20: "star", 32: "heart", 44: "gem"}
FX_UNLOCKS = {12: "burst", 24: "shockwave", 36: "fireworks", 48: "supernova"}
# Lootboxes (random cosmetic) and energy-cap bumps.
LOOTBOX_LEVELS = {5, 10, 15, 20, 25, 30, 35, 40, 45, 50}
ENERGY_CAP_LEVELS = {10, 20, 30, 40, 50}


def _label_for(kind: str, key: str) -> str:
    for lvl, k, label in BORDER_TIERS:
        if kind == "border" and k == key:
            return f"{label} border"
    return {"shape": f"{key.title()} claim", "fx": f"{key.title()} explosion",
            "lootbox": "Lootbox", "energy_cap": "+5 energy cap",
            "cosmetic": "Collectible"}.get(kind, key)


def lootbox_rarity(level: int) -> str:
    """Better boxes at higher levels."""
    if level >= 40:
        return "legendary"
    if level >= 25:
        return "epic"
    if level >= 10:
        return "rare"
    return "common"


def rewards_for_level(level: int) -> list[dict]:
    """Every reward unlocked exactly AT `level` (used to grant on level-up and
    to render the ladder). Levels with no milestone still grant a collectible
    so every level gives something."""
    out = []
    for lvl, key, _label in BORDER_TIERS:
        if lvl == level:
            out.append({"kind": "border", "key": key, "label": _label_for("border", key)})
    if level in SHAPE_UNLOCKS:
        out.append({"kind": "shape", "key": SHAPE_UNLOCKS[level], "label": _label_for("shape", SHAPE_UNLOCKS[level])})
    if level in FX_UNLOCKS:
        out.append({"kind": "fx", "key": FX_UNLOCKS[level], "label": _label_for("fx", FX_UNLOCKS[level])})
    if level in LOOTBOX_LEVELS:
        out.append({"kind": "lootbox", "key": lootbox_rarity(level), "label": f"{lootbox_rarity(level).title()} lootbox"})
    if level in ENERGY_CAP_LEVELS:
        out.append({"kind": "energy_cap", "key": "+5", "label": "+5 energy cap"})
    # Fallback so no level is empty: a plain collectible slot the client fills
    # from its level-gated cosmetic pool.
    if not out and level > 0:
        out.append({"kind": "cosmetic", "key": f"lvl{level}", "label": "Collectible"})
    return out


def reward_ladder() -> list[dict]:
    """The full 1..MAX_LEVEL ladder for the progression screen."""
    return [
        {"level": lvl, "xp_required": xp_for_level(lvl), "rewards": rewards_for_level(lvl)}
        for lvl in range(1, MAX_LEVEL + 1)
    ]


def current_border(level: int) -> str:
    """Highest border tier the player has reached."""
    tier = BORDER_TIERS[0][1]
    for lvl, key, _ in BORDER_TIERS:
        if level >= lvl:
            tier = key
    return tier
