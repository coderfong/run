"""Which fixed-art items could honestly take a colour swatch, and which could not.

The colourable slots recolour by keeping each pixel's LIGHTNESS and taking hue
and saturation from the palette — that is why a brown hairstyle and a blue one
have identical pixel counts. It only works on art that is one colour family
with shading. Run it over a gold medal and you get a pink medal; over a pair of
white trainers with a black sole and a red swoosh you get one flat blob.

So this measures, per item, how much of its ink is a single hue:

  * pixels are weighted by how saturated they are — a black sole and a white
    midsole carry no hue and recolour fine either way, so they must not count
    against an item;
  * the hue histogram is circular, and the score is the share of saturated ink
    inside the best 60-degree arc.

Items above the threshold are safe to recolour. Everything else keeps its
authored art, and the point of this script is to say which is which rather
than to find out after shipping 600 PNGs.

Run: python scripts/audit-colourable.py
"""
from __future__ import annotations

import colorsys
import json
import re
from pathlib import Path

import numpy as np
from PIL import Image

FRONTEND = Path(__file__).resolve().parents[1]
SLOTS = ("footwear", "accessory", "face")

# Share of saturated ink that must sit inside one 60 degree arc.
ONE_HUE = 0.80
# Below this saturation a pixel is grey/black/white and carries no hue.
SAT_FLOOR = 0.22
# An item with almost no saturated ink at all (white trainers, silver chain) is
# a special case: there is no hue to preserve, so a recolour is total, which is
# exactly what you want on a plain garment.
MOSTLY_NEUTRAL = 0.12


def item_sources(slot: str) -> dict[str, str]:
    """id -> image path, read off the catalogue rather than the filesystem."""
    text = (FRONTEND / "src/config/cosmetics.js").read_text(encoding="utf8", errors="replace")
    block = re.search(rf"\n  {slot}: \[(.*?)\n  \],", text, re.S)
    if not block:
        return {}
    out = {}
    for line in block.group(1).splitlines():
        ident = re.search(r"id: '([^']+)'", line)
        img = re.search(r"img: require\('([^']+)'\)", line)
        if ident and img:
            out[ident.group(1)] = img.group(1)
    return out


def hue_spread(path: Path):
    image = Image.open(path).convert("RGBA")
    pixels = np.asarray(image).astype(float) / 255.0
    solid = pixels[..., 3] > 0.75
    if solid.sum() < 64:
        return None
    rgb = pixels[solid][:, :3]
    mx = rgb.max(1)
    mn = rgb.min(1)
    sat = np.where(mx > 0, (mx - mn) / np.maximum(mx, 1e-6), 0.0)
    coloured = sat > SAT_FLOOR
    share_coloured = float(coloured.mean())
    if share_coloured < MOSTLY_NEUTRAL:
        return {"hues": 0.0, "coloured": share_coloured, "verdict": "neutral"}

    hues = np.array([colorsys.rgb_to_hsv(*p)[0] for p in rgb[coloured]]) * 360.0
    weights = sat[coloured]
    # Circular histogram; the score is the best contiguous 60 degree arc.
    hist, _ = np.histogram(hues, bins=36, range=(0, 360), weights=weights)
    doubled = np.concatenate([hist, hist])
    window = np.convolve(doubled, np.ones(6), mode="valid")[:36]
    score = float(window.max() / max(hist.sum(), 1e-6))
    return {
        "hues": score,
        "coloured": share_coloured,
        "verdict": "one hue" if score >= ONE_HUE else "multi hue",
    }


def main() -> int:
    report = {}
    for slot in SLOTS:
        sources = item_sources(slot)
        rows = []
        for item_id, rel in sorted(sources.items()):
            path = (FRONTEND / "src/config" / rel).resolve()
            if not path.exists():
                continue
            measured = hue_spread(path)
            if not measured:
                continue
            rows.append({"id": item_id, **measured})
        report[slot] = rows
        ok = [r for r in rows if r["verdict"] in ("one hue", "neutral")]
        print(f"{slot}: {len(ok)}/{len(rows)} could take a swatch")
        for r in rows:
            if r["verdict"] == "multi hue":
                print(f"    keeps its own art: {r['id']:<16} one-hue share {r['hues']:.2f}")
    (FRONTEND / "scripts" / "colourable-audit.json").write_text(
        json.dumps(report, indent=2), encoding="utf8"
    )
    total = sum(len(v) for v in report.values())
    safe = sum(1 for v in report.values() for r in v if r["verdict"] in ("one hue", "neutral"))
    print(f"\n{safe} of {total} fixed-art items could be recoloured "
          f"({safe * 10} new PNGs at ten swatches each)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
