"""Push re-solved wave-3 layouts into cosmetics.js.

merge-catalog-3.py only ADDS items it hasn't seen, which is right for a first
install and wrong after the body is rebuilt: the 32 wigs were re-fitted to the
new head by install-items-3.py, but their catalogue lines still carry the
layout solved against the old one. This rewrites just the `layout: { ... }` of
each wave-3 item in place, leaving ids, unlocks and every other field alone.

Run from frontend/:  python scripts/sync-layouts-3.py
"""
import json
import os
import re

SCRATCH = os.path.dirname(os.path.abspath(__file__))
CAT = os.path.join(SCRATCH, "..", "src", "config", "cosmetics.js")

items = json.load(open(os.path.join(SCRATCH, "installed3.json")))
src = open(CAT, encoding="utf-8").read()

changed = skipped = 0
for it in items:
    lay = it.get("layout") or {}
    line_re = re.compile(r"^(    \{ id: '%s',.*)$" % re.escape(it["id"]), re.M)
    m = line_re.search(src)
    if not m:
        skipped += 1
        continue
    line = m.group(1)
    body = ", ".join(f"{k}: {v}" for k, v in lay.items())
    new_layout = f"layout: {{ {body} }}" if lay else None

    if "layout: {" in line:
        if new_layout:
            line2 = re.sub(r"layout: \{[^}]*\}", new_layout, line)
        else:                       # solved layout is now empty -> drop it
            line2 = re.sub(r", layout: \{[^}]*\}", "", line)
    elif new_layout:                # gained a layout it didn't have
        line2 = line.replace("), rarity:", f"), {new_layout}, rarity:", 1)
        if line2 == line:
            line2 = line.replace(", rarity:", f", {new_layout}, rarity:", 1)
    else:
        continue

    if line2 != line:
        src = src[:m.start(1)] + line2 + src[m.end(1):]
        changed += 1

open(CAT, "w", encoding="utf-8", newline="\n").write(src)
print(f"{changed} layouts synced, {skipped} ids not found in the catalogue")
