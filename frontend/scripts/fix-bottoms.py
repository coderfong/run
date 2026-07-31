"""Re-proportion leggings (bottom6) and track pants (bottom9): their art is
much taller-per-width than the existing pants (bottom1 aspect 1.67), so at a
believable leg width they render past the ankles. Squash height so aspect
matches the rig's leg length; cartoon art tolerates it and the legs read
chunkier (closer to the body art's proportions)."""
import os
from PIL import Image

CH = r"C:\Users\user\Desktop\run\frontend\assets\character\outfit"
TARGET_ASPECT = 512 / 306  # existing bottom1 pants: renders ankle-length

for base in ["bottom6", "bottom9"]:
    for suf in [""] + [f"_{i}" for i in range(10)]:
        p = os.path.join(CH, f"{base}{suf}.png")
        im = Image.open(p).convert("RGBA")
        w, h = im.size
        nh = round(w * TARGET_ASPECT)
        if abs(nh - h) < 3:
            continue
        im = im.resize((w, nh), Image.LANCZOS)
        im.save(p, optimize=True)
    print(base, w, h, "->", w, nh)
