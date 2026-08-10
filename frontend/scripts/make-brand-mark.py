"""Cut the PASER runner out of the app icon into a tintable brand mark.

`assets/icon.png` is the logo, but it is a 1024 square of BLACK figure on
OPAQUE WHITE — dropped onto a dark card it is a white box, and `tintColor`
would paint the box rather than the runner. This keys the white out, crops to
the figure, and writes a transparent PNG whose every visible pixel is white,
so a single asset takes any colour via `tintColor`.

Re-runnable: reads only the icon, always rewrites the output.

    python scripts/make-brand-mark.py
"""

from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "icon.png"
OUT = ROOT / "assets" / "brand" / "paser-mark.png"
HEADLESS = ROOT / "assets" / "brand" / "paser-mark-body.png"

# Anything at least this bright is background. The icon is flat black on flat
# white, so the cut is unambiguous — the threshold only has to survive the
# antialiased edge, which becomes partial alpha.
WHITE_CUTOFF = 250
PAD = 8  # breathing room around the crop, in source pixels


def main() -> None:
    src = Image.open(SRC).convert("RGBA")
    w, h = src.size
    px = src.load()

    # White → transparent, ink → opaque white (so tintColor owns the colour).
    # The edge pixels keep their coverage as alpha, which is what stops the
    # mark looking jagged at small sizes.
    for y in range(h):
        for x in range(w):
            r, g, b, _ = px[x, y]
            lum = (r * 299 + g * 587 + b * 114) // 1000
            alpha = 0 if lum >= WHITE_CUTOFF else 255 - lum
            px[x, y] = (255, 255, 255, alpha)

    box = src.getbbox()
    if box is None:
        raise SystemExit("nothing left after keying — check WHITE_CUTOFF")
    left, top, right, bottom = box
    box = (
        max(0, left - PAD),
        max(0, top - PAD),
        min(w, right + PAD),
        min(h, bottom + PAD),
    )
    mark = src.crop(box)

    # Square it, so callers can size it with one number and never distort it.
    side = max(mark.size)
    square = Image.new("RGBA", (side, side), (255, 255, 255, 0))
    square.paste(mark, ((side - mark.width) // 2, (side - mark.height) // 2))
    square = square.resize((512, 512), Image.LANCZOS)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    square.save(OUT, optimize=True)
    print(f"wrote {OUT.relative_to(ROOT)} ({square.size[0]}x{square.size[1]})")

    write_headless(square)


def write_headless(mark: Image.Image) -> None:
    """Also emit the mark WITHOUT its head, plus where the head sat.

    The share card stands the logo's running man on the route and puts the
    player's own head on him, so the mark's own head has to come off. It is a
    separate connected shape in the art, which makes the cut exact rather than
    a guessed rectangle.
    """
    import numpy as np
    from scipy import ndimage

    alpha = np.array(mark)[:, :, 3] > 60
    labels, count = ndimage.label(alpha)
    if count < 2:
        print("  ! mark is one shape — head cut skipped")
        return

    # The head is the SMALLER of the two, and the higher up.
    sizes = [(labels == i).sum() for i in range(1, count + 1)]
    head_label = 1 + min(range(count), key=lambda i: sizes[i])
    ys, xs = np.nonzero(labels == head_label)
    w, h = mark.size

    # Grow the cut a few pixels: the label came off a hard alpha threshold, and
    # the antialiased rim underneath it survives as a ghost of the cap.
    head_mask = ndimage.binary_dilation(labels == head_label, iterations=4)
    px = np.array(mark.copy())
    px[head_mask] = (0, 0, 0, 0)
    Image.fromarray(px).save(HEADLESS, optimize=True)

    print(f"wrote {HEADLESS.relative_to(ROOT)}")
    print("  head slot, as fractions of the mark — keep LogoRunner.js in step:")
    print(f"    x {xs.min()/w:.3f}..{xs.max()/w:.3f}   y {ys.min()/h:.3f}..{ys.max()/h:.3f}")
    print(f"    centre ({(xs.min()+xs.max())/2/w:.3f}, {(ys.min()+ys.max())/2/h:.3f})"
          f"   width {(xs.max()-xs.min())/w:.3f}")


if __name__ == "__main__":
    main()
