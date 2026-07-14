# PASER — Asset Generation Guide

Everything to generate to make the game feel rich, keyed to the ids already in
code so a generated file drops straight in. Priorities: **P0** = biggest visual
payoff, **P1** = strong, **P2** = polish.

**Style north star (put this in every prompt):** PASER's mascot look — clean,
rounded, friendly, bold flat shapes with a soft inner shadow; brand gradient
**pink `#ec4899` → purple `#8b5cf6`** (teal `#2dd4bf` accent); transparent
background; consistent top-left light; no text baked in. Dark-UI first (assets
sit on `#0b0d10`), so keep edges readable on dark.

Formats: **icons → SVG** (crisp + tintable) or PNG @1x/@2x/@3x. **Illustrations
→ PNG** transparent, @2x/@3x. **Animations → Lottie JSON** (from After Effects
via Bodymovin, or a Lottie generator), transparent, ≤200 KB, ≤2 s.

---

## 1. Navigation & UI icons (P0 — this is why screens look "plain")

The app currently uses generic `lucide` vector icons everywhere. Keep lucide for
dense utility glyphs (chevrons, X, checkmarks, settings), but generate a
**custom branded set** for the high-frequency, identity-defining ones. Provide
each as a single-colour SVG (so it tints per state) **plus** a filled/duotone
variant for the active state.

**Tab bar (5) — highest impact, generate first:**
| Tab | id | Notes |
|---|---|---|
| Home | `tab-home` | inactive (outline) + active (filled/gradient) |
| Map | `tab-map` | territory/globe feel |
| Record | `tab-record` | the raised centre button — a runner/footprint, energetic |
| Club | `tab-club` | shield/crest |
| You | `tab-you` | avatar/person |

**Action & status icons (generate as branded SVGs):**
`like`/kudos (heart), `comment`/chat (speech bubble), `share`/send, `bell`
(notifications), `energy` (bolt — matches the `Zap` used in the meter),
`lootbox` (gift/chest), `streak` (flame), `claim`/territory (flag-on-land),
`steal` (crossed swords), `trophy`, `clan-shield`, `locate` (crosshair),
`add`/create, `lock`, `sparkles`, `timer`, `pace`/route.

**Spec:** 24×24 base grid, 2px stroke to match current UI, export at 24/48/72.
Full list of what's in use today (39 glyphs) if you want 1:1 replacements:
ArrowRight, Award, Bell, Check, ChevronLeft, ChevronRight, Crown, Dices, Flag,
Flame, Footprints, Gift, Heart, Home, Layers, LocateFixed, Lock, Map, MapPin,
MessageCircle, Navigation, Pause, Play, Route, Send, Shield, ShieldCheck, Shirt,
Sparkles, Swords, Timer, TriangleAlert, Trophy, User, UserPlus, X, Zap.

---

## 2. Character collectibles / wearables (P0 — core of progression)

New level-gated items in the avatar rig. Existing slots live in
`frontend/assets/character/`: **body, face, hair, glasses, outfit**. Match those
exactly: same canvas size, same rig anchor, transparent PNG, front-facing,
consistent line weight (open one existing file and mirror its framing).

Recommended new content (each becomes a `config/cosmetics.js` entry with a
`levelUnlock(n)` — see `config/progression.js`):

| Slot | Generate | Rarity spread |
|---|---|---|
| **headwear** (NEW slot) | 10–14 hats/helmets/crowns/beanies/headbands | common→legendary |
| hair | 8–12 new styles | common→epic |
| glasses | 6–8 (visors, shades, goggles) | common→epic |
| outfit | 10–14 (jerseys, jackets, capes) | common→legendary |
| face | 6–8 expressions/face paint | common→rare |
| **accessory** (NEW slot) | 8–10 (wings, backpacks, medals, scarves) | rare→legendary |

> Adding the two NEW slots (`headwear`, `accessory`) needs a small rig change
> (layer + z-order + anchor) in `CharacterRig.js` and a `SLOTS` entry — flag me
> to wire it once you have the art. Until then, put wearables in existing slots.

**Deliver per item:** `assets/character/<slot>/<id>.png` (+ colourable variants
if it recolours, like the existing 10-swatch tops). Naming = the item `id`.

---

## 3. Portrait borders — top tiers (P1)

Tiers 1–6 (`wood, bronze, silver, gold, platinum, diamond`) are **already
code-drawn** (SVG rings in `PortraitBorder.js`). Generate art only for the
premium 4 so they feel special:

| id | Level | Deliver |
|---|---|---|
| `onyx` | 30 | 1024² transparent ring PNG (or Lottie for subtle shimmer) |
| `ember` | 36 | animated Lottie ring (flame licks) preferred |
| `prismatic` | 43 | animated Lottie (rainbow sweep) |
| `mythic` | 50 | animated Lottie (the flex tier — gold + particles) |

Ring art must be a **frame only** (hollow centre) sized to hug a circular
portrait; keep stroke ≤8% of diameter. Drop static PNGs in
`assets/borders/<id>.png`; animated ones as `assets/lottie/border-<id>.json`
(then tell me to wire them into `PortraitBorder`).

---

## 4. Claim explosion animations (P1)

Play when a claim lands. Wired already — drop the file in and uncomment its line
in `components/ClaimFx.js` (`CLAIM_FX_SOURCES`). Level-unlocked keys:

| id | Level | Vibe |
|---|---|---|
| `burst` | 12 | quick confetti/paint burst in clan colour |
| `shockwave` | 24 | expanding ring/impact |
| `fireworks` | 36 | multi-pop celebration |
| `supernova` | 48 | full-screen radial bloom |

**Spec:** `assets/lottie/claim-<id>.json`, transparent, ~1–1.5 s, plays once,
looks good centred over the result card. Keep the dominant colour neutral/white
so it reads on any clan colour (or make it tint-able).

---

## 5. Lucky box (lootbox) + open animation (P1)

Rewarded every 5 levels; rarity scales (`common, rare, epic, legendary`). Rarity
tint colours already exist in `config/progression.js` (`RARITY_COLORS`).

| Asset | id / path | Notes |
|---|---|---|
| Closed chest | `assets/lootbox/chest-<rarity>.png` | 4 rarities, or 1 chest + 4 glow overlays |
| Open chest | `assets/lootbox/chest-<rarity>-open.png` | reveal frame |
| Open animation | `assets/lottie/lootbox-open.json` | shake → burst → light rays, ~2 s |
| Rarity burst | `assets/lottie/lootbox-<rarity>-burst.json` | colour-graded per tier (optional) |

Once the chest/animation exist, tell me to add a reveal modal to the
ProgressionScreen open flow (right now it opens instantly with a toast).

---

## 6. Energy & level-up (P2)

| Asset | id / path | Notes |
|---|---|---|
| Energy pack icons | `assets/shop/<product_id>.png` | ids: `energy_refill_small`, `energy_pack_large`, `energy_refill_full` |
| Empty/full bolt | `assets/energy/bolt-{full,empty}.png` | optional (lucide `Zap` works now) |
| Level-up burst | `assets/lottie/level-up.json` | fires on level gain (needs a small hook) |
| Reward reveal card | `assets/art/reward-reveal.png` | background for the "you unlocked X" card |

---

## 7. Claim-shape preview icons (P2)

Shapes themselves are **code geometry (done)** — equal-area circle/hexagon/star/
heart/gem. Generate only tiny mono preview icons for a shape-picker UI:
`assets/shapes/<key>.svg` for `hexagon, star, heart, gem` (circle is trivial).

---

## 8. Screen richness — illustrations & backgrounds (P1)

You already have a solid illustration set (`assets/art/`: auth-hero, cards,
onboarding, empty states, season-banner). To kill the "plain" feel, add:

- **Empty states** still missing art: progression (no lootboxes yet), energy
  (out of energy), map (no land nearby), chat (no messages). Match existing
  `empty-*.png` style. → `assets/art/empty-<name>.png`.
- **Section header flourishes / dividers** — a subtle gradient or mascot motif
  behind key headers.
- **Card backgrounds / textures** — a faint topographic/map texture PNG to layer
  under stat walls and the result card (huge "premium" boost, low effort).
- **Level-tier badges** — small emblem per border tier for the ladder rows.
- **Club crest kit** — modular crest shapes so clubs feel distinct.

---

## Generation order (do these first)

1. **Tab bar 5 icons + ~12 action icons** (§1) — instant, app-wide facelift.
2. **Collectibles** (§2) — the reason to level up.
3. **Lootbox chest + open Lottie** (§5) — the dopamine moment.
4. **Claim explosion Lottie** (§4) + **top border tiers** (§3).
5. **Empty-state + texture polish** (§8).

## When art is ready, ping me to wire:
- new `headwear`/`accessory` rig slots + `SLOTS`/`cosmetics.js` entries,
- animated borders into `PortraitBorder`,
- the lootbox reveal modal + level-up celebration hook,
- a shape/FX/border **equip UI** (Avatar Studio tab) so players choose unlocked cosmetics.
