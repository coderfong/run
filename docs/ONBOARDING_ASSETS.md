# PASER — game-style UI asset spec

Everything the game-style surface can display — the first-run flow, the
tutorial, and the restyled app screens — keyed to the exact filenames the code
already looks for. Every asset is **optional**: `src/config/onboardingArt.js`
returns `null` for anything missing and the screens fall back to a code-drawn
panel, so drop files in as they're ready.

- §1–§4 — first run (onboarding + coach marks)
- **§5 — app screens** (Home strip, page headers, profile banner, badges)
- **§6 — pass, rewards, side rail** (lootbox rarities, claim FX, PRO exclusives)

**Wiring a new file = 2 steps:** save it at the exact path below → uncomment its
line in `frontend/src/config/onboardingArt.js`. Nothing else.

The flow itself:

| # | Step | File | Art used |
|---|---|---|---|
| 1 | Name | `onboarding/steps/NameStep.js` | `thumbName` |
| 2 | Birthday | `onboarding/steps/BirthdayStep.js` | `thumbBirthday` |
| 3–7 | Face · Hair · Top · Bottoms · Hat | `onboarding/steps/CharacterStep.js` | `stage` + the character rig |
| 8 | PASER PRO | `onboarding/steps/ProStep.js` | `proHero` |
| 9 | Ready | `onboarding/steps/ReadyStep.js` | `thumbReady` |
| — | Coach marks over the live app | `onboarding/TutorialOverlay.js` | `welcome, claim, energy, clans` (defend card), `safety`; final card is icon-only |

---

## Style north star — put this block at the top of EVERY prompt

> Hand-inked cartoon illustration in the PASER style: wobbly black ink outline
> (uniform ~6px at 1536px wide), flat matte fills, no gradients inside shapes,
> no gloss. Bold single-source light from the top-left. Heavy risograph film
> grain over the whole image and a slight off-register colour edge, like a
> cheap comic print. Limited palette: one saturated background colour plus
> PASER pink `#ec4899`, purple `#8b5cf6`, teal `#2dd4bf`, cream `#F4EEE1`, ink
> `#0C0C10`. Runners are a diverse crew of ordinary people (mixed body types,
> ages, skin tones, one wearing a sports hijab) — never a mascot animal, never
> a corporate flat-illustration look. Square-ish 4:3 comic panel, subject
> centred with generous headroom, **no text and no lettering baked in** unless
> the entry says otherwise. Flat background colour fills the whole frame edge
> to edge.

Two deliberate borrowings from the reference app you sent: **the grain** and
**the comic panel framing** (speech bubbles, motion lines, one clear action per
panel). Everything else stays PASER — its own crew art and its own pink, not
the reference's orange.

Deliver **PNG**, sRGB, no alpha needed for panels (the flat colour is the
background), @2x sizes below. Keep every panel's flat background colour in sync
with `ART_BG` in `src/config/onboardingArt.js`.

---

## 1. Story panels — the coach marks (P0)

`1536 × 1152` (4:3). Path: `frontend/assets/art/onboarding/<file>`.

The three shipped panels are **square (1254²)** and their cards already pass
`aspect: 1`; anything new is 4:3.

| key | file | status | Panel brief |
|---|---|---|---|
| `welcome` | *(none — by design)* | ✅ | Shows the runner the player just built, on a `#2B1636` panel. Only add art here if you want a bespoke "the crew waves you in" panel instead. |
| `claim` | *(reusing `art/claim-explainer.png`)* | ✅ | — |
| `clans` | *(reusing `art/onboarding-clans.png`)* | ✅ | — |
| `safety` | *(reusing `art/onboarding-safety.png`)* | ✅ | — |
| `energy` | `onboarding/energy.png` | ❌ **generate** | Purple `#2B1636`: a runner mid-stride grabbing a glowing pink lightning bolt out of the air, sparks trailing; a second bolt already stuffed in their pocket. Speech bubble empty/none. |
| `run` | `onboarding/run.png` | ⭕ optional | Final card ("Go claim your first patch"). Falls back to the `Flag` icon. Teal/green: a runner setting off from a start line with a claim flag under one arm, a loop of dashed path curving away ahead of them. |
| `pasers` | `onboarding/pasers.png` | 🗄 unused | Deep blue `#13294B`: two runners high-fiving mid-run. Kept wired for the day the pasers card returns, but the tutorial no longer shows it (the `pasers` card was dropped 2026-09-01 when the flow went to 6 cards ending on the first run). |
| `rewards` | `onboarding/rewards.png` | ⭕ optional | Warm brown `#3A1D0B`: a runner popping open a lootbox, light rays and cosmetics (cap, shades, cape) flying out. |
| `leaderboard` | `onboarding/leaderboard.png` | ⭕ optional | Teal `#0B322A`: three runners on a chunky hand-drawn podium, the 1st-place one flexing. |

> The four ✅ rows already ship — the tutorial is usable **today** with zero new
> art. Generate `energy` first; it is the only shipping card still on an icon
> fallback.

---

## 2. Step thumbnails (P0 — tiny, high payoff)

`520 × 520`, rounded-square composition (the code clips to a 28px squircle with
an ink border, so **don't** bake the rounded corners in). Flat colour bg.

| key | file | Brief |
|---|---|---|
| `thumbName` | `onboarding/thumb-name.png` | Orange `#F26A3A`: two runners shaking hands, one wearing a stuck-on "HELLO my name is" badge. Badge is blank — no lettering. |
| `thumbBirthday` | `onboarding/thumb-birthday.png` | Pink `#E2497A`: a runner in a party hat leaning over a birthday cake with lit candles, mid-blow. |
| `thumbReady` | `onboarding/thumb-ready.png` | Teal `#0F766E`: a runner in a starting-block crouch on a chunky start line, dust puff behind the back foot. |

---

## 3. Backdrops (P1)

| key | file | Size | Brief |
|---|---|---|---|
| `stage` | `onboarding/stage.png` | `1170 × 1400` (portrait, will be cropped) | The night stage the character creator stands on: deep navy-to-teal night sky with a few stars, a pale footpath running left→right across the lower third, dark bushes at both edges, soft warm glow where the runner will stand (centre, lower third). **Leave the centre clear** — the rig is composited on top. |
| `proHero` | `onboarding/pro-hero.png` | `1536 × 1152` | PASER PRO panel: a runner in a gold cape bursting through a paper banner, gold sparks, deep brown `#2A1B06` bg. Gold `#F5C451` is the only warm accent. |
| `grain` | `onboarding/grain.png` | `512 × 512` tileable, alpha | Optional: monochrome film-grain tile so code-drawn panels get the same texture as the art. Ping me to wire it as an overlay. |

---

## 4. Character art gaps the new flow exposes (P1 — the real gap)

The reference flow opens with **"Choose your Stomper"** (body build) and
**"Choose body color"**. PASER can't offer either yet: `assets/character/body/`
holds exactly **one** `body.png`, so the flow starts at Face instead.

To match the reference, generate either or both — they slot into the same
step component, one line each:

| Need | Deliver | Notes |
|---|---|---|
| **Body builds** | `assets/character/body/body-{1..5}.png` | Same `248 × 640` trimmed canvas, same head/shoulder/hip anchors as the current `body.png` — the rig places every other layer off those fractions (`LAYOUT` in `CharacterRig.js`). Vary build (slim, mid, broad, short, tall) NOT pose. |
| **Skin tones** | `assets/character/body/body-<build>-{1..8}.png` | 8 tones per build, same pipeline as the other colourables (`frontend/scripts/asset-pipeline.py` recolours from a master). |

Send me the sheets and I'll add the `body` slot to `SLOTS`/`ITEMS`, wire the
z-order in `CharacterRig`, and drop two more steps ("Meet your Paser" → build,
"You can style your Paser" → skin) into `CHARACTER_STEPS` — the flow is already
data-driven, so it's a config change, not a rewrite.

---

## 5. App screens (P0 — this is what makes the whole app read as a game)

The shared kit is `src/components/ui/toon.js` (`ToonCard`, `ToonHeader`,
`ToonRow/Group`, `ToonChip`, `ProgressTrack`, `SlotDots`, `GetStartedCard`) on
tokens in `src/theme/toon.js`. It's already used by the tab bar, Home and
Pasers; everything below is art those pieces will pick up.

Path: `frontend/assets/art/ui/<file>` — transparent PNG unless noted.

| key | file | Size | Where it shows | Brief |
|---|---|---|---|---|
| `getStartedLeft` | `ui/getstarted-left.png` | 300 × 360 | Home checklist strip, left edge | A runner mid-stride leaning INTO the frame, cropped by the card edge. Shoulders-to-knees, facing right. |
| `getStartedRight` | `ui/getstarted-right.png` | 300 × 360 | same, right edge | A runner planting a claim flag into the ground, facing left. Mirror weight of the left one. |
| `headerPasers` | `ui/header-pasers.png` | 1254² | "Add pasers" header | **Shipped.** TWO runners high-fiving mid-stride, passing in opposite directions — the huddle-of-six brief it replaced read as a crowd, not as *your* runners. Square for the same reason as `headerRivals` below. Its baked green `#28AB8A` is repeated as the header's `solid` in `PasersScreen`, so keep the two in step if the art is regenerated. |
| `headerClub` | `ui/header-club.png` | 640 × 500 | Club page header | Two club crews facing off across a painted line, chests out, one holding a crest. |
| `headerLeaderboard` | `ui/header-leaderboard.png` | 640 × 500 | Leaderboard header | Three runners on a chunky hand-drawn podium; 1st flexing, 3rd sulking. |
| `headerRivals` | `ui/header-rivals.png` | 1254² | Rivals header | **Shipped.** TWO runners only, planting rival flags either side of a torn plot of claimed ground — a personal grudge, not a crowd (that is what separates it from `headerClub`). Square, not 640 × 500: the header is tall enough that `cover` crops a square down to the two runners. Its baked teal `#04776E` is repeated as the header's `solid` in `RivalsScreen`, so keep the two in step if the art is regenerated. |
| `profileBanner` | `ui/profile-banner.png` | 1400 × 600 | top of You / Profile | A wide roadside scene band — footpath, bushes, a couple of rocks, warm low sun. **Leave the centre 40% clear**: the player's runner is composited on top. Opaque, not transparent. |
| `burstRays` | `ui/burst-rays.png` | 800 × 800 | reward / level-up moments | Flat radial sun-rays, 8–10 wedges, single warm colour, transparent between wedges. Used behind a reward icon. |
| `badge1st` … `badge3rd` | `ui/badge-1st.png` etc. | 320 × 320 | leaderboard rows, run results | Comic sticker numerals ("1st") — hand-lettered, thick outline, small impact bursts behind. **Text IS baked in for these three** (that's the point). |
| `paperGrain` | `ui/paper-grain.png` | 512² tileable | any toon card | Monochrome grain tile, ~8% opacity overlay. Optional; ask me to wire it. |

### Already covered — don't regenerate

- **Tab bar + action icons** — the 27 sticker PNGs in `assets/icons/` already
  ship and the new floating pill bar uses them as-is. Optional upgrade: redraw
  `tab-home / tab-map / tab-record / tab-club / tab-you` as glossy 3D stickers
  (thick outline, top-left highlight, soft contact shadow) to match the
  reference's chunkier tab icons. Same filenames = zero code change.
- **Energy bolt / lootbox / trophy / streak** — already in `assets/icons/`.
- **Currency coins** — PASER has no soft currency (energy is the resource). Only
  needed if you add one; then it's `assets/icons/coin.png` + a coin-stack set
  per pack size.

### Cannot be generated — must come from official press kits

The share rows on the Pasers screen (WhatsApp, Messages, and any Instagram /
Discord / Telegram rows you add) use **third-party trademarks**. Do not
generate look-alikes: download each brand's official mark from its brand
resources page and follow its usage rules (minimum clear space, no recolouring,
no rounding into your own shape). Until then the rows render a neutral lucide
glyph, which is legally safe.

### One caveat about the look

This style is fundamentally a **light UI** — the hard black outline and the
offset drop shadow are what make it read as a toy, and both disappear on a dark
surface. The kit degrades honestly (soft rim, no shadow, per
`toonSurface()` in `src/theme/toon.js`), but if you want the reference's punch
everywhere, ship **light as the default** (`DEFAULT_PREF` in
`src/theme/ThemeContext.js`) and treat dark as the opt-in night-run mode.

---

## 6. Pass, rewards and the Home side rail (P0)

The ladder now names a REAL item at every tier — 48 cosmetic rewards across
both tracks, each keyed `<slot>:<id>` against `frontend/src/config/cosmetics.js`
and drawn by `components/RewardArt.js` as the actual thing (the wood border
draws the wood ring, the hexagon tier draws the real claim polygon, the Crown
tier draws the crown). So most of this section is **not** "draw a reward icon"
— it's the four things that still have no object of their own.

### 6a. Lootbox rarities (P0 — 4 files)

`assets/icons/lootbox-{common,rare,epic,legendary}.png`, 512², transparent.
One generic `lootbox.png` is doing all four jobs today, tinted with a ring.

Same crate silhouette in all four so they read as one family; only the
material and light change:

| file | Brief |
|---|---|
| `lootbox-common.png` | Plain wooden crate, iron corners, closed lid, no glow. |
| `lootbox-rare.png` | Same crate in blue-painted wood, brass corners, faint blue rim light. |
| `lootbox-epic.png` | Purple lacquered crate, gold corners, lid slightly ajar with purple light escaping. |
| `lootbox-legendary.png` | Gold crate, gem inlays, lid open, strong warm light and 3–4 sparks above. |

### 6b. Claim FX (P1 — the last glyph in the ladder)

`fx` tiers (levels 12, 24, 36, 48) still fall back to a sparkle glyph because
`CLAIM_FX_SOURCES` is empty. Deliver **Lottie JSON** (transparent, ≤2 s, ≤200 KB)
so it plays on the map when a claim lands, plus a 512² PNG still for the tile:

| key | Brief |
|---|---|
| `burst` | Pink ring expanding out from the claim centre with 8 radial darts. |
| `shockwave` | Two teal rings, the second chasing the first, ground-crack lines. |
| `fireworks` | Three staggered pops in pink / purple / teal with falling trails. |
| `supernova` | White core flash → gold expanding ring → slow glitter fallout. |

### 6c. Side-rail tiles (P1 — 4 files)

`assets/art/ui/rail-{pass,boxes,shop,season}.png`, 256², transparent. They sit
inside a gold/pink/teal/purple frame the code already draws, so deliver the
**contents only**, no frame, no text:

| key | Brief |
|---|---|
| `rail-pass` | A rolled pass ticket with a crown stamp, seen at a slight angle. |
| `rail-boxes` | Three stacked lootboxes, the top one ajar. |
| `rail-shop` | An energy bolt over a small shopfront awning. |
| `rail-season` | A trophy on a plinth with a laurel. |

### 6d. Premium-exclusive cosmetics (complete)

`PREMIUM_ITEMS` in `backend/app/progression.py` now awards 17 cosmetics marked
`premiumOnly`. They have no stat, free-pass, lootbox, or coin-shop route. The
track starts with epic items and becomes legendary from level 32 onward.

The free track is separately curated: 40 `passOnly` items span all eight
wearable slots and progress common → rare → epic → legendary. Run
`node scripts/check-catalog.js` after catalogue or reward-map changes; it
enforces both inventories and verifies that neither leaks into the shop.

### 6e. Optional polish

| Asset | Size | Note |
|---|---|---|
| `ui/pass-banner.png` | 1536 × 640 | Hero strip for the top of the pass screen — the crew running toward a giant glowing tier diamond. |
| `ui/tier-diamond.png` | 256² | Frame art for the level diamonds; they're code-drawn (rotated square, ink outline) and fine as-is. |
| `ui/stamp-claimed.png` | 256² | A "CLAIMED" rubber stamp to overlay collected tiers instead of the check chip. |

### Do NOT generate

- **Portrait borders** (wood → mythic). `PortraitBorder` draws them as SVG
  gradient rings — vector, crisp at any size, already correct.
- **Claim shapes** (hexagon/star/heart/gem). `RewardArt` draws the real polygon
  straight from `unitShape()`, so the tile can never disagree with the map.
- **Energy sticker** — `assets/icons/energy.png` already ships.

---

## 7. Generation order

1. **Lootbox rarities + PRO exclusives** (§6) — the pass is the money screen and
   both gaps are visible on every tier.
2. **`getstarted-left/right` + `header-pasers`** (§5) — biggest visible change
   per file; they land on the two screens a new player sees first.
3. `energy` story panel (§1) — the only shipping coach-mark card still on an
   icon fallback. (`run` is an optional nice-to-have; `pasers` is now unused.)
4. The three step thumbnails (§2) — cheapest polish in the whole flow.
5. `profile-banner` + `badge-1st/2nd/3rd` (§5) — makes You and the leaderboard
   feel like a game.
6. `stage` (§3) — replaces a code-drawn gradient; sets the creator's mood.
7. Body builds + skin tones (§4) — unlocks two more creator steps.
8. `proHero` (§3), the remaining page headers, then `rewards` / `leaderboard`.

Nav icons and the collectibles/lootbox/FX list still live in
[ASSET_GUIDE.md](ASSET_GUIDE.md) — this doc only covers first-run.

---

# 8. Prompt pack — every still image, copy-paste ready

**41 prompts.** The only assets NOT here are the four claim-FX animations
(§6b) — those are Lottie, not stills.

### How to use this section

1. **Prepend the style block** from the top of this doc to every single
   prompt. The prompts below only describe the subject; the style block is
   what keeps 41 files looking like one game.
2. **Sizes are what to GENERATE.** Where a delivery size differs it's noted;
   the character pipeline rescales by itself.
3. **Transparent unless it says opaque.** Story panels and the profile banner
   are opaque (their flat background colour is part of the art); everything
   else is a cut-out on transparency.
4. **No baked text anywhere except the three place badges and the CLAIMED
   stamp.** Those four are called out explicitly.

Progress checklist — tick as they land:

- [ ] 8a Story panels (2 required, 2 optional)
- [ ] 8b Step thumbnails (3)
- [ ] 8c Creator stage + PRO hero (2)
- [ ] 8d Body builds + skin tones (5 + recolour master)
- [ ] 8e App-screen art (10)
- [x] 8f PRO exclusive cosmetics (17)
- [ ] 8g Lootbox rarities (4)
- [ ] 8h Side-rail tiles (4)
- [ ] 8i Optional polish (2)

---

## 8a. Story panels — tutorial coach marks

`1536 × 1152` (4:3), **opaque**, flat background colour fills the frame edge to
edge. Path: `assets/art/onboarding/<file>`. Keep the background hex in sync
with `ART_BG` in `src/config/onboardingArt.js`.

**`energy.png`** — background `#2B1636`
> A runner mid-stride reaching up to grab a glowing lightning bolt out of the
> air, sparks trailing off it; a second bolt is already stuffed in their
> shorts pocket. The bolt is the brightest thing in the frame.

**`run.png`** *(optional)* — background `#0F3D33`
> A runner setting off from a thick painted start line with a claim flag tucked
> under one arm, a loop of dashed path curving away ahead of them. Eyes forward,
> weight already moving.

**`pasers.png`** *(unused — kept for a future pasers card)* — background `#13294B`
> Two runners high-fiving at full speed as they pass each other, motion lines
> behind both, a third runner catching up in the background. Warm rim light on
> all three.

**`rewards.png`** *(optional)* — background `#3A1D0B`
> A runner popping open a lootbox held at chest height, light rays bursting
> out, cosmetics flying up out of it — a cap, sunglasses and a cape mid-air.

**`leaderboard.png`** *(optional)* — background `#0B322A`
> Three runners standing on a chunky hand-drawn podium of stacked blocks. The
> first-place runner flexes, second claps, third slumps. No numbers.

---

## 8b. Step thumbnails — onboarding form steps

`520 × 520`, **transparent subject on a flat colour fill**, square
composition. The code clips them into a 28 px squircle with an ink border, so
**do not** round the corners yourself. Path: `assets/art/onboarding/<file>`.

**`thumb-name.png`** — background `#F26A3A`
> Two runners shaking hands, one wearing a blank stick-on name badge on their
> chest. The badge is empty — no lettering.

**`thumb-birthday.png`** — background `#E2497A`
> A runner in a party hat leaning over a small birthday cake with lit candles,
> cheeks puffed mid-blow, one hand steadying the plate.

**`thumb-ready.png`** — background `#0F766E`
> A runner crouched in a starting-block stance on a thick painted start line,
> a puff of dust behind the back foot, eyes forward.

---

## 8c. Creator stage + PRO hero

**`onboarding/stage.png`** — `1170 × 1400` portrait, **opaque**
> A night scene looking along a suburban footpath: deep navy sky fading to
> teal at the horizon, a scatter of small stars, a pale path running left to
> right across the lower third, dark bushes crowding both edges, a warm pool
> of lamp light in the centre of the path. **Leave the middle third empty** —
> the player's character is composited on top of it. No people.

**`onboarding/pro-hero.png`** — `1536 × 1152`, **opaque**, background `#2A1B06`
> A runner in a gold cape bursting head-first through a paper banner, shreds
> flying outward, gold sparks trailing. Heroic low angle. Gold is the only
> warm accent in the frame.

---

## 8d. Body builds + skin tones — the character creator's missing steps

These are the only assets with a **hard canvas requirement**: `248 × 640`
exactly, transparent, because every other layer (hair, hats, tops) is placed
off the body's head/shoulder/hip fractions in `CharacterRig.js`. A body drawn
at a different scale drags all 100+ items out of alignment.

Generate all five in **one image, side by side, same pose, same eye line**, so
the proportions stay honest — then split them.

> Five full-body cartoon runners standing in an identical neutral front-facing
> stance, arms slightly away from the body, feet together, in a single row on
> a transparent background. Same height and eye line for all five, same flat
> mid-grey skin. Vary only the build: slim, average, broad, stocky-short,
> tall-lanky. No clothing, no hair, no facial features — plain mannequin
> bodies with the black ink outline.

Then the skin tones. **One master per build is enough** — the pipeline's
recolour handles the rest, so deliver the grey master and I'll wire eight
tones through `asset-pipeline.py` the same way the cloth palette works.

Path: `assets/character/body/body-{1..5}.png`.

---

## 8e. App-screen art

Path: `assets/art/ui/<file>`. All **transparent** unless noted.

**`getstarted-left.png`** — `300 × 360`
> A runner mid-stride leaning into frame from the left, cropped at the
> shoulders and knees, facing right. Weight forward, arms pumping.

**`getstarted-right.png`** — `300 × 360`
> A runner driving a claim flag into the ground, facing left, cropped at the
> shoulders and knees. Mirrors the weight of the left-hand runner.

**`header-pasers.png`** — `640 × 500`
> A tight huddle of five or six runners in different coloured kit, arms over
> each other's shoulders, seen from slightly below so they tower into frame.

**`header-club.png`** — `640 × 500`
> Two rival crews facing off across a thick painted line on the ground, chests
> out, one runner at the front holding a club crest overhead.

**`header-leaderboard.png`** — `640 × 500`
> Three runners on a chunky hand-drawn podium of stacked blocks — first
> flexing, second clapping, third sulking. No numbers on the blocks.

**`profile-banner.png`** — `1400 × 600`, **opaque**
> A wide roadside scene band: footpath running the full width, bushes and a
> couple of rocks along it, warm low sun from the right. **Leave the centre
> 40% clear of detail** — the player's runner is composited there. No people.

**`burst-rays.png`** — `800 × 800`
> A flat radial sunburst: nine tapering wedges of a single warm yellow
> radiating from the centre, transparent between the wedges, no outline.
> Nothing in the middle — an icon sits on top.

**`badge-1st.png` / `badge-2nd.png` / `badge-3rd.png`** — `320 × 320` each
> A comic-sticker numeral reading "1st" in hand-lettered chunky type, tilted
> about 12°, thick black outline with a white inner edge, three short impact
> bursts radiating behind it. Gold for 1st, silver for 2nd, bronze for 3rd.
> **Text IS baked in on these three** — that's the point of them.

**`paper-grain.png`** — `512 × 512` seamless tile
> A seamless monochrome film-grain texture, fine and even, mid-grey on
> transparent. No visible repeats, no large blotches. Used at ~8% opacity.

---

## 8f. The 17 PRO exclusive cosmetics (complete)

The art is installed, every item is marked `premiumOnly`, and the live pass
order is owned by `PREMIUM_ITEMS` in `backend/app/progression.py`:

| Levels | Cosmetics |
|---|---|
| 2–8 | Laurel wreath, Monocle, Varsity jacket, Zip gilet |
| 12–18 | Wolf ears, Boombox, Aurora jacket, Mirror visor |
| 22–28 | Punk crown, Kabuto, Knight armour |
| 32–48 | Flame crown, Cyber shades, Dragon wings, Varsity jacket · Navy, Jetpack, Halo |

Do not add a stat or coin route to these entries. `check-catalog.js` verifies
all 17 keys, their epic/legendary rarity floor, and their absence from the
generated shop catalogue.

## 8g. Lootbox rarities — 4 files

`assets/icons/lootbox-{common,rare,epic,legendary}.png`, generate 1024²,
deliver 512², **transparent**, no ground shadow.

> A closed wooden supply crate seen from three-quarters front, rope handle on
> the left, iron corner brackets, a rounded lid. Chunky proportions, heavy
> black ink outline, flat matte fills.

Then vary ONLY material and light — same silhouette every time so they read as
one family in the ladder:

| file | Variation |
|---|---|
| `lootbox-common` | Plain untreated wood, iron brackets, lid shut, no glow. |
| `lootbox-rare` | Blue-painted wood, brass brackets, thin blue rim-light along the lid edge. |
| `lootbox-epic` | Purple lacquered wood, gold brackets, lid ajar with purple light spilling from the gap. |
| `lootbox-legendary` | Gold crate with gem inlays on the lid, lid fully open, strong warm light column and 3–4 sparks rising. |

## 8h. Claim FX — 4 animations (THE ONLY NON-STILL SET)

The `fx` tiers (levels 12, 24, 36, 48) are the **only** rewards still drawn
with a generic glyph. Deliver **Lottie JSON** (transparent, ≤ 2 s, ≤ 200 KB,
loops once) plus one 512² PNG still for the ladder tile. These play on the map
where a claim lands, so the motion must read at ~120 px.

| key | Motion |
|---|---|
| `burst` | A pink ring expands from the centre and fades; 8 short radial darts fly out with it. |
| `shockwave` | Two teal rings, the second chasing the first, plus 4 short ground-crack lines that snap outward and fade. |
| `fireworks` | Three staggered pops — pink, purple, teal — each with falling trails. |
| `supernova` | White core flash → a gold ring expanding past frame → slow glitter fallout drifting down. |

Send them and I'll wire `CLAIM_FX_SOURCES` (it's an empty registry waiting for
exactly these four keys).

## 8i. Side-rail tiles — 4 files

`assets/art/ui/rail-{pass,boxes,shop,season}.png`, generate 512², deliver 256²,
**transparent, contents only** — the code draws the coloured frame around
them, so don't include a frame, a background or any text.

| file | Prompt |
|---|---|
| `rail-pass` | A rolled parchment pass ticket at a slight angle, a crown stamp pressed into the centre, ribbon tie. |
| `rail-boxes` | Three lootboxes stacked in a pyramid, the top one ajar with light escaping. |
| `rail-shop` | A single energy bolt in front of a small striped shop awning. |
| `rail-season` | A trophy on a short plinth with a laurel branch curving up one side. |

## 8j. Optional polish

| File | Size | Prompt |
|---|---|---|
| `ui/pass-banner.png` | 1536 × 640 | The crew running left-to-right toward a giant glowing tier diamond that floats above the path. Opaque, deep purple background — this is a header strip. |
| `ui/stamp-claimed.png` | 512² | A tilted rubber-stamp mark reading "CLAIMED", ink-bled edges, single colour, transparent. **Text IS baked in here.** |
