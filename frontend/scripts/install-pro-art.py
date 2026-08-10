"""Derive the two PASER PRO illustrations from one master.

The master (`assets/art/src/pro-crew.png`) is a SQUARE night scene: four
runners lit by a gold glow, standing on nothing, with the glow's falloff baked
into a near-black background. It is not referenced by any `require`, so it does
not ship — it is only the input here.

Two outputs, because the two places PRO is sold want different shapes:

  * `art/onboarding/pro-hero.png` — 4:3, for the first-run step's ComicPanel
    (onboarding/steps/ProStep.js). The panel is a fixed 4:3 box, so a square
    pasted into it letterboxes.
  * `art/ui/pro-banner.png` — 16:9, for the card on You (screens/ProfileScreen).
    The crew sits hard RIGHT and the left 44% is empty stage, because that is
    where the card draws its wordmark and its one line of copy.

BOTH widen the master by REPLICATING ITS EDGE COLUMN rather than filling with a
flat colour. The background is a vignette, not a flat black: its rows differ,
and a flat fill leaves a visible vertical seam down each side. Stretching the
edge column continues each row's own value, so the join cannot be seen. Nothing
is ever cropped — every character stays whole at both aspects.

Re-runnable: both outputs are regenerated from the master every time, so this
is the only thing that should ever write them.

Run from frontend/:  python scripts/install-pro-art.py
"""

import pathlib

from PIL import Image, ImageFilter

ROOT = pathlib.Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
MASTER = ASSETS / "art" / "src" / "pro-crew.png"

# Sizes match what downscale-art.py would cap these families to, so the two
# scripts never fight over the same file: onboarding art is FULLBLEED (1290 on
# the long side), and the banner is a card-width image (358pt x 3, rounded).
HERO = (1290, 968)      # 4:3
BANNER = (1080, 608)    # 16:9


# Columns averaged to build the fill, and how hard that column is blurred down
# its length. The master carries a fine grain plus scattered gold sparkles, and
# a single raw column stretched 200px wide turns every one of those specks into
# a horizontal streak running off the edge of the card.
#
# The sample stays NARROW on purpose. The vignette brightens inward, so a wide
# average is measurably lighter than the edge it is supposed to continue and
# leaves a step at the join; four columns is enough for the blur to work with
# and still reads as the edge's own value.
EDGE_SAMPLE = 4
EDGE_SMOOTH = 6


def edge_column(im: Image.Image, side: str) -> Image.Image:
    box = (0, 0, EDGE_SAMPLE, im.height) if side == "left" else (
        im.width - EDGE_SAMPLE, 0, im.width, im.height
    )
    strip = im.crop(box).resize((1, im.height), Image.LANCZOS)
    return strip.filter(ImageFilter.GaussianBlur(EDGE_SMOOTH))


def widen(im: Image.Image, width: int, x: int) -> Image.Image:
    """Place `im` at `x` on a `width`-wide canvas, filling both sides with the
    vignette values of the edge it is nearest to."""
    out = Image.new("RGB", (width, im.height))
    if x > 0:
        out.paste(edge_column(im, "left").resize((x, im.height), Image.BILINEAR), (0, 0))
    right_w = width - x - im.width
    if right_w > 0:
        out.paste(
            edge_column(im, "right").resize((right_w, im.height), Image.BILINEAR),
            (x + im.width, 0),
        )
    out.paste(im, (x, 0))
    return out


def main() -> None:
    master = Image.open(MASTER).convert("RGB")

    # Hero: the master at the panel's full height, centred, stage extended
    # sideways to 4:3.
    square = master.resize((HERO[1], HERO[1]), Image.LANCZOS)
    hero = widen(square, HERO[0], (HERO[0] - HERO[1]) // 2)
    hero_path = ASSETS / "art" / "onboarding" / "pro-hero.png"
    hero.save(hero_path, optimize=True)
    print(f"{hero_path.relative_to(ROOT)}  {hero.size[0]}x{hero.size[1]}")

    # Banner: same trick, but the crew is pushed flush right so the card's copy
    # has the left of the stage to itself.
    square = master.resize((BANNER[1], BANNER[1]), Image.LANCZOS)
    banner = widen(square, BANNER[0], BANNER[0] - BANNER[1])
    banner_path = ASSETS / "art" / "ui" / "pro-banner.png"
    banner.save(banner_path, optimize=True)
    print(f"{banner_path.relative_to(ROOT)}  {banner.size[0]}x{banner.size[1]}")


if __name__ == "__main__":
    main()
