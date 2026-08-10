"""Splice catalog_snippet3.js into src/config/cosmetics.js.

Appends each slot's new lines to the end of that slot's array, just before the
closing bracket, so existing ordering (and the 'none' entry that has to stay
first in every optional slot) is untouched.
"""
import os
import re

SCRATCH = os.path.dirname(os.path.abspath(__file__))
CAT = os.path.join(SCRATCH, "..", "src", "config", "cosmetics.js")
SNIP = os.path.join(SCRATCH, "catalog_snippet3.js")

snippet = open(SNIP, encoding="utf-8").read()
blocks = {}
for m in re.finditer(r"// ---- (\w+) ----\n(.*?)(?=\n// ----|\Z)", snippet, re.S):
    blocks[m.group(1)] = [l for l in m.group(2).splitlines() if l.strip()]

src = open(CAT, encoding="utf-8").read()
added = 0
for slot, lines in blocks.items():
    # the slot's array inside `export const ITEMS = { ... }`
    m = re.search(r"\n  %s: \[\n(.*?)\n  \],\n" % slot, src, re.S)
    assert m, f"no {slot} array found"
    body = m.group(1)
    ids = set(re.findall(r"id: '([^']+)'", body))
    fresh = [l for l in lines if re.search(r"id: '([^']+)'", l).group(1) not in ids]
    if not fresh:
        continue
    marker = "    // --- wave 3 (2026-07-31) ---"
    insert = ("\n" + marker + "\n" + "\n".join(fresh)) if marker not in body \
        else "\n" + "\n".join(fresh)
    src = src[:m.end(1)] + insert + src[m.end(1):]
    added += len(fresh)
    print(f"{slot:9s} +{len(fresh)}")

open(CAT, "w", encoding="utf-8", newline="\n").write(src)
print(f"\n{added} items spliced into cosmetics.js")
