"""How a run post's photos are addressed.

The photos are stored as data URIs (see `runs.post_media`) but are never
handed out that way: a feed page carrying twenty runs' worth of base64 is
megabytes the client cannot cache and has to re-download every time. What the
API returns is one immutable URL per photo, versioned by the post's edit
token, which the phone caches to disk like any other image.

The same URLs come back on the next edit to mean "keep this one", which is how
editing a caption does not re-upload the photos that are already there.
"""

import re

from . import images

_URL_RE = re.compile(r"^/runs/(?P<run>[0-9a-fA-F-]{36})/post-photo/(?P<index>\d+)(?:\?|$)")


def photo_urls(run_id, etag, media) -> list[str]:
    """One URL per stored photo. Empty when the post has none."""
    count = len(media or [])
    if not count:
        return []
    version = etag or "0"
    return [f"/runs/{run_id}/post-photo/{i}?v={version}" for i in range(count)]


def resolve_incoming(run_id, existing, values) -> list[str]:
    """What to store, given what the client sent.

    A data URI is a new photo and is downscaled on the way in. One of this
    run's own photo URLs is a photo the client is keeping. Anything else is
    rejected — including a URL belonging to somebody else's run, which is the
    only way this could become a way to copy a photo you cannot see.
    """
    kept = []
    for value in values or []:
        if value.startswith("data:"):
            kept.append(images.bounded_jpeg_data_uri(value))
            continue
        match = _URL_RE.match(value)
        if not match or match.group("run").lower() != str(run_id).lower():
            raise ValueError("post photos must be images you uploaded to this run")
        index = int(match.group("index"))
        if index >= len(existing or []):
            raise ValueError("that photo is no longer on this run")
        kept.append(existing[index])
    return kept
