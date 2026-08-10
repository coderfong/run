"""The emote vocabulary, server side.

This is the mirror of `frontend/src/effects/reactionRegistry.js`. The client
decides which emotes to OFFER; this decides which it will STORE, and the two
are deliberately not the same list — the picker shows eight, the allowlist
accepts every key the registry can draw, so an older build that still sends a
retired key is recorded rather than rejected, and a newer build can start
sending a new key the moment its art ships without waiting on a backend deploy.

Keys are storage identity. Renaming one rewrites history for everybody who ever
sent it, so they are named for the GESTURE ("love", "brutal") rather than for
the sprite that happens to draw it.
"""

# Everything the client can render. Kept in the same order as the registry so
# the two files can be read side by side.
ALLOWED = frozenset({
    # the picker
    "love", "happy", "wow", "respect", "brutal", "rival", "vibes", "idea",
    # renderable, not offered: older clients and the scene pet's own chatter
    "surprise", "exclamation", "angry", "heartbreak", "flowers",
    "tear", "question", "dots", "sleeping", "despair",
})

# How many distinct emotes a single run's summary carries. A run cannot collect
# more than this many DIFFERENT faces on a card before the tail is folded away,
# which keeps a feed row a fixed size no matter how popular the run got.
MAX_SUMMARY = 6


def is_allowed(emote) -> bool:
    return isinstance(emote, str) and emote in ALLOWED


def normalise(emote):
    """Trim and validate one emote key, or None. Raises ValueError on junk."""
    if emote is None:
        return None
    key = emote.strip() if isinstance(emote, str) else emote
    if not is_allowed(key):
        raise ValueError(f"unknown emote: {emote!r}")
    return key


def summarise(db, run_ids, viewer_id):
    """Per run: the distinct emotes with counts, and which one is the viewer's.

    ONE query for a whole page of feed rows rather than a correlated subquery
    per row — a feed page is fifty runs and each of those could carry dozens of
    reactions, so the per-row shape is what would actually hurt here.

    Returns ({run_id: [{emote, count, mine}]}, {run_id: viewer's emote}).
    """
    from sqlalchemy import text  # local: keeps this module import-light

    ids = [str(r) for r in run_ids]
    if not ids:
        return {}, {}
    rows = db.execute(
        text(
            """
            SELECT run_id::text, emote, COUNT(*) AS n,
                   BOOL_OR(user_id = :uid) AS mine
            FROM run_reactions
            WHERE run_id = ANY(CAST(:rids AS uuid[]))
            GROUP BY run_id, emote
            ORDER BY run_id, n DESC, emote
            """
        ),
        {"rids": ids, "uid": viewer_id},
    ).fetchall()

    summary: dict[str, list] = {}
    mine: dict[str, str] = {}
    for run_id, emote, count, is_mine in rows:
        bucket = summary.setdefault(run_id, [])
        if is_mine:
            mine[run_id] = emote
        # Ordered by count already, so the fold keeps the loudest emotes and
        # drops the long tail — but never the viewer's OWN, which has to stay
        # visible for the picker to show as selected.
        if len(bucket) < MAX_SUMMARY or is_mine:
            bucket.append({"emote": emote, "count": int(count or 0), "mine": bool(is_mine)})
    return summary, mine
