"""Curated clan cosmetics — server-owned so every client renders identically.

12 clan colors (fill / stroke / glow triples, same shape as the old team
palette) and 16 badge icons (keys the client maps to icons). Clans store a
color_key + badge_icon; the API returns the resolved triple.
"""

# key -> {fill (translucent), stroke (saturated), glow (bright, dark mode)}
CLAN_COLORS = {
    "violet": {"fill": "rgba(147,51,234,0.20)", "stroke": "#9333ea", "glow": "#c084fc"},
    "emerald": {"fill": "rgba(16,163,74,0.20)", "stroke": "#15803d", "glow": "#4ade80"},
    "azure": {"fill": "rgba(37,99,235,0.20)", "stroke": "#2563eb", "glow": "#60a5fa"},
    "crimson": {"fill": "rgba(220,38,38,0.20)", "stroke": "#dc2626", "glow": "#f87171"},
    "amber": {"fill": "rgba(217,119,6,0.20)", "stroke": "#b45309", "glow": "#fbbf24"},
    "teal": {"fill": "rgba(13,148,136,0.20)", "stroke": "#0f766e", "glow": "#2dd4bf"},
    "rose": {"fill": "rgba(225,29,72,0.20)", "stroke": "#be123c", "glow": "#fb7185"},
    "indigo": {"fill": "rgba(79,70,229,0.20)", "stroke": "#4338ca", "glow": "#818cf8"},
    "lime": {"fill": "rgba(101,163,13,0.20)", "stroke": "#4d7c0f", "glow": "#a3e635"},
    "cyan": {"fill": "rgba(8,145,178,0.20)", "stroke": "#0e7490", "glow": "#22d3ee"},
    "fuchsia": {"fill": "rgba(192,38,211,0.20)", "stroke": "#a21caf", "glow": "#e879f9"},
    "orange": {"fill": "rgba(234,88,12,0.20)", "stroke": "#c2410c", "glow": "#fb923c"},
}
DEFAULT_COLOR = "azure"

# Neutral slate for solo (clanless) runners — never a saturated hue.
NEUTRAL_COLOR = {"fill": "rgba(100,116,139,0.20)", "stroke": "#64748b", "glow": "#94a3b8"}

# Client maps these keys to lucide icons.
CLAN_BADGES = [
    "shield", "flame", "bolt", "crown", "wolf", "anchor", "mountain", "rocket",
    "skull", "leaf", "star", "sword", "compass", "diamond", "wave", "target",
]
DEFAULT_BADGE = "shield"

# League tiers, lowest -> highest.
LEAGUES = ["bronze", "silver", "gold", "platinum", "diamond"]


def color_triple(color_key):
    return CLAN_COLORS.get(color_key or DEFAULT_COLOR, CLAN_COLORS[DEFAULT_COLOR])
