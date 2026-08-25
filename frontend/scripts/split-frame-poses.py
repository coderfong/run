#!/usr/bin/env python3
"""Cut each frame's boil strip into one PNG per pose.

WHY THIS EXISTS
---------------
A frame ships as a horizontal STRIP of three drawings of the same box (the
"boil" — see ui/ArtFrame.js). Drawing one of those poses therefore means
cropping the strip, which is why every frame is rendered as eight clipped
slices: eight <View overflow:hidden> wrappers with an offset <Image> inside
each. That is sixteen native views per layer, thirty-two for a frame with a
fill behind it, and a feed card carries four or five of them.

iOS can do the whole nine-slice natively — `capInsets` maps to
`resizableImageWithCapInsets:` — which is ONE view per layer instead of
sixteen. But it stretches the middle of the WHOLE image, and the middle of a
three-pose strip is the second drawing. So the poses have to be separate files
before the native path is available at all. That is all this script does.

The strips are LEFT IN PLACE on purpose: the boil (cycling the three drawings)
still runs off them, because that path animates a translate on the UI thread
and cannot swap an image source per frame. Boiling frames are rare and
deliberately so; the still ones are the whole rest of the app.

USAGE
-----
    python scripts/split-frame-poses.py [--check]

Re-runnable. `--check` verifies the emitted files match the strips without
writing anything, which is what CI would call.

Reads  frontend/assets/frames/<id>.png, <id>_paper.png and frame-manifest.json
Writes frontend/assets/frames/poses/<id>_p<N>.png, <id>_paper_p<N>.png
"""

import argparse
import json
import sys
from pathlib import Path

from PIL import Image

FRAMES_DIR = Path(__file__).resolve().parent.parent / "assets" / "frames"
POSES_DIR = FRAMES_DIR / "poses"
MANIFEST = FRAMES_DIR / "frame-manifest.json"

# The two drawings every frame ships: the outline, and the same box filled.
# They are cut identically, because the fill has to boil in step with the line
# that sits on top of it.
LAYERS = (("", "ink"), ("_paper", "paper"))


def poses_for(spec, image, suffix, frame_id):
    """Crop one strip into its poses, checking the strip is the size claimed.

    The manifest is generated from the same art (scripts/animations/cut_frames.py),
    so a mismatch here means the two have drifted — and a frame cut on the wrong
    grid is a box with somebody else's corner on it, which is worth failing over
    rather than shipping.
    """
    w, h, count = spec["frameWidth"], spec["frameHeight"], spec.get("frameCount", 1)
    expected = (w * count, h)
    if image.size != expected:
        raise SystemExit(
            f"{frame_id}{suffix}.png is {image.size}, manifest says {expected}"
        )
    return [image.crop((i * w, 0, (i + 1) * w, h)) for i in range(count)]


def check_middle(pose, spec, want_opaque, label, problems):
    """The stretched centre has to be uniform, or the native path is wrong.

    `capInsets` stretches everything inside the insets. The eight-slice path
    never drew that region at all — it left a hole for the ink and covered it
    with a plain coloured rectangle for the paper — so nothing before now cared
    what was in there. The native path DOES draw it, by smearing whatever it
    finds across the whole box.

    That is fine exactly as long as the region is one uniform thing: nothing at
    all for an outline, solid for a fill. Both hold for all seventeen frames,
    and this is what keeps it that way if the pack is ever recut.
    """
    ins = spec["insets"]
    box = (ins["left"], ins["top"], pose.width - ins["right"], pose.height - ins["bottom"])
    if box[2] <= box[0] or box[3] <= box[1]:
        problems.append(f"{label}: insets leave no middle to stretch")
        return
    low, high = pose.crop(box).split()[3].getextrema()
    if want_opaque and low != 255:
        problems.append(f"{label}: fill is not solid inside its insets (min alpha {low})")
    if not want_opaque and high != 0:
        problems.append(f"{label}: outline is not clear inside its insets (max alpha {high})")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        action="store_true",
        help="verify the emitted poses match the strips; write nothing",
    )
    args = parser.parse_args()

    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    POSES_DIR.mkdir(exist_ok=True)

    written = 0
    stale = []

    for frame_id, spec in manifest["frames"].items():
        for suffix, label in LAYERS:
            src = FRAMES_DIR / f"{frame_id}{suffix}.png"
            if not src.exists():
                # A frame with no paper drawing is legal — the fill is optional.
                if label == "paper":
                    continue
                raise SystemExit(f"missing {src}")

            with Image.open(src) as strip:
                strip = strip.convert("RGBA")
                for index, pose in enumerate(poses_for(spec, strip, suffix, frame_id)):
                    out = POSES_DIR / f"{frame_id}{suffix}_p{index}.png"
                    check_middle(pose, spec, label == "paper", out.name, stale)
                    if args.check:
                        if not out.exists():
                            stale.append(f"{out.name} missing")
                            continue
                        with Image.open(out) as have:
                            if have.convert("RGBA").tobytes() != pose.tobytes():
                                stale.append(f"{out.name} differs from its strip")
                        continue
                    # optimize=True matters more than it looks: these are 102
                    # files whose only job is to exist, and the pack is already
                    # over the OTA asset budget.
                    pose.save(out, "PNG", optimize=True)
                    written += 1

    if args.check:
        if stale:
            print("frame poses are out of date:", file=sys.stderr)
            for line in stale:
                print(f"  {line}", file=sys.stderr)
            print("  run: python scripts/split-frame-poses.py", file=sys.stderr)
            return 1
        print(f"frame poses match their strips ({len(manifest['frames'])} frames)")
        return 0

    total = sum(p.stat().st_size for p in POSES_DIR.glob("*.png"))
    print(f"wrote {written} pose files to {POSES_DIR} ({total / 1024:.0f} KB)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
