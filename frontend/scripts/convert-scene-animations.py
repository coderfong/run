"""Turn the supplied Pit Stop clips into the assets the shop scene ships.

assets/animations/README.md documents the one format the app renders through
`components/GameAnimation.js`: transparent, animated WebP, because it is the
only container that plays with an alpha channel on iOS, Android and web alike.
Supplied clips never arrive that way, so this is the seam that converts them.

KEYING IS PER-SOURCE, and picking the wrong mode is the way to ruin one of
these:

    white   flat cartoon art on a white card. This can NOT be keyed by colour —
            a balloon's highlight, an ice cube and the flesh of a coconut are
            all white too, and a global white key punches holes straight
            through the subject. The background is instead the near-white
            region that REACHES THE FRAME EDGE, so interior white survives.

    black   solid art on a black card — same connectivity test, inverted. It
            has to be the connectivity test and not a luma key: a luma key
            reads brightness as coverage, which is right for something that
            GLOWS on black but wrong for anything opaque. Run over the OPEN
            sign it turns a solid green badge 77% transparent and deletes the
            dark string it hangs from.

    alpha   the clip already carries alpha. Resample and re-encode, nothing to
            key. A licensed re-download will usually land here.

    glow    bright particles on a black card, with NO enclosing outline — a
            firework, a spark burst, a shower of confetti. Here brightness IS
            coverage, so alpha comes off the max channel and the colour is
            un-premultiplied back out of the black it was composited onto.
            The connectivity test is wrong for these: it can only ever return
            0 or 255, so every anti-aliased particle edge keeps a hard black
            fringe, and a hundred fringed dots read as grubby.

    white_on_yellow
            white strokes over a flat YELLOW card. Neither brightness nor
            connectivity works here: the card is nearly as bright as the
            strokes (253,214,12 against 255,255,255) and it is the strokes'
            own background, so they never reach the frame edge as a separate
            region. What separates them is the BLUE channel — the card and
            everything printed on it sit under blue 46, and the strokes are
            the only white on the frame. Alpha is that channel, rescaled.

`still` alongside a mode takes ONE frame instead of the whole clip, cropped to
its alpha bounding box. That is the right answer for a clip whose only motion
is a rigid scroll: the scene can drift a still image itself, at three different
speeds for parallax, for none of the bytes and none of the decoder cost. The
still path keys on luma (`BLACK_KEY_STILL`) rather than by connectivity,
because the one source that uses it IS soft light on black — clouds with
anti-aliased edges, where coverage is exactly what brightness means.

Run from frontend/:

    python scripts/convert-scene-animations.py                 # everything
    python scripts/convert-scene-animations.py propWatermelon  # one entry

Needs ffmpeg on PATH, plus Pillow, numpy and scipy.
"""

import os
import shutil
import subprocess
import sys
import tempfile

import numpy as np
from PIL import Image
from scipy import ndimage


FE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ANIM_DIR = os.path.join(FE, "assets", "animations")
ART_DIR = os.path.join(FE, "assets", "art", "shop")
DOWNLOADS = "D:\\downloads"

# The reaction clips in this set play back at 20 fps (see
# assets/animations/README.md). The Pit Stop props run slower on purpose: they
# are idling furniture on a screen that already has three breathing characters,
# a garland and a scrolling sky, and 12 fps is both calmer and 40% cheaper.
FPS = 20
PROP_FPS = 12

# The widest prop frame in config/pitStop.js is the balloons at 200 reference
# units on a 1536-unit scene — about 56pt on a 430pt phone, so 144px of SUBJECT
# covers it at 2x with headroom and reads cleanly at 3x. The sources are 1500²
# masters that would otherwise cost megabytes each for art that is never drawn
# above a thumbnail.
#
# WORK_EDGE is the resolution keying and cropping happen at. It has to be
# comfortably above MAX_EDGE, because the crop throws most of the frame away
# and the final downscale happens after it — key at 160 and a subject filling
# half the master would deliver 80 real pixels.
MAX_EDGE = 144
WORK_EDGE = 512

SOURCES = [
    {
        "key": "pitStopCloudBand",
        "src": os.path.join(DOWNLOADS, "f2R48tBX8F.webm"),
        "out": os.path.join(ART_DIR, "pitstop-cloud-band.png"),
        "mode": "black",
        "still": True,
        "note": "sky band above the tent; the scene drifts it (PitStopScene CloudBand)",
    },
    {
        # RE-CUT, NOT RE-KEYED — note the source is the shipped asset, not the
        # supplied `Open.webm`. The original conversion keyed this correctly
        # but kept the master's margin, so the badge drew at about a third of
        # its layout frame: a sign nobody could read, on the layer nearest the
        # customer. Cropping the already-keyed art fixes the size and risks
        # nothing; re-keying the webm cannot reproduce the original alpha (see
        # `explode_frames`). The frame in config/pitStop.js is unchanged.
        "key": "openSign",
        "src": os.path.join(ANIM_DIR, "open-sign.webp"),
        "out": os.path.join(ANIM_DIR, "open-sign.webp"),
        "mode": "alpha",
        "quality": 62,
        "note": "shop — front-most layer, on the left tent pole",
    },
    {
        # RE-KEYED. The shipped reward-burst.webp was fully OPAQUE — a solid
        # near-black card behind the confetti — so every reward reveal and
        # every rare shop purchase drew a black square over the screen. The
        # master carries an `alpha_mode=1` tag but its alpha plane is flat 255,
        # so no decoder flag recovers this: the black has to be keyed out.
        #
        # `glow`, not `black`: these are loose confetti pieces with no
        # enclosing outline, and a connectivity key would leave every one of
        # them ringed in hard black. `crop: False` because a burst is an
        # effect laid over other art — its margin is where the pieces fly to.
        "key": "rewardBurst",
        "src": os.path.join(DOWNLOADS, "GPAn1Jw9go.webm"),
        "out": os.path.join(ANIM_DIR, "reward-burst.webp"),
        "mode": "glow",
        "crop": False,
        "fps": FPS,
        "work_edge": 150,
        "edge": 150,
        "loops": 1,
        "quality": 62,
        "note": "every reward reveal; shop rare-or-better purchase",
    },
    {
        # THE BOLTS ONLY. The master is a whole background — a rotating yellow
        # sunburst with white lightning cracking across it — and shipping it
        # whole would mean a full-screen opaque raster: 16:9 art cropped to a
        # 9:19.5 phone, magnified past 3x, at four seconds of every pixel on
        # the display. RewardReveal already learned that lesson with
        # `victoryRays`, and its ray fan is drawn in SVG now for exactly this
        # reason.
        #
        # So the clip is split where it wants to split. The sunburst is eight
        # 12.8-degree wedges on a 45-degree pitch turning 45 deg/s clockwise,
        # #FCFD0D on #FDD60C — four numbers, and RevealRays draws it sharp at
        # any size for free. What SVG cannot cheaply do is the lightning, and
        # that is what comes out of here: white strokes on transparent, laid
        # over the drawn fan.
        #
        # `crop: False` because position is the content — these bolts strike
        # out from the centre, and cropping to their bounding box would move
        # them. 30 frames because the 4s master is a 1s cycle played four
        # times, measured (see `frames`).
        "key": "revealLightning",
        "src": os.path.join(DOWNLOADS, "Yellow Lightning Burst.mp4"),
        "out": os.path.join(ANIM_DIR, "reveal-lightning.webp"),
        "mode": "white_on_yellow",
        "crop": False,
        "fps": 30,
        "frames": 30,
        "work_edge": 1400,
        "quality": 55,
        "note": "lootbox reveal background; the sunburst under it is RevealRays",
    },
    # --- Iconscout clips ---------------------------------------------------
    #
    # WATERMARKED. Every one of these five was downloaded as a PREVIEW and has
    # "iconscout / Graphiqa Studio" baked across the middle of the subject. The
    # conversion below is faithful — it will happily carry the watermark
    # through — so these files must be replaced with licensed, un-watermarked
    # downloads before any store build. Keep the filenames and nothing else
    # needs to change; re-run this script and the scene picks them up.
    #
    # A licensed download that already carries alpha (transparent WebM/GIF, or
    # a Lottie render) should switch `mode` to "alpha" — the white flood-fill
    # exists only for the flat white-card MP4 the preview ships as.
    {
        # ONE ROW of the supplied two-row clip. The master stacks both rows
        # into a square, and a square garland stretched across a 1536-unit wall
        # would stand 1477 units tall — the whole scene. Cut to its top row it
        # is a wide shallow band the scene can repeat, which is what a garland
        # across a wall actually is. `square: False` keeps that shape.
        "key": "propGarland",
        "src": os.path.join(DOWNLOADS, "decoration-animation-gif-download-6102767.mp4"),
        "out": os.path.join(ANIM_DIR, "prop-garland.webp"),
        "mode": "white",
        "region": (0.0, 0.0, 1.0, 0.46),
        "square": False,
        "repeat": 6,
        "edge": 144,
        "quality": 36,
        "note": "back wall — replaces the 13 vector pennants and their cord",
        "watermarked": True,
    },
    {
        "key": "propBalloons",
        "src": os.path.join(DOWNLOADS, "balloons-animation-gif-download-6102763.mp4"),
        "out": os.path.join(ANIM_DIR, "prop-balloons.webp"),
        "mode": "white",
        "quality": 40,
        "note": "tent decoration, top-left air",
        "watermarked": True,
    },
    {
        "key": "propCocktail",
        "src": os.path.join(DOWNLOADS, "caipirinha-animation-gif-download-6102764.mp4"),
        "out": os.path.join(ANIM_DIR, "prop-cocktail.webp"),
        "mode": "white",
        "quality": 40,
        "note": "counter front row, between the cup lane and the bottles",
        "watermarked": True,
    },
    {
        "key": "propWatermelon",
        "src": os.path.join(DOWNLOADS, "Watermelon.mp4"),
        "out": os.path.join(ANIM_DIR, "prop-watermelon.webp"),
        "mode": "white",
        "quality": 40,
        "note": "counter front row, far right — replaces the vector FruitArt",
        "watermarked": True,
    },
    {
        "key": "propCoconut",
        "src": os.path.join(DOWNLOADS, "Coconut Drink.mp4"),
        "out": os.path.join(ANIM_DIR, "prop-coconut.webp"),
        "mode": "white",
        "quality": 40,
        "note": "counter front row, left of the attendant",
        "watermarked": True,
    },
    {
        "key": "propSodaBottles",
        "src": os.path.join(DOWNLOADS, "Soda Drinks.mp4"),
        "out": os.path.join(ANIM_DIR, "prop-soda-bottles.webp"),
        "mode": "white",
        "quality": 40,
        "note": "counter front row, rides presentBeat — replaces the vector GelsArt",
        "watermarked": True,
    },
]


def run(args):
    subprocess.run(args, check=True, capture_output=True)


def probe_duration(src):
    out = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=nw=1:nk=1", src],
        capture_output=True, text=True, check=True,
    )
    return float(out.stdout.strip())


# geq is a per-pixel expression interpreter: fine for the ONE frame a `still`
# needs, and unusably slow over a whole clip — which is why whole clips key in
# numpy (`key_black_backing`) instead of in ffmpeg.
BLACK_KEY_STILL = (
    "format=rgba,"
    "geq=r='r(X,Y)':g='g(X,Y)':b='b(X,Y)':a='max(max(r(X,Y),g(X,Y)),b(X,Y))',"
    "unpremultiply=inplace=1"
)


def key_flat_backing(img, backing, tolerance=36):
    """Erase the flat card a solid illustration sits on, and only that.

    Keeps only the backing-coloured regions that REACH THE EDGE of the frame,
    so backing-coloured pixels enclosed by the subject's outline survive: a
    balloon highlight, an ice cube and coconut flesh against a white card; the
    OPEN sign's dark string and nail against a black one. That connectivity
    test is the whole point — a global colour key punches holes straight
    through the art, and on the OPEN sign it deletes the string outright.

    Done with connected-component labelling rather than PIL's `floodfill`,
    which is a pure-Python breadth-first search and takes minutes per clip at
    these frame counts.
    """
    rgb = img.convert("RGB")
    arr = np.asarray(rgb)
    if backing == "white":
        is_backing = arr.min(axis=2) >= 255 - tolerance
    else:
        is_backing = arr.max(axis=2) <= tolerance

    labels, count = ndimage.label(is_backing)
    if count:
        edges = np.concatenate([labels[0, :], labels[-1, :], labels[:, 0], labels[:, -1]])
        outside = np.isin(labels, np.unique(edges[edges > 0]))
    else:
        outside = np.zeros_like(is_backing)

    out = rgb.convert("RGBA")
    out.putalpha(Image.fromarray(np.where(outside, 0, 255).astype(np.uint8), "L"))
    return out


def convert_still(entry):
    """One frame, keyed and cropped to its content."""
    tmp = tempfile.mkdtemp(prefix="still-")
    try:
        raw = os.path.join(tmp, "frame.png")
        run(["ffmpeg", "-v", "error", "-y", "-i", entry["src"],
             "-vf", f"select=eq(n\\,0),{BLACK_KEY_STILL}", "-vframes", "1", raw])
        img = Image.open(raw).convert("RGBA")
        # Cropping to the alpha bbox is what makes the still tileable: the
        # scene positions the band by its CLOUDS, and empty sky baked into the
        # frame would push them out of the strip the tent leaves visible.
        box = img.getchannel("A").getbbox()
        img.crop(box).save(entry["out"])
        return box
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def key_glow_backing(img, lo=16, hi=64):
    """Lift bright particles off a black card, keeping their soft edges.

    Everything the subject is drawn ON is black, so the master is already the
    subject PRE-MULTIPLIED against black: a half-covered edge pixel is half as
    bright as the particle it belongs to. That makes brightness a direct read
    of coverage, and dividing the colour back out by it recovers the particle's
    real hue instead of a muddied one.

    `lo` is the black floor and it MUST clear the card. The reward-burst
    master's card measures a flat max-channel 12 rather than a true 0, so at
    lo=8 every background pixel came out at alpha 18 — invisible on its own,
    a faint grey square once 150x150 of them are laid over a bright screen.

    `hi` is the brightness at which a pixel counts as fully covered. It sits
    low on purpose — these are saturated cartoon confetti, so anything that is
    genuinely part of a piece clears 64 easily and stays opaque; only the
    anti-aliased rim lands between `lo` and `hi`, which is exactly the band
    that should be partial.
    """
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    luma = arr.max(axis=2)
    alpha = np.clip((luma - lo) / float(hi - lo), 0.0, 1.0)
    # Un-premultiply. Guard the divide: where alpha is ~0 the colour is the
    # black card and carries no information to recover.
    safe = np.maximum(alpha, 1e-3)[..., None]
    rgb = np.clip(arr / safe, 0, 255)
    out = np.dstack([rgb, alpha * 255.0]).astype(np.uint8)
    return Image.fromarray(out, "RGBA")


def key_white_on_yellow(img, lo=60, hi=200):
    """Lift white strokes off a flat yellow card, by their blue channel.

    Yellow has no blue in it. On the lightning master the card, its rays and
    the supplier's watermark all measure blue <= 46 with no bolt on screen,
    while a bolt is pure white — so blue alone separates them by a factor of
    five, where luma separates them by a tenth of a stop and connectivity not
    at all. `lo` clears the card with room to spare; anti-aliased stroke edges
    ramp through the band between `lo` and `hi` and come out partial, which is
    what makes a thin bolt survive being drawn at three times this size.

    THE WATERMARK GOES WITH THE CARD, and that is not a side effect — it is
    the reason this asset is shippable while the five Iconscout props below
    are not. Their watermark sits ON the subject and is carried through by any
    honest key. This one is printed on the background in the background's own
    hue, so keying the bolts leaves it behind.

    Colour is forced to white rather than un-premultiplied. An edge pixel here
    is the bolt mixed with the CARD, and the card is not what the bolt will be
    composited over — recovering the "true" colour from it would just fold
    yellow into a white stroke.
    """
    arr = np.asarray(img.convert("RGB"), dtype=np.float32)
    alpha = np.clip((arr[:, :, 2] - lo) / float(hi - lo), 0.0, 1.0)
    rgb = np.full(arr.shape, 255.0, dtype=np.float32)
    return Image.fromarray(np.dstack([rgb, alpha * 255.0]).astype(np.uint8), "RGBA")


def key_frame(img, mode):
    if mode in ("white", "black"):
        return key_flat_backing(img, mode)
    if mode == "glow":
        return key_glow_backing(img)
    if mode == "white_on_yellow":
        return key_white_on_yellow(img)
    return img.convert("RGBA")


def explode_frames(src, out_dir, fps=PROP_FPS, edge=WORK_EDGE):
    """Decode a source to a numbered PNG sequence at `edge`.

    An animated WebP is read through Pillow rather than ffmpeg, whose WebP
    demuxer does not handle these files. That path exists so an already-keyed
    asset can be RE-CUT without being re-keyed — which is the only safe way to
    resize the OPEN sign. Its keyed art holds a black triangle enclosed by the
    two strings, and no key run over the original can tell that background
    apart from the strings that bound it: widen the tolerance and the strings
    dissolve, narrow it and the triangle survives as a solid black wedge.
    """
    if src.lower().endswith(".webp"):
        with Image.open(src) as anim:
            for i in range(getattr(anim, "n_frames", 1)):
                anim.seek(i)
                frame = anim.convert("RGBA")
                frame.thumbnail((edge, edge), Image.LANCZOS)
                frame.save(os.path.join(out_dir, f"{i + 1:05d}.png"))
        return

    # `-vcodec libvpx` decodes VP8's side alpha track; the default decoder
    # silently drops it and hands back yuv420p. It matters for any source that
    # really is transparent, and costs nothing for the ones that are not.
    decode = ["-vcodec", "libvpx"] if src.lower().endswith(".webm") else []
    run(["ffmpeg", "-v", "error", "-y", *decode, "-i", src,
         "-vf", f"fps={fps},scale={edge}:{edge}:force_original_aspect_ratio=decrease",
         os.path.join(out_dir, "%05d.png")])


def union_bbox(boxes, size, square=True):
    """The smallest box that holds every frame's content.

    Union, not per-frame: cropping each frame to its own bounds would make a
    bobbing balloon sit still and its frame wobble instead.

    Square by default, because the prop frames in config/pitStop.js are square
    and `GameAnimation` sizes by width — a non-square asset in a square frame
    gets stretched. Padding the short axis back out keeps the art undistorted
    and still leaves it filling the frame on its long axis. The garland opts
    out: it is a wide shallow band whose whole purpose is to tile across the
    wall, and squaring it would bury the flags in empty air.
    """
    left = min(b[0] for b in boxes)
    top = min(b[1] for b in boxes)
    right = max(b[2] for b in boxes)
    bottom = max(b[3] for b in boxes)
    if not square:
        return (left, top, right, bottom)

    edge = max(right - left, bottom - top)
    cx, cy = (left + right) / 2, (top + bottom) / 2
    left = round(cx - edge / 2)
    top = round(cy - edge / 2)
    # A subject that sits against one edge of the master can push the square
    # off-canvas; slide it back in rather than letting the crop shrink.
    left = max(0, min(left, size[0] - edge))
    top = max(0, min(top, size[1] - edge))
    return (left, top, left + edge, top + edge)


def loop_period(paths, floor=0.25, ratio=0.3):
    """The shortest prefix of the clip that already contains the whole loop.

    These props are authored as a short idle cycle played more than once —
    the balloons run two identical 38-frame cycles inside their 75 — and
    shipping the repeat doubles the file for motion nobody can distinguish. A
    self-looping WebP replays whatever it holds, so trimming to one cycle is
    invisible.

    The test is deliberately conservative: a candidate has to match frame zero
    an order of magnitude better than an average pair of frames does before it
    is believed, so a clip with no repeat (or a slow drift that merely passes
    near its start) keeps all of its frames.
    """
    grays = []
    for path in paths:
        with Image.open(path) as img:
            grays.append(np.asarray(img.convert("L").resize((64, 64)), dtype=np.int16))

    base = grays[0]
    diffs = [float(np.abs(base - g).mean()) for g in grays[1:]]
    if not diffs:
        return len(paths)

    start = max(2, int(len(grays) * floor))
    window = diffs[start - 1:]
    if not window:
        return len(paths)

    best = min(window)
    if best >= np.mean(diffs) * ratio:
        return len(paths)
    return start + window.index(best)


def convert_cropped(entry):
    """A whole clip, keyed frame by frame, cropped to content, re-encoded.

    The masters float their subject in a wide empty margin. Encoding that
    margin would be wasteful on its own, but the real cost is layout: a
    120-unit frame in the scene would draw about 70 units of art, and every
    prop would read as undersized no matter what the frame said. Cropping to
    the content is what makes a layout frame mean what it says.

    Keying happens at WORK_EDGE and the downscale to MAX_EDGE comes after the
    crop, so the delivered pixels are all subject.

    `crop: False` opts out of the whole crop/trim pass. A REACTION is not a
    prop standing in a layout frame — it is an effect laid over something else
    at a size the caller picks, and its empty margin is the space its particles
    fly out into. Cropping one would make the burst fill its box and clip.
    """
    fps = entry.get("fps", PROP_FPS)
    tmp = tempfile.mkdtemp(prefix="anim-")
    try:
        explode_frames(entry["src"], tmp, fps=fps, edge=entry.get("work_edge", WORK_EDGE))
        frames = sorted(f for f in os.listdir(tmp) if f.endswith(".png"))

        # `frames` is an EXPLICIT cycle length, for a source whose loop
        # `loop_period` cannot find. That heuristic takes the best-matching
        # candidate in the clip, which is the right answer for a prop authored
        # as one cycle played twice; give it four identical cycles and the
        # closest match to frame zero is as likely to be the last repeat as the
        # first, so it keeps three of them. Measure the cycle once, state it
        # here, and the trim is exact.
        if entry.get("frames"):
            for name in frames[entry["frames"]:]:
                os.remove(os.path.join(tmp, name))
            frames = frames[:entry["frames"]]

        # `region` selects part of the master before anything else looks at it,
        # in fractions of the frame. The garland needs it: the clip draws TWO
        # rows of bunting stacked into a square, and only one row can be a
        # band that tiles across a wall.
        region = entry.get("region")
        boxes = []
        for name in frames:
            path = os.path.join(tmp, name)
            img = Image.open(path)
            if region:
                w, h = img.size
                img = img.crop((round(region[0] * w), round(region[1] * h),
                                round(region[2] * w), round(region[3] * h)))
            keyed = key_frame(img, entry["mode"])
            keyed.save(path)
            box = keyed.getchannel("A").getbbox()
            if box:
                boxes.append(box)
        print(f"    keyed {len(frames)} frames")

        if boxes and entry.get("crop", True):
            with Image.open(os.path.join(tmp, frames[0])) as first:
                crop = union_bbox(boxes, first.size, square=entry.get("square", True))
            span = crop[2] - crop[0]
            edge = entry.get("edge", MAX_EDGE)
            size = (edge, round(edge * (crop[3] - crop[1]) / span))
            # `repeat` bakes the tiling into the asset instead of laying N
            # copies in the scene. The garland has to span 1536 units and its
            # swag is only worth ~256 of them, and every copy in the scene
            # would be its own animated decoder — six of them, for one
            # decoration. Repeating the pixels costs bytes once and draws once.
            copies = entry.get("repeat", 1)
            for name in frames:
                path = os.path.join(tmp, name)
                with Image.open(path) as img:
                    out = img.crop(crop).resize(size, Image.LANCZOS)
                if copies > 1:
                    band = Image.new("RGBA", (size[0] * copies, size[1]), (0, 0, 0, 0))
                    for i in range(copies):
                        band.alpha_composite(out, (i * size[0], 0))
                    out = band
                out.save(path)

        kept = len(frames)
        if entry.get("crop", True):
            kept = loop_period([os.path.join(tmp, f) for f in frames])
            if kept < len(frames):
                print(f"    one cycle is {kept} frames — dropping {len(frames) - kept} repeats")
                for name in frames[kept:]:
                    os.remove(os.path.join(tmp, name))

        # Scenery loops forever in the decoder (and its catalogue entry must
        # carry `selfLooping: true` — otherwise Reduce Motion removes the object
        # from the counter rather than calming it, the rule the OPEN sign
        # already documents). A reaction plays exactly once: `loop 1`.
        loops = str(entry.get("loops", 0))
        run(["ffmpeg", "-v", "error", "-y", "-framerate", str(fps),
             "-i", os.path.join(tmp, "%05d.png"),
             "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", str(entry["quality"]),
             "-compression_level", "3", "-loop", loops, "-an", entry["out"]])
        return round(kept / fps * 1000)
    finally:
        shutil.rmtree(tmp, ignore_errors=True)


def main():
    wanted = set(sys.argv[1:])
    for entry in SOURCES:
        if wanted and entry["key"] not in wanted:
            continue
        if not os.path.exists(entry["src"]):
            print(f"[miss] {entry['key']}: no source at {entry['src']}")
            continue

        os.makedirs(os.path.dirname(entry["out"]), exist_ok=True)
        kind = "still" if entry.get("still") else entry["mode"]
        print(f"[conv] {entry['key']} ({kind}) -> {os.path.basename(entry['out'])}")

        duration = None
        if entry.get("still"):
            convert_still(entry)
        else:
            duration = convert_cropped(entry)

        size_kb = os.path.getsize(entry["out"]) / 1024
        with Image.open(entry["out"]) as img:
            w, h = img.size
        line = f"    {w}x{h}, {size_kb:.0f} KB"
        if duration is not None:
            # Paste this straight into the catalogue entry in
            # config/gameAnimations.js.
            line += f" -> duration: {duration}, aspect: {w}/{h}, selfLooping: true"
        print(line)
        if entry.get("watermarked"):
            print("    !! carries an iconscout preview watermark — replace before shipping")


if __name__ == "__main__":
    main()
