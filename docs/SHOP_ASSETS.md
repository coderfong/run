# PASER — merchant shop asset spec

Target: rebuild `src/screens/ShopScreen.js` as a **shopfront scene** — a
shopkeeper behind a counter at the top, the rotating stock on a board below —
instead of the current plain card grid.

Same rules as `ONBOARDING_ASSETS.md`: every file is optional, `art()` returns
`null` for anything missing, and the screen falls back to what it draws today.
Save to `frontend/assets/art/shop/`, then uncomment the key in
`src/config/onboardingArt.js`. Nothing else to wire.

---

## 0. Read this before generating anything

Three constraints, each learned by shipping it wrong:

1. **No 9-slice in React Native.** `Image` has no cross-platform 9-slice, so a
   frame authored square and stretched into a wide box distorts its corners
   (this is why `tile-free.png` / `tile-pro.png` are generated but unused).
   Every frame below is therefore specified **at the aspect ratio it actually
   renders at**. If you regenerate one at a different shape, it will look wrong
   no matter what the code does.
2. **No text baked into the art.** Prices, the countdown, item counts and
   rarity are live data drawn by the app. A plaque is generated *empty*; the
   label goes on top. Bake in "BUY" and it can never be localised or restyled.
3. **Leave the middle clear.** Anything the app draws over (the merchant's
   counter, an item cell, a plaque) needs a calm, low-contrast centre or the
   text on top becomes unreadable.

### Style block — paste at the top of EVERY prompt

Use the block from `ASSET_PROMPTS.md` §0 and **upload
`docs/character-sheet.png` as a reference every time**. The one substitution
for this screen:

> The shopkeeper is a **person** — one of the PASER runner cast — not an animal
> and not a mascot. Think a friendly market-stall trader in running gear:
> apron over a track top, cap or visor, towel over one shoulder.

The reference screenshot that prompted this is a dark painterly fantasy game.
Do **not** copy its rendering — match PASER's flat hand-inked look. Copy its
*layout*, not its art direction.

---

## 1. The layer breakdown

The reference screen is eight stacked layers. Mapped to PASER:

| # | Reference | PASER asset | Have it? |
|---|---|---|---|
| 1 | Tent backdrop, shelves, crates | `shop-scene.png` | generate |
| 2 | Frog merchant | `shop-merchant.png` | generate |
| 3 | Counter the merchant stands behind | `shop-counter.png` | generate |
| 4 | Currency HUD (coins / gems) | coin + energy icons | **already have** |
| 5 | "Next refresh in…" bar | `shop-refresh-bar.png` | generate |
| 6 | Offer board | `shop-board.png` | generate |
| 7 | Per-offer card frame | `shop-cell.png` | generate |
| 8 | Buy plaque, sale burst, divider | `shop-plaque.png`, `shop-sale.png`, `shop-divider.png` | generate |

---

## 2. Tier 1 — the six that create the look

Generate these first. With just these the screen already reads as a shopfront.

**Three of these six are DONE and must not be regenerated.** `shop-scene.png`
and `shop-counter.png` are superseded by the two painted plates in §3a, which
are cut from one master and are the shape the scene actually uses;
`shop-merchant.png` was never needed at all, because the shopkeeper is a real
PASER avatar rendered through `CharacterRig` (see `PIT_STOP_CREW`) rather than
bespoke art. `shop-board.png`, `shop-cell.png` and `shop-plaque.png` are still
open — the stock grid draws hand-drawn frames from the frame registry today.

| File | Size | Alpha | Notes |
|---|---|---|---|
| `shop-scene.png` | 1536×1024 | no | Stall interior: canopy above, shelves and crates left and right, warm lamp light. **Bottom-centre 40% must stay empty and uncluttered** — the merchant and counter sit there. |
| `shop-merchant.png` | 1024×1024 | **yes** | Shopkeeper, waist-up, facing forward, arms open in welcome. Centred, generous headroom, nothing cropped at the sides. |
| `shop-counter.png` | 1536×512 | **yes** | Foreground counter strip the merchant stands behind — wooden bench with a few goods. Sells the depth. Transparent above the bench line. |
| `shop-board.png` | 1024×1280 | **yes** | The stock board below the scene: a leather-and-wood panel with stitched edge and corner rivets. **Flat, near-empty middle** — 12 item cells are drawn on it. Authored at 4:5, the ratio it renders at. |
| `shop-cell.png` | 512×640 | **yes** | One item slot: a recessed pocket with a thin frame. Neutral so rarity can tint the border. Empty centre — the cosmetic art and price are drawn inside. |
| `shop-plaque.png` | 512×160 | **yes** | Blank wooden buy plaque with metal end caps, 3.2:1. **No lettering.** |

## 3. Tier 2 — chrome

| File | Size | Alpha | Notes |
|---|---|---|---|
| `shop-refresh-bar.png` | 1536×256 | **yes** | Wide banner for the rotation countdown, 6:1. Calm centre for the timer text. |
| `shop-hud.png` | 512×256 | **yes** | Small parchment plate behind the coin balance, top-right. |
| `shop-divider.png` | 1024×192 | **yes** | Ribbon/rope divider for section headings between rarity groups. |
| `shop-sale.png` | 512×512 | **yes** | Starburst badge for a discounted item. **No "%" baked in** — the number is drawn on top. Only worth generating if you add a sale mechanic (see §5). |
| `shop-soldout.png` | 512×268 | **yes** | Diagonal "owned" stamp. You can reuse `art/ui/stamp-claimed.png` instead and skip this. |

## 3a. The stall is PAINTED — two plates, one master

**This supersedes `shop-scene.png` and `shop-counter.png` in the table above.**
The station used to draw its own environment as vector art in
`components/shop/PitStopArt.js`. It does not any more. One illustration of the
whole stall — blue-and-white canopy, cream back wall, two shelves, a
water-drop counter, a sunny park behind it — is the environment, and
`frontend/scripts/install-pit-stop-art.py` cuts it into the two plates the
scene needs.

| File | Size | Alpha | What it is |
|---|---|---|---|
| `art/src/pitstop-water-point.png` | 941×1672 | no | The master, as delivered. Nothing renders it; the install script reads it. |
| `art/shop/pitstop-backdrop.png` | 1290×1251 | no | Everything BEHIND the crew: sky, canopy, wall, shelves, counter top. |
| `art/shop/pitstop-counter.png` | 1290×1251 | **yes** | The counter from its back edge down, drawn AFTER the crew. |

**Why two and not one.** The three volunteers stand between them. The counter
has to occlude them at the hip or they read as pasted onto a picture of a
stall rather than standing behind one — that sandwich is the entire reason for
the cut, and it is the only cut. Both plates are the full scene box and both
come out of ONE resize of ONE crop, so they register exactly; cutting them as
two separate crops would land them on different pixel grids and leave a
hairline seam along the counter's top edge.

**The scene box moved.** It was 1536×1146 (1.34); it is 1536×1490 (1.03),
because the painting is close to square once the empty sand below the stall is
dropped. Every frame in `config/pitStop.js` is measured off the picture — the
canopy's lower outline at y 671, the shelves at 911, the counter's top edge at
1188 — and the crew is smaller than it was, because a stall whose hips reach
the counter and whose hat clears the awning cannot be much wider than 270
units. The hero is taller than the old one; it is the first thing in a
ScrollView and picking an item scrolls past it, so that is affordable.

**To regenerate:** replace the master and run

```
cd frontend && python scripts/install-pit-stop-art.py
```

then re-measure the landmarks in `config/pitStop.js`. The crop rows live in
the script, in SOURCE pixels, so the two files describe the same picture.

**To check it without a device:** `python scripts/gen-pit-stop-preview.py`
composites the real plates, the real catalogue avatars and the real prop clips
at their real frames into `scripts/qa-pit-stop/`. A collision it shows is a
real one.

### What the painting retired

* The five vector layers (`BackgroundLayer`, `TentLayer`, `BackWallLayer`,
  `CounterBaseLayer`, `CounterFrontLayer`) and `BuntingArt` / `SignArt`. Still
  exported from `PitStopArt.js`, drawn by nothing, and authored against the old
  box — any of them brought back needs its geometry redone.
* **The drifting sky.** Three tiling cloud strips crossed the vector sky at
  three speeds. The painted sky has trees in its top corners, so a strip would
  slide clouds in front of the treetops. `pitstop-cloud-band.png` stays wired
  because `PlazaScene` drifts the same band on Crossroads.
* **The wall props** (route board, race bib). The painted wall is bare by
  design and three heads leave no strip wide enough for a readable board. The
  shelves carry real PASER icons instead — the stopwatch on the left, the
  trophy on the right, each at the end its volunteer does not stand in front of.
* **The second hanging bottle.** The painting hangs its own pennant banners on
  both tent poles, so a drawn bottle swinging there was a second object doing
  the same job in the same place. One bottle and the medal remain, in the two
  lanes the crew leaves clear.

### One thing the painting exposed

The attendant wore the `visor`, and the visor's art reaches to y 127 in rig
body units while the eyes sit at 108–120 — it covers them completely. That
made the one character whose blinks and expression ladder carry the whole
scene unable to show either. The shop's keeper wears the `bandana` now.

**The visor covers the eyes for every runner wearing it**, not just this one.
That is a layout to fix in `config/cosmetics.js` and it is deliberately not
fixed from the shop's crew list.

## 3b. Motion props — already filled by supplied clips

These slots are **done**, from clips supplied as video rather than generated as
stills. Do not write prompts for them.

| Scene slot | Asset | Source |
| --- | --- | --- |
| sky above the tent | `art/shop/pitstop-cloud-band.png` | a scrolling cloud clip, shipped as ONE still frame and drifted by the scene at three speeds |
| tent peak — the stall's signage | `animations/open-sign.webp` | replaced the painted banner |
| tent decoration, top-left | `animations/prop-balloons.webp` | Iconscout |
| counter, far left | `animations/prop-coconut.webp` | Iconscout — replaced the vector towels |
| counter, in front of the attendant | `animations/prop-watermelon.webp` | Iconscout — replaced the vector fruit bowl |
| counter, helper's lane | `animations/prop-soda-bottles.webp` | Iconscout — replaced the vector gel tray |

**The four Iconscout assets are watermarked** — they were supplied as preview
downloads with `iconscout / Graphiqa Studio` baked across the subject. They are
wired up and positioned, but must be re-downloaded licensed before a store
build. Same filenames, then re-run `frontend/scripts/convert-scene-animations.py`.

The counter is now entirely supplied art. The drawn towels, cooler, gel tray,
fruit bowl, pennant garland and painted banner in `components/shop/PitStopArt.js`
are no longer rendered; the drawing code is still exported there if any of it is
ever wanted back.

`SCENE.visibleHeight` is gone with the vector stall: the hero used to be
cropped short of its own box to cut the dead bottom off a drawn counter skirt,
and the painted plate simply ends at the counter's lower outline instead. Any
new full-scene layer must still be sized with `sceneBox`, not `absoluteFill` —
the two plates have to agree on where the counter's top line falls, or the crew
is cut in the wrong place.

Anything new that joins this set is SCENERY, which means two things in
`config/gameAnimations.js`: encode it with an infinite loop count, and mark it
`selfLooping: true` so Reduce Motion holds a frame rather than deleting the
object off the counter.

## 4. Tier 3 — polish, only if the screen earns it

- `shop-merchant-wave.png` (1024×1024, alpha) — a second pose so the keeper
  waves on entry. Same framing as the base pose so they can cross-fade.
- `shop-merchant-sad.png` — the "can't afford it" reaction.
- `shop-canopy.png` (1536×384, alpha) — a drape that overlays the very top for
  depth in front of the scene.

---

## 5. Do NOT generate these — PASER has no such mechanic

The reference shows features this app doesn't have. Art for them would sit
unused, so skip unless you decide to build the feature first:

- **Set-progress bars** ("Transformation Set 2/5, 40%"). PASER cosmetics have
  no set/collection grouping.
- **A second currency** (the blue gems). PASER has coins and energy only.
- **Manual shop refresh** ("Refresh Shop 3/3"). The rotation is a deterministic
  12-hour window derived from the clock (`backend/app/coins.py`,
  `ROTATION_HOURS = 12`) with nothing stored server-side — a manual reroll
  means new backend state, not just art.
- **A discount badge.** No sale mechanic exists; prices come from rarity.

---

## 6. Layout note — the grid is 12, not 2

The reference sells two big offers. PASER's window is **12 items** (5 common,
4 rare, 2 epic, 1 legendary — `FEATURED_MIX`), so the board holds a 3-column
grid of small cells, not two hero cards. `shop-cell.png` is specified at 4:5
for that grid. If you'd rather have the reference's two-up hero layout, the
rotation mix has to shrink first — that's a backend change, and worth deciding
before generating cell art at the wrong shape.

Cells show **art and price only** — no item name, per the art-only rule in
`ShopScreen.js`. That means the cell needs less vertical room than the
reference's cards, which carry a title and a progress bar.
