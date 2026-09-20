from pathlib import Path
from PIL import Image, ImageDraw
import re

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Users\user\Desktop\new assets")
DEST = ROOT / "frontend" / "assets" / "character" / "curated"
CONFIG = ROOT / "frontend" / "src" / "config" / "curatedCosmetics.js"

CATALOG = {
"top": """Everyday Technical Tee|CORE
Hot-Weather Mesh Tee|CORE
Green Everyday Running Shirt|CORE
Dark Reflective Technical Tee|CORE
Coastal Sunrise Singlet|FREE
Competitive Track Singlet|PRO
Lightweight Rain Shell|CORE
Run Club Technical Shirt|CORE
Run Club Race Singlet|FREE
Trail Sleeveless Top|CORE
Singapore Race Singlet|EVENT
Windbreaker|CORE
Aurora Jacket|PRO
Varsity Jacket|CORE
Sleeveless Hoodie|CORE
Team Jersey|CORE
Cycling Jersey|CORE
Utility Vest|CORE
Tropical Camp Shirt|CORE
Cream Striped Knit|CORE
Lilac Half-Zip|CORE
White Stripe Polo|CORE
Blush Crop Jacket|FREE
Storm Parka|PRO
Judo Gi|CORE_ACHIEVEMENT
Knight Armour|BOX
Starlit Mage Robes|PRO
Shinobi Gi|BOX
Astronaut Suit|PRO
Pirate Coat|BOX
Leaf Fairy Dress|PRO
Valkyrie Armour|PRO
Tactical Rig|BOX
Cyber Runner Jacket|PRO
Neon Grid Shell|PRO
Midnight Reflective Hoodie|PRO
Gold Race-Day Singlet|PRO
City Run Club Jacket|CORE
Trail Expedition Vest|FREE
Tropical Storm Poncho|EVENT
Dragon Team Jersey|EVENT
Sea Breeze Windshirt|FREE
Champion Varsity Jacket|PRO
Shadow Runner Top|BOX
Holographic Shell|BOX
Lightning Race Suit|PRO
Heritage Runner Jacket|EVENT
Lunar Runner Jacket|BOX
Sunrise Marathon Singlet|FREE
Regional Championship Singlet|EVENT""",
"accessory": """Digital Sports Watch|CORE
Wireless Sports Earphones|CORE
Running Waist Pouch|CORE
Wearable Race Bib|CORE
Phone Armband|CORE
Cooling Neck Towel|CORE
Night Running Light Harness|PRO
Run Club Cross-Body Bag|CORE
Hydration Race Vest|CORE
Neck Gaiter|CORE
Gold Medal|ACHIEVEMENT
Trophy Chain|PRO
Race Harness|CORE
Dog Tags|CORE
Pearl Strand|CORE
Charm Chain|CORE
Flower Lei|EVENT
Neckerchief|CORE
Bow Tie|CORE
Necktie|CORE
Heart Handbag|CORE
Waterproof Phone Pouch|FREE
Electrolyte Running Belt|FREE
Run Club Lanyard|FREE
Reflective Race Sash|CORE
Lucky Charm Pendant|BOX
Finish-Line Wreath Necklace|PRO
Shoe-Pod Tracker|FREE
Neon Club Badge|BOX
Marathon Finisher Sash|EVENT""",
"bottom": """Competitive Split Shorts|CORE
Everyday Training Shorts|CORE
Layered Compression Shorts|CORE
Knee-Length Performance Tights|CORE
Full-Length Technical Tights|CORE
Trail Running Shorts|CORE
Running Skort|CORE
Modest Running Trousers|CORE
Red Running Shorts|CORE
Grey Sweat Shorts|CORE
Olive Cargo Shorts|CORE
Camo Cargo Shorts|CORE
Cream Cargo Shorts|CORE
Sage Cropped Joggers|CORE
Sand Chinos|CORE
Cropped Jeans|CORE
Denim Skirt|CORE
Sage Tennis Skirt|CORE
Green Gingham Skirt|CORE
Reflective Night Tights|PRO
Waterproof Running Trousers|PRO
Run Club Race Shorts|FREE
Gold Marathon Split Shorts|PRO
Trail Expedition Trousers|PRO
Cyber Grid Tights|BOX
Shadow Runner Pants|BOX
Festival Running Skort|EVENT
Champion Race Shorts|PRO""",
"footwear": """Everyday Cushioned Road Shoes|CORE
Max-Cushion Long Run Shoes|CORE
Lightweight Speed Trainers|CORE
High-Stack Race-Day Shoes|PRO
Trail Running Shoes|CORE
Wet-Weather Road Shoes|CORE
Reflective Night Runners|FREE
Recovery Sandals|CORE
Clean White Sneakers|CORE
Black Knit Runners|CORE
Classic High-Tops|CORE
Court Sneakers|CORE
Loafers|CORE
Chelsea Boots|CORE
Trail Boots|CORE
Hiking Sandals|CORE
Slides|CORE
Mary Janes|CORE
Ballet Flats|CORE
Dress Shoes|CORE
Carbon Gold Racers|PRO
Aurora Racers|PRO
Neon Pulse Runners|BOX
Cloud-Foam Runners|PRO
Stealth Night Shoes|BOX
Lava Trail Shoes|BOX
Frost Trail Shoes|BOX
Winged Speed Shoes|PRO
Champion Track Spikes|PRO
Regional Event Runners|EVENT""",
"headwear": """Technical Race Cap|CORE
Reflective Night Cap|CORE
Sun-Protection Running Cap|CORE
Racing Visor|CORE
Trail Flap Cap|CORE
Bucket Hat|CORE
Knit Beanie|CORE
Run Club Cap|CORE
Snapback|CORE
Trucker Cap|CORE
Sweatband|CORE
Performance Headband|CORE
Cycling Cap|CORE
Flower Crown|EVENT
Tropical Straw Hat|EVENT
Beret|CORE
Sailor Cap|CORE
Cowboy Hat|CORE
Royal Crown|PRO
Tiara|PRO
Wizard Hat|PRO
Pirate Hat|BOX
Knight Helmet|BOX
Astronaut Helmet|PRO
Shinobi Headband|BOX
Cat Ears|CORE
Fox Ears|BOX
Bunny Ears|CORE
Devil Horns|BOX
Dragon Horns|PRO
Halo|PRO
Cyber Visor Cap|PRO
Glowing Race Cap|PRO
Champion Laurels|ACHIEVEMENT
Festival Headpiece|EVENT
Champion Crown|PRO
Cloud Halo|BOX
Neon Antenna Headband|BOX""",
"glasses": """Wraparound Performance Sunglasses|CORE
Clear Night-Running Glasses|CORE
Adaptive Performance Sunglasses|PRO
Aviators|CORE
Wayfarers|CORE
Round Frames|CORE
Rimless Glasses|CORE
Oversized Fashion Frames|CORE
Mirrored Sport Shield|PRO
Clear Sport Shield|CORE
Cyber Visor|PRO
Snow/Ski Visor|BOX
Heart Glasses|CORE
Star Glasses|BOX
Pixel Glasses|BOX
Half Face Mask|CORE
Shinobi Face Mask|BOX
Festival Mask|EVENT
Reflective Face Shield|PRO
Dragon Mask|PRO""",
"extra": """Angel Wings|PRO
Neon Wings|PRO
Dragon Wings|PRO
Fairy Wings|PRO
Phoenix Wings|PRO
Holographic Wings|BOX
Twin Blades|BOX
Lightning Aura|BOX
Flame Aura|BOX
Water Aura|BOX
Leaf Aura|EVENT
Star Aura|PRO
Cloud Aura|PRO
Neon Orbit Rings|PRO
Pixel Glitch Aura|BOX
Heart Orbit|PRO
Spirit Flame Orbs|BOX
Champion Laurel Glow|PRO
Floating Mini Trophy|PRO
Run Club Hologram Badge|FREE
Prismatic Halo|PRO
Energy Shoulder Flares|BOX
Speed Energy Rings|PRO
Victory Confetti Aura|EVENT""",
}

def slug(s):
    return re.sub(r"[^a-z0-9]+", "", s.lower())

def parsed(name):
    return [tuple(line.split("|", 1)) for line in CATALOG[name].splitlines()]

def transparent_trim(im):
    im = im.convert("RGBA")
    # Only remove the generated pure/near-pure black field. Interior black ink
    # is retained because it is not reachable from the canvas boundary.
    w, h = im.size
    # Pillow's native flood fill is dramatically faster than a Python pixel
    # walk across 220 1K/2K source images.
    for seed in ((0, 0), (w-1, 0), (0, h-1), (w-1, h-1)):
        ImageDraw.floodfill(im, seed, (0, 0, 0, 0), thresh=9)
    box = im.getbbox()
    return im.crop(box) if box else im

def split_grid(im, cols, rows):
    w, h = im.size
    return [im.crop((round(c*w/cols), round(r*h/rows), round((c+1)*w/cols), round((r+1)*h/rows)))
            for r in range(rows) for c in range(cols)]

def main():
    files = sorted(SOURCE.glob("*.png"), key=lambda p: (p.stat().st_mtime, p.name))
    if len(files) != 218:
        raise SystemExit(f"Expected 218 source PNGs, found {len(files)}")
    source = {
        "top": [files[i-1] for i in range(1,55) if i not in {17,19,24,48}],
        "accessory": files[54:84],
        "bottom": files[94:122],
        "glasses": files[174:194],
        "extra": files[194:218],
    }
    source["footwear"] = split_grid(Image.open(files[122]), 5, 2) + [Image.open(p) for p in files[123:143]]
    source["headwear"] = split_grid(Image.open(files[143]), 8, 1) + [Image.open(p) for p in files[144:174]]

    layouts = {
        "top": "{ w: 0.9, top: 0.30 }", "bottom": "{ w: 0.72, top: 0.55 }",
        "footwear": "{ w: 0.70, top: 0.81 }", "headwear": "{ w: 0.72, top: -0.06 }",
        "glasses": "{ w: 0.61, cy: 0.175 }", "accessory": "{ w: 0.72, top: 0.32 }",
        "extra": "{ w: 1.35, cy: 0.39 }",
    }
    exports = []
    for category, inputs in source.items():
        items = parsed(category)
        assert len(items) == len(inputs), (category, len(items), len(inputs))
        folder = DEST / category
        folder.mkdir(parents=True, exist_ok=True)
        lines = []
        for (label, tag), raw in zip(items, inputs):
            im = raw if isinstance(raw, Image.Image) else Image.open(raw)
            out = folder / f"{slug(label)}.png"
            transparent_trim(im).save(out, optimize=True)
            source_tag = "CORE" if tag in {"ACHIEVEMENT", "CORE_ACHIEVEMENT"} else tag
            achievement = tag in {"ACHIEVEMENT", "CORE_ACHIEVEMENT"}
            if tag == "CORE": unlock = "null"
            elif achievement: unlock = "{ pass: true, label: 'Achievement reward' }"
            elif tag == "FREE": unlock = "{ pass: true, label: 'Free pass reward' }"
            elif tag == "PRO": unlock = "{ premium: true, label: 'PASER PRO reward' }"
            elif tag == "BOX": unlock = "{ pass: true, label: 'Cosmetic lootbox chase item' }"
            else: unlock = "{ pass: true, label: 'Regional / seasonal event reward' }"
            rarity = {"CORE":"common", "CORE_ACHIEVEMENT":"epic", "ACHIEVEMENT":"epic", "FREE":"rare", "PRO":"legendary", "BOX":"legendary", "EVENT":"epic"}[tag]
            rel = f"../../assets/character/curated/{category}/{out.name}"
            z = ", z: 'back'" if category == "extra" else (", z: 'front'" if category == "accessory" else "")
            ach = ", achievement: true" if achievement else ""
            lines.append(f"  {{ id: 'cur_{slug(label)}', label: {label!r}, img: require('{rel}'), layout: {layouts[category]}{z}, sourceTag: '{source_tag}'{ach}, rarity: '{rarity}', unlock: {unlock} }},")
        export_name = {"top":"CURATED_TOPS","bottom":"CURATED_BOTTOMS","footwear":"CURATED_FOOTWEAR","headwear":"CURATED_HEADWEAR","glasses":"CURATED_GLASSES","accessory":"CURATED_ACCESSORIES","extra":"CURATED_EXTRAS"}[category]
        exports.append(f"export const {export_name} = [\n" + "\n".join(lines) + "\n];")
    CONFIG.write_text("// Generated by tools/import_curated_cosmetics.py. Fit Studio owns layout values.\n\n" + "\n\n".join(exports) + "\n", encoding="utf-8")
    print(f"Wrote {sum(len(parsed(k)) for k in CATALOG)} transparent assets and {CONFIG}")

if __name__ == "__main__":
    main()
