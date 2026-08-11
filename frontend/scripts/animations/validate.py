#!/usr/bin/env python3
"""Validate every imported PASER effect against its generated metadata."""

import json
from pathlib import Path

from PIL import Image, ImageChops


DENSITY_SCALES = (1, 2, 3)


def main() -> int:
    frontend = Path(__file__).resolve().parents[2]
    manifest_path = frontend / "assets" / "effects" / "import-manifest.json"
    if not manifest_path.exists():
        raise SystemExit("No import manifest. Run npm run animations:import first.")
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    errors = []
    ids = set()
    blocked_ids = {effect["id"] for effect in manifest.get("blockedAssets", [])}
    if manifest.get("releaseApprovedOnly") is not True:
        errors.append("manifest is not marked releaseApprovedOnly")
    if manifest.get("densityScales") != list(DENSITY_SCALES):
        errors.append(f"manifest densityScales must be {list(DENSITY_SCALES)}")
    for effect in manifest["effects"]:
        if effect["id"] in ids:
            errors.append(f"duplicate id: {effect['id']}")
        ids.add(effect["id"])
        if effect["id"] in blocked_ids or effect.get("releaseApproved") is not True:
            errors.append(f"{effect['id']}: release-blocked effect entered the generated registry")
        path = Path(effect["importedPath"])
        if not path.exists():
            errors.append(f"missing: {path}")
            continue
        with Image.open(path) as image:
            base_rgba = image.convert("RGBA")
            expected = (effect["columns"] * effect["frameWidth"], effect["rows"] * effect["frameHeight"])
            if image.size != expected:
                errors.append(f"{effect['id']}: {image.size} != {expected}")
            if image.width > 4096 or image.height > 4096:
                errors.append(f"{effect['id']}: texture side exceeds the mobile 4096 px limit")
            if base_rgba.getchannel("A").getbbox() is None:
                errors.append(f"{effect['id']}: sprite sheet contains no visible pixels")
        if effect.get("densityScales") != list(DENSITY_SCALES):
            errors.append(f"{effect['id']}: densityScales must be {list(DENSITY_SCALES)}")
        variants = effect.get("densityVariants") or {}
        for scale in DENSITY_SCALES[1:]:
            variant = variants.get(str(scale))
            if not variant:
                errors.append(f"{effect['id']}: missing @{scale}x density metadata")
                continue
            variant_path = Path(variant["path"])
            if variant_path.name != f"{path.stem}@{scale}x{path.suffix}":
                errors.append(f"{effect['id']}: malformed @{scale}x filename")
            if not variant_path.exists():
                errors.append(f"{effect['id']}: missing density asset: {variant_path}")
                continue
            expected_density = (expected[0] * scale, expected[1] * scale)
            with Image.open(variant_path) as image:
                if image.size != expected_density:
                    errors.append(f"{effect['id']}@{scale}x: {image.size} != {expected_density}")
                if image.width > 4096 or image.height > 4096:
                    errors.append(f"{effect['id']}@{scale}x: texture side exceeds the mobile 4096 px limit")
                density_rgba = image.convert("RGBA")
                if density_rgba.getchannel("A").getbbox() is None:
                    errors.append(f"{effect['id']}@{scale}x: sprite sheet contains no visible pixels")
                expected_pixels = base_rgba.resize(expected_density, Image.Resampling.NEAREST)
                if ImageChops.difference(density_rgba, expected_pixels).getbbox() is not None:
                    errors.append(f"{effect['id']}@{scale}x: pixels are not a nearest-neighbour density copy")
        for key in ("frameWidth", "frameHeight", "columns", "rows", "frameCount"):
            if not isinstance(effect.get(key), int) or effect[key] <= 0:
                errors.append(f"{effect['id']}: {key} must be a positive integer")
        if effect["frameCount"] > effect["columns"] * effect["rows"]:
            errors.append(f"{effect['id']}: frameCount exceeds grid capacity")
        if effect["fps"] <= 0:
            errors.append(f"{effect['id']}: fps must be positive")
        if effect.get("visualScale", 1) <= 0:
            errors.append(f"{effect['id']}: visualScale must be positive")
    runtime_bytes = sum(effect.get("runtimeBytes", 0) for effect in manifest["effects"])
    if runtime_bytes != manifest.get("selectedBytes"):
        errors.append(f"selectedBytes mismatch: {manifest.get('selectedBytes')} != {runtime_bytes}")
    if errors:
        print("\n".join(errors))
        return 1
    print(
        f"Validated {len(ids)} effects; 1x/2x/3x pixels, dimensions, grid capacity, "
        "IDs and FPS are consistent."
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
