"""Install the September 2026 curated cosmetics from Desktop\new assets.

REPLACES tools/import_curated_cosmetics.py, which got three things wrong:

  * It paired art with names by FILE MODIFIED TIME, against a fixed list. The
    folder is not in that order (older draws, redraws and extra items sit in
    between), so most tops and bottoms wore another item's name: the id
    cur_astronautsuit drew the shinobi gi, cur_creamstripedknit the utility
    vest, and so on.
  * It cut the two contact sheets on the wrong grid. The shoe sheet is 2 x 5
    pairs, cut as 5 x 2; the headwear sheet is 4 x 2, cut as 8 x 1. Half the
    curated hats were slivers of two neighbouring drawings.
  * Every item in a slot got the same placeholder layout.

This one is driven by an explicit MANIFEST (every file in the folder is either
installed or listed in SKIPPED with the reason), keeps every existing cur_ id,
cuts contact sheets by connected component, and SOLVES each layout from the
body's own landmarks (see the tables below). Fits made by hand in the Fit
Studio against the old art are carried over to the redraw of the same garment.

Run from frontend/:
  python scripts/install-curated-2.py --dry   # solve and report only
  python scripts/install-curated-2.py
then node scripts/check-catalog.js, and open the Fit Studio (npm run fit) to
fine tune.
"""
from pathlib import Path
import argparse
import re
import io
import subprocess
import json
import shutil
import time

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = Path(__file__).resolve().parents[1]
SOURCE = Path(r"C:\Users\user\Desktop\new assets")
DEST = ROOT / "assets" / "character" / "curated"
CONFIG = ROOT / "src" / "config" / "curatedCosmetics.js"
OVERRIDES = ROOT / "scripts" / "fit-studio" / "fit-overrides.json"
# Fits carried from the studio are saved here after the first run, so a
# re-run keeps them (the studio's pending overrides are cleared by then).
CARRIED = ROOT / "scripts" / "curated-2-fits.json"
# The commit holding the old (mislabelled) curated art the fits were made on.
FIT_BASE = "8f8cb1e"

RAIN_SHELL = 'ChatGPT Image Sep 19, 2026, 12_15_07 AM (7).png'
TACTICAL_RIG = 'ChatGPT Image Sep 20, 2026, 09_48_47 PM (4).png'
SHEET_TOPS_A = 'ChatGPT Image Sep 20, 2026, 09_10_47 PM.png'
SHEET_TOPS_B = 'ChatGPT Image Sep 20, 2026, 09_43_05 PM.png'
SHEET_COSTUMES = 'ChatGPT Image Sep 20, 2026, 09_54_11 PM.png'

# (source, slot, id without cur_, label, source tag, placement kind). A source
# is a file name, or (sheet file, cols, rows, cell) for one drawing on a sheet.
MANIFEST = [
    ('38_lightweight_race_cap.png', 'headwear', 'technicalracecap', 'Technical Race Cap', 'CORE', 'cap'),
    ('39_reflective_night_cap.png', 'headwear', 'reflectivenightcap', 'Reflective Night Cap', 'CORE', 'cap'),
    ('40_trail_sun_cap.png', 'headwear', 'sunprotectionrunningcap', 'Sun Protection Running Cap', 'CORE', 'cap'),
    ('ChatGPT Image Sep 19, 2026, 02_14_25 AM (1).png', 'headwear', 'wizardhat', 'Wizard Hat', 'PRO', 'tallbrim'),
    ('ChatGPT Image Sep 19, 2026, 02_14_25 AM (10).png', 'headwear', 'dragonhorns', 'Dragon Horns', 'PRO', 'ears'),
    ('ChatGPT Image Sep 19, 2026, 02_14_25 AM (2).png', 'headwear', 'piratehat', 'Pirate Hat', 'BOX', 'widebrim'),
    ('ChatGPT Image Sep 19, 2026, 02_14_25 AM (3).png', 'headwear', 'knighthelmet', 'Knight Helmet', 'BOX', 'helmet'),
    ('ChatGPT Image Sep 19, 2026, 02_14_25 AM (4).png', 'headwear', 'astronauthelmet', 'Astronaut Helmet', 'PRO', 'bighelmet'),
    ('ChatGPT Image Sep 19, 2026, 02_14_25 AM (5).png', 'headwear', 'shinobiheadband', 'Shinobi Headband', 'BOX', 'band'),
    ('ChatGPT Image Sep 19, 2026, 02_14_25 AM (6).png', 'headwear', 'catears', 'Cat Ears', 'CORE', 'ears'),
    ('ChatGPT Image Sep 19, 2026, 02_14_25 AM (7).png', 'headwear', 'foxears', 'Fox Ears', 'BOX', 'ears'),
    ('ChatGPT Image Sep 19, 2026, 02_14_25 AM (8).png', 'headwear', 'bunnyears', 'Bunny Ears', 'CORE', 'ears'),
    ('ChatGPT Image Sep 19, 2026, 02_14_25 AM (9).png', 'headwear', 'devilhorns', 'Devil Horns', 'BOX', 'ears'),
    ('ChatGPT Image Sep 19, 2026, 02_14_31 AM (1).png', 'headwear', 'sweatband', 'Sweatband', 'CORE', 'band'),
    ('ChatGPT Image Sep 19, 2026, 02_14_31 AM (2).png', 'headwear', 'performanceheadband', 'Performance Headband', 'CORE', 'band'),
    ('ChatGPT Image Sep 19, 2026, 02_14_31 AM (3).png', 'headwear', 'runclubcap', 'Run Club Cap', 'CORE', 'cap'),
    ('ChatGPT Image Sep 19, 2026, 02_14_31 AM (4).png', 'headwear', 'flowercrown', 'Flower Crown', 'EVENT', 'wreath'),
    ('ChatGPT Image Sep 19, 2026, 02_14_31 AM (5).png', 'headwear', 'tropicalstrawhat', 'Tropical Straw Hat', 'EVENT', 'widebrim'),
    ('ChatGPT Image Sep 19, 2026, 02_14_31 AM (6).png', 'headwear', 'beret', 'Beret', 'CORE', 'beret'),
    ('ChatGPT Image Sep 19, 2026, 02_14_31 AM (7).png', 'headwear', 'sailorcap', 'Sailor Cap', 'CORE', 'cap'),
    ('ChatGPT Image Sep 19, 2026, 02_14_32 AM (10).png', 'headwear', 'tiara', 'Tiara', 'PRO', 'tiara'),
    ('ChatGPT Image Sep 19, 2026, 02_14_32 AM (8).png', 'headwear', 'cowboyhat', 'Cowboy Hat', 'CORE', 'widebrim'),
    ('ChatGPT Image Sep 19, 2026, 02_14_32 AM (9).png', 'headwear', 'royalcrown', 'Royal Crown', 'PRO', 'crown'),
    ('ChatGPT Image Sep 19, 2026, 02_14_37 AM (1).png', 'headwear', 'cyclingcap', 'Cycling Cap', 'CORE', 'cap'),
    ('ChatGPT Image Sep 19, 2026, 02_14_37 AM (2).png', 'headwear', 'nightstripecap', 'Night Stripe Cap', 'CORE', 'cap'),
    ('ChatGPT Image Sep 19, 2026, 02_14_37 AM (3).png', 'headwear', 'desertflapcap', 'Desert Flap Cap', 'CORE', 'flapcap'),
    ('ChatGPT Image Sep 19, 2026, 02_14_37 AM (4).png', 'headwear', 'racingvisor', 'Racing Visor', 'CORE', 'visor'),
    ('ChatGPT Image Sep 19, 2026, 02_14_37 AM (5).png', 'headwear', 'trailflapcap', 'Trail Flap Cap', 'CORE', 'flapcap'),
    ('ChatGPT Image Sep 19, 2026, 02_14_37 AM (6).png', 'headwear', 'buckethat', 'Bucket Hat', 'CORE', 'bucket'),
    ('ChatGPT Image Sep 19, 2026, 02_14_38 AM (10).png', 'headwear', 'truckercap', 'Trucker Cap', 'CORE', 'cap'),
    ('ChatGPT Image Sep 19, 2026, 02_14_38 AM (7).png', 'headwear', 'knitbeanie', 'Knit Beanie', 'CORE', 'beanie'),
    ('ChatGPT Image Sep 19, 2026, 02_14_38 AM (8).png', 'headwear', 'tealbrimcap', 'Teal Brim Cap', 'CORE', 'cap'),
    ('ChatGPT Image Sep 19, 2026, 02_14_38 AM (9).png', 'headwear', 'snapback', 'Snapback', 'CORE', 'cap'),
    (('ChatGPT Image Sep 19, 2026, 02_14_14 AM (3).png', 4, 2, 0), 'headwear', 'halo', 'Halo', 'PRO', 'halo'),
    (('ChatGPT Image Sep 19, 2026, 02_14_14 AM (3).png', 4, 2, 1), 'headwear', 'cybervisorcap', 'Cyber Visor Cap', 'PRO', 'cap'),
    (('ChatGPT Image Sep 19, 2026, 02_14_14 AM (3).png', 4, 2, 2), 'headwear', 'glowingracecap', 'Glowing Race Cap', 'PRO', 'cap'),
    (('ChatGPT Image Sep 19, 2026, 02_14_14 AM (3).png', 4, 2, 3), 'headwear', 'championlaurels', 'Champion Laurels', 'ACHIEVEMENT', 'wreath'),
    (('ChatGPT Image Sep 19, 2026, 02_14_14 AM (3).png', 4, 2, 4), 'headwear', 'festivalheadpiece', 'Festival Headpiece', 'EVENT', 'headpiece'),
    (('ChatGPT Image Sep 19, 2026, 02_14_14 AM (3).png', 4, 2, 5), 'headwear', 'championcrown', 'Champion Crown', 'PRO', 'crown'),
    (('ChatGPT Image Sep 19, 2026, 02_14_14 AM (3).png', 4, 2, 6), 'headwear', 'cloudhalo', 'Cloud Halo', 'BOX', 'halo'),
    (('ChatGPT Image Sep 19, 2026, 02_14_14 AM (3).png', 4, 2, 7), 'headwear', 'neonantennaheadband', 'Neon Antenna Headband', 'BOX', 'ears'),
    (('ChatGPT Image Sep 19, 2026, 01_06_59 AM.png', 2, 5, 0), 'footwear', 'everydaycushionedroadshoes', 'Everyday Cushioned Road Shoes', 'CORE', 'pair'),
    (('ChatGPT Image Sep 19, 2026, 01_06_59 AM.png', 2, 5, 1), 'footwear', 'maxcushionlongrunshoes', 'Max Cushion Long Run Shoes', 'CORE', 'pair'),
    (('ChatGPT Image Sep 19, 2026, 01_06_59 AM.png', 2, 5, 2), 'footwear', 'lightweightspeedtrainers', 'Lightweight Speed Trainers', 'CORE', 'pair'),
    (('ChatGPT Image Sep 19, 2026, 01_06_59 AM.png', 2, 5, 3), 'footwear', 'highstackracedayshoes', 'High Stack Race Day Shoes', 'PRO', 'pair'),
    (('ChatGPT Image Sep 19, 2026, 01_06_59 AM.png', 2, 5, 4), 'footwear', 'trailrunningshoes', 'Trail Running Shoes', 'CORE', 'pair'),
    (('ChatGPT Image Sep 19, 2026, 01_06_59 AM.png', 2, 5, 5), 'footwear', 'wetweatherroadshoes', 'Wet Weather Road Shoes', 'CORE', 'pair'),
    (('ChatGPT Image Sep 19, 2026, 01_06_59 AM.png', 2, 5, 6), 'footwear', 'reflectivenightrunners', 'Reflective Night Runners', 'FREE', 'pair'),
    (('ChatGPT Image Sep 19, 2026, 01_06_59 AM.png', 2, 5, 7), 'footwear', 'recoverysandals', 'Recovery Sandals', 'CORE', 'pair'),
    (('ChatGPT Image Sep 19, 2026, 01_06_59 AM.png', 2, 5, 8), 'footwear', 'cleanwhitesneakers', 'Clean White Sneakers', 'CORE', 'pair'),
    (('ChatGPT Image Sep 19, 2026, 01_06_59 AM.png', 2, 5, 9), 'footwear', 'blackknitrunners', 'Black Knit Runners', 'CORE', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_18 AM (1).png', 'footwear', 'classichightops', 'Classic High Tops', 'CORE', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_19 AM (2).png', 'footwear', 'courtsneakers', 'Court Sneakers', 'CORE', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_19 AM (3).png', 'footwear', 'loafers', 'Loafers', 'CORE', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_19 AM (4).png', 'footwear', 'chelseaboots', 'Chelsea Boots', 'CORE', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_20 AM (5).png', 'footwear', 'trailboots', 'Trail Boots', 'CORE', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_20 AM (6).png', 'footwear', 'hikingsandals', 'Hiking Sandals', 'CORE', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_21 AM (7).png', 'footwear', 'slides', 'Slides', 'CORE', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_22 AM (8).png', 'footwear', 'maryjanes', 'Mary Janes', 'CORE', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_22 AM (9).png', 'footwear', 'balletflats', 'Ballet Flats', 'CORE', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_23 AM (10).png', 'footwear', 'dressshoes', 'Dress Shoes', 'CORE', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_28 AM (1).png', 'footwear', 'carbongoldracers', 'Carbon Gold Racers', 'PRO', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_28 AM (2).png', 'footwear', 'auroraracers', 'Aurora Racers', 'PRO', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_28 AM (3).png', 'footwear', 'neonpulserunners', 'Neon Pulse Runners', 'BOX', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_29 AM (4).png', 'footwear', 'cloudfoamrunners', 'Cloud Foam Runners', 'PRO', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_29 AM (5).png', 'footwear', 'stealthnightshoes', 'Stealth Night Shoes', 'BOX', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_30 AM (6).png', 'footwear', 'lavatrailshoes', 'Lava Trail Shoes', 'BOX', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_30 AM (7).png', 'footwear', 'frosttrailshoes', 'Frost Trail Shoes', 'BOX', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_30 AM (8).png', 'footwear', 'wingedspeedshoes', 'Winged Speed Shoes', 'PRO', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_31 AM (10).png', 'footwear', 'regionaleventrunners', 'Regional Event Runners', 'EVENT', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 01_18_31 AM (9).png', 'footwear', 'championtrackspikes', 'Champion Track Spikes', 'PRO', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 12_45_13 AM (10).png', 'footwear', 'blushchunkytrainers', 'Blush Chunky Trainers', 'CORE', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 12_45_13 AM (9).png', 'footwear', 'tealdailytrainers', 'Teal Daily Trainers', 'CORE', 'pair'),
    ('ChatGPT Image Sep 19, 2026, 02_31_22 AM (1).png', 'glasses', 'wraparoundperformancesunglasses', 'Wraparound Performance Sunglasses', 'CORE', 'specs'),
    ('ChatGPT Image Sep 19, 2026, 02_31_22 AM (2).png', 'glasses', 'clearnightrunningglasses', 'Clear Night Running Glasses', 'CORE', 'specs'),
    ('ChatGPT Image Sep 19, 2026, 02_31_23 AM (3).png', 'glasses', 'adaptiveperformancesunglasses', 'Adaptive Performance Sunglasses', 'PRO', 'specs'),
    ('ChatGPT Image Sep 19, 2026, 02_31_23 AM (4).png', 'glasses', 'aviators', 'Aviators', 'CORE', 'specs'),
    ('ChatGPT Image Sep 19, 2026, 02_31_23 AM (5).png', 'glasses', 'wayfarers', 'Wayfarers', 'CORE', 'specs'),
    ('ChatGPT Image Sep 19, 2026, 02_31_24 AM (6).png', 'glasses', 'roundframes', 'Round Frames', 'CORE', 'specs'),
    ('ChatGPT Image Sep 19, 2026, 02_31_24 AM (7).png', 'glasses', 'rimlessglasses', 'Rimless Glasses', 'CORE', 'specs'),
    ('ChatGPT Image Sep 19, 2026, 02_31_24 AM (8).png', 'glasses', 'oversizedfashionframes', 'Oversized Fashion Frames', 'CORE', 'specs'),
    ('ChatGPT Image Sep 19, 2026, 02_31_25 AM (10).png', 'glasses', 'clearsportshield', 'Clear Sport Shield', 'CORE', 'shield'),
    ('ChatGPT Image Sep 19, 2026, 02_31_25 AM (9).png', 'glasses', 'mirroredsportshield', 'Mirrored Sport Shield', 'PRO', 'shield'),
    ('ChatGPT Image Sep 19, 2026, 02_31_30 AM (1).png', 'glasses', 'cybervisor', 'Cyber Visor', 'PRO', 'shield'),
    ('ChatGPT Image Sep 19, 2026, 02_31_31 AM (2).png', 'glasses', 'snowskivisor', 'Snow Ski Visor', 'BOX', 'goggles'),
    ('ChatGPT Image Sep 19, 2026, 02_31_31 AM (3).png', 'glasses', 'heartglasses', 'Heart Glasses', 'CORE', 'specs'),
    ('ChatGPT Image Sep 19, 2026, 02_31_31 AM (4).png', 'glasses', 'starglasses', 'Star Glasses', 'BOX', 'specs'),
    ('ChatGPT Image Sep 19, 2026, 02_31_31 AM (5).png', 'glasses', 'pixelglasses', 'Pixel Glasses', 'BOX', 'specs'),
    ('ChatGPT Image Sep 19, 2026, 02_31_32 AM (6).png', 'glasses', 'halffacemask', 'Half Face Mask', 'CORE', 'mouthmask'),
    ('ChatGPT Image Sep 19, 2026, 02_31_32 AM (7).png', 'glasses', 'shinobifacemask', 'Shinobi Face Mask', 'BOX', 'mouthmask'),
    ('ChatGPT Image Sep 19, 2026, 02_31_32 AM (8).png', 'glasses', 'festivalmask', 'Festival Mask', 'EVENT', 'eyemask'),
    ('ChatGPT Image Sep 19, 2026, 02_31_32 AM (9).png', 'glasses', 'reflectivefaceshield', 'Reflective Face Shield', 'PRO', 'faceshield'),
    ('ChatGPT Image Sep 19, 2026, 02_31_33 AM (10).png', 'glasses', 'dragonmask', 'Dragon Mask', 'PRO', 'eyemask'),
    ('ChatGPT Image Sep 19, 2026, 02_50_26 AM (1).png', 'extra', 'angelwings', 'Angel Wings', 'PRO', 'wings'),
    ('ChatGPT Image Sep 19, 2026, 02_50_26 AM (2).png', 'extra', 'neonwings', 'Neon Wings', 'PRO', 'wings'),
    ('ChatGPT Image Sep 19, 2026, 02_50_27 AM (3).png', 'extra', 'dragonwings', 'Dragon Wings', 'PRO', 'wings'),
    ('ChatGPT Image Sep 19, 2026, 02_50_27 AM (4).png', 'extra', 'fairywings', 'Fairy Wings', 'PRO', 'wings'),
    ('ChatGPT Image Sep 19, 2026, 02_50_27 AM (5).png', 'extra', 'phoenixwings', 'Phoenix Wings', 'PRO', 'wings'),
    ('ChatGPT Image Sep 19, 2026, 02_50_28 AM (10).png', 'extra', 'wateraura', 'Water Aura', 'BOX', 'aura'),
    ('ChatGPT Image Sep 19, 2026, 02_50_28 AM (6).png', 'extra', 'holographicwings', 'Holographic Wings', 'BOX', 'wings'),
    ('ChatGPT Image Sep 19, 2026, 02_50_28 AM (7).png', 'extra', 'twinblades', 'Twin Blades', 'BOX', 'blades'),
    ('ChatGPT Image Sep 19, 2026, 02_50_28 AM (8).png', 'extra', 'lightningaura', 'Lightning Aura', 'BOX', 'aura'),
    ('ChatGPT Image Sep 19, 2026, 02_50_28 AM (9).png', 'extra', 'flameaura', 'Flame Aura', 'BOX', 'aura'),
    ('ChatGPT Image Sep 19, 2026, 03_01_30 AM (1).png', 'extra', 'leafaura', 'Leaf Aura', 'EVENT', 'aura'),
    ('ChatGPT Image Sep 19, 2026, 03_01_30 AM (2).png', 'extra', 'staraura', 'Star Aura', 'PRO', 'aura'),
    ('ChatGPT Image Sep 19, 2026, 03_01_31 AM (3).png', 'extra', 'cloudaura', 'Cloud Aura', 'PRO', 'aura'),
    ('ChatGPT Image Sep 19, 2026, 03_01_31 AM (4).png', 'extra', 'neonorbitrings', 'Neon Orbit Rings', 'PRO', 'aura'),
    ('ChatGPT Image Sep 19, 2026, 03_01_31 AM (5).png', 'extra', 'pixelglitchaura', 'Pixel Glitch Aura', 'BOX', 'aura'),
    ('ChatGPT Image Sep 19, 2026, 03_01_31 AM (6).png', 'extra', 'heartorbit', 'Heart Orbit', 'PRO', 'aura'),
    ('ChatGPT Image Sep 19, 2026, 03_01_31 AM (7).png', 'extra', 'spiritflameorbs', 'Spirit Flame Orbs', 'BOX', 'aura'),
    ('ChatGPT Image Sep 19, 2026, 03_01_31 AM (8).png', 'extra', 'championlaurelglow', 'Champion Laurel Glow', 'PRO', 'aura'),
    ('ChatGPT Image Sep 19, 2026, 03_01_32 AM (10).png', 'extra', 'runclubhologrambadge', 'Run Club Hologram Badge', 'FREE', 'floatleft'),
    ('ChatGPT Image Sep 19, 2026, 03_01_32 AM (9).png', 'extra', 'floatingminitrophy', 'Floating Mini Trophy', 'PRO', 'floatright'),
    ('ChatGPT Image Sep 19, 2026, 03_06_33 AM (1).png', 'extra', 'prismatichalo', 'Prismatic Halo', 'PRO', 'halo'),
    ('ChatGPT Image Sep 19, 2026, 03_06_33 AM (2).png', 'extra', 'energyshoulderflares', 'Energy Shoulder Flares', 'BOX', 'flares'),
    ('ChatGPT Image Sep 19, 2026, 03_06_33 AM (3).png', 'extra', 'speedenergyrings', 'Speed Energy Rings', 'PRO', 'rings'),
    ('ChatGPT Image Sep 19, 2026, 03_06_34 AM (4).png', 'extra', 'victoryconfettiaura', 'Victory Confetti Aura', 'EVENT', 'aura'),
    ('ChatGPT Image Sep 19, 2026, 12_41_47 AM (1).png', 'accessory', 'digitalsportswatch', 'Digital Sports Watch', 'CORE', 'watch'),
    ('ChatGPT Image Sep 19, 2026, 12_41_47 AM (2).png', 'accessory', 'wirelesssportsearphones', 'Wireless Sports Earphones', 'CORE', 'earbuds'),
    ('ChatGPT Image Sep 19, 2026, 12_41_48 AM (3).png', 'accessory', 'runningwaistpouch', 'Running Waist Pouch', 'CORE', 'belt'),
    ('ChatGPT Image Sep 19, 2026, 12_41_48 AM (4).png', 'accessory', 'wearableracebib', 'Wearable Race Bib', 'CORE', 'bib'),
    ('ChatGPT Image Sep 19, 2026, 12_41_48 AM (5).png', 'accessory', 'phonearmband', 'Phone Armband', 'CORE', 'armband'),
    ('ChatGPT Image Sep 19, 2026, 12_41_49 AM (6).png', 'accessory', 'coolingnecktowel', 'Cooling Neck Towel', 'CORE', 'towel'),
    ('ChatGPT Image Sep 19, 2026, 12_41_49 AM (7).png', 'accessory', 'nightrunninglightharness', 'Night Running Light Harness', 'PRO', 'harness'),
    ('ChatGPT Image Sep 19, 2026, 12_41_50 AM (8).png', 'accessory', 'runclubcrossbodybag', 'Run Club Cross Body Bag', 'CORE', 'crossbody'),
    ('ChatGPT Image Sep 19, 2026, 12_41_52 AM (9).png', 'accessory', 'hydrationracevest', 'Hydration Race Vest', 'CORE', 'harness'),
    ('ChatGPT Image Sep 19, 2026, 12_41_53 AM (10).png', 'accessory', 'neckgaiter', 'Neck Gaiter', 'CORE', 'gaiter'),
    ('ChatGPT Image Sep 19, 2026, 12_42_07 AM (1).png', 'accessory', 'goldmedal', 'Gold Medal', 'ACHIEVEMENT', 'medal'),
    ('ChatGPT Image Sep 19, 2026, 12_42_08 AM (2).png', 'accessory', 'trophychain', 'Trophy Chain', 'PRO', 'chain'),
    ('ChatGPT Image Sep 19, 2026, 12_42_09 AM (3).png', 'accessory', 'raceharness', 'Race Harness', 'CORE', 'harness'),
    ('ChatGPT Image Sep 19, 2026, 12_42_09 AM (4).png', 'accessory', 'dogtags', 'Dog Tags', 'CORE', 'chain'),
    ('ChatGPT Image Sep 19, 2026, 12_42_09 AM (5).png', 'accessory', 'pearlstrand', 'Pearl Strand', 'CORE', 'chain'),
    ('ChatGPT Image Sep 19, 2026, 12_42_10 AM (6).png', 'accessory', 'charmchain', 'Charm Chain', 'CORE', 'chain'),
    ('ChatGPT Image Sep 19, 2026, 12_42_10 AM (7).png', 'accessory', 'flowerlei', 'Flower Lei', 'EVENT', 'lei'),
    ('ChatGPT Image Sep 19, 2026, 12_42_11 AM (10).png', 'accessory', 'necktie', 'Necktie', 'CORE', 'tie'),
    ('ChatGPT Image Sep 19, 2026, 12_42_11 AM (8).png', 'accessory', 'neckerchief', 'Neckerchief', 'CORE', 'kerchief'),
    ('ChatGPT Image Sep 19, 2026, 12_42_11 AM (9).png', 'accessory', 'bowtie', 'Bow Tie', 'CORE', 'bowtie'),
    ('ChatGPT Image Sep 19, 2026, 12_42_25 AM (1).png', 'accessory', 'hearthandbag', 'Heart Handbag', 'CORE', 'handbag'),
    ('ChatGPT Image Sep 19, 2026, 12_42_26 AM (2).png', 'accessory', 'waterproofphonepouch', 'Waterproof Phone Pouch', 'FREE', 'lanyard'),
    ('ChatGPT Image Sep 19, 2026, 12_42_26 AM (3).png', 'accessory', 'electrolyterunningbelt', 'Electrolyte Running Belt', 'FREE', 'belt'),
    ('ChatGPT Image Sep 19, 2026, 12_42_27 AM (4).png', 'accessory', 'runclublanyard', 'Run Club Lanyard', 'FREE', 'lanyard'),
    ('ChatGPT Image Sep 19, 2026, 12_42_27 AM (5).png', 'accessory', 'reflectiveracesash', 'Reflective Race Sash', 'CORE', 'sash'),
    ('ChatGPT Image Sep 19, 2026, 12_42_27 AM (6).png', 'accessory', 'luckycharmpendant', 'Lucky Charm Pendant', 'BOX', 'chain'),
    ('ChatGPT Image Sep 19, 2026, 12_42_28 AM (7).png', 'accessory', 'finishlinewreathnecklace', 'Finish Line Wreath Necklace', 'PRO', 'chain'),
    ('ChatGPT Image Sep 19, 2026, 12_42_28 AM (8).png', 'accessory', 'shoepodtracker', 'Shoe Pod Tracker', 'FREE', 'shoepods'),
    ('ChatGPT Image Sep 19, 2026, 12_42_29 AM (10).png', 'accessory', 'marathonfinishersash', 'Marathon Finisher Sash', 'EVENT', 'sash'),
    ('ChatGPT Image Sep 19, 2026, 12_42_29 AM (9).png', 'accessory', 'neonclubbadge', 'Neon Club Badge', 'BOX', 'badge'),
    ('ChatGPT Image Sep 19, 2026, 12_15_07 AM (7).png', 'top', 'lightweightrainshell', 'Lightweight Rain Shell', 'CORE', 'top'),
    ('ChatGPT Image Sep 19, 2026, 12_15_51 AM (10).png', 'top', 'tropicalstormponcho', 'Tropical Storm Poncho', 'EVENT', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_27_52 PM (1).png', 'top', 'tropicalcampshirt', 'Tropical Camp Shirt', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_27_52 PM (2).png', 'top', 'creamstripedknit', 'Cream Striped Knit', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_27_53 PM (3).png', 'top', 'sleevelesshoodie', 'Sleeveless Hoodie', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_27_53 PM (4).png', 'top', 'teamjersey', 'Team Jersey', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_27_53 PM (5).png', 'top', 'cyclingjersey', 'Cycling Jersey', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_27_54 PM (6).png', 'top', 'utilityvest', 'Utility Vest', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_27_54 PM (7).png', 'top', 'singaporeracesinglet', 'Singapore Race Singlet', 'EVENT', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_27_54 PM (8).png', 'top', 'windbreaker', 'Windbreaker', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_27_55 PM (10).png', 'top', 'varsityjacket', 'Varsity Jacket', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_27_55 PM (9).png', 'top', 'aurorajacket', 'Aurora Jacket', 'PRO', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_33_54 PM (1).png', 'top', 'dragonteamjersey', 'Dragon Team Jersey', 'EVENT', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_33_55 PM (2).png', 'top', 'seabreezewindshirt', 'Sea Breeze Windshirt', 'FREE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_33_55 PM (3).png', 'top', 'championvarsityjacket', 'Champion Varsity Jacket', 'PRO', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_33_55 PM (4).png', 'top', 'shadowrunnertop', 'Shadow Runner Top', 'BOX', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_33_56 PM (5).png', 'top', 'holographicshell', 'Holographic Shell', 'BOX', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_33_56 PM (6).png', 'top', 'lightningracesuit', 'Lightning Race Suit', 'PRO', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_33_57 PM (7).png', 'top', 'heritagerunnerjacket', 'Heritage Runner Jacket', 'EVENT', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_33_57 PM (8).png', 'top', 'lunarrunnerjacket', 'Lunar Runner Jacket', 'BOX', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_33_57 PM (9).png', 'top', 'sunrisemarathonsinglet', 'Sunrise Marathon Singlet', 'FREE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_33_58 PM (10).png', 'top', 'regionalchampionshipsinglet', 'Regional Championship Singlet', 'EVENT', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_37_08 PM (1).png', 'top', 'sailorblouse', 'Sailor Blouse', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_37_08 PM (2).png', 'top', 'puffsleevecroptop', 'Puff Sleeve Crop Top', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_37_09 PM (3).png', 'top', 'blackfootballjersey', 'Black Football Jersey', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_37_09 PM (4).png', 'top', 'sunburstziptee', 'Sunburst Zip Tee', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_37_09 PM (5).png', 'top', 'blackpuffervest', 'Black Puffer Vest', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_37_10 PM (6).png', 'top', 'pastelcardigan', 'Pastel Cardigan', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_37_10 PM (7).png', 'top', 'cloudpufferjacket', 'Cloud Puffer Jacket', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_37_10 PM (8).png', 'top', 'blacksleevelesshoodie', 'Black Sleeveless Hoodie', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_37_11 PM (10).png', 'top', 'bowcamisole', 'Bow Camisole', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_37_11 PM (9).png', 'top', 'frillyhearttop', 'Frilly Heart Top', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_48_47 PM (4).png', 'top', 'tacticalrig', 'Tactical Rig', 'BOX', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_48_48 PM (5).png', 'top', 'cyberrunnerjacket', 'Cyber Runner Jacket', 'PRO', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_48_48 PM (6).png', 'top', 'neongridshell', 'Neon Grid Shell', 'PRO', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_48_49 PM (7).png', 'top', 'midnightreflectivehoodie', 'Midnight Reflective Hoodie', 'PRO', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_48_49 PM (8).png', 'top', 'goldracedaysinglet', 'Gold Race Day Singlet', 'PRO', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_48_49 PM (9).png', 'top', 'cityrunclubjacket', 'City Run Club Jacket', 'CORE', 'top'),
    ('ChatGPT Image Sep 20, 2026, 09_48_51 PM (10).png', 'top', 'trailexpeditionvest', 'Trail Expedition Vest', 'FREE', 'top'),
    ('ChatGPT Image Sep 21, 2026, 12_42_14 AM (1).png', 'top', 'lilachalfzip', 'Lilac Half Zip', 'CORE', 'top'),
    ('ChatGPT Image Sep 21, 2026, 12_42_15 AM (2).png', 'top', 'whitestripepolo', 'White Stripe Polo', 'CORE', 'top'),
    ('ChatGPT Image Sep 21, 2026, 12_42_15 AM (3).png', 'top', 'blushcropjacket', 'Blush Crop Jacket', 'FREE', 'top'),
    ('ChatGPT Image Sep 21, 2026, 12_42_15 AM (4).png', 'top', 'stormparka', 'Storm Parka', 'PRO', 'top'),
    ('ChatGPT Image Sep 21, 2026, 12_42_15 AM (5).png', 'top', 'judogi', 'Judo Gi', 'CORE_ACHIEVEMENT', 'top'),
    ('ChatGPT Image Sep 21, 2026, 12_42_16 AM (6).png', 'top', 'knightarmour', 'Knight Armour', 'BOX', 'top'),
    ('ChatGPT Image Sep 21, 2026, 12_42_16 AM (7).png', 'top', 'starlitmagerobes', 'Starlit Mage Robes', 'PRO', 'top'),
    ('ChatGPT Image Sep 21, 2026, 12_42_16 AM (8).png', 'top', 'shinobigi', 'Shinobi Gi', 'BOX', 'top'),
    ('ChatGPT Image Sep 21, 2026, 12_42_17 AM (9).png', 'top', 'astronautsuit', 'Astronaut Suit', 'PRO', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_10_47 PM.png', 5, 2, 1), 'top', 'runclubtechnicalshirt', 'Run Club Technical Shirt', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_10_47 PM.png', 5, 2, 2), 'top', 'runclubracesinglet', 'Run Club Race Singlet', 'FREE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_10_47 PM.png', 5, 2, 3), 'top', 'trailsleevelesstop', 'Trail Sleeveless Top', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_10_47 PM.png', 5, 2, 4), 'top', 'hotweathermeshtee', 'Hot Weather Mesh Tee', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_10_47 PM.png', 5, 2, 5), 'top', 'everydaytechnicaltee', 'Everyday Technical Tee', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_10_47 PM.png', 5, 2, 6), 'top', 'greeneverydayrunningshirt', 'Green Everyday Running Shirt', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_10_47 PM.png', 5, 2, 7), 'top', 'darkreflectivetechnicaltee', 'Dark Reflective Technical Tee', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_10_47 PM.png', 5, 2, 8), 'top', 'coastalsunrisesinglet', 'Coastal Sunrise Singlet', 'FREE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_10_47 PM.png', 5, 2, 9), 'top', 'competitivetracksinglet', 'Competitive Track Singlet', 'PRO', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_43_05 PM.png', 5, 2, 0), 'top', 'bretonstripetee', 'Breton Stripe Tee', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_43_05 PM.png', 5, 2, 1), 'top', 'blackbomberjacket', 'Black Bomber Jacket', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_43_05 PM.png', 5, 2, 2), 'top', 'sherpadenimjacket', 'Sherpa Denim Jacket', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_43_05 PM.png', 5, 2, 3), 'top', 'oatmealcardigan', 'Oatmeal Cardigan', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_43_05 PM.png', 5, 2, 4), 'top', 'labcoat', 'Lab Coat', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_43_05 PM.png', 5, 2, 5), 'top', 'whitecroppedcami', 'White Cropped Cami', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_43_05 PM.png', 5, 2, 6), 'top', 'pinkcroptee', 'Pink Crop Tee', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_43_05 PM.png', 5, 2, 7), 'top', 'midnightpullover', 'Midnight Pullover', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_43_05 PM.png', 5, 2, 8), 'top', 'pastelrugbyshirt', 'Pastel Rugby Shirt', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_43_05 PM.png', 5, 2, 9), 'top', 'layeredpuffervest', 'Layered Puffer Vest', 'CORE', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_54_11 PM.png', 5, 1, 0), 'top', 'piratecoat', 'Pirate Coat', 'BOX', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_54_11 PM.png', 5, 1, 1), 'top', 'leaffairydress', 'Leaf Fairy Dress', 'PRO', 'top'),
    (('ChatGPT Image Sep 20, 2026, 09_54_11 PM.png', 5, 1, 2), 'top', 'valkyriearmour', 'Valkyrie Armour', 'PRO', 'top'),
    ('ChatGPT Image Sep 21, 2026, 01_18_29 AM (1).png', 'bottom', 'olivecargoshorts', 'Olive Cargo Shorts', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_18_29 AM (2).png', 'bottom', 'camocargoshorts', 'Camo Cargo Shorts', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_18_29 AM (3).png', 'bottom', 'creamcargoshorts', 'Cream Cargo Shorts', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_18_30 AM (4).png', 'bottom', 'sagecroppedjoggers', 'Sage Cropped Joggers', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_18_30 AM (5).png', 'bottom', 'sandchinos', 'Sand Chinos', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_18_31 AM (6).png', 'bottom', 'croppedjeans', 'Cropped Jeans', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_18_31 AM (7).png', 'bottom', 'denimskirt', 'Denim Skirt', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_18_31 AM (8).png', 'bottom', 'sagetennisskirt', 'Sage Tennis Skirt', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_18_32 AM (10).png', 'bottom', 'reflectivenighttights', 'Reflective Night Tights', 'PRO', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_18_32 AM (9).png', 'bottom', 'greenginghamskirt', 'Green Gingham Skirt', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_24_11 AM (1).png', 'bottom', 'trailexpeditiontrousers', 'Trail Expedition Trousers', 'PRO', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_24_12 AM (2).png', 'bottom', 'runclubraceshorts', 'Run Club Race Shorts', 'FREE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_24_13 AM (3).png', 'bottom', 'goldmarathonsplitshorts', 'Gold Marathon Split Shorts', 'PRO', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_24_14 AM (4).png', 'bottom', 'waterproofrunningtrousers', 'Waterproof Running Trousers', 'PRO', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_24_16 AM (5).png', 'bottom', 'cybergridtights', 'Cyber Grid Tights', 'BOX', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_24_18 AM (6).png', 'bottom', 'shadowrunnerpants', 'Shadow Runner Pants', 'BOX', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_24_18 AM (7).png', 'bottom', 'festivalrunningskort', 'Festival Running Skort', 'EVENT', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_24_19 AM (8).png', 'bottom', 'championraceshorts', 'Champion Race Shorts', 'PRO', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_29_16 AM (1).png', 'bottom', 'fulllengthtechnicaltights', 'Full Length Technical Tights', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_29_17 AM (2).png', 'bottom', 'trailrunningshorts', 'Trail Running Shorts', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_29_17 AM (3).png', 'bottom', 'runningskort', 'Running Skort', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_29_18 AM (4).png', 'bottom', 'modestrunningtrousers', 'Modest Running Trousers', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_29_18 AM (5).png', 'bottom', 'competitivesplitshorts', 'Competitive Split Shorts', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_29_19 AM (6).png', 'bottom', 'everydaytrainingshorts', 'Everyday Training Shorts', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_29_19 AM (7).png', 'bottom', 'layeredcompressionshorts', 'Layered Compression Shorts', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_29_20 AM (8).png', 'bottom', 'kneelengthperformancetights', 'Knee Length Performance Tights', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_29_22 AM (9).png', 'bottom', 'greysweatshorts', 'Grey Sweat Shorts', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_29_23 AM (10).png', 'bottom', 'redrunningshorts', 'Red Running Shorts', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_33_57 AM (1).png', 'bottom', 'blacktrackjoggers', 'Black Track Joggers', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_33_58 AM (2).png', 'bottom', 'whitestraighttrousers', 'White Straight Trousers', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_33_58 AM (3).png', 'bottom', 'creammidiskirt', 'Cream Midi Skirt', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_33_58 AM (4).png', 'bottom', 'blackbasicshorts', 'Black Basic Shorts', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_34_01 AM (6).png', 'bottom', 'blackdolphinshorts', 'Black Dolphin Shorts', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_34_02 AM (7).png', 'bottom', 'blackleggings', 'Black Leggings', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_34_02 AM (8).png', 'bottom', 'blackbikeshorts', 'Black Bike Shorts', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_34_02 AM (9).png', 'bottom', 'whitepleatedskirt', 'White Pleated Skirt', 'CORE', 'bottom'),
    ('ChatGPT Image Sep 21, 2026, 01_34_03 AM (10).png', 'bottom', 'coralskort', 'Coral Skort', 'CORE', 'bottom'),
]

SKIPPED = {
    'ChatGPT Image Sep 19, 2026, 12_15_20 AM (1).png': 'older draw of Windbreaker (147 replaces it)',
    'ChatGPT Image Sep 19, 2026, 12_15_20 AM (2).png': 'older draw of Aurora Jacket (149)',
    'ChatGPT Image Sep 19, 2026, 12_15_20 AM (3).png': 'older draw of Varsity Jacket (148)',
    'ChatGPT Image Sep 19, 2026, 12_15_28 AM (2).png': 'third near-identical white/navy track jacket (Windbreaker, 147)',
    'ChatGPT Image Sep 19, 2026, 12_15_29 AM (8).png': 'older draw of Utility Vest (145)',
    'ChatGPT Image Sep 19, 2026, 12_15_30 AM (10).png': 'older draw of Cream Striped Knit (141)',
    'ChatGPT Image Sep 20, 2026, 09_56_10 PM.png': 'overview sheet; the same five tops ship as singles 218-222',
    'ChatGPT Image Sep 21, 2026, 01_33_59 AM (5).png': 'drawing is damaged: a pale smudge glows through both legs',
}


# ---------------------------------------------------------------------------
# Body geometry, in body.png pixels (248 x 640). The rig lays every item out in
# fractions of this box, so all placement below is solved here and divided out.
# ---------------------------------------------------------------------------
BW, BH = 248, 640
HEAD_CX, HEAD_W = 123, 157          # skull x 45..201 (CharacterRig HEAD)
EYE_Y = 8 + 0.46 * 218              # EYE_LINE_OF_HEAD
SOLE_Y = 640
FEET_SPAN = 0.797                   # the split shoes' left..right reach (fit-pair-footwear.py)

# Hats: (width in head widths, anchor, y). Calibrated off the fitted wave-1/4
# hats: a cap is 1.1 heads across with its brim at y~64, a beanie 1.09 at y~80,
# ear headbands 1.15-1.18 ending at y~70, a halo floating clear of the skull.
HAT = {
    'cap': (1.12, 'bottom', 66), 'visor': (1.12, 'bottom', 64),
    'band': (1.06, 'bottom', 70), 'beanie': (1.09, 'bottom', 80),
    'bucket': (1.28, 'bottom', 72), 'widebrim': (1.55, 'bottom', 66),
    'tallbrim': (1.5, 'bottom', 66), 'beret': (1.2, 'bottom', 58),
    'flapcap': (1.22, 'top', -42), 'ears': (1.18, 'bottom', 72),
    'wreath': (1.18, 'bottom', 62), 'tiara': (0.9, 'bottom', 34),
    'crown': (0.85, 'bottom', 30), 'headpiece': (1.05, 'bottom', 78),
    'halo': (1.0, 'bottom', -6), 'helmet': (1.22, 'center', 118),
    'bighelmet': (1.5, 'center', 122),
}
# Hair rules (see CharacterRig): hideHair hides every style, hidesBulky only
# the big ones, so open headwear still shows hair around it.
HAT_FLAGS = {
    'cap': 'hidesBulky: true', 'flapcap': 'hidesBulky: true', 'beanie': 'hidesBulky: true',
    'bucket': 'hidesBulky: true', 'widebrim': 'hidesBulky: true', 'tallbrim': 'hidesBulky: true',
    'beret': 'hidesBulky: true', 'helmet': 'hideHair: true', 'bighelmet': 'hideHair: true',
}
# Eyewear and masks: (width in head widths, centre y).
GLASSES = {
    'specs': (0.95, EYE_Y), 'shield': (1.02, EYE_Y - 2), 'goggles': (1.08, EYE_Y - 2),
    'mouthmask': (0.78, 168), 'eyemask': (1.0, EYE_Y - 4), 'faceshield': (1.1, 130),
}
# Accessories: (ink width px, anchor, y, centre x). Arms hang at the sides
# (x 5..40 and 208..243), the neck base is y~214, the crotch y~443.
ACC = {
    'watch': (40, 'center', 420, 20),
    # the art is both buds side by side, not two buds a head apart: worn at one ear
    'earbuds': (58, 'center', 128, 214),
    'belt': (225, 'center', 395, 124), 'bib': (110, 'center', 300, 124),
    'armband': (45, 'center', 290, 22), 'towel': (150, 'top', 196, 124),
    'harness': (200, 'top', 214, 124), 'crossbody': (215, 'top', 214, 124),
    'gaiter': (120, 'top', 196, 124), 'medal': (115, 'top', 212, 124),
    'chain': (125, 'top', 212, 124), 'lei': (170, 'top', 206, 124),
    'tie': (50, 'top', 214, 124), 'kerchief': (115, 'top', 208, 124),
    'bowtie': (70, 'center', 226, 124), 'handbag': (80, 'top', 380, 215),
    'lanyard': (80, 'top', 210, 124), 'sash': (200, 'top', 214, 124),
    'shoepods': (200, 'center', 612, 124), 'badge': (50, 'center', 290, 160),
    # behind the body
    'wings': (380, 'center', 270, 124), 'aura': (330, 'center', 330, 124),
    'blades': (290, 'center', 260, 124), 'floatleft': (70, 'center', 60, 20),
    'floatright': (70, 'center', 60, 228), 'halo': (170, 'bottom', -4, 124),
    'flares': (280, 'center', 235, 124), 'rings': (320, 'center', 400, 124),
}
# Worn at the neck or on the head: drawn after the jaw plate, not under it.
AT_NECK = {'towel', 'gaiter', 'medal', 'chain', 'lei', 'tie', 'kerchief', 'bowtie', 'lanyard', 'earbuds'}

# Tops and bottoms come off the same generator at one drawing scale, so they
# are placed by SCALE (body px per source px), measured off the fits made by
# hand in the Fit Studio: tops median 0.22 with the collar at y~186. Bottoms
# are anchored on the waistband instead, because shorts and trousers flare by
# very different amounts below it: the legs span 158px where they split
# (x 44..202 at y 448), so the band is a little wider than that, its top edge
# at y 395, and a hem that would run past the ankle scales the piece down.
TOP_SCALE, TOP_Y = 0.22, 0.29 * 640
WAIST_W, WAIST_Y, HEM_MAX = 160, 395, 626

MAX_SIDE = 768
EXPORTS = {'top': 'CURATED_TOPS', 'accessory': 'CURATED_ACCESSORIES', 'bottom': 'CURATED_BOTTOMS',
           'glasses': 'CURATED_GLASSES', 'extra': 'CURATED_EXTRAS', 'footwear': 'CURATED_FOOTWEAR',
           'headwear': 'CURATED_HEADWEAR'}


def rnd(v):
    return f"{round(v, 4):g}"


def trim(im):
    im = im.convert('RGBA')
    box = Image.fromarray((np.asarray(im)[..., 3] > 8).astype(np.uint8) * 255).getbbox()
    return im.crop(box) if box else im


def _seams(profile, n):
    """n-1 cut positions: the emptiest line within 12% of each nominal cut."""
    L = len(profile)
    cuts = [0]
    for k in range(1, n):
        c, r = round(k * L / n), round(0.12 * L / n)
        cuts.append(c - r + int(np.argmin(profile[c - r:c + r + 1])))
    return cuts + [L]


def sheet_cell(name, cols, rows, cell):
    """One cell of a contact sheet.

    Neighbouring drawings touch (outlines overlap on the costume and tops
    sheets), so neither connected components nor a straight grid work: rows are
    split at the emptiest row near each nominal line, then each row's columns
    at the emptiest column near theirs.
    """
    arr = np.asarray(Image.open(SOURCE / name).convert('RGBA'))
    a = arr[..., 3] > 60
    ys = _seams(a.sum(1), rows)
    r, c = divmod(cell, cols)
    band = arr[ys[r]:ys[r + 1]]
    xs = _seams((band[..., 3] > 60).sum(0), cols)
    out = band[:, xs[c]:xs[c + 1]].copy()
    # a sliver of a neighbour can survive the cut; keep the biggest blob and
    # whatever lies close to it
    m = out[..., 3] > 60
    lab, n = ndimage.label(ndimage.binary_dilation(m, iterations=6))
    if n > 1:
        sizes = ndimage.sum(m, lab, range(1, n + 1))
        keep = [i + 1 for i, v in enumerate(sizes) if v >= 0.08 * sizes.max()]
        out[..., 3] = np.where(np.isin(lab, keep), out[..., 3], 0)
    return Image.fromarray(out)


def load(src):
    if isinstance(src, tuple):
        name, cols, rows, cell = src
        return trim(sheet_cell(name, cols, rows, cell))
    return trim(Image.open(SOURCE / src))


def vec(im):
    bg = Image.new('RGBA', im.size, (255, 255, 255, 255))
    bg.alpha_composite(im.convert('RGBA'))
    v = np.asarray(bg.convert('RGB').resize((24, 24), Image.BILINEAR), float).ravel()
    return (v - v.mean()) / (v.std() + 1e-6)


def place(w_px, anchor, y, cx, W, H):
    """Layout for art trimmed to its ink, drawn w_px wide in body pixels."""
    h_px = w_px * H / W
    out = {'w': w_px / BW}
    if anchor == 'center':
        out['cy'] = y / BH
    elif anchor == 'top':
        out['top'] = y / BH
    else:
        out['top'] = (y - h_px) / BH
    if abs(cx - BW / 2) > 0.5:
        out['dx'] = (cx - BW / 2) / BW
    return out


def solve(slot, kind, im, scale_hint):
    W, H = im.size
    if slot == 'headwear':
        k, anchor, y = HAT[kind]
        return place(k * HEAD_W, anchor, y, HEAD_CX, W, H)
    if slot == 'glasses':
        k, cy = GLASSES[kind]
        return place(k * HEAD_W, 'center', cy, HEAD_CX, W, H)
    if slot in ('accessory', 'extra'):
        w_px, anchor, y, cx = ACC[kind]
        return place(w_px, anchor, y, cx, W, H)
    if slot == 'footwear':
        return place(FEET_SPAN * BW, 'bottom', SOLE_Y, BW / 2, W, H)
    if slot == 'top':
        return place(W * TOP_SCALE * scale_hint, 'top', TOP_Y, BW / 2, W, H)
    if slot == 'bottom':
        a = np.asarray(im)[..., 3] > 40
        row = a[int(H * 0.05)]
        xs = np.nonzero(row)[0]
        waist = (xs.max() - xs.min()) if len(xs) else W
        w_px = W * WAIST_W / waist
        w_px = min(w_px, (HEM_MAX - WAIST_Y) * W / H)
        return place(w_px, 'top', WAIST_Y, BW / 2, W, H)
    raise ValueError(slot)


def js_layout(lay):
    keys = [k for k in ('w', 'top', 'cy', 'dx') if k in lay]
    return '{ ' + ', '.join(f"{k}: {rnd(lay[k])}" for k in keys) + ' }'


def unlock_for(tag):
    achievement = tag in ('ACHIEVEMENT', 'CORE_ACHIEVEMENT')
    if tag == 'CORE':
        return 'null', 'common', ''
    if achievement:
        return "{ pass: true, label: 'Achievement reward' }", 'epic', ', achievement: true'
    return {
        'FREE': ("{ pass: true, label: 'Free pass reward' }", 'rare', ''),
        'PRO': ("{ premium: true, label: 'PASER PRO reward' }", 'legendary', ''),
        'BOX': ("{ pass: true, label: 'Cosmetic lootbox chase item' }", 'legendary', ''),
        'EVENT': ("{ pass: true, label: 'Regional / seasonal event reward' }", 'epic', ''),
    }[tag]


def studio_fits():
    """The hand fits made in the Fit Studio against the art being replaced.

    The old art is read from git HEAD's tree, never from disk: after the first
    install the files on disk ARE the new art, and matching a fit against them
    would attach it to whatever happens to share the old file name.
    """
    if not OVERRIDES.exists():
        return {}, {}
    data = json.loads(OVERRIDES.read_text(encoding='utf-8'))
    fits = {}
    for slot in ('top', 'bottom'):
        for key, lay in (data.get(slot) or {}).items():
            if not key.startswith('cur_'):
                continue
            rel = f"frontend/assets/character/curated/{slot}/{key[4:]}.png"
            blob = subprocess.run(['git', 'show', f'{FIT_BASE}:{rel}'], cwd=ROOT.parent,
                                  capture_output=True).stdout
            if blob:
                fits[(slot, key)] = (lay, Image.open(io.BytesIO(blob)).convert('RGBA'))
    return data, fits


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--dry', action='store_true', help='solve and report, write nothing')
    ap.add_argument('--resolve', action='store_true',
                    help='re-solve EVERY item line (drops Fit Studio fits, z and reward edits)')
    args = ap.parse_args()

    missing = [m[0] if isinstance(m[0], str) else m[0][0] for m in MANIFEST]
    missing = sorted({n for n in missing if not (SOURCE / n).exists()})
    if missing:
        raise SystemExit(f"missing source files: {missing}")

    # Sheet art is drawn smaller than the singles. A sheet that repeats a single
    # gives the ratio directly: 139 cell 0 is the rain shell (single 99), 178
    # cell 3 the tactical rig (single 171). Sheet 170 shares 139's layout.
    def ratio(single, sheet):
        return load(single).size[0] / load(sheet).size[0]
    r139 = ratio(RAIN_SHELL, (SHEET_TOPS_A, 5, 2, 0))
    r178 = ratio(TACTICAL_RIG, (SHEET_COSTUMES, 5, 1, 3))
    hint = {SHEET_TOPS_A: r139, SHEET_TOPS_B: r139, SHEET_COSTUMES: r178}
    print(f"sheet scale: tops sheets x{r139:.3f}, costume sheet x{r178:.3f}")

    # Deleted in the Fit Studio means deleted: never bring an item back.
    deleted_log = ROOT / 'scripts' / 'fit-studio' / 'deleted-items.json'
    deleted = {d['id'] for d in json.loads(deleted_log.read_text(encoding='utf-8'))} if deleted_log.exists() else set()
    manifest = [m for m in MANIFEST if f"cur_{m[2]}" not in deleted]
    if len(manifest) != len(MANIFEST):
        print(f"skipping {len(MANIFEST) - len(manifest)} items deleted in the Fit Studio")

    overrides, fits = studio_fits()
    saved = json.loads(CARRIED.read_text(encoding='utf-8')) if CARRIED.exists() else {}
    items = []
    for src, slot, slug, label, tag, kind in manifest:
        im = load(src)
        h = hint.get(src[0], 1.0) if isinstance(src, tuple) else 1.0
        items.append(dict(src=src, slot=slot, slug=slug, label=label, tag=tag, kind=kind,
                          im=im, h=h, v=vec(im), lay=solve(slot, kind, im, h)))

    # Carry each studio fit over to the new drawing of the SAME garment. The
    # ids were attached to the wrong drawings before, so a fit is matched by
    # what its art looks like, not by its id; the scale (body px per source px)
    # is kept, which is what makes it survive a redraw at a slightly different
    # size.
    carried = {}
    for (slot, key), (lay, old) in fits.items():
        pool = [it for it in items if it['slot'] == slot]
        v = vec(old)
        best = max(pool, key=lambda it: float(it['v'] @ v) / v.size)
        sim = float(best['v'] @ v) / v.size
        if sim < 0.7:
            print(f"  fit {key}: no confident match ({sim:.2f}), dropped")
            continue
        prev = carried.get(best['slug'])
        if prev and prev[0] >= sim:
            continue
        base = {'w': 0.9, 'top': 0.30} if slot == 'top' else {'w': 0.72, 'top': 0.55}
        scale = lay.get('w', base['w']) * BW / old.size[0]
        new = {'w': scale * best['im'].size[0] * best['h'] / BW,
               'top': lay.get('top', base['top'])}
        if lay.get('dx'):
            new['dx'] = lay['dx']
        carried[best['slug']] = (sim, key, new)
    for slug, rec in saved.items():
        if slug not in carried:
            carried[slug] = (rec['sim'], rec['from'], rec['layout'])
    for slug, (sim, key, new) in carried.items():
        it = next(i for i in items if i['slug'] == slug)
        it['lay'] = new
        print(f"  fit {key} -> cur_{slug} ({sim:.2f})")

    # Items already in the catalogue keep their line as it stands: from
    # 2026-09-22 their layouts, draw side (z) and reward unlocks are hand work
    # done in the Fit Studio and in progression.py, and a re-run must only add
    # what is new. --resolve starts every line over.
    existing = {}
    if CONFIG.exists() and not args.resolve:
        for line in CONFIG.read_text(encoding='utf-8').splitlines():
            m = re.search(r"id: 'cur_(\w+)'", line)
            if m:
                existing[m.group(1)] = line
    blocks = {}
    for it in items:
        if it['slug'] in existing:
            blocks.setdefault(it['slot'], []).append(existing[it['slug']])
            continue
        rel = f"../../assets/character/curated/{it['slot']}/{it['slug']}.png"
        unlock, rarity, ach = unlock_for(it['tag'])
        source_tag = 'CORE' if ach else it['tag']
        extra = ''
        if it['slot'] == 'headwear' and it['kind'] in HAT_FLAGS:
            extra = ', ' + HAT_FLAGS[it['kind']]
        if it['slot'] == 'extra':
            extra = ", z: 'back'"
        if it['slot'] == 'accessory':
            extra = ", z: 'front'" + (', atNeck: true' if it['kind'] in AT_NECK else '')
        blocks.setdefault(it['slot'], []).append(
            f"  {{ id: 'cur_{it['slug']}', label: {js_str(it['label'])}, img: require('{rel}'), "
            f"layout: {js_layout(it['lay'])}{extra}, sourceTag: '{source_tag}'{ach}, "
            f"rarity: '{rarity}', unlock: {unlock} }},")

    counts = {s: len(b) for s, b in blocks.items()}
    print('items:', counts, 'total', sum(counts.values()))
    if args.dry:
        return

    CARRIED.write_text(json.dumps({slug: {'sim': round(sim, 3), 'from': key, 'layout': new}
                                   for slug, (sim, key, new) in sorted(carried.items())}, indent=1),
                       encoding='utf-8')

    written = set()
    for it in items:
        out = DEST / it['slot'] / f"{it['slug']}.png"
        out.parent.mkdir(parents=True, exist_ok=True)
        im = it['im']
        if max(im.size) > MAX_SIDE:
            f = MAX_SIDE / max(im.size)
            im = im.resize((round(im.width * f), round(im.height * f)), Image.LANCZOS)
        # Windows: a file watcher (Metro, the studio, Explorer) can hold a PNG
        # open for a moment, which surfaces as EINVAL; a short retry clears it.
        for attempt in range(20):
            try:
                im.save(out, optimize=True)
                break
            except OSError:
                if attempt == 19:
                    raise
                time.sleep(0.25)
        written.add(out.resolve())
    stale = [p for p in DEST.rglob('*.png') if p.resolve() not in written]
    for p in stale:
        p.unlink()
    print(f"wrote {len(written)} PNGs, removed {len(stale)} stale")

    order = ['top', 'accessory', 'bottom', 'glasses', 'extra', 'footwear', 'headwear']
    body = '\n\n'.join(f"export const {EXPORTS[s]} = [\n" + '\n'.join(blocks[s]) + '\n];' for s in order)
    CONFIG.write_text(
        '// Generated by scripts/install-curated-2.py. Fit Studio owns layout values:\n'
        '// fits written from the studio land here, and re-running the installer\n'
        '// re-solves every layout, so apply studio fits AFTER any re-install.\n\n'
        + body + '\n', encoding='utf-8')
    print(f"wrote {CONFIG.relative_to(ROOT)}")

    # The carried fits now live in the catalogue; left in the studio's pending
    # overrides they would be re-applied to whatever art the OLD id now names.
    if fits:
        stamp = time.strftime('%Y-%m-%dT%H-%M-%S')
        backup = OVERRIDES.with_name(f'fit-overrides.pre-curated-2-{stamp}.json')
        shutil.copy(OVERRIDES, backup)
        for slot in ('top', 'bottom'):
            for key in [k for k in (overrides.get(slot) or {}) if k.startswith('cur_')]:
                del overrides[slot][key]
        OVERRIDES.write_text(json.dumps(overrides), encoding='utf-8')
        print(f"cleared {len(fits)} carried studio fits (backup {backup.name})")


def js_str(s):
    return "'" + s.replace('\\', '\\\\').replace("'", "\\'") + "'"


if __name__ == '__main__':
    main()
