"""Copy every character asset — cosmetics, body, face — into ONE flat folder.

The art lives split across `assets/character/<category>/`, which is right for
the app and wrong for looking at, sending, or backing up. This mirrors the lot
into a single folder.

Filenames are PREFIXED with their category (`hair__hair12_3.png`), because the
categories collide: `_src/outfit/ofT1.png` and `outfit/ofT1.png` are different
pictures with the same name, and a plain flatten silently keeps one of them.

Re-runnable: it clears the destination's PNGs first, so a second run reflects
deletions rather than leaving orphans behind.

    python scripts/collect-character-assets.py [DEST]

DEST defaults to ~/Desktop/paser-character-assets.
"""

import shutil
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "assets" / "character"
DEFAULT_DEST = Path.home() / "Desktop" / "paser-character-assets"


def main() -> None:
    dest = Path(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_DEST
    if not SRC.is_dir():
        raise SystemExit(f"no character assets at {SRC}")

    dest.mkdir(parents=True, exist_ok=True)
    for old in dest.glob("*.png"):
        old.unlink()

    counts = {}
    total_bytes = 0
    for path in sorted(SRC.rglob("*.png")):
        rel = path.relative_to(SRC)
        # "hair/hair12.png" -> "hair__hair12.png"
        # "_src/outfit/ofT1.png" -> "src-outfit__ofT1.png"
        parts = list(rel.parts[:-1])
        if parts and parts[0] == "_src":
            parts[0] = "src"
            category = "-".join(parts)
        else:
            category = "-".join(parts) if parts else "loose"
        shutil.copy2(path, dest / f"{category}__{rel.name}")
        counts[category] = counts.get(category, 0) + 1
        total_bytes += path.stat().st_size

    width = max(len(c) for c in counts)
    for category in sorted(counts):
        print(f"  {category.ljust(width)}  {counts[category]:>4}")
    print(f"\n{sum(counts.values())} files, {total_bytes / 1e6:.0f} MB -> {dest}")


if __name__ == "__main__":
    main()
