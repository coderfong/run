# Seedance Capture Asset Spec — `seedance_portal_test` (DEV prototype)

Status: **experimental, not release-approved**. This document records the
actual contract of the first Seedance-generated capture FX plate, as
measured from the real render — not the prompt's requested timestamps.

## Model

`dreamina-seedance-2-5-260628`, via the `ark-seed` MCP server
(`seedance_2_5_create_task`).

## Source

- Task ID: `cgt-20260922101729-ebaal`
- Local source video: `tmp/seedance/capture_portal_shockwave_v01.mp4` (not
  committed — `tmp/` is scratch space)
- Last frame: `tmp/seedance/capture_portal_shockwave_v01_lastframe.jpg`
- No v02 was needed — see Validation below.

## Canvas

- Ratio: **1:1**, resolution **480p** (rendered at 640×640), duration
  **4.04s** (24fps, 97 frames), no audio, no watermark.
- **Why 1:1, not portrait**, despite the capture stage (`mapBox` in
  `ResultScreen.js`) being a portrait, near full-bleed map: PASER's effect
  renderer never draws a hero effect at the stage's aspect ratio. Every
  capture-style sprite step is placed and sized by
  `fitEffectInBounds()` (`src/effects/anchors.js`), which computes
  `size = min(requestedSize, min(rect.width, rect.height) / visualScale)`
  and renders it as a single square box (`EffectPlayer`'s `size` prop is one
  number, used for both width and height). Production hero effects request
  sizes of roughly 220–320px (`meteor_claim`'s impact sprite is 320px, for
  example). A portrait source would either be cropped to a square at
  composite time (wasting most of its frame) or stretched. 1:1 is the ratio
  the existing renderer actually consumes.

## Runtime format

Animated WebP (alpha), via PASER's existing `ANIMATED_IMAGE` effect type
(`AnimatedImageEffect.js` → `ui/image`, the same pipeline
`assets/animations/*.webp` and `config/gameAnimations.js` use elsewhere in
the app). No `expo-video`, no new player.

- `frontend/assets/animations/seedance-portal-shockwave.webp`
- 260×260px, 84 frames @ 24fps, 3500ms, ~1.4MB.
- Trimmed from the source's 97 frames to 84: the choreography's `hold`
  window unmounts this sprite at 3450ms into the style (see Integration),
  so the last ~13 frames of the source were never going to be shown. Cutting
  them at conversion time is most of the file-size reduction; the runtime
  `hold` cutoff alone would have produced the same visible result but shipped
  ~500KB of frames nobody sees.

## Camera

Enforced by the prompt only (Seedance 2.5 has no reliable camera-fixed
parameter through this MCP's schema). **Validated stable**: the hexagon
portal and every subsequent burst stay centred in the frame across every
sampled timestamp from 0.0s to 3.7s, with no pan/zoom/tilt/rotate — see
Validation.

## Background / alpha extraction

**Mode: `glow`** (`scripts/convert-scene-animations.py`). Chosen over `black`
(connectivity key) because the source has no enclosing outline around its
particles/rays — it's exactly the "bright particles on a black card" case the
script's own docstring says `black`'s connectivity test gets wrong (every
anti-aliased edge would keep a hard black fringe). `glow` reads alpha off
the max RGB channel and un-premultiplies the colour back out of black,
which is what a soft bloom edge needs.

`crop: False` (implemented directly, not via the script's `SOURCES` table —
see Integration). The effect is deliberately centred and radially symmetric
so it can sit on PASER's `TERRITORY_CENTER` anchor; the alpha bounding box
grows and shrinks by frame (a single spark at t=0 vs. a full-frame burst at
the impact), and cropping to it would shift the effective centre every
frame, breaking that anchor. This mirrors the existing script's own
`revealLightning` entry, which opts out of cropping for the identical reason
("these bolts strike out from the centre, and cropping to their bounding box
would move them").

Verified clean: composited a mid-brightness frame and a peak-impact frame
over a flat colour card — soft bloom falloff at every edge, no hard black
fringe/halo.

## Actor safe zones

**Real layout, not invented.** Positions are NOT fixed screen thirds in this
codebase — `layoutDefenders()` (`src/effects/anchors.js`) places defenders at
interior points of the *actual claimed polygon*, which can be any shape in
any orientation. The numbers below are derived from the real constants and
formulas, expressed as an approximate range against a representative
390×844pt phone stage (`mapBox`), not measured against one fixed layout:

| Actor | Rig size | Formula | Approx. normalized footprint |
|---|---|---|---|
| Attacker | `ACTOR_SIZE = 118px` (`ClaimActor.js`) | anchored at `seq.projection.claimPoint` (the tapped claim point) | ~0.30 × 0.30 of stage width, generally within x 0.3–0.7, y 0.35–0.65 after the 1.14× (`FRAME_SCALE`) framing push holds the whole overlay in for the scene |
| 1 defender | `DEFENDER_SIZE = 88px` | ≥ `88 × 1.1 ≈ 97px` from the claim point (`attackerGap`), farthest-point-sampled inside the polygon | ~0.22 × 0.22 of stage width, radius ~0.15–0.35 of stage width from the attacker, **in any direction** |
| 2–3 defenders | same 88px | same farthest-point sampling, sorted nearest→furthest from the claim point | spread around the attacker at the same radius band, mutually ≥ `88 × 0.8 ≈ 70px` apart |
| Impact / claim centre | — | `EFFECT_ANCHOR.TERRITORY_CENTER`, which defaults to the claim point — **the same point the attacker stands at** | same as attacker |

Because the attacker and the impact point are the same anchor by default, and
defenders can be spread in *any* direction around it (not reliably "above"),
the generation prompt's "lower-center attacker / upper-middle defenders /
centre impact" composition is a **directional simplification**, not a
guaranteed runtime layout. It was still used verbatim (the exact prompt is
below), because: (a) it's a reasonable default heuristic — most claimed
polygons do put some usable ground on multiple sides of the pin, and a
generic reserved-space convention is better than none; (b) the actual
runtime footprint of this asset is much smaller than its 640px native frame
— `fitEffectInBounds` fits it to the same ~220–320px hero-effect size every
other style uses, well inside the 88–118px characters' clearance; and (c) the
plate is radially symmetric in practice (see Validation), so it reads fine
regardless of which side a given defender lands on.

## Impact zone

Normalized: the same point as the attacker/claim point above — `TERRITORY_CENTER`, x≈0.5, y≈0.5 of the effect's own 260×260 box (it's centred by construction), which `fitEffectInBounds` then re-centres on the real claim point in stage space.

## Actual generated timing (measured, not the prompt's targets)

Extracted frames at 0.0/0.5/1.0/1.45/1.8/1.9/2.0–2.4 (0.05s steps)/3.0/3.7s
and inspected each. The render does **not** follow the prompt's timestamps —
see the deltas:

| Beat | Prompt asked for | Actual (measured) |
|---|---|---|
| Quiet setup | 0.0–0.5s | 0.0–~1.0s (particles stay faint noticeably longer) |
| Portal forming | 0.5–1.2s | ~1.45–1.9s (hexagon ring visible and holding) |
| Convergence | 1.2–1.5s | ~1.9–2.25s (small central spark growing) |
| **Main impact** | **1.5s** | **~2.30–2.32s** (near-total white-frame flash, 1–2 frames at 24fps) |
| Radial shockwave | 1.5–2.2s | ~2.35–2.6s (teal/purple starburst with debris) |
| Residual / secondary arcs | 2.2–3.0s | ~2.6–3.0s (resolves into a rotating spiral of arcs and shards) |
| Clears | 3.0–4.0s | ~3.0–3.7s mostly clear; fully clear by ~3.85–4.0s |

The impact landed **~0.8s later** than requested. This is the number that
drives the choreography sync below — not 1.45s.

## Forbidden generated content

Verified absent at every sampled frame: characters, humans, silhouettes,
faces, hands, bodies, text, UI, maps, territory polygons, logos, numbers.
The render is the abstract FX plate only, on a pure black background.

## Seedance master prompt

v01 succeeded on the first attempt; **no v02 was generated** (none of the
automatic-regeneration triggers fired — see the report's Validation
section). The exact prompt submitted:

```
Create a 4-second mobile-game capture special effect animation on a perfectly uniform solid black background.

Style: flat illustrated game FX, bold clean shapes, polished cartoon mobile-game look, dark fantasy-tech energy, not photorealistic, not live-action, not anime character-focused, not realistic smoke/fire.

Color palette: mostly mint green, teal, cyan, and purple energy on black, with strong readable contrast.

Camera must remain completely fixed for the entire animation.
No camera movement, no pan, no zoom, no tilt, no rotation, no perspective shift, no screen reframing.

Composition / reserved placeholder zones

This animation is meant to be composited later with live game characters, so keep these areas readable:

Lower-center area reserved for 1 attacker
Upper-middle area reserved for up to 3 defenders arranged horizontally
Middle-center area is the main impact zone

Leave those character zones mostly clear and readable.
FX may move around, behind, or briefly through the edges of these zones, but do not permanently block them with dense effects.

Animation sequence

0.0–0.5s
Subtle energy begins gathering in the middle of the frame. Very light particles and faint energy distortion.

0.5–1.2s
A stylized portal / energy distortion begins forming around the central impact zone. Energy lines arc upward from the lower-center attacker area toward the middle.

1.2–1.5s
Energy rapidly converges into the central impact point.

1.5s
A strong main impact happens at the center.

1.5–2.2s
A large radial shockwave bursts outward with mint, teal, and purple energy arcs, graphic streaks, and small illustrated debris / particles.

2.2–3.0s
Residual energy, secondary arcs, and drifting particles continue briefly, still keeping the character placeholder zones readable.

3.0–4.0s
The effect clears rapidly until the frame is mostly clean again, leaving only minimal fading particles by the end.

Hard exclusions

Do not generate:

people
humanoids
characters
silhouettes
faces
hands
bodies
text
words
numbers
logos
UI
buttons
maps
territory polygons
buildings
scenery
background environment

Only generate the special effect animation on a pure solid black background.

No audio.
```

## Integration

```
Seedance MP4 (tmp/seedance/capture_portal_shockwave_v01.mp4)
    → tmp/seedance/convert_effect.py
        (imports key_glow_backing from scripts/convert-scene-animations.py
         by file path; decodes @24fps, keys each frame with `glow`,
         resizes to 260×260, trims to 84 frames, encodes libwebp_anim)
    → frontend/assets/animations/seedance-portal-shockwave.webp
    → src/effects/effectRegistry.js
        (BUILTIN_ANIMATED_IMAGES.seedance_portal_shockwave,
         type: ANIMATED_IMAGE, duration 3500, frameCount 84, fps 24,
         releaseApproved: false)
    → src/effects/captureStyles.js
        (DEV_CAPTURE_STYLES[0], id 'seedance_portal_test' — hand-authored
         sequence using the same exported primitives scene() uses, synced to
         the MEASURED impact at 2300ms: haptic/shake/camera-punch at 2300,
         territoryReveal at 2330, total style duration 3450ms)
    → EffectPlayer (existing renderer, no new player)
    → CaptureStylePlayer (existing choreography player, unmodified)
    → live CaptureCast (real CharacterRig-based attacker/defenders,
       unmodified)
    → live TerritoryRevealCanvas (real SVG polygon reveal, unmodified;
       the plate never draws territory itself)
```

`getCaptureStyle()` resolves `DEV_CAPTURE_STYLES` only as a fallback *after*
`CAPTURE_STYLES` fails to match — production id resolution
(`pickCaptureStyle()` / `PLAYABLE_CAPTURE_STYLES`) never sees this array at
all, so this style structurally cannot enter a real capture.

### Why the style was hand-authored instead of using `scene()`

`scene()`'s spine (`SPINE.*` in `captureStyles.js`) hardcodes most of its
beat timestamps (`DISPLACE`, `EXIT`, `SETTLE`, `WALK`, `WIN`) to the
production target shape (impact ~1.15s, total ~2.64s); only `impact.at` and
`territory.at` are overridable. This asset's *measured* impact (2.3s) is
too far from that shape to reuse `scene()` without either producing an
incoherent sequence (defenders knocked back before the impact happens) or
parameterizing `scene()` itself — a change with surface area across all 30+
production styles for the sake of one DEV prototype. The style is built
instead with the same exported step primitives (`attacker`, `defenders`,
`scatter`, `effect`, `reveal`, `haptic`, `shake`, `camera`, `victory`,
`sound`, `pause`) `scene()` itself calls, sorted and beat-tagged by hand the
same way `scene()` does internally, and it validates under the identical,
unmodified `validateChoreography()`.

### Fitting `POST_REVEAL_BUDGET`

The style must finish within `CLAIM_TIMING.reveal + CLAIM_TIMING.handoff`
(1350ms) of its reveal cue, or `validateChoreography` fails it — correctly:
the controller only keeps a style mounted that long after the reveal cue,
and this rule was not weakened. With the reveal cued at 2330ms (immediately
after the measured 2300ms impact), the style's total duration is capped at
3450ms — 230ms of margin under the 3680ms ceiling. The FX plate's `hold`
(3420ms, starting at 30ms) unmounts it right at that boundary, which is why
the shipped asset is trimmed to 3500ms rather than the source's full 4.04s:
the last ~540ms of the source (already mostly clear per the timing table
above) would never be seen.
