# Seedance Capture Asset Spec — Round 3, ACTION-BASED direction (DEV prototype)

Status: **experimental, not release-approved**.

## Why round 3 exists

Round 2 (`SEEDANCE_CAPTURE_ASSET_SPEC_V2.md`) proved the PASER-doodle art
direction reads correctly, but both candidates it shipped (PASER Stamp,
PASER Party Burst) were a single Seedance clip carrying the **entire**
capture scene by itself — anticipation, impact and retract all baked into
one ~2.1s plate, played as the style's one hero effect. That is an isolated
FX sprite standing in for a scene, not a scene: the live attacker/defender
choreography around it was reduced to a brace-and-celebrate bookend.

Round 3's brief: a capture should be a short **action sequence** (setup →
attack → impact → defender reaction → territory takeover → victory), with
Seedance generating only the **environmental/attack FX**, not a whole-scene
clip and not the characters. The live `CharacterRig` stays the attacker, the
live avatars stay the defenders, and Seedance produces 1–3 short FX plates
that the *existing* choreography engine (`choreography.js` /
`CaptureStylePlayer.js`) drives.

## The reference implementation was already the answer

Before generating anything, `captureStyles.js`'s own production style
**`meteor_claim`** (`CAPTURE_STYLES[0]`, and `DEFAULT_CAPTURE_STYLE_ID`) was
audited. It is explicitly commented as "the reference implementation" and
already builds exactly the requested shape via the shared `scene()`
compiler and the production `SPINE` timing (`captureStyles.js:131-144`):

```
SPINE = { OPEN:0, WARN:200, NOTICE:380, RELEASE:560, IMPACT:1150,
          DISPLACE:1270, CONVERT:1300, SETTLE:1720, EXIT:1820,
          WALK:2000, WIN:2440, END:2640 }
```

— attacker `POINT_SKY` → shadow/darken warning → defenders `LOOK_UP` →
ONE projectile (`solar_shrapnel_01`, travelling `screenTop` → territory
centre, growing) → single impact (freeze, sprite, flash, haptic, shake,
punch-in) → territory reveal (`SHOCKWAVE`) → defenders
`SHOCKWAVE_KNOCKBACK` then flee → attacker walks in and celebrates. Total
duration 2640ms, impact at 1150ms — inside the requested 2.5–3.5s / 1.1–1.3s
windows without changing a single number.

So round 3 did not design a new timeline. It is `meteor_claim`'s own
`scene()` call, unchanged, with only the two sprite-pack FX ids
(`solar_shrapnel_01`, `warm_explosion_01`) swapped for Seedance PASER-doodle
plates. See `captureStyles.js`'s `DEV_CAPTURE_STYLES` entry
`seedance_meteor_strike`.

## Why two SHORT plates, not one long one

Because neither plate is the whole scene, neither needs the frame-precise
measured-impact-timestamp treatment round 2 required:

- `seedance_meteor_fall` is a **looping rock that never itself travels**.
  The engine's `projectile()` step (`fly()` in `captureStyles.js`) already
  owns position, scale (`grow`) and rotation (`spin`) via a Reanimated
  wrapper (`TravellingEffect` in `CaptureStylePlayer.js`) — exactly the same
  role `solar_shrapnel_01` always played. The plate only has to loop
  convincingly for its ~560ms flight; it does not need to depict falling.
- `seedance_meteor_impact` is a **short, front-loaded burst**. The player
  (`spriteSpeedForWindow`) rescales any sprite's natural duration to fit the
  step's own `hold` window (0.7x–2.4x), and removes it at the end of that
  window regardless — so trimming for CONTENT (cut to where the burst is
  already forming) is enough; there is no exact timestamp to hit.

This is the structural reason round 3's generations needed no v02: a bad
timing draw in a whole-scene plate is a reject, but a plate that is only
ever a few hundred milliseconds of one beat has nowhere precise to miss.

## Model and pipeline

`dreamina-seedance-2-5-260628`, via the `ark-seed` MCP server
(`seedance_2_5_create_task`, submitted through `ark_job_submit` — this
machine has no local Python interpreter, so the conversion step below is a
Node.js port of round 1/2's `tmp/seedance/convert_doodle.py`, not the
script itself; see "Conversion" below).

## Candidate 1 — Meteor Fall (rock loop)

- **v01 task ID**: `cgt-20260922134912-8qfyr` — **approved on first
  attempt**.
- **Source**: 960×960, 24fps, 4.04s, pure black background.
- **Local source**: `tmp/seedance/meteor_fall_v01.mp4`.
- **Shipped asset**: `frontend/assets/animations/seedance-meteor-fall.webp`,
  720×720, 24 frames (skipped 2 lead-in frames, trimmed to 24 of the
  remaining 95), 1000ms, 162KB.
  (First conversion pass used a 200×200 edge and looked visibly soft in the
  Capture Style Lab — the plate is rendered at `size:130` and further scaled
  up to 2.2x by `grow` mid-flight, i.e. up to ~286pt of effective on-screen
  size, which on a 3x-density phone needs closer to 720-860px of source to
  stay crisp. Reconverted from the same local source clip at `edge:720`,
  `quality:62`, same trim — no re-generation needed.)
- **Effect ID**: `seedance_meteor_fall`.
- **Visual description**: a single chunky flat-doodle meteor rock — burnt-
  orange fill, darker orange facet lines, thick uneven black outline —
  rotating and wobbling gently in place at frame centre, with 2–3 short
  black speed-line streaks trailing on one side and small yellow spark /
  red ember flecks popping off periodically. It does not travel across the
  frame; the `projectile()` wrapper supplies all translation.
- **No frame-precise timing needed**: any ~1s window of the loop works
  identically inside the engine's own 560ms flight.

## Candidate 2 — Meteor Impact (burst)

- **v01 task ID**: `cgt-20260922134912-i7bil` — **approved on first
  attempt**.
- **Source**: 960×960, 24fps, 4.04s, pure black background.
- **Local source**: `tmp/seedance/meteor_impact_v01.mp4`.
- **Shipped asset**:
  `frontend/assets/animations/seedance-meteor-impact.webp`, 960×960, 12
  frames (skipped 2 lead-in frames, trimmed to the next 12 of 95), 500ms,
  460KB.
  (First conversion pass used a 320×320 edge — matching the step's
  `size:320` at 1x, but visibly soft at real device density. The source
  video is natively 960×960, so reconverted at `edge:960`, `quality:62` —
  effectively no downscale at all, at the same trim.)
- **Effect ID**: `seedance_meteor_impact`.
- **Frame inspection** (24fps native, `tmp/seedance/inspect_impact_fine/`):
  frame 3 (~0.08s into the source) already shows a mid-size hot-pink/yellow
  starburst; by frame 10 (~0.375s) the burst is full size with 6 flung
  orange/yellow rock-chunk doodles and teal spark flecks; the composition is
  then essentially static through frame 30 (~1.25s) — the model settled
  rather than continuing to animate, which is why a short trim was
  sufficient. Trim window chosen: skip the first 2 frames (still mid-form),
  keep the next 12 (~0.083s–0.5s of source) — full burst, chunks flinging,
  sparks scattering.
- **Visual description**: a jagged ten-point comic starburst (hot-pink
  core, yellow outer points, thick black outline) with 6 flat-doodle orange/
  yellow rock chunks (each its own black outline) flung outward and
  tumbling as 2D stickers, teal spark-dash flecks scattering wide, and thick
  black motion-ray doodles radiating from centre. No glow, no 3D, no text.
- **Composited over solid teal and hot-pink cards** to verify keying
  (`tmp/seedance/verify_impact/composite_teal.png`,
  `tmp/seedance/verify_fall/composite_teal.png` /
  `composite_pink.png`): background fully transparent, black outlines
  crisp and unwashed on both cards.

## Conversion

No Python interpreter is installed on this machine (`python`/`python3`
both resolve to the Microsoft Store stub), so round 1/2's
`tmp/seedance/convert_doodle.py` (PIL + scipy connected-component
labelling) could not run directly. `tmp/seedance/convert-doodle.js` is a
Node.js port of the same algorithm, using `jimp-compact` (already a
frontend dependency) for decode/resize/encode and a hand-written iterative
(non-recursive, `Int32Array`-queued) 4-connectivity BFS flood fill from the
frame border — the same rule as `key_flat_backing(img, 'black')` in
`frontend/scripts/convert-scene-animations.py`: only near-black pixels
(max(R,G,B) ≤ 36) that are **reachable from the border** are keyed to
alpha 0, so interior black outline strokes (never touching the border)
survive. `ffmpeg` (already on this machine) handles frame extraction and
the final `libwebp_anim` encode, unchanged from the Python version's own
`ffmpeg` calls.

```
Seedance MP4 -> tmp/seedance/convert-doodle.js (config: fps, edge, quality,
    skipFrames, maxFrames)
    ffmpeg decode @24fps -> per-frame BFS black-connectivity key (JS port
    of key_flat_backing) + Jimp bicubic resize -> re-sequence -> ffmpeg
    encode libwebp_anim
-> assets/animations/seedance-meteor-{fall,impact}.webp
-> effectRegistry.js BUILTIN_ANIMATED_IMAGES (ANIMATED_IMAGE type,
   releaseApproved: true -- ships in the bundle; NOT the production-capture
   gate, see the field's own comment)
-> captureStyles.js DEV_CAPTURE_STYLES `seedance_meteor_strike`: the
   PRODUCTION `scene()` compiler (same one meteor_claim uses), not a
   hand-authored sequence -- the whole point being that this direction
   needs no new choreography, only new art.
-> EffectPlayer / CaptureStylePlayer / live CaptureCast /
   TerritoryRevealCanvas (all unmodified)
```

## Seedance master prompts

Both approved on the first attempt; no v02 was needed for either.

### Meteor Fall — v01 (approved; used)

```
Flat hand-drawn mobile game UI animation in PASER's playful neo-brutalist doodle style. Thick irregular black outlines, bright flat teal, hot pink, yellow, mint and sky blue fills. Sticker-like shapes, comic squash and stretch, hand-drawn motion lines, simple 2D illustration. No realistic lighting, no 3D rendering, no cinematic VFX, no photorealism, no humans, no text. Pure solid black RGB(0,0,0) background. Locked camera. Centre-focused territory capture animation.

CONCEPT: METEOR ROCK LOOP. A single chunky flat-doodle meteor rock/space-rock, drawn as an irregular lumpy polygon with a thick uneven black outline, sits roughly at the centre of the frame the entire time and does NOT travel or fall across the frame -- it only rotates and wobbles in place with a light comic squash-and-stretch, like a looping character idle. This plate will be moved and scaled by the game engine separately, so the rock itself must stay centred and must NOT move toward any edge.

0.0-4.0s (continuous loop): the meteor rock -- flat orange/burnt-orange fill with a few darker orange jagged facet lines, thick black outline -- spins slowly and wobbles side to side, staying within the middle 35% of the frame at all times. Two to three short hand-drawn black speed-line streaks trail behind it on one side, flicking and redrawing as it turns, as if it is moving fast even though it stays in place. Small chunky yellow spark flecks and a couple of tiny hot-pink ember dots pop off it every second or so and fade quickly. No smoke, no fire, no glow -- every spark and ember is a small flat filled shape with its own thin black outline.

Format: exactly square 640x640, 1:1, about 4 seconds, 24fps, locked static camera with absolutely no pan/zoom/tilt/rotation of the CAMERA itself (only the rock subject rotates). Pure solid black RGB(0,0,0) background, completely uniform, no dark grey wash, no vignette, no gradient. The rock and all its effects must stay centred within the middle 35-40% of the frame at every single frame, never drifting toward any edge. Absolutely no humans, hands, faces, bodies, animals, text, letters, numbers, or logos. No soft neon glow, no blurred bloom, no lens flare, no realistic particles, no smoke simulation, no 3D rendering or CGI lighting -- every shape must have a clean, slightly uneven hand-drawn black outline and a flat, unshaded colour fill, like a sticker.
```

### Meteor Impact — v01 (approved; used)

```
Flat hand-drawn mobile game UI animation in PASER's playful neo-brutalist doodle style. Thick irregular black outlines, bright flat teal, hot pink, yellow, mint and sky blue fills. Sticker-like shapes, comic squash and stretch, hand-drawn motion lines, simple 2D illustration. No realistic lighting, no 3D rendering, no cinematic VFX, no photorealism, no humans, no text. Pure solid black RGB(0,0,0) background. Locked camera. Centre-focused territory capture animation.

CONCEPT: METEOR IMPACT BURST. The single moment a meteor slams into the ground, drawn as a chunky comic impact -- NOT a slow build-up. The burst must already be mid-explosion in the very first frame and keep expanding from there.

CRITICAL TIMING REQUIREMENT: do not show any anticipation, wind-up, or empty frames. Frame 0 must already show the impact beginning -- the burst starts AT the cut and expands outward across the clip. This is only the explosion itself, nothing before it.

0.0-0.6s: dead centre of the frame, a bold jagged comic starburst bursts outward from a point -- thick black uneven outline, flat fill alternating hot-pink and yellow triangular spikes -- while thick black doodle impact lines radiate outward from the same point and a handful of chunky orange and yellow rock-chunk shapes (each with its own black outline) fling outward and slightly upward before starting to fall, plus small teal spark flecks scattering wide.
0.6-1.4s: the starburst and rock chunks continue expanding and drifting outward, chunks tumbling as flat 2D stickers (simple 2D spin, no 3D), starburst holding its jagged shape near full size.
1.4-2.2s: everything -- starburst, chunks, sparks -- shrinks and pops away quickly, back to empty pure black well before the end.

Format: exactly square 640x640, 1:1, about 3-4 seconds, 24fps, locked static camera with absolutely no pan/zoom/tilt/rotation. Pure solid black RGB(0,0,0) background, completely uniform, no dark grey wash, no vignette, no gradient, nothing else in the environment. Keep the whole burst compact and centred, radially balanced, within roughly the middle 60% of the frame, so it can be layered under live characters standing around it. Absolutely no humans, hands, faces, bodies, animals, text, letters, numbers, or logos. No soft neon glow, no blurred bloom, no lens flare, no realistic particles, no smoke simulation, no 3D rendering or CGI lighting -- every single shape is flat-coloured with a clean, slightly hand-drawn uneven black outline, like PASER's own sticker and icon artwork.
```

## Integration / files

- `frontend/assets/animations/seedance-meteor-fall.webp` (new)
- `frontend/assets/animations/seedance-meteor-impact.webp` (new)
- `frontend/src/effects/effectRegistry.js` — registers both as
  `ANIMATED_IMAGE`, `releaseApproved: true` (ships in bundle; does not gate
  production capture selection, see the field's own comment)
- `frontend/src/effects/captureStyles.js` — `DEV_CAPTURE_STYLES` gains
  `seedance_meteor_strike`, built with the same `scene()` compiler as every
  production style, `releaseApproved: false`
- `frontend/__tests__/effects.test.js` — `BUILTIN_ANIMATED_IMAGE_COUNT`
  3 → 5; new `describe('DEV_CAPTURE_STYLES ...')` block validating every dev
  style (including `seedance_meteor_strike` at defender counts 0–3) and
  confirming dev styles stay unreachable from `pickCaptureStyle`
- `AnimationGalleryScreen.js`'s Capture Style Lab needed **no changes** —
  `LAB_STYLES = [...CAPTURE_STYLES, ...DEV_CAPTURE_STYLES]` already picks up
  any new `DEV_CAPTURE_STYLES` entry, with its existing defender-count
  (0/1/2/3) and Attacker/Victim perspective controls.

Nothing here changes production style selection (`PLAYABLE_CAPTURE_STYLES`
only ever reads `CAPTURE_STYLES`), backend behaviour, or any unrelated
screen.
