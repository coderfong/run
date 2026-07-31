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
# Claim polygon shapes — the stamp your run leaves.
SHAPE_UNLOCKS = {8: "hexagon", 20: "star", 32: "heart", 44: "gem"}
# Lootboxes (random cosmetic) and energy-cap bumps.
LOOTBOX_LEVELS = {5, 10, 15, 20, 25, 30, 35, 40, 45, 50}
ENERGY_CAP_LEVELS = {10, 20, 30, 40, 50}


def _label_for(kind: str, key: str) -> str:
    for lvl, k, label in BORDER_TIERS:
        if kind == "border" and k == key:
            return f"{label} border"
    return {"shape": f"{key.title()} claim",
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


_RARITY_UP = {"common": "rare", "rare": "epic", "epic": "legendary", "legendary": "legendary"}

# Premium-exclusive cosmetics, keyed "<slot>:<id>" against the client catalogue
# in frontend/src/config/cosmetics.js. Claiming one inserts a user_unlocks row,
# and the client treats a server unlock as equippable regardless of its normal
# stat gate — so these are the ONLY way to get these items.
#
# Keep ids in sync with the catalogue: an id that doesn't resolve falls back to
# a generic gift tile, which is exactly the "it just says cosmetics" problem
# this list exists to kill.
# EXCLUSIVITY: every id below is premium-ONLY art with no stat route at all —
# each carries `unlock: premiumOnly` in the client catalogue, so isUnlocked
# returns false until a claimed tier writes the user_unlocks row. Free players
# lose nothing (their level-gated crown/wings/shields are untouched); the pass
# adds seventeen items they simply never had. Rarity skews epic/legendary on
# purpose — a paid tier handing over a common tee reads as a scam.
PREMIUM_ITEMS = {
    2: ("headwear:laurel", "Laurel wreath"),
    4: ("glasses:monocle", "Monocle"),
    6: ("top:varsity", "Varsity jacket"),
    8: ("bottom:flameshorts", "Flame shorts"),
    12: ("headwear:wolfears", "Wolf ears"),
    14: ("accessory:boombox", "Boombox"),
    16: ("top:aurorajacket", "Aurora jacket"),
    18: ("glasses:mirrorvisor", "Mirror visor"),
    22: ("headwear:jester", "Jester crown"),
    26: ("accessory:trophypack", "Adventure pack"),
    28: ("top:champjersey", "Champion jersey"),
    32: ("headwear:flamecrown", "Flame crown"),
    34: ("glasses:cybershades", "Cyber shades"),
    38: ("accessory:dragonwings", "Dragon wings"),
    42: ("bottom:flamejoggers", "Flame joggers"),
    46: ("accessory:jetpack", "Jetpack"),
    48: ("headwear:halo", "Halo"),
}


def premium_rewards_for_level(level: int) -> list[dict]:
    """The premium track — strictly better than free at every single tier.

    Free gives ONE thing per tier. Premium gives:
      * lootbox tiers  → a box one rarity above free, PLUS an energy pack
      * milestone tiers→ a premium-exclusive cosmetic (see PREMIUM_ITEMS)
      * every other    → a bigger energy pack than free ever grants
    Borders/shapes/FX stay derived from level for everyone — paying must never
    be the only route to a visible rank.
    """
    out: list[dict] = []
    if level in LOOTBOX_LEVELS:
        rarity = _RARITY_UP[lootbox_rarity(level)]
        out.append({"kind": "lootbox", "key": rarity, "label": f"{rarity.title()} lootbox"})
        out.append({"kind": "energy", "key": "+25", "label": "+25 energy"})
        return out
    if level in PREMIUM_ITEMS:
        key, label = PREMIUM_ITEMS[level]
        out.append({"kind": "cosmetic", "key": key, "label": label})
        return out
    amount = 50 if level % 10 == 0 else 30
    return [{"kind": "energy", "key": f"+{amount}", "label": f"+{amount} energy"}]


# The free track's filler tiers. Every level that isn't a border/shape/FX/box
# milestone hands over a NAMED cosmetic, keyed "<slot>:<id>" against
# frontend/src/config/cosmetics.js, so the ladder can draw the actual item art.
# A generic "Collectible" tile with a stand-in icon is a broken promise — the
# player can't tell what they're running toward.
#
# Ordered roughly by desirability so the ladder escalates. None of these are in
# PREMIUM_ITEMS, and none are the five level-gated items (crown, angel wings,
# neon wings, sport shield, ski goggles) that free players already earn.
FREE_ITEMS = {
    2: ("face:grump", "Grump"),
    3: ("hair:messy", "Messy"),
    4: ("top:crewtee", "Crew tee"),
    6: ("bottom:shorts", "Shorts"),
    7: ("face:wink", "Wink"),
    9: ("hair:buzz", "Buzz cut"),
    11: ("headwear:cap", "Cap"),
    12: ("headwear:cowboyhat", "Cowboy hat"),
    13: ("top:pockettee", "Pocket tee"),
    14: ("bottom:cargos", "Cargos"),
    16: ("glasses:rects", "Rects"),
    17: ("hair:softwaves", "Soft waves"),
    18: ("face:tongueout", "Cheeky"),
    19: ("top:stripetee", "Stripe tee"),
    21: ("headwear:bandana", "Bandana"),
    22: ("bottom:trackpants", "Track pants"),
    23: ("hair:braids", "Braided pigtails"),
    24: ("glasses:steampunk", "Steampunk goggles"),
    26: ("top:singlet", "Race singlet"),
    27: ("face:stareyes", "Star eyes"),
    28: ("glasses:roundgold", "Round golds"),
    29: ("bottom:fbtshorts", "Runner shorts"),
    31: ("headwear:beanie", "Beanie"),
    33: ("hair:spacebuns", "Space buns"),
    34: ("top:sweater", "Sweater"),
    36: ("top:puffer", "Puffer jacket"),
    37: ("accessory:hydropack", "Hydration pack"),
    38: ("face:hearteyes", "Heart eyes"),
    39: ("bottom:leggings", "Leggings"),
    41: ("glasses:cleargoggles", "Clear goggles"),
    42: ("hair:surfer", "Surfer"),
    46: ("top:oversized", "Oversized tee"),
    47: ("headwear:bikehelmet", "Bike helmet"),
    48: ("accessory:capepauldron", "Champion cape"),
    49: ("accessory:goldmedal", "Gold medal"),
}


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
    if level in LOOTBOX_LEVELS:
        out.append({"kind": "lootbox", "key": lootbox_rarity(level), "label": f"{lootbox_rarity(level).title()} lootbox"})
    if level in ENERGY_CAP_LEVELS:
        out.append({"kind": "energy_cap", "key": "+5", "label": "+5 energy cap"})
    # No milestone at this level → a named cosmetic, so the tile can show the
    # actual item instead of a generic "Collectible".
    if not out and level in FREE_ITEMS:
        key, label = FREE_ITEMS[level]
        out.append({"kind": "cosmetic", "key": key, "label": label})
    elif not out and level > 0:
        # Only reachable if FREE_ITEMS falls out of sync with the milestones.
        out.append({"kind": "energy", "key": "+15", "label": "+15 energy"})
    return out


def reward_ladder() -> list[dict]:
    """The full 1..MAX_LEVEL two-track ladder for the progression screen."""
    return [
        {
            "level": lvl,
            "xp_required": xp_for_level(lvl),
            "rewards": rewards_for_level(lvl),
            "premium": premium_rewards_for_level(lvl),
        }
        for lvl in range(1, MAX_LEVEL + 1)
    ]


def current_border(level: int) -> str:
    """Highest border tier the player has reached."""
    tier = BORDER_TIERS[0][1]
    for lvl, key, _ in BORDER_TIERS:
        if level >= lvl:
            tier = key
    return tier
