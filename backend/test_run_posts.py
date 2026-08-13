"""Validation contract for editable run captions and photos."""

from pydantic import ValidationError

from app.schemas import RunPostIn


def test_run_post_caption_is_trimmed_and_empty_becomes_none():
    assert RunPostIn(caption="  morning miles  ").caption == "morning miles"
    assert RunPostIn(caption="   ").caption is None


def test_run_post_accepts_four_supported_images():
    photo = "data:image/jpeg;base64,aGVsbG8="
    post = RunPostIn(media=[photo] * 4)
    assert len(post.media) == 4


def test_run_post_rejects_too_many_or_non_image_values():
    photo = "data:image/jpeg;base64,aGVsbG8="
    for media in ([photo] * 5, ["file:///private/photo.jpg"]):
        try:
            RunPostIn(media=media)
        except ValidationError:
            pass
        else:
            raise AssertionError("invalid post media was accepted")
