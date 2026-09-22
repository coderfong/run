# Seedance Capture Asset Spec — Round 4, Lightning / Ground Smash / Comic Brawl (DEV prototypes)

Status: **experimental, not release-approved**.

Continues Round 3 (`SEEDANCE_CAPTURE_ASSET_SPEC_V3.md`, Meteor Strike): the
same architecture — a production `scene()` choreography with Seedance FX
plates swapped in for sprite-pack art, nothing hand-authored — applied to
three more concepts. Each reuses an existing production reference style
verbatim (same `scene()` call, same `SPINE` timing) rather than inventing
new choreography:

| DEV style | Production reference | Family |
|---|---|---|
| `seedance_lightning_attack` | `lightning_conquest` | projectile |
| `seedance_ground_smash` | `earth_crack` | territory (attacker-only) |
| `seedance_comic_brawl` | `sword_slash` | duel |

## Lessons carried over from Meteor Strike, applied from the start

- **Resolution**: Meteor's first pass under-resolved both plates (200×200
  and 320×320), visibly soft once composited at real device pixel density.
  Every Round 4 asset was converted at `edge:960` (lightning-strike,
  ground-smash, brawl-clash — matching the source clip's native 960×960
  almost 1:1) or `edge:640`/`edge:720` for the two looping projectile plates
  (lightning-charge, which is scaled less aggressively by `grow` than
  meteor-fall was).
- **Multi-plate split only where there's a travel beat.** Lightning gets two
  plates (a looping charge bolt for the `projectile()` travel, a front-loaded
  strike burst for impact) because the choreography has a travel beat to
  cover, same as Meteor. Ground Smash and Comic Brawl get **one** plate each
  — `mode: ATTACKER_ONLY` / `DUEL` styles have no projectile beat, so there
  is nothing for a second plate to depict. This is a deliberate deviation
  from the original brief's example asset list ("seedance_ground_cracks,
  seedance_ground_smash"): the "cracks shoot outward, chunks pop upward"
  half of that brief is already drawn for free by `earth_crack`'s own vector
  environment (`CRACKS`/`RISE`/`GLOW_SEAMS`, tinted from the live palette),
  so a second generated asset would duplicate what the engine already does
  at zero art cost — see the "choose based on choreography, not the previous
  prototype's asset count" instruction this round was built against.

## Model and pipeline

Unchanged from Round 3: `dreamina-seedance-2-5-260628` via
`seedance_2_5_create_task`, submitted through `ark_job_submit`; conversion
via the Node port `tmp/seedance/convert-doodle.js` (`ffmpeg` decode, iterative
BFS black-connectivity keying via `jimp-compact`, `ffmpeg` `libwebp_anim`
encode) — no local Python interpreter on this machine.

## Candidate 1 — Lightning Charge (looping bolt)

- **v01 task ID**: `cgt-20260922145702-s51xl` — **rejected**: the bolt
  rendered with a soft neon glow/bloom halo bleeding outward from the black
  outline (verified: sampling the black-outline-to-background transition
  showed a smooth brightness gradient extending several pixels into the
  black, not a hard edge), despite the prompt's explicit "no soft neon
  glow" language — the model defaulted to a "neon sign" read of "lightning
  bolt". Auto-reject trigger: real glow present despite explicit
  no-glow prompt.
- **v02 task ID (first attempt)**: `cgt-20260922150056-qqh0q` — **failed**
  with `OutputAudioSensitiveContentDetected.PolicyViolation`, an unrelated/
  spurious moderation error about output audio on a request that never asked
  for one (`generate_audio` was left unset). Not a content problem with the
  prompt; resubmitted identically (with `generate_audio: false` set
  explicitly this time) rather than treated as a rejected candidate.
- **v02 task ID (retry, used)**: `cgt-20260922150645-hr3l8` — **approved**.
  The corrected prompt named the failure directly and gave a concrete test
  ("if you covered the yellow fill and outline with your hand, the black
  card around it must be completely empty") — came back with a hard,
  crisp edge, verified by the same pixel-transition sampling.
- **Local source**: `tmp/seedance/lightning_charge_v02.mp4` (v01 kept at
  `lightning_charge_v01.mp4`).
- **Source**: 960×960, 24fps, 4.04s, pure black background.
- **Shipped asset**:
  `frontend/assets/animations/seedance-lightning-charge.webp`, 640×640, 24
  frames (skipped 2 lead-in frames, trimmed to 24 of 95), 1000ms, 208KB.
- **Effect ID**: `seedance_lightning_charge`.
- **Visual description**: a chunky flat-yellow doodle lightning-bolt sticker
  with a thick black outline (and a thin yellow accent ring just outside the
  black, an unrequested but on-brand touch the model added), pulsing in
  place with light squash-and-stretch. Like `seedance_meteor_fall`, it does
  not itself travel — the engine's `projectile()` wrapper supplies all
  translation/scale/spin, so the plate only needed to loop convincingly for
  its 220ms flight, not depict falling or arriving.

## Candidate 2 — Lightning Strike (impact burst)

- **v01 task ID**: `cgt-20260922145702-nfb1a` — **approved on first
  attempt**.
- **Local source**: `tmp/seedance/lightning_strike_v01.mp4`.
- **Source**: 960×960, 24fps, 4.04s, pure black background.
- **Shipped asset**:
  `frontend/assets/animations/seedance-lightning-strike.webp`, 960×960, 12
  frames (skipped 3 lead-in frames — the first ~3 frames show the bolt alone
  before the burst/ring arrive, frame-inspected at native 24fps — trimmed to
  the next 12 of 94), 500ms, 900KB.
- **Effect ID**: `seedance_lightning_strike`.
- **Visual description**: matches the brief's exact colour spec —
  bright yellow bolt with a white-hot core streak (thick black zigzag
  outline), a hot-pink jagged radiating comic burst behind it, a flat teal
  ground-ring shockwave at the base, and thick black motion-ray lines
  radiating outward. No realistic lightning, no glow.

## Candidate 3 — Ground Smash (single impact plate)

- **v01 task ID**: `cgt-20260922145702-cjljs` — **rejected**: the crack
  lines rendered in dark charcoal-grey (~RGB 60-71, measured by pixel
  sampling), not black — above the keying tolerance (36) so they would have
  survived conversion as visible muddy-grey lines rather than being swept as
  background, but still wrong against the PASER house style's thick BLACK
  outline language. Auto-reject trigger: primary line art not black.
- **v02 task ID (used)**: `cgt-20260922150323-540hi` — **approved**. The
  corrected prompt explained WHY v1 failed (black-on-black is invisible, so
  the cracks — which have no fill on either side to contrast against pure
  black — need their own bright colour) and specified mint-green explicitly.
  Came back with crisp bright-mint crack lines and a normal black-outlined
  yellow/pink starburst at centre. (v2 also dropped the small flung
  ground-chunk shapes v1 had; judged an acceptable trade for solving the
  colour problem, given `earth_crack`'s own `E.RISE` vector primitive
  already draws "slabs lifting" as a separate, free beat.)
- **Local source**: `tmp/seedance/ground_smash_v02.mp4` (v01 kept at
  `ground_smash_v01.mp4`).
- **Source**: 960×960, 24fps, 4.04s, pure black background.
- **Shipped asset**:
  `frontend/assets/animations/seedance-ground-smash.webp`, 960×960, 12
  frames (skipped 2 lead-in frames, trimmed to the next 12 of 95), 500ms,
  570KB.
- **Effect ID**: `seedance_ground_smash`.
- **Visual description**: bright mint-green jagged crack lines radiating
  from a central point, a flat yellow comic starburst (thick black outline)
  at the centre with a hot-pink inner ring.

## Candidate 4 — Comic Brawl Clash (single impact plate)

- **v01 task ID**: `cgt-20260922145702-geoi4` — **rejected**: the main
  starburst/impact-cloud shape had essentially no outline — pixel-column
  sampling through a spike tip showed background (0,0,0) transitioning
  through exactly ONE blended pixel (~50,45,42) straight into the cream fill
  (~211,208,195), i.e. anti-aliasing only, no deliberate black ink stroke.
  Auto-reject trigger: primary shape missing its house-style black outline
  entirely.
- **v02 task ID (used)**: `cgt-20260922150323-al0lp` — **approved**. The
  corrected prompt asked for a concrete, thick, multi-pixel black stroke
  ("imagine drawing the cloud shape with a thick black marker first, then
  filling the inside") — came back with a clearly visible black ink outline
  around the whole cloud, verified the same way.
- **Local source**: `tmp/seedance/brawl_clash_v02.mp4` (v01 kept at
  `brawl_clash_v01.mp4`).
- **Source**: 960×960, 24fps, 4.04s, pure black background.
- **Shipped asset**: `frontend/assets/animations/seedance-brawl-clash.webp`,
  960×960, 12 frames (skipped 6 lead-in frames — v2's burst grows in from a
  small start, frame-inspected to find where it reaches full size, around
  0.29s — trimmed to the next 12 of 91), 500ms, 612KB.
- **Effect ID**: `seedance_brawl_clash`.
- **Visual description**: a classic comic impact-cloud starburst, cream
  fill with a genuine thick black outline, filled with chunky yellow
  doodle stars (each individually black-outlined), short black scribbled
  motion-lines radiating from the centre, and small flat pink/teal
  geometric accent shapes. Confirmed **zero text** anywhere in any sampled
  frame, per the brief's explicit "no POW, no BAM" requirement.

## Choreography — all three reuse a production reference verbatim

### Lightning Attack (`seedance_lightning_attack`)

Same `scene()` call as `lightning_conquest`: attacker `RAISE_ARMS`, sky
`DARKEN`s, defenders `LOOK_UP`, a 220ms bolt travels `screenTop` →
`defenderGroupCenter` (`seedance_lightning_charge`, `grow: 1.7`), impact
(`seedance_lightning_strike`) lands **on the defender group**, not territory
centre — the bolt earths into the rivals, then `ELECTRIFY` territory reveal
from territory centre, `SHOCKWAVE_KNOCKBACK` and flee.

### Ground Smash (`seedance_ground_smash`)

Same `scene()` call as `earth_crack`: attacker `JUMP` → `SLAM` toward
territory centre, impact anchored at the attacker's own **`characterFeet`**
(not territory centre — the smash originates from where the attacker
landed), vector `CRACKS`/`RISE`/`GLOW_SEAMS` at the same anchor, `CRACK_GLOW`
territory reveal from `CHARACTER_FEET`.

### Comic Brawl (`seedance_comic_brawl`)

Same `scene()` call as `sword_slash`: attacker `STEP_FORWARD` then
`DASH_FORWARD` **toward `nearestDefender`** — genuine convergence, not two
characters standing still while FX happens between them — a `duel()` contact
step at the moment they meet, then the clash-cloud plate at `nearestDefender`
(`size: 360`, large enough to plausibly cover both rigs; confirmed
`FOREGROUND_FX` (40) paints above `CHARACTER` (30) in `layers.js`, so this
needs no renderer change), `SHOCKWAVE` territory reveal from territory
centre, `FALL_AND_RECOVER` defender displacement, flee.

## Integration / files

- `frontend/assets/animations/seedance-lightning-charge.webp`,
  `seedance-lightning-strike.webp`, `seedance-ground-smash.webp`,
  `seedance-brawl-clash.webp` (new)
- `frontend/src/effects/effectRegistry.js` — four new `BUILTIN_ANIMATED_IMAGES`
  entries, `releaseApproved: true` (ships in bundle; does not gate
  production capture selection)
- `frontend/src/effects/captureStyles.js` — `DEV_CAPTURE_STYLES` gains
  `seedance_lightning_attack`, `seedance_ground_smash`, `seedance_comic_brawl`,
  each built with the same `scene()` compiler as every production style,
  `releaseApproved: false`
- `frontend/__tests__/effects.test.js` — `BUILTIN_ANIMATED_IMAGE_COUNT` 5 → 9;
  three new `describe()` blocks under `DEV_CAPTURE_STYLES`, each validating
  the style's shape, its FX plates' registry entries, and defender counts 0-3
- `AnimationGalleryScreen.js`'s Capture Style Lab needed **no changes** —
  all three appear automatically via `LAB_STYLES = [...CAPTURE_STYLES,
  ...DEV_CAPTURE_STYLES]`.

Nothing here changes production style selection (`PLAYABLE_CAPTURE_STYLES`
only ever reads `CAPTURE_STYLES`), backend behaviour, or any unrelated
screen.
