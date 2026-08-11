"""Contact sheet for the hand-drawn frames, drawn the way the app draws them.

`cut_frames.py` produces art and numbers; this renders the two together at sizes
nothing like the source, which is the only way to see whether the numbers are
right. It reimplements the nine slice from `src/ui/ArtFrame.js` rather than
eyeballing the strips, so what lands here is what the phone will draw:

  * corners at their source size, never stretched;
  * edges stretched on one axis only;
  * PAPER underneath with its middle filled, INK over the top.

Drawn on a mid grey with a text-height marker inside each box, because the two
failure modes both hide on white: paper poking out past a corner, and padding
that does not clear the ink.

Run: python scripts/animations/qa_frames.py
Writes: scripts/qa-frames/<id>.png plus contact.png
"""
from __future__ import annotations

import json
from pathlib import Path

from PIL import Image, ImageDraw

# Sizes to try each frame at. Deliberately includes one much wider and one much
# taller than any source drawing, plus one small enough that the corners have to
# share the box.
TRIALS = ((320, 120), (150, 210), (64, 64))
PAGE = (108, 112, 122)
CONTENT = (232, 96, 120)


def slice_layout(spec, width, height, scale=1):
    """Ported from sliceLayout in src/ui/ArtFrame.js. Keep the two in step."""
    w, h, insets = spec["frameWidth"], spec["frameHeight"], spec["insets"]
    l = min(round(insets["left"] * scale), width // 2)
    r = min(round(insets["right"] * scale), width // 2)
    t = min(round(insets["top"] * scale), height // 2)
    b = min(round(insets["bottom"] * scale), height // 2)
    mid_w = max(0, width - l - r)
    mid_h = max(0, height - t - b)
    src_mid_w = max(1, w - insets["left"] - insets["right"])
    src_mid_h = max(1, h - insets["top"] - insets["bottom"])
    mid_x, mid_y = mid_w / src_mid_w, mid_h / src_mid_h
    fx_l, fx_r = l / insets["left"], r / insets["right"]
    fy_t, fy_b = t / insets["top"], b / insets["bottom"]

    def at(key, rect, left, top, fx, fy):
        return {"key": key, "rect": rect, "left": left, "top": top,
                "sheetW": fx * w, "sheetH": fy * h}

    return [s for s in (
        at("tl", (0, 0, insets["left"], insets["top"]), 0, 0, fx_l, fy_t),
        at("tr", (w - insets["right"], 0, insets["right"], insets["top"]), width - r, 0, fx_r, fy_t),
        at("bl", (0, h - insets["bottom"], insets["left"], insets["bottom"]), 0, height - b, fx_l, fy_b),
        at("br", (w - insets["right"], h - insets["bottom"], insets["right"], insets["bottom"]),
           width - r, height - b, fx_r, fy_b),
        at("top", (insets["left"], 0, src_mid_w, insets["top"]), l, 0, mid_x, fy_t),
        at("bottom", (insets["left"], h - insets["bottom"], src_mid_w, insets["bottom"]),
           l, height - b, mid_x, fy_b),
        at("left", (0, insets["top"], insets["left"], src_mid_h), 0, t, fx_l, mid_y),
        at("right", (w - insets["right"], insets["top"], insets["right"], src_mid_h),
           width - r, t, fx_r, mid_y),
        at("mid", (insets["left"], insets["top"], src_mid_w, src_mid_h), l, t, mid_x, mid_y),
    ) if s["sheetW"] > 0 and s["sheetH"] > 0]


def draw_layer(sheet, spec, width, height, keys):
    """One layer of the nine slice, as the app builds it: scale the whole sheet
    so this slice comes out the right size, then window it down to the slice."""
    out = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    frame = sheet.crop((0, 0, spec["frameWidth"], spec["frameHeight"]))
    for s in slice_layout(spec, width, height):
        if s["key"] not in keys:
            continue
        sx = s["sheetW"] / spec["frameWidth"]
        sy = s["sheetH"] / spec["frameHeight"]
        scaled = frame.resize((max(1, round(s["sheetW"])), max(1, round(s["sheetH"]))), Image.BILINEAR)
        x, y, rw, rh = s["rect"]
        window = scaled.crop((round(x * sx), round(y * sy),
                              round(x * sx) + max(1, round(rw * sx)),
                              round(y * sy) + max(1, round(rh * sy))))
        out.alpha_composite(window, (round(s["left"]), round(s["top"])))
    return out


EDGES = {"tl", "tr", "bl", "br", "top", "bottom", "left", "right"}


def render(spec, ink_sheet, paper_sheet, width, height):
    box = Image.new("RGBA", (width, height), (0, 0, 0, 0))
    # Paper takes the middle as well; ink never does, because a frame's interior
    # is empty and nothing should be drawn over the content.
    box.alpha_composite(draw_layer(paper_sheet, spec, width, height, EDGES | {"mid"}))
    # A marker where content would sit, padded off the ink by the measured line
    # depth. If it touches ink, the padding rule is wrong.
    pad = spec["ink"]
    draw = ImageDraw.Draw(box)
    x0, y0 = pad["left"] + 2, pad["top"] + 2
    x1, y1 = width - pad["right"] - 2, height - pad["bottom"] - 2
    if x1 > x0 and y1 > y0:
        draw.rectangle((x0, y0, x1, y1), outline=CONTENT, width=1)
    box.alpha_composite(draw_layer(ink_sheet, spec, width, height, EDGES))
    return box


def check_middle_is_clear(frames_dir: Path, spec) -> list[str]:
    """Interior ink left in the stretchable middle is the bug this catches.

    A rule or a tick that survives the cut lands in one of the four edge bands
    or the centre, all of which stretch — so a three pixel mark becomes a bar
    down the whole side of a tall box. It is invisible at source size and
    obvious at render size, which is exactly the sort of thing to assert on
    rather than to look for.
    """
    import numpy as np
    from PIL import Image as _Image

    sheet = _Image.open(frames_dir / f"{spec['id']}.png").convert("RGBA")
    w, h, insets = spec["frameWidth"], spec["frameHeight"], spec["insets"]
    alpha = np.zeros((h, w), bool)
    for i in range(spec["frameCount"]):
        alpha |= np.array(sheet.crop((w * i, 0, w * (i + 1), h)))[:, :, 3] > 12

    problems = []
    inner = alpha[insets["top"]:h - insets["bottom"], insets["left"]:w - insets["right"]]
    if inner.any():
        rows = sorted(set(np.flatnonzero(inner.any(axis=1)) + insets["top"]))
        problems.append(f"{spec['id']}: ink inside the stretchable middle at rows {rows[:6]}")
    return problems


def main() -> int:
    frames_dir = Path(__file__).resolve().parents[2] / "assets" / "frames"
    out_dir = Path(__file__).resolve().parents[1] / "qa-frames"
    out_dir.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((frames_dir / "frame-manifest.json").read_text(encoding="utf-8"))

    gap, label = 16, 18
    cells = []
    problems = []
    for frame_id, spec in manifest["frames"].items():
        problems += check_middle_is_clear(frames_dir, spec)
        ink = Image.open(frames_dir / f"{frame_id}.png").convert("RGBA")
        paper = Image.open(frames_dir / f"{frame_id}_paper.png").convert("RGBA")
        row_w = sum(w for w, _ in TRIALS) + gap * (len(TRIALS) - 1)
        row_h = max(h for _, h in TRIALS)
        cell = Image.new("RGBA", (row_w, row_h + label), PAGE + (255,))
        ImageDraw.Draw(cell).text((0, 2), frame_id, fill=(240, 240, 240, 255))
        x = 0
        for w, h in TRIALS:
            cell.alpha_composite(render(spec, ink, paper, w, h), (x, label))
            x += w + gap
        cell.save(out_dir / f"{frame_id}.png")
        cells.append(cell)

    cols = 2
    rows = (len(cells) + cols - 1) // cols
    cw = max(c.width for c in cells) + gap * 2
    ch = max(c.height for c in cells) + gap
    sheet = Image.new("RGBA", (cw * cols, ch * rows), PAGE + (255,))
    for i, cell in enumerate(cells):
        sheet.alpha_composite(cell, ((i % cols) * cw + gap, (i // cols) * ch + gap // 2))
    sheet.save(out_dir / "contact.png")
    print(f"Wrote {len(cells)} frames to {out_dir}")
    for problem in problems:
        print(f"  PROBLEM  {problem}")
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
