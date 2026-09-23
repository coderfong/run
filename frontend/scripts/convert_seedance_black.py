"""Convert a black-backed Seedance clip to an alpha animated WebP.

Only near-black pixels connected to a frame edge become transparent. Enclosed
black ink therefore survives as the artwork's outline.
"""

from collections import deque
from pathlib import Path
import shutil
import subprocess
import sys

from PIL import Image


def clear_connected_background(path: Path, threshold: int = 34) -> None:
    image = Image.open(path).convert("RGBA")
    pixels = image.load()
    width, height = image.size
    seen = bytearray(width * height)
    queue = deque()

    def enqueue(x: int, y: int) -> None:
        index = y * width + x
        if seen[index]:
            return
        r, g, b, _ = pixels[x, y]
        if max(r, g, b) > threshold:
            return
        seen[index] = 1
        queue.append((x, y))

    for x in range(width):
        enqueue(x, 0)
        enqueue(x, height - 1)
    for y in range(height):
        enqueue(0, y)
        enqueue(width - 1, y)

    while queue:
        x, y = queue.popleft()
        pixels[x, y] = (0, 0, 0, 0)
        if x: enqueue(x - 1, y)
        if x + 1 < width: enqueue(x + 1, y)
        if y: enqueue(x, y - 1)
        if y + 1 < height: enqueue(x, y + 1)

    image.save(path)


def main() -> None:
    source = Path(sys.argv[1]).resolve()
    output = Path(sys.argv[2]).resolve()
    work = output.parent / f".{output.stem}-frames"
    shutil.rmtree(work, ignore_errors=True)
    work.mkdir(parents=True)
    subprocess.run([
        "ffmpeg", "-y", "-i", str(source), "-vf", "fps=24,scale=640:640",
        str(work / "%04d.png"),
    ], check=True)
    frames = sorted(work.glob("*.png"))
    for frame in frames:
        clear_connected_background(frame)
    subprocess.run([
        "ffmpeg", "-y", "-framerate", "24", "-i", str(work / "%04d.png"),
        "-c:v", "libwebp_anim", "-lossless", "0", "-q:v", "76", "-loop", "0",
        str(output),
    ], check=True)
    shutil.rmtree(work)
    print(f"{len(frames)} frames -> {output}")


if __name__ == "__main__":
    main()
