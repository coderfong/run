# Seedance Capture Asset Spec — Round 2, PASER-doodle direction (DEV prototypes)

Status: **experimental, not release-approved**. Round 2 of the Seedance
capture-FX exploration, redirected after round 1
(`SEEDANCE_CAPTURE_ASSET_SPEC.md`, the Portal prototype) was judged not
recognisably PASER — soft glow, no black outlines, sci-fi rather than
doodle. This document records the actual, measured contract of the three
round-2 candidates.

## Reference correction

The Home Screen screenshot supplied for this round (`UsersuserDesktoprun.figma-home.png`,
375×812) is a dark, glossy, gradient dashboard with a photographic avatar —
no black outlines, no flat doodle fills, none of the described palette. It
does not match PASER. The actual reference used instead, verified directly
against the shipped app:

- `frontend/src/theme/nb.js` / `theme/toon.js` — real tokens: `pink #ec4899`,
  `teal #2dd4bf`, `yellow #ffd54a`, `green (mint) #3ddc84`, `blue (sky)
  #4d96ff`, `ink #0c0c10`, cream `#f5f1e6`. Matches the brief's palette to
  the hex.
- `frontend/assets/art/claim-explainer.png` — a real shipped PASER
  illustration of a claim: hand-drawn runner, teal territory blob, yellow
  flag, thick wobbly black outlines.
- `frontend/assets/art/ui/burst-rays.png` — a flat chunky yellow sunburst,
  same doodle language.

## Model

`dreamina-seedance-2-5-260628`, via the `ark-seed` MCP server, same as
round 1.

## Keying mode correction (applies to all three candidates)

Round 1 used `glow` mode (bright shapes, no outline). This round's content
is flat colour fills with a **thick black outline** — a structurally
different case. Empirically verified (composited a converted frame over a
solid colour card) that:

- `glow` mode corrupts the black outline to a washed-out **grey** line
  (alpha reconstruction failure on near-zero-brightness pixels during
  un-premultiply).
- `black` connectivity mode preserves the outline **crisply**, with no
  halo.

All three candidates below are converted with `black` mode
(`key_flat_backing(img, 'black')` from `scripts/convert-scene-animations.py`).

## Candidate 1 — PASER Stamp

- **v01 task ID**: `cgt-20260922115125-hh1n9` — **rejected**: impact did not
  land until ~1.7–1.8s (frame-inspected at 0.05–0.1s steps from 0.95s to
  1.8s). Auto-reject trigger: "main impact is later than 1.5s." Everything
  else about it (style, palette, final composition, confetti) was correct —
  purely a pacing problem, the stamp hovered instead of dropping.
- **v02 task ID**: `cgt-20260922121113-8qp8z` — corrected prompt explicitly
  demanded a fast, "stapler-slam" drop completing by 1.1–1.2s. **Result:
  overcorrected** — impact now measured between 0.73s (still falling) and
  0.78s (starburst fully formed), i.e. ~0.75–0.78s. This is earlier than the
  0.9–1.4s ideal window, but "impact too early" is not one of the listed
  auto-reject triggers, and it is a much smaller miss than v01's lateness —
  kept rather than spending a third generation.
- **Local source**: `tmp/seedance/paser_stamp_v02.mp4` (v01 also kept at
  `tmp/seedance/paser_stamp_v01.mp4` for the record, not converted).
- **Source**: 640×640, 4.04s, 24fps, pure black `RGB(0,0,0)` background
  (verified by sampling frame corners).
- **Shipped asset**: `frontend/assets/animations/seedance-paser-stamp.webp`,
  280×280, requested 52 frames trimmed from source, encoded down to **49**
  unique frames (libwebp merged a couple of near-duplicates) = 2042ms, 729KB.
- **Effect ID**: `seedance_paser_stamp`. **Capture style ID**:
  `seedance_paser_stamp_test`.
- **Measured timing used for the choreography**: impact/haptic/shake at
  780ms, territory reveal at 810ms, style duration 2120ms (POST_REVEAL_BUDGET
  ceiling 2160ms — 40ms margin).
- **Visual description**: an oversized flat teal rounded-rectangle "stamp"
  drops fast from just above centre, hits dead centre, and detonates into a
  chunky pink/teal jagged comic starburst with yellow stars and pink/teal/
  yellow square-and-diamond confetti, all with thick uneven black outlines.
  Settles, then the confetti disperses and fades to black by ~2s.

## Candidate 2 — Route Scribble

**Rejected after both allowed generations. Not converted, not registered.**

- **v01 task ID**: `cgt-20260922115126-40e5l` — **rejected**: the background
  measured a uniform `RGB(22,22,22)`, not pure black (confirmed by sampling
  frame corners), and the scribbled line itself was drawn in pure black.
  Ran `black` connectivity keying on an actual frame and confirmed
  empirically — **the entire frame keyed to alpha 0**, line included: with
  no colour fill yet present (the line hasn't closed into a filled shape),
  there is nothing to "enclose" the outline and separate it from the
  background's connected region, so the whole thing gets swept away as
  background. Auto-reject trigger: "black background is contaminated."
- **v02 task ID**: `cgt-20260922121113-a7477` — corrected prompt fixed both
  problems: background verified pure `RGB(0,0,0)` this time, and the
  travelling line was requested in bright teal (not black) specifically so
  it would be keyable before the fill exists; a black outline was requested
  to "snap into place simultaneously" with the fill. **The background and
  line-colour fixes worked.** But the requested simultaneous black outline
  **did not appear**: frames at 1.35s and 1.45s (well after the measured
  fill snap at ~1.28–1.32s) show a plain, borderless flat teal disc with no
  outline at all. A black outline does eventually appear once the pink
  starburst arrives (~2.5s), but for roughly a second around the actual
  impact beat the core shape has no outline. Auto-reject trigger: "it lacks
  the PASER black-outline language."
- Per the 2-generation cap, no v03 was attempted. Both source files are kept
  at `tmp/seedance/route_scribble_v01.mp4` and
  `tmp/seedance/route_scribble_v02.mp4` for the record.
- **What a third attempt would need to fix**: the outline has to be tied to
  the SAME moment as the fill snap, not to a later beat — likely needs the
  prompt to describe the outline as part of the fill event itself ("the
  shape fills teal and is outlined in the same instant, as one action") in
  a shorter, more insistent clause, since the current phrasing ("simultaneously
  a thick black outline stroke snaps into place... on top, as part of the
  impact beat") was apparently read as a separate, later beat.

## Candidate 3 — PASER Party Burst

- **v01 task ID**: `cgt-20260922115126-xq3ym` — **approved on the first
  attempt**, no v02 needed.
- **Local source**: `tmp/seedance/party_burst_v01.mp4`.
- **Source**: 640×640, 4.04s, 24fps, pure black background.
- **Shipped asset**: `frontend/assets/animations/seedance-party-burst.webp`,
  280×280, 58 frames (trimmed from 97), 2417ms, 539KB.
- **Effect ID**: `seedance_party_burst`. **Capture style ID**:
  `seedance_party_burst_test`.
- **Measured timing**: a small teal anticipation blob squashes and stretches
  from 0s, then POPs into the full burst between 1.06s and 1.10s (pinned by
  0.03s-step sampling) — comfortably inside the 0.9–1.4s window, close to
  the 1.15s ideal. Retraction is smooth and complete by ~2.35s (sampled at
  0.05s steps from 2.2s to 2.45s) — well ahead of the 3.0–3.5s target, no
  hard cut. Choreography: impact/haptic/shake at 1100ms, territory reveal
  at 1130ms, style duration 2120ms (ceiling 2480ms — 360ms margin, the most
  comfortable fit of the three).
- **Visual description**: a small flat teal blob winds up, then POPs into a
  radial ten-petal doodle burst — alternating hot-pink and yellow petals,
  two mint-teal petals, each with thick uneven black outlines — carrying
  PASER iconography inside the petals: a mint map-pin icon, two yellow
  stars, two mint square/diamond shapes, a mint footprint pair, plus small
  black motion-dash marks at the corners. Retracts to a single point and
  vanishes cleanly.

## Runtime architecture (unchanged from round 1)

```
Seedance MP4 -> tmp/seedance/convert_doodle.py
    (imports key_flat_backing(mode='black') from
     scripts/convert-scene-animations.py by file path; decodes @24fps,
     keys each frame, resizes, trims frame count, encodes libwebp_anim)
-> assets/animations/seedance-{party-burst,paser-stamp}.webp
-> effectRegistry.js BUILTIN_ANIMATED_IMAGES (ANIMATED_IMAGE type,
   releaseApproved: true -- ships in the bundle; NOT the production-capture
   gate, see the field's own comment)
-> captureStyles.js DEV_CAPTURE_STYLES (hand-authored sequences, same
   exported primitives scene() uses, each synced to its own MEASURED
   impact; a small shared `finishDevSequence` helper assigns beats/sorts)
-> EffectPlayer / CaptureStylePlayer / live CaptureCast /
   TerritoryRevealCanvas (all unmodified)
```

`getCaptureStyle()`'s fallback to `DEV_CAPTURE_STYLES` (added in round 1,
unchanged) is what lets `AnimationGalleryScreen.js` resolve these ids while
`pickCaptureStyle()` / `PLAYABLE_CAPTURE_STYLES` — which only ever read
`CAPTURE_STYLES` — remain structurally unable to select any of them.

## Seedance master prompts

Every prompt below opens with the required PASER-doodle descriptor clause,
then the concept-specific choreography. v02 prompts are given where a v02
was generated; v01 prompts are given for the record where the v01 itself
still matters (Route Scribble, where both attempts are part of the story).

### PASER Stamp — v01 (rejected: impact too late)

```
Flat hand-drawn mobile game UI animation in PASER's playful neo-brutalist doodle style. Thick irregular black outlines, bright flat teal, hot pink, yellow, mint and sky blue fills. Sticker-like shapes, comic squash and stretch, hand-drawn motion lines, simple 2D illustration. No realistic lighting, no 3D rendering, no cinematic VFX, no photorealism, no humans, no text. Pure black background. Locked camera. Centre-focused territory capture animation.

CONCEPT: PASER STAMP. A giant chunky flat territory stamp slams straight down onto the centre of the frame.

0.0-0.3s: a few small thick black hand-drawn motion lines and tiny dust-doodle marks gather toward the centre, frame otherwise empty black.
0.3-0.8s: a flat, oversized, rounded-rectangle stamp shape (thick black outline, solid teal face) drops straight down from above toward centre, growing larger as it falls, trailing 2-3 hand-drawn speed lines.
0.8-1.15s: MAIN IMPACT -- the stamp hits dead centre. A bold cartoon squash: the stamp flattens wide for one frame with sharp comic impact lines radiating outward, a hot-pink and teal flat-colour splash kicks out to the sides, a handful of tiny chunky yellow stars pop outward, small square confetti pieces (pink, yellow, teal) scatter, thick black doodle impact lines radiate from the point of contact. No glow, no light flash -- the impact is drawn with shapes and outlines only.
1.15-2.0s: the stamped shape settles and bounces once, like a sticker being pressed and springing back slightly, thick black outline holding its edge the whole time.
2.0-3.2s: the confetti and stars shrink and pop away one by one until the frame is empty black again.

Format: exactly square 640x640, 1:1, about 3.2-3.6 seconds, 24fps, locked static camera with absolutely no pan/zoom/tilt/rotation. Pure solid black background, nothing else in the environment -- no floor, no room, no gradient sky. Keep the strongest shapes compact and centred so the plate can be layered under live characters standing around it. Absolutely no humans, hands, faces, bodies, animals, text, letters, numbers, or logos. No soft neon glow, no blurred bloom, no lens flare, no realistic particles, no smoke simulation, no 3D rendering or CGI lighting -- every shape must have a clean, slightly uneven hand-drawn black outline and a flat, unshaded colour fill, like a sticker.
```

### PASER Stamp — v02 (approved; used)

```
Flat hand-drawn mobile game UI animation in PASER's playful neo-brutalist doodle style. Thick irregular black outlines, bright flat teal, hot pink, yellow, mint and sky blue fills. Sticker-like shapes, comic squash and stretch, hand-drawn motion lines, simple 2D illustration. No realistic lighting, no 3D rendering, no cinematic VFX, no photorealism, no humans, no text. Pure solid black RGB(0,0,0) background. Locked camera. Centre-focused territory capture animation.

CONCEPT: PASER STAMP (CORRECTED TIMING -- v1 landed its impact around 1.7s, far too late; this version must be fast and snappy).

CRITICAL TIMING REQUIREMENT: the stamp must complete its ENTIRE downward drop and hit dead centre of the frame by 1.1-1.2 seconds. Do NOT let the stamp hover, float, or descend slowly. It falls FAST, like a stapler slamming down, not like a feather drifting.

0.0-0.25s: a few small thick black hand-drawn motion lines gather toward the centre, frame otherwise empty pure black.
0.25-0.6s: a flat, oversized, rounded-rectangle stamp shape (thick black outline, solid teal face) drops FAST and DIRECTLY from just above the centre of the frame straight down, growing slightly larger as it falls, trailing 2-3 hand-drawn speed lines. It must already be positioned centrally, not off to one side or near the top edge -- keep it within the middle 60% of the frame at every moment.
0.6-1.1s: MAIN IMPACT -- the stamp hits dead centre of the frame. A bold cartoon squash: the stamp flattens wide for one frame with sharp comic impact lines radiating outward, a hot-pink and teal flat-colour comic starburst kicks out around it, a handful of tiny chunky yellow stars pop outward, small square and diamond confetti pieces (pink, yellow, teal) scatter, thick black doodle impact lines radiate from the point of contact. No glow, no light flash -- the impact is drawn with shapes and outlines only.
1.1-2.2s: the stamped shape and its starburst settle and bounce once, like a sticker being pressed and springing back slightly, thick black outline holding its edge the whole time, staying centred.
2.2-3.2s: the confetti, stars and starburst shrink and pop away one by one until the frame is empty pure black again.

Format: exactly square 640x640, 1:1, about 3.2-3.6 seconds, 24fps, locked static camera with absolutely no pan/zoom/tilt/rotation. Pure solid black RGB(0,0,0) background, completely uniform, no dark grey wash, no vignette, no ambient tone -- nothing else in the environment. Keep the strongest shapes compact and centred at all times, never drifting to one side or to the top/bottom edge, so the plate can be layered under live characters standing around it. Absolutely no humans, hands, faces, bodies, animals, text, letters, numbers, or logos. No soft neon glow, no blurred bloom, no lens flare, no realistic particles, no smoke simulation, no 3D rendering or CGI lighting -- every shape must have a clean, slightly uneven hand-drawn black outline and a flat, unshaded colour fill, like a sticker.
```

### Route Scribble — v01 (rejected: contaminated background)

```
Flat hand-drawn mobile game UI animation in PASER's playful neo-brutalist doodle style. Thick irregular black outlines, bright flat teal, hot pink, yellow, mint and sky blue fills. Sticker-like shapes, comic squash and stretch, hand-drawn motion lines, simple 2D illustration. No realistic lighting, no 3D rendering, no cinematic VFX, no photorealism, no humans, no text. Pure black background. Locked camera. Centre-focused territory capture animation.

CONCEPT: ROUTE SCRIBBLE. A thick black marker line rapidly scribbles out a wobbly closed loop around the centre of the frame, like someone circling territory on a map by hand, then the loop fills in.

0.0-0.9s: a single thick black marker-style line races around the centre in a hand-drawn, slightly wobbly closed loop (an irregular rounded blob shape, not a perfect circle), drawing itself on screen as if animated stroke-by-stroke, picking up speed as it goes.
0.9-1.15s: MAIN IMPACT -- the instant the line closes the loop on itself, a sharp SNAP: the whole inside of the loop fills solid flat teal in one decisive beat, with a thin bright outline flash along the black border only (no glow) -- like a shape filling in a drawing app.
1.15-1.8s: immediately off that snap -- a hot-pink flat radial burst kicks out from the loop's edge, one chunky yellow star pops above it, and 3-4 short thick black hand-drawn motion-ray doodles radiate outward from the shape.
1.8-2.4s: the burst pink shapes and star shrink and settle, a couple of tiny confetti squares drift and fade.
2.4-3.2s: everything clears except the black outline holding steady, then that too fades, back to empty black.

Format: exactly square 640x640, 1:1, about 3.2-3.6 seconds, 24fps, locked static camera with absolutely no pan/zoom/tilt/rotation. Pure solid black background only. The scribbled shape should stay compact and centred (roughly the middle 40-50% of the frame) so live characters can stand around it. Absolutely no humans, hands, faces, bodies, animals, text, letters, numbers, or logos -- the line is drawn by an unseen hand, never shown. No soft neon glow, no blurred bloom, no lens flare, no realistic particles or smoke, no 3D rendering or CGI lighting -- the marker line must look hand-drawn and slightly imperfect/wobbly, not a smooth vector curve, and every shape gets a clean black outline and a flat unshaded colour fill.
```

### Route Scribble — v02 (rejected: missing black outline at impact)

```
Flat hand-drawn mobile game UI animation in PASER's playful neo-brutalist doodle style. Thick irregular black outlines, bright flat teal, hot pink, yellow, mint and sky blue fills. Sticker-like shapes, comic squash and stretch, hand-drawn motion lines, simple 2D illustration. No realistic lighting, no 3D rendering, no cinematic VFX, no photorealism, no humans, no text. Pure solid black RGB(0,0,0) background. Locked camera. Centre-focused territory capture animation.

CONCEPT: ROUTE SCRIBBLE (CORRECTED -- v1 used a black marker line on a background that was not truly pure black, and the line itself was pure black with nothing to visually separate it from the card; this version fixes both).

CRITICAL BACKGROUND REQUIREMENT: the background must be perfectly flat, uniform, pure solid black, RGB(0,0,0) exactly, with absolutely no dark grey wash, no vignette, no ambient haze, no soft glow anywhere in the black itself. Test this by imagining a pure black rectangle behind the art -- the card must be indistinguishable from that.

CRITICAL LINE-COLOUR REQUIREMENT: the travelling scribble line itself must be drawn in bright solid TEAL/TURQUOISE (not black) while it is being drawn -- a thick, chunky, hand-drawn marker-style teal line, slightly wobbly, not a smooth vector curve. Only AFTER the loop closes and the shape fills in does a separate thin black outline stroke draw itself around the finished teal shape, on top, as part of the impact beat.

0.0-0.9s: a single thick bright-teal marker-style line races around the centre in a hand-drawn, slightly wobbly closed loop (an irregular rounded blob shape, not a perfect circle), drawing itself on screen stroke-by-stroke, picking up speed as it goes. The line is teal the whole time, never black, during this phase.
0.9-1.15s: MAIN IMPACT -- the instant the line closes the loop on itself: a sharp SNAP where the whole inside of the loop fills solid flat teal in one decisive beat, and simultaneously a thick black hand-drawn outline stroke snaps into place tracing the exact edge of the shape -- like a shape filling in a drawing app and its border locking in. No glow, no light flash -- drawn shapes and outlines only.
1.15-1.8s: immediately off that snap -- a hot-pink flat radial burst kicks out from the loop's edge, one chunky yellow star pops above it, and 3-4 short thick black hand-drawn motion-ray doodles radiate outward from the shape.
1.8-2.4s: the burst pink shapes and star shrink and settle, a couple of tiny confetti squares drift and fade.
2.4-3.2s: everything clears -- the teal shape and its black outline shrink away -- back to empty pure black.

Format: exactly square 640x640, 1:1, about 3.2-3.6 seconds, 24fps, locked static camera with absolutely no pan/zoom/tilt/rotation. Pure solid black RGB(0,0,0) background only. The scribbled shape should stay compact and centred (roughly the middle 40-50% of the frame) so live characters can stand around it. Absolutely no humans, hands, faces, bodies, animals, text, letters, numbers, or logos -- the line is drawn by an unseen hand, never shown. No soft neon glow, no blurred bloom, no lens flare, no realistic particles or smoke, no 3D rendering or CGI lighting.
```

### PASER Party Burst — v01 (approved; used)

```
Flat hand-drawn mobile game UI animation in PASER's playful neo-brutalist doodle style. Thick irregular black outlines, bright flat teal, hot pink, yellow, mint and sky blue fills. Sticker-like shapes, comic squash and stretch, hand-drawn motion lines, simple 2D illustration. No realistic lighting, no 3D rendering, no cinematic VFX, no photorealism, no humans, no text. Pure black background. Locked camera. Centre-focused territory capture animation.

CONCEPT: PASER PARTY BURST. The most celebratory of the set -- a small centred shape does a quick squash-and-pop into a chunky radial doodle explosion of PASER UI iconography, then everything retracts away.

0.0-0.4s: a small flat teal rounded-blob shape sits at dead centre and quickly squashes down and inward, anticipating, thick black outline throughout, frame otherwise empty black.
0.4-0.9s: the blob stretches back up and winds tighter, tiny black hand-drawn motion lines flicking off it.
0.9-1.2s: MAIN IMPACT -- POP. The blob bursts into a radial doodle explosion, all flat-coloured, all black-outlined, all drawn -- no glow, no light flash: chunky rounded hot-pink rays fanning outward, a few bright yellow chunky stars, small mint-green rectangles, small sky-blue circles, 2-3 tiny black footprint doodles, one small flat map-pin icon shape, and short thick black motion-stroke marks, all flying outward from the centre in a compact radial burst (staying within roughly the middle 55% of the frame).
1.2-2.2s: the burst pieces continue drifting outward briefly, tumbling and rotating slightly as flat 2D stickers (no 3D rotation, just simple 2D spin), like a standings-card celebration graphic.
2.2-3.2s: every piece rapidly shrinks and retracts back toward the centre point and disappears -- quick, snappy, not a slow fade -- leaving the frame empty black well before the end.

Format: exactly square 640x640, 1:1, about 3.2-3.6 seconds, 24fps, locked static camera with absolutely no pan/zoom/tilt/rotation. Pure solid black background only, nothing else. Keep the whole burst compact and centred, radially balanced in every direction, so it can be layered under live characters standing anywhere around it. Absolutely no humans, hands, faces, bodies, animals, text, letters, numbers, or logos. No soft neon glow, no blurred bloom, no lens flare, no realistic particles or smoke simulation, no 3D rendering or CGI lighting, no metallic or glassy shading -- every single shape is flat-coloured with a clean, slightly hand-drawn uneven black outline, like PASER's own sticker and icon artwork.
```

## Integration / files

See the main report for the full files-created/files-modified list and test
results. Nothing here changes production style selection, backend
behaviour, or any unrelated screen.
