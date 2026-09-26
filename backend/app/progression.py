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
# Claim polygon shapes used to unlock here (hexagon/star/heart/gem). They are
# gone: a claim is no longer a stamp you choose but a territory grown around
# the route you actually ran, so there is no shape left to own. Levels 8, 32
# and 44 hand over a collectible instead (FREE_ITEMS below).
# Lootboxes (random cosmetic) and energy-cap bumps.
LOOTBOX_LEVELS = {5, 10, 15, 20, 25, 30, 35, 40, 45, 50}
ENERGY_CAP_LEVELS = {10, 20, 30, 40, 50}


def _label_for(kind: str, key: str) -> str:
    # Labels sit under a tile that already SHOWS the thing, so they name it and
    # nothing more — "Mythic", not "Mythic border". The kind is obvious from
    # the art; repeating it just made every tile wrap to two lines.
    for lvl, k, label in BORDER_TIERS:
        if kind == "border" and k == key:
            return label
    return {"lootbox": f"{key.title()} box", "energy_cap": "+5 cap",
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
# returns false until a claimed tier writes the user_unlocks row. The pass adds
# seventeen items unavailable from the free track or coin shop. Rarity skews
# epic/legendary on purpose — a paid tier handing over a common tee reads as a scam.
PREMIUM_ITEMS = {
    2: ("headwear:cur_tiara", "Tiara"),
    4: ("glasses:monocle", "Monocle"),
    6: ("top:cur_varsityjacket", "Varsity jacket"),
    8: ("top:cur_utilityvest", "Utility vest"),
    12: ("headwear:wolfears", "Wolf ears"),
    14: ("accessory:cur_neonclubbadge", "Neon club badge"),
    16: ("top:cur_aurorajacket", "Aurora jacket"),
    18: ("glasses:cur_reflectivefaceshield", "Reflective face shield"),
    22: ("headwear:punkcrown", "Punk crown"),
    26: ("headwear:kabuto", "Kabuto"),
    28: ("top:cur_knightarmour", "Knight armour"),
    32: ("headwear:flamecrown", "Flame crown"),
    34: ("glasses:cybershades", "Cyber shades"),
    38: ("accessory:cur_dragonwings", "Dragon wings"),
    42: ("top:k10t", "Navy varsity jacket"),
    46: ("accessory:jetpack", "Jetpack"),
    48: ("headwear:cur_halo", "Halo"),
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
        out.append({"kind": "lootbox", "key": rarity, "label": _label_for("lootbox", rarity)})
        out.append({"kind": "energy", "key": "+25", "label": "+25"})
        return out
    if level in PREMIUM_ITEMS:
        key, label = PREMIUM_ITEMS[level]
        out.append({"kind": "cosmetic", "key": key, "label": label})
        return out
    amount = 50 if level % 10 == 0 else 30
    return [{"kind": "energy", "key": f"+{amount}", "label": f"+{amount}"}]


# The free track's cosmetic tiers. Every level that isn't a box milestone
# hands over a NAMED cosmetic, keyed "<slot>:<id>" against
# frontend/src/config/cosmetics.js, so the ladder can draw the actual item art.
# A generic "Collectible" tile with a stand-in icon is a broken promise — the
# player can't tell what they're running toward.
#
# The eight-level bands deliberately step common -> rare -> epic -> legendary,
# cover all eight wearable slots, and use items marked `passOnly` client-side.
# With no parallel shop/stat route, claiming a tier always adds something new.
FREE_ITEMS = {
    1: ("face:grump", "Grump"),
    2: ("headwear:cur_flowercrown", "Flower crown"),
    3: ("hair:messy", "Messy"),
    4: ("top:cur_whitestripepolo", "White stripe polo"),
    6: ("face:determined", "Game face"),
    7: ("accessory:cur_runclublanyard", "Run club lanyard"),
    8: ("top:cur_midnightpullover", "Midnight pullover"),
    9: ("hair:flow", "Flow"),
    11: ("headwear:bandana", "Bandana"),
    12: ("glasses:rects", "Rectangle shades"),
    13: ("hair:roundfro", "Round fro"),
    14: ("bottom:wb025", "Red running shorts"),
    16: ("top:cur_labcoat", "Lab coat"),
    17: ("footwear:wf005", "Black and red runners"),
    18: ("top:cur_sunrisemarathonsinglet", "Sunrise marathon singlet"),
    19: ("accessory:cur_goldmedal", "Gold medal"),
    21: ("headwear:cur_tropicalstrawhat", "Tropical straw hat"),
    22: ("bottom:cur_denimskirt", "Denim skirt"),
    23: ("glasses:cur_festivalmask", "Festival mask"),
    24: ("headwear:cur_championlaurels", "Champion laurels"),
    26: ("top:cur_cloudpufferjacket", "Cloud puffer jacket"),
    27: ("bottom:cur_runclubraceshorts", "Run club race shorts"),
    28: ("footwear:wf010", "Purple and gold sneakers"),
    29: ("accessory:cur_hydrationracevest", "Hydration race vest"),
    31: ("hair:topknot", "Top knot"),
    32: ("glasses:cur_snowskivisor", "Snow ski visor"),
    33: ("top:cur_darkreflectivetechnicaltee", "Dark reflective tee"),
    34: ("bottom:wb110", "Charcoal race shorts"),
    36: ("footwear:wf011", "Volt runners"),
    37: ("headwear:bikehelmet", "Bike helmet"),
    38: ("accessory:cur_marathonfinishersash", "Marathon finisher sash"),
    39: ("accessory:cur_twinblades", "Twin blades"),
    41: ("hair:surfer", "Surfer"),
    42: ("glasses:steampunk", "Steampunk goggles"),
    43: ("top:cur_championvarsityjacket", "Champion varsity jacket"),
    44: ("footwear:wf044", "Pink strap sneakers"),
    46: ("headwear:cur_knighthelmet", "Knight helmet"),
    47: ("headwear:cur_cloudhalo", "Cloud halo"),
    48: ("accessory:cur_neonwings", "Neon wings"),
    49: ("glasses:onimask", "Oni mask"),
}


def rewards_for_level(level: int) -> list[dict]:
    """Every reward unlocked exactly AT `level` (used to grant on level-up and
    to render the ladder). Levels with no milestone still grant a collectible
    so every level gives something."""
    out = []
    # Borders are NOT granted here any more — they come from rank (app/ranks.py),
    # which is earned by taking and holding ground. Handing the same ring out on
    # the level ladder would make the badge mean two different things at once.
    if level in LOOTBOX_LEVELS:
        out.append({"kind": "lootbox", "key": lootbox_rarity(level),
                    "label": _label_for("lootbox", lootbox_rarity(level))})
    if level in ENERGY_CAP_LEVELS:
        out.append({"kind": "energy_cap", "key": "+5", "label": "+5 cap"})
    # No milestone at this level → a named cosmetic, so the tile can show the
    # actual item instead of a generic "Collectible".
    if not out and level in FREE_ITEMS:
        key, label = FREE_ITEMS[level]
        out.append({"kind": "cosmetic", "key": key, "label": label})
    elif not out and level > 0:
        # Only reachable if FREE_ITEMS falls out of sync with the milestones.
        out.append({"kind": "energy", "key": "+15", "label": "+15"})
    # Free track gets energy too, on the same cadence as premium — it's just
    # smaller (15 vs 30, 25 vs 50). Energy only on the paid side made the free
    # ladder feel like it was withholding the one consumable that gates play.
    if level % 2 == 0:
        amount = 25 if level % 10 == 0 else 15
        out.append({"kind": "energy", "key": f"+{amount}", "label": f"+{amount}"})
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
    """DEPRECATED — borders now come from rank, see app/ranks.py.
    Kept only so any stale caller keeps returning something sensible."""
    """Highest border tier the player has reached."""
    tier = BORDER_TIERS[0][1]
    for lvl, key, _ in BORDER_TIERS:
        if level >= lvl:
            tier = key
    return tier
