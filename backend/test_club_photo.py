"""Contract for a club's uploaded photo: what is accepted, and what is stored."""

import base64
import io

import pytest
from pydantic import ValidationError

from app import images
from app.clans_meta import photo_url
from app.schemas import ClanCreate, ClanUpdate

PIL = pytest.importorskip("PIL.Image", reason="Pillow is what normalises uploads")

PHOTO = "data:image/jpeg;base64,aGVsbG8="


def _jpeg_data_uri(width, height):
    buf = io.BytesIO()
    PIL.new("RGB", (width, height), (12, 200, 140)).save(buf, format="JPEG", quality=95)
    return "data:image/jpeg;base64," + base64.b64encode(buf.getvalue()).decode("ascii")


def test_club_is_created_without_choosing_an_icon():
    club = ClanCreate(name="Night Owls", tag="OWLS", color_key="azure", photo=PHOTO)
    assert club.photo == PHOTO
    # The icon is only the fallback crest now, so the client never sends one.
    assert club.badge_icon == "shield"


def test_photo_must_be_an_image_a_browser_can_draw():
    for bad in ("file:///private/crest.jpg", "data:text/html;base64,aGk="):
        with pytest.raises(ValidationError):
            ClanCreate(name="Night Owls", tag="OWLS", color_key="azure", photo=bad)


def test_oversized_photo_is_refused():
    with pytest.raises(ValidationError):
        ClanCreate(
            name="Night Owls", tag="OWLS", color_key="azure",
            photo="data:image/jpeg;base64," + "A" * 3_000_001,
        )


def test_empty_photo_on_a_patch_means_remove_it():
    # None leaves the crest alone; "" is the instruction to clear it.
    assert ClanUpdate().photo is None
    assert ClanUpdate(photo="").photo == ""


def test_stored_photo_is_a_square_thumbnail():
    stored = images.square_jpeg_data_uri(_jpeg_data_uri(2400, 1600))
    raw, media_type = images.decode_data_uri(stored)
    assert media_type == "image/jpeg"
    assert PIL.open(io.BytesIO(raw)).size == (images.AVATAR_SIZE, images.AVATAR_SIZE)
    assert len(stored) < 200_000


def test_undecodable_photo_survives_normalisation_unchanged():
    assert images.square_jpeg_data_uri(PHOTO) == PHOTO


def test_photo_url_is_versioned_by_the_upload():
    assert photo_url("abc", None) is None
    assert photo_url("abc", "ff01") == "/clans/abc/photo?v=ff01"
