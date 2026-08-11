#!/usr/bin/env python3
"""Inventory PASER's external animation library without modifying it.

Archives are expanded into an OS temp cache solely so Pillow can inspect their
contents.  Inventory paths always point back to the source archive and entry.
"""

from __future__ import annotations

import argparse
import collections
import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
from typing import Any

from PIL import Image, UnidentifiedImageError


ARCHIVES = {".zip", ".rar"}
IMAGE_EXTENSIONS = {".png", ".gif", ".webp", ".jpg", ".jpeg", ".bmp"}
SUPPORTED_EXTENSIONS = IMAGE_EXTENSIONS | {".json"}
IGNORED_PARTS = {"__macosx", ".ds_store"}
OVERSIZED_BYTES = 4 * 1024 * 1024
MAX_TEXTURE_SIDE = 4096
MAX_TEXTURE_PIXELS = 16_777_216

CATEGORY_RULES = (
    ("pets", ("animal", "pet", "chicken", "ducky", "duck", "rat", "shroom", "dog", "cat", "bird", "creature")),
    ("emoji", ("emoji", "emote", "reaction", "angry", "dizzy", "surprise", "heart")),
    ("explosion", ("explosion", "blast", "bomb", "detonat")),
    ("lightning", ("lightning", "electric", "thunder", "bolt")),
    ("portal", ("portal", "warp", "teleport")),
    ("smoke", ("smoke", "cloud", "fog")),
    ("fire", ("fire", "flame", "inferno", "ember", "burn")),
    ("ice", ("ice", "frost", "snow", "freeze")),
    ("water", ("water", "splash", "bubble", "aqua")),
    ("magic", ("magic", "spell", "holy", "arcane", "rune")),
    ("glitch", ("glitch", "pixelat", "digital")),
    ("celebration", ("confetti", "coin", "star", "sparkle", "victory", "celebrat", "chest", "jackpot")),
    ("impact", ("impact", "hit", "slash", "shockwave", "burst", "blood")),
    ("energy", ("energy", "laser", "beam", "charge", "orb", "pulse", "aura")),
    ("projectile", ("bullet", "shoot", "projectile", "missile", "arrow")),
    ("ambient", ("leaf", "leaves", "rain", "dust", "wind", "firefl")),
    ("character", ("warrior", "idle", "walk", "run", "attack", "jump", "die", "hurt")),
    ("ui", ("ui pack", "icon", "button", "frame", "scope", "cursor")),
)

TAG_WORDS = (
    "animal", "angry", "arcane", "beam", "blood", "bolt", "bomb", "bubble",
    "bullet", "burst", "celebration", "charge", "chest", "coin", "confetti",
    "dark", "debris", "digital", "dizzy", "electric", "emoji", "energy",
    "explosion", "fire", "flame", "frost", "glitch", "heart", "holy", "ice",
    "impact", "laser", "leaf", "lightning", "magic", "meteor", "orb", "pet",
    "portal", "projectile", "pulse", "rain", "reaction", "shockwave", "smoke",
    "snow", "spark", "sparkle", "star", "surprise", "thunder", "victory", "warp",
    "water", "wind",
)


def norm_path(value: str) -> str:
    return value.replace("\\", "/")


def source_key(container: Path, entry: str | None = None) -> str:
    base = str(container.resolve())
    return f"{base}::{norm_path(entry)}" if entry else base


def slug(value: str) -> str:
    value = re.sub(r"(?i)(sprite[ _-]?sheet|sprites|sheet|animation|animated|preview|free|final|effect|fx)", " ", value)
    value = re.sub(r"[^a-zA-Z0-9]+", "_", value.lower()).strip("_")
    return value[:54] or "asset"


def stable_id(category: str, label: str, key: str) -> str:
    suffix = hashlib.sha1(norm_path(key).lower().encode("utf-8")).hexdigest()[:8]
    return f"{category}_{slug(label)}_{suffix}"


def classify(path_text: str) -> tuple[str, list[str], float]:
    lower = re.sub(r"[_-]+", " ", path_text.lower())
    def contains(word: str) -> bool:
        return bool(re.search(rf"\b{re.escape(word)}\b", lower)) if len(word) <= 3 else word in lower

    matches: list[tuple[str, int]] = []
    tags = {word for word in TAG_WORDS if contains(word)}
    for category, words in CATEGORY_RULES:
        score = sum(1 for word in words if contains(word))
        if score:
            matches.append((category, score))
    # State words such as idle/walk/run should refine an animal, not reclassify
    # it as a generic character. This also avoids substring accidents such as
    # the "rat" inside System.Configuration.dll.
    animal_words = ("animal", "pet", "chicken", "ducky", "duck", "rat", "shroom", "dog", "cat", "bird", "creature")
    if any(contains(word) for word in animal_words):
        tags.add("pets")
        return "pets", sorted(tags), 0.88
    if not matches:
        return "misc", sorted(tags), 0.25
    matches.sort(key=lambda item: (-item[1], item[0]))
    category, score = matches[0]
    tags.add(category)
    confidence = min(0.94, 0.52 + 0.13 * score)
    return category, sorted(tags), confidence


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def transparency(image: Image.Image) -> bool:
    if image.mode in {"RGBA", "LA"}:
        lo, hi = image.getchannel("A").getextrema()
        return lo < 255
    if image.mode == "P" and "transparency" in image.info:
        return True
    return False


def dhash(image: Image.Image) -> str:
    sample = image.convert("L").resize((9, 8), Image.Resampling.BILINEAR)
    pixels = list(sample.get_flattened_data())
    bits = 0
    for y in range(8):
        for x in range(8):
            bits = (bits << 1) | int(pixels[y * 9 + x] > pixels[y * 9 + x + 1])
    return f"{bits:016x}"


def content_bbox(image: Image.Image) -> tuple[int, int, int, int] | None:
    rgba = image.convert("RGBA")
    return rgba.getchannel("A").getbbox()


def divisor_candidates(value: int, limit: int = 32) -> list[int]:
    return [count for count in range(2, min(limit, value) + 1) if value % count == 0]


def score_grid(alpha: Image.Image, columns: int, rows: int) -> float:
    """Score how plausibly a transparent image is a regular sprite grid."""
    width, height = alpha.size
    fw, fh = width // columns, height // rows
    if fw < 8 or fh < 8:
        return -1
    occupied = 0
    edge_clear = 0
    for row in range(rows):
        for col in range(columns):
            cell = alpha.crop((col * fw, row * fh, (col + 1) * fw, (row + 1) * fh))
            if not cell.getbbox():
                continue
            occupied += 1
            edges = [
                cell.crop((0, 0, fw, 1)), cell.crop((0, fh - 1, fw, fh)),
                cell.crop((0, 0, 1, fh)), cell.crop((fw - 1, 0, fw, fh)),
            ]
            if sum(1 for edge in edges if not edge.getbbox()) >= 2:
                edge_clear += 1
    cells = columns * rows
    if occupied < max(2, cells * 0.55):
        return -1
    return (occupied / cells) * 0.55 + (edge_clear / occupied) * 0.35 - (cells / 1024)


def detect_sprite_layout(image: Image.Image, name: str) -> dict[str, Any] | None:
    width, height = image.size
    lower = name.lower()
    explicit = any(word in lower for word in ("sprite", "sheet", "strip", "rows", "columns"))
    candidates: list[tuple[float, int, int, str]] = []
    # Alpha conversion is the expensive part. Do it once per source image,
    # not once per candidate grid (large packs can expose dozens of divisors).
    alpha = image.convert("RGBA").getchannel("A")

    if width / max(1, height) >= 2.4:
        for columns in divisor_candidates(width):
            fw = width // columns
            if 8 <= fw <= height * 2:
                score = score_grid(alpha, columns, 1)
                candidates.append((score + 0.12, columns, 1, "horizontal-strip"))
    if height / max(1, width) >= 2.4:
        for rows in divisor_candidates(height):
            fh = height // rows
            if 8 <= fh <= width * 2:
                score = score_grid(alpha, 1, rows)
                candidates.append((score + 0.12, 1, rows, "vertical-strip"))

    if explicit or (width >= 64 and height >= 64):
        for columns in divisor_candidates(width, 16):
            for rows in divisor_candidates(height, 16):
                cells = columns * rows
                if cells > 128:
                    continue
                fw, fh = width // columns, height // rows
                aspect = fw / max(1, fh)
                if not (0.45 <= aspect <= 2.2):
                    continue
                score = score_grid(alpha, columns, rows)
                if explicit:
                    score += 0.12
                candidates.append((score, columns, rows, "regular-grid"))

    candidates = [item for item in candidates if item[0] >= 0]
    if not candidates:
        return None
    candidates.sort(key=lambda item: (item[0], -(item[1] * item[2])), reverse=True)
    score, columns, rows, layout = candidates[0]
    confidence = max(0.3, min(0.96, score))
    # A weak geometry-only guess stays visible in inventory but is not imported
    # until an override or human review confirms it.
    if confidence < 0.53 and not explicit:
        return None
    return {
        "layout": layout,
        "sheetWidth": width,
        "sheetHeight": height,
        "frameWidth": width // columns,
        "frameHeight": height // rows,
        "columns": columns,
        "rows": rows,
        "frameCount": columns * rows,
        "layoutConfidence": round(confidence, 2),
        "layoutNeedsReview": confidence < 0.72,
    }


def sidecar_sprite_layout(path: Path, width: int, height: int) -> dict[str, Any] | None:
    """Read exact grid metadata when a pack ships it beside the sheet."""
    manifest = path.with_name("manifest.json")
    if manifest.exists():
        try:
            data = json.loads(manifest.read_text(encoding="utf-8-sig"))
            frames = data.get("frames") if isinstance(data, dict) else None
            if frames and all(isinstance(frame.get("sheet"), dict) for frame in frames):
                sheets = [frame["sheet"] for frame in frames]
                frame_widths = {int(sheet["width"]) for sheet in sheets}
                frame_heights = {int(sheet["height"]) for sheet in sheets}
                if len(frame_widths) == len(frame_heights) == 1:
                    fw, fh = frame_widths.pop(), frame_heights.pop()
                    xs = sorted({int(sheet["x"]) for sheet in sheets})
                    ys = sorted({int(sheet["y"]) for sheet in sheets})
                    # The fixed-grid export is directly playable. A packed atlas
                    # can have irregular x/y placements and stays review-only.
                    regular = all(sheet["x"] % fw == 0 and sheet["y"] % fh == 0 for sheet in sheets)
                    duration = frames[0].get("duration") or {}
                    numerator = float(duration.get("numerator_ms", 0) or 0)
                    denominator = float(duration.get("denominator", 0) or 0)
                    fps = (1000 * denominator / numerator) if numerator and denominator else None
                    return {
                        "layout": "regular-grid" if regular else "packed-atlas",
                        "sheetWidth": width,
                        "sheetHeight": height,
                        "frameWidth": fw,
                        "frameHeight": fh,
                        "columns": width // fw if regular else len(xs),
                        "rows": height // fh if regular else len(ys),
                        "frameCount": len(frames),
                        "fps": round(fps, 2) if fps else None,
                        "layoutConfidence": 1.0,
                        "layoutNeedsReview": not regular,
                        "metadataSource": manifest.name,
                    }
        except (OSError, ValueError, KeyError, TypeError, json.JSONDecodeError):
            pass

    text_sidecar = path.with_suffix(".txt")
    if text_sidecar.exists():
        try:
            pattern = re.compile(r"=\s*(\d+)\s+(\d+)\s+(\d+)\s+(\d+)\s*$")
            placements = []
            for line in text_sidecar.read_text(encoding="utf-8-sig").splitlines():
                match = pattern.search(line)
                if match:
                    placements.append(tuple(map(int, match.groups())))
            if placements:
                widths = {item[2] for item in placements}
                heights = {item[3] for item in placements}
                if len(widths) == len(heights) == 1:
                    fw, fh = widths.pop(), heights.pop()
                    regular = all(x % fw == 0 and y % fh == 0 for x, y, _, _ in placements)
                    return {
                        "layout": "regular-grid" if regular else "packed-atlas",
                        "sheetWidth": width,
                        "sheetHeight": height,
                        "frameWidth": fw,
                        "frameHeight": fh,
                        "columns": width // fw if regular else None,
                        "rows": height // fh if regular else None,
                        "frameCount": len(placements),
                        "layoutConfidence": 1.0,
                        "layoutNeedsReview": not regular,
                        "metadataSource": text_sidecar.name,
                    }
        except (OSError, UnicodeError):
            pass
    return None


def inspect_image(path: Path) -> dict[str, Any]:
    with Image.open(path) as image:
        width, height = image.size
        frame_count = int(getattr(image, "n_frames", 1))
        animated = bool(getattr(image, "is_animated", False) and frame_count > 1)
        duration = image.info.get("duration")
        info: dict[str, Any] = {
            "width": width,
            "height": height,
            "mode": image.mode,
            "hasTransparency": transparency(image),
            "embeddedFrameCount": frame_count,
            "isAnimated": animated,
            "durationMsPerFrame": duration if isinstance(duration, (int, float)) else None,
            "perceptualHash": dhash(image),
            "contentBounds": list(content_bbox(image) or ()),
        }
        if animated:
            info["animationType"] = "animated-image"
            info["frameCount"] = frame_count
            if duration:
                info["fps"] = round(1000 / duration, 2)
        elif path.suffix.lower() == ".png":
            # Packs that export frame0000.png, frame0001.png, ... are image
            # sequences. A single frame can contain several disconnected
            # shapes, which must not be mistaken for a grid within that frame.
            sequence_member = bool(re.match(r"^.*?\D[_-]?\d{3,}$", path.stem))
            layout = None if sequence_member else (
                sidecar_sprite_layout(path, width, height) or detect_sprite_layout(image, path.name)
            )
            if layout:
                info.update(layout)
                info["animationType"] = "spritesheet"
            else:
                info["animationType"] = "static-image"
        else:
            info["animationType"] = "static-image"
        return info


def inspect_json(path: Path) -> dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8-sig") as handle:
            data = json.load(handle)
    except (OSError, UnicodeError, json.JSONDecodeError) as exc:
        return {"animationType": "invalid-json", "inspectionError": str(exc)}
    is_lottie = isinstance(data, dict) and all(key in data for key in ("v", "fr", "ip", "op", "layers"))
    if not is_lottie:
        return {"animationType": "generic-json", "isLottie": False}
    frames = max(0, float(data["op"]) - float(data["ip"]))
    fps = float(data["fr"])
    return {
        "animationType": "lottie",
        "isLottie": True,
        "width": data.get("w"),
        "height": data.get("h"),
        "frameCount": round(frames),
        "fps": fps,
        "durationMs": round(frames / fps * 1000) if fps else None,
        "lottieVersion": data.get("v"),
    }


def special_support(animation_type: str, extension: str) -> str:
    if animation_type == "spritesheet":
        return "PASER SpriteAnimation metadata"
    if animation_type == "lottie":
        return "lottie-react-native"
    if animation_type == "animated-image":
        return "expo-image animated GIF/WebP decoder"
    if animation_type == "frame-sequence":
        return "PASER frame sequence player"
    if animation_type == "static-image":
        return "React Native image"
    if extension in {".aseprite", ".ase", ".psd"}:
        return "authoring export required"
    return "unsupported or non-runtime source file"


def safe_archive_entries(archive: Path) -> list[str]:
    proc = subprocess.run(
        ["tar", "-tf", str(archive)], capture_output=True, text=True, errors="replace", check=False
    )
    if proc.returncode and not proc.stdout:
        raise RuntimeError(proc.stderr.strip() or f"Could not read {archive}")
    entries = [
        line for line in proc.stdout.splitlines()
        if line and not line.endswith(("/", "\\"))
    ]
    for entry in entries:
        pure = PurePosixPath(norm_path(entry))
        if pure.is_absolute() or ".." in pure.parts:
            raise RuntimeError(f"Unsafe archive entry: {archive.name}::{entry}")
    return entries


def extract_archive(archive: Path, cache_root: Path) -> tuple[Path, list[str]]:
    digest = hashlib.sha1(str(archive.resolve()).encode("utf-8")).hexdigest()[:10]
    destination = cache_root / f"{slug(archive.stem)}-{digest}"
    entries = safe_archive_entries(archive)
    marker = destination / ".paser-extracted"
    if marker.exists():
        return destination, entries
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True)
    proc = subprocess.run(
        ["tar", "-xf", str(archive), "-C", str(destination)],
        capture_output=True, text=True, errors="replace", check=False,
    )
    # libarchive can report recoverable RAR filter warnings after extracting all
    # usable entries. Keep the files, but surface the warning in the report.
    marker.write_text(proc.stderr.strip(), encoding="utf-8")
    return destination, entries


def record_for(path: Path, container: Path, entry: str | None) -> dict[str, Any]:
    key = source_key(container, entry)
    extension = path.suffix.lower()
    classification_path = f"{container.name}/{entry}" if entry else path.name
    category, tags, confidence = classify(classification_path)
    record: dict[str, Any] = {
        "fileName": path.name,
        "originalName": path.name,
        "absoluteSourcePath": key,
        "containerPath": str(container.resolve()),
        "archiveEntry": norm_path(entry) if entry else None,
        "extension": extension or None,
        "format": extension.lstrip(".") or "unknown",
        "fileSize": path.stat().st_size,
        "sha256": sha256_file(path),
        "category": category,
        "tags": tags,
        "classificationConfidence": round(confidence, 2),
    }
    try:
        if extension in IMAGE_EXTENSIONS:
            record.update(inspect_image(path))
        elif extension == ".json":
            record.update(inspect_json(path))
        else:
            record["animationType"] = "source-or-unsupported"
    except (OSError, ValueError, UnidentifiedImageError) as exc:
        record.update({"animationType": "broken-image", "inspectionError": str(exc)})

    width, height = record.get("width") or 0, record.get("height") or 0
    reasons = []
    if record["fileSize"] > OVERSIZED_BYTES:
        reasons.append("file-over-4MB")
    if max(width, height) > MAX_TEXTURE_SIDE:
        reasons.append("texture-side-over-4096")
    if width * height > MAX_TEXTURE_PIXELS:
        reasons.append("texture-over-16MP")
    if record["animationType"] in {"broken-image", "invalid-json", "generic-json", "source-or-unsupported"}:
        reasons.append("unsupported-runtime-format")
    if record["animationType"] == "spritesheet" and record.get("layoutNeedsReview"):
        reasons.append("sprite-layout-needs-review")
    record["oversized"] = any(reason.startswith(("file-", "texture-")) for reason in reasons)
    record["looksUsableInPASER"] = not reasons or reasons == ["sprite-layout-needs-review"]
    record["exclusionReasons"] = reasons
    record["specialRuntimeSupport"] = special_support(record["animationType"], extension)
    record["id"] = stable_id(category, path.stem, key)
    return record


def record_for_missing_entry(container: Path, entry: str) -> dict[str, Any]:
    """Keep an unreadable archive member in the inventory instead of hiding it."""
    key = source_key(container, entry)
    extension = Path(entry).suffix.lower()
    category, tags, confidence = classify(f"{container.name}/{entry}")
    return {
        "id": stable_id(category, Path(entry).stem, key),
        "fileName": PurePosixPath(norm_path(entry)).name,
        "originalName": PurePosixPath(norm_path(entry)).name,
        "absoluteSourcePath": key,
        "containerPath": str(container.resolve()),
        "archiveEntry": norm_path(entry),
        "extension": extension or None,
        "format": extension.lstrip(".") or "unknown",
        "fileSize": None,
        "sha256": None,
        "category": category,
        "tags": tags,
        "classificationConfidence": round(confidence, 2),
        "animationType": "inaccessible-archive-entry",
        "oversized": False,
        "looksUsableInPASER": False,
        "exclusionReasons": ["archive-entry-could-not-be-extracted"],
        "specialRuntimeSupport": "archive extraction support required",
        "inspectionError": "The platform archive reader listed this entry but could not extract it.",
    }


SEQUENCE_RE = re.compile(r"^(.*?\D)[_-]?(\d{3,})$", re.IGNORECASE)


def group_frame_sequences(files: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[str, str], list[tuple[int, dict[str, Any]]]] = collections.defaultdict(list)
    for item in files:
        if item.get("animationType") != "static-image":
            continue
        stem = Path(item["fileName"]).stem
        match = SEQUENCE_RE.match(stem)
        if not match:
            continue
        parent = norm_path(str(PurePosixPath(item.get("archiveEntry") or item["absoluteSourcePath"]).parent))
        buckets[(parent, match.group(1).lower())].append((int(match.group(2)), item))

    sequences = []
    for (_, prefix), members in buckets.items():
        members.sort(key=lambda pair: pair[0])
        if len(members) < 3:
            continue
        numbers = [number for number, _ in members]
        if any(b - a != 1 for a, b in zip(numbers, numbers[1:])):
            continue
        items = [item for _, item in members]
        dimensions = {(item.get("width"), item.get("height")) for item in items}
        if len(dimensions) != 1:
            continue
        first = items[0]
        key = first["absoluteSourcePath"]
        sequences.append({
            "id": stable_id(first["category"], prefix, key),
            "originalName": prefix,
            "animationType": "frame-sequence",
            "category": first["category"],
            "tags": sorted(set(first["tags"] + ["frame-sequence"])),
            "classificationConfidence": first["classificationConfidence"],
            "frameCount": len(items),
            "frameWidth": first.get("width"),
            "frameHeight": first.get("height"),
            "frames": [item["absoluteSourcePath"] for item in items],
            "looksUsableInPASER": all(item["looksUsableInPASER"] for item in items),
            "specialRuntimeSupport": "PASER frame sequence player",
        })
        for item in items:
            item["sequenceId"] = sequences[-1]["id"]
    return sequences


def duplicate_report(files: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    exact: dict[str, list[dict[str, Any]]] = collections.defaultdict(list)
    perceptual: dict[tuple[str, int, int], list[dict[str, Any]]] = collections.defaultdict(list)
    for item in files:
        if item.get("sha256"):
            exact[item["sha256"]].append(item)
        if item.get("perceptualHash"):
            perceptual[(item["perceptualHash"], item.get("width", 0), item.get("height", 0))].append(item)
    exact_groups = []
    exact_paths = set()
    for digest, members in exact.items():
        if len(members) < 2:
            continue
        paths = [member["absoluteSourcePath"] for member in members]
        exact_groups.append({"sha256": digest, "count": len(paths), "paths": paths})
        exact_paths.update(paths)
        for member in members:
            member["duplicateGroup"] = digest[:12]
    likely_groups = []
    for (fingerprint, width, height), members in perceptual.items():
        distinct_hashes = {member["sha256"] for member in members}
        if len(members) < 2 or len(distinct_hashes) < 2:
            continue
        paths = [member["absoluteSourcePath"] for member in members]
        likely_groups.append({
            "perceptualHash": fingerprint, "width": width, "height": height,
            "count": len(paths), "paths": paths,
        })
        for member in members:
            member["likelyDuplicateGroup"] = f"{fingerprint}:{width}x{height}"
    return exact_groups, likely_groups


def build_summary(inventory: dict[str, Any]) -> str:
    summary = inventory["summary"]
    lines = [
        "# PASER Animation Library",
        "",
        f"Generated {inventory['generatedAt']} from `{inventory['sourceRoot']}`.",
        "",
        "## Library totals",
        "",
        f"- Top-level source files: **{summary['topLevelFiles']}**",
        f"- Files inside archives: **{summary['containedFiles']}**",
        f"- Runtime media/source records inspected: **{summary['inspectedFiles']}**",
        f"- Detected animations: **{summary['detectedAnimations']}**",
        f"- Source size: **{summary['sourceBytes'] / 1024 / 1024:.1f} MB** compressed/loose",
        f"- Extracted archive size: **{summary['extractedBytes'] / 1024 / 1024:.1f} MB**",
        f"- Exact duplicate groups: **{summary['exactDuplicateGroups']}**",
        f"- Likely duplicate groups: **{summary['likelyDuplicateGroups']}**",
        f"- Supported/usable records: **{summary['usableFiles']}**",
        f"- Unsupported or broken records: **{summary['unsupportedFiles']}**",
        f"- Oversized records: **{summary['oversizedFiles']}**",
        f"- Assets selected for the Expo bundle: **{summary['selectedForImport']}**",
        "",
        "## Formats found",
        "",
        "| Format | Files |",
        "| --- | ---: |",
    ]
    lines.extend(f"| `{key or 'no extension'}` | {value} |" for key, value in summary["formats"].items())
    lines += ["", "## Animation types", "", "| Type | Records |", "| --- | ---: |"]
    lines.extend(f"| {key} | {value} |" for key, value in summary["animationTypes"].items())
    lines += ["", "## Categories", "", "| Category | Records |", "| --- | ---: |"]
    lines.extend(f"| {key} | {value} |" for key, value in summary["categories"].items())
    lines += [
        "",
        "## Import policy",
        "",
        "This inventory does not bundle the source collection. Only assets named in "
        "`frontend/scripts/animations/animation-selection.json` are copied into the Expo app. "
        "Uncertain sprite layouts remain reviewable and require an override before import.",
        "",
        "See the machine-readable `docs/animation-library-inventory.json` for every record, "
        "archive entry, hash, dimension, alpha result, duplicate group, and exclusion reason.",
        "",
    ]
    return "\n".join(lines)


def apply_overrides(files: list[dict[str, Any]], overrides_path: Path) -> int:
    """Apply explicit human-reviewed metadata without weakening scanner defaults."""
    if not overrides_path.is_file():
        return 0
    document = json.loads(overrides_path.read_text(encoding="utf-8"))
    if not isinstance(document, dict):
        raise ValueError(f"Overrides must be an object keyed by absoluteSourcePath: {overrides_path}")
    overrides = document.get("overrides", document)
    if not isinstance(overrides, dict):
        raise ValueError(f"The overrides field must be an object: {overrides_path}")
    applied = 0
    for item in files:
        patch = overrides.get(item["absoluteSourcePath"])
        if patch is None:
            continue
        if not isinstance(patch, dict):
            raise ValueError(f"Override for {item['absoluteSourcePath']} must be an object")
        item.update(patch)
        applied += 1
    return applied


def scan(
    source: Path,
    inventory_path: Path,
    summary_path: Path,
    cache_root: Path,
    overrides_path: Path,
) -> dict[str, Any]:
    source = source.resolve()
    top_level = sorted((path for path in source.rglob("*") if path.is_file()), key=lambda p: str(p).lower())
    files: list[dict[str, Any]] = []
    containers = []
    contained_files = 0
    extracted_bytes = 0
    archive_warnings = []

    cache_root.mkdir(parents=True, exist_ok=True)
    for container in top_level:
        container_info = {
            "fileName": container.name,
            "absoluteSourcePath": str(container),
            "extension": container.suffix.lower() or None,
            "fileSize": container.stat().st_size,
            "sha256": sha256_file(container),
            "isArchive": container.suffix.lower() in ARCHIVES,
        }
        containers.append(container_info)
        if container.suffix.lower() in ARCHIVES:
            try:
                extracted_root, entries = extract_archive(container, cache_root)
                contained_files += len(entries)
                marker = extracted_root / ".paser-extracted"
                warning = marker.read_text(encoding="utf-8") if marker.exists() else ""
                if warning:
                    archive_warnings.append({"archive": str(container), "warning": warning})
                entry_lookup = {norm_path(entry).lower(): entry for entry in entries}
                observed_entries = set()
                for extracted in extracted_root.rglob("*"):
                    if not extracted.is_file() or extracted.name == ".paser-extracted":
                        continue
                    relative = norm_path(str(extracted.relative_to(extracted_root)))
                    entry = entry_lookup.get(relative.lower(), relative)
                    observed_entries.add(norm_path(entry).lower())
                    extracted_bytes += extracted.stat().st_size
                    files.append(record_for(extracted, container, entry))
                for entry in entries:
                    if norm_path(entry).lower() not in observed_entries:
                        files.append(record_for_missing_entry(container, entry))
            except Exception as exc:  # keep the rest of a multi-pack scan useful
                container_info["inspectionError"] = str(exc)
        else:
            files.append(record_for(container, container, None))

    overrides_applied = apply_overrides(files, overrides_path)
    sequences = group_frame_sequences(files)
    exact_duplicates, likely_duplicates = duplicate_report(files)
    runtime_animations = [
        item for item in files
        if item["animationType"] in {"spritesheet", "animated-image", "lottie"} and not item.get("sequenceId")
    ] + sequences

    formats = collections.Counter((item["extension"] or "") for item in files)
    types = collections.Counter(item["animationType"] for item in files)
    categories = collections.Counter(item["category"] for item in files)
    unsupported = sum(
        item["animationType"] in {
            "source-or-unsupported", "broken-image", "invalid-json", "generic-json",
            "inaccessible-archive-entry",
        }
        for item in files
    )
    inventory = {
        "schemaVersion": 1,
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "sourceRoot": str(source),
        "scanCache": str(cache_root),
        "overridesFile": str(overrides_path),
        "overridesApplied": overrides_applied,
        "thresholds": {
            "oversizedBytes": OVERSIZED_BYTES,
            "maxTextureSide": MAX_TEXTURE_SIDE,
            "maxTexturePixels": MAX_TEXTURE_PIXELS,
        },
        "summary": {
            "topLevelFiles": len(top_level),
            "containedFiles": contained_files,
            "inspectedFiles": len(files),
            "detectedAnimations": len(runtime_animations),
            "sourceBytes": sum(item["fileSize"] for item in containers),
            "extractedBytes": extracted_bytes,
            "formats": dict(sorted(formats.items(), key=lambda pair: (-pair[1], pair[0]))),
            "animationTypes": dict(sorted(types.items(), key=lambda pair: (-pair[1], pair[0]))),
            "categories": dict(sorted(categories.items(), key=lambda pair: (-pair[1], pair[0]))),
            "exactDuplicateGroups": len(exact_duplicates),
            "exactDuplicateFiles": sum(group["count"] - 1 for group in exact_duplicates),
            "likelyDuplicateGroups": len(likely_duplicates),
            "usableFiles": sum(bool(item["looksUsableInPASER"]) for item in files),
            "unsupportedFiles": unsupported,
            "oversizedFiles": sum(bool(item["oversized"]) for item in files),
            "selectedForImport": 0,
        },
        "containers": containers,
        "files": files,
        "frameSequences": sequences,
        "animations": runtime_animations,
        "exactDuplicates": exact_duplicates,
        "likelyDuplicates": likely_duplicates,
        "archiveWarnings": archive_warnings,
    }
    inventory_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    inventory_path.write_text(json.dumps(inventory, indent=2, ensure_ascii=False), encoding="utf-8")
    summary_path.write_text(build_summary(inventory), encoding="utf-8")
    return inventory


def main() -> int:
    script = Path(__file__).resolve()
    repo_root = script.parents[3]
    default_source = Path(os.environ.get("PASER_ANIMATION_SOURCE", Path.home() / "Desktop" / "animations"))
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, default=default_source)
    parser.add_argument("--inventory", type=Path, default=repo_root / "docs" / "animation-library-inventory.json")
    parser.add_argument("--summary", type=Path, default=repo_root / "docs" / "ANIMATION_LIBRARY.md")
    parser.add_argument("--cache", type=Path, default=Path(tempfile.gettempdir()) / "paser-animation-scan")
    parser.add_argument("--overrides", type=Path, default=script.with_name("animation-overrides.json"))
    args = parser.parse_args()
    if not args.source.is_dir():
        parser.error(f"Animation source directory does not exist: {args.source}")
    result = scan(
        args.source,
        args.inventory.resolve(),
        args.summary.resolve(),
        args.cache.resolve(),
        args.overrides.resolve(),
    )
    print(json.dumps(result["summary"], indent=2))
    print(f"Inventory: {args.inventory.resolve()}")
    print(f"Summary:   {args.summary.resolve()}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
