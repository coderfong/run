"""Normalising uploaded photos before they are stored.

A club crest is fetched by every client that lists the club, so what a phone
hands us (a 3000px camera frame) is the wrong thing to keep. Everything that
arrives is centre-cropped to a square, downscaled, and re-encoded as JPEG,
which turns a 2 MB upload into roughly 50 KB.

Pillow is imported defensively: a dev backend without it must still boot, and
the worst case there is that the original image is stored untouched.
"""

import base64
import binascii
import io

try:  # pragma: no cover - exercised by which wheels the environment has
    from PIL import Image, ImageOps
except Exception:  # pragma: no cover
    Image = None
    ImageOps = None

AVATAR_SIZE = 512
# A run post photo keeps its shape, so it is bounded by its longest side
# instead. 1280 is a full-width feed photo on the densest phone screen.
PHOTO_MAX_DIM = 1280
_JPEG_QUALITY = 82

DATA_URI_PREFIXES = (
    "data:image/jpeg;base64,",
    "data:image/png;base64,",
    "data:image/webp;base64,",
)


def decode_data_uri(value: str):
    """(bytes, media_type) for a data URI, or (None, None) if it is not one."""
    if not value or "," not in value:
        return None, None
    header, _, encoded = value.partition(",")
    if not header.startswith("data:"):
        return None, None
    media_type = header[5:].split(";")[0] or "image/jpeg"
    try:
        return base64.b64decode(encoded, validate=True), media_type
    except (binascii.Error, ValueError):
        return None, None


def square_jpeg_data_uri(value: str, size: int = AVATAR_SIZE) -> str:
    """A square JPEG data URI built from any accepted image data URI.

    Returns the input unchanged when it cannot be re-processed, so a photo is
    never lost to a decode failure; the size guard on the way in is what keeps
    that case bounded.
    """
    if not value:
        return value
    raw, _ = decode_data_uri(value)
    if raw is None or Image is None:
        return value
    try:
        with Image.open(io.BytesIO(raw)) as img:
            # Honour the camera's rotation flag before cropping, or a portrait
            # photo crops around the wrong axis.
            img = ImageOps.exif_transpose(img)
            img = ImageOps.fit(img.convert("RGB"), (size, size), Image.LANCZOS)
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=_JPEG_QUALITY, optimize=True)
    except Exception:
        return value
    return _as_jpeg_data_uri(out)


def bounded_jpeg_data_uri(value: str, max_dim: int = PHOTO_MAX_DIM) -> str:
    """The same treatment for an image that must keep its aspect ratio.

    Shrinks so the longest side is `max_dim` and re-encodes as JPEG. Photos
    smaller than that are still re-encoded, because what a phone hands us at
    quality 0.6 is usually well above what a feed card needs.
    """
    if not value:
        return value
    raw, _ = decode_data_uri(value)
    if raw is None or Image is None:
        return value
    try:
        with Image.open(io.BytesIO(raw)) as img:
            img = ImageOps.exif_transpose(img).convert("RGB")
            img.thumbnail((max_dim, max_dim), Image.LANCZOS)
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=_JPEG_QUALITY, optimize=True)
    except Exception:
        return value
    return _as_jpeg_data_uri(out)


def _as_jpeg_data_uri(buffer: io.BytesIO) -> str:
    return "data:image/jpeg;base64," + base64.b64encode(buffer.getvalue()).decode("ascii")
