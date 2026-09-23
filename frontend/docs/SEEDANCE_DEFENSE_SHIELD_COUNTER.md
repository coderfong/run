# Seedance Defense Prototype: Shield Counter

## Architecture audit

- A successful defense is received as a foreground notification with category
  `defended` by `DefenseHeldBanner`.
- Before this change the event produced only a light haptic and banner.
- The territory owner is the local avatar; the failed attacker comes from the
  notification actor payload. Successful-defense gameplay currently exposes
  one owner, so the prototype deliberately renders one defender.
- `CaptureCast`, `ClaimActor`, `useCaptureStage`, anchors, camera actions and
  `EffectPlayer` already support both actors and the required physical actions.
- `DefenseStylePlayer` delegates to the existing choreography scheduler with a
  defense resolver/plan. It never receives an ownership-reveal callback.

## Asset provenance

- Model: `dreamina-seedance-2-5-260628`
- Endpoint: `ep-m-20260921020023-psqr2`
- Task: `cgt-20260923014016-lbfa0`
- Source: `tmp/seedance/defense/shield-counter-v01.mp4`
- Source properties: 960x960, 24 fps, 5.04 s, 3,370,739 bytes
- Retimed source: `tmp/seedance/defense/shield-counter-v01-retimed.mp4`
- Final: `assets/animations/seedance-defense-shield-counter.webp`
- Final properties: 640x640, 59 encoded frames, 24 fps, 494,606 bytes
- Native generated impact: approximately 2.50 s
- Integrated impact after retiming: approximately 1.08 s

## Prompt

Flat hand-drawn mobile game UI animation in PASER's playful neo-brutalist
doodle style. Thick irregular black outlines, bright flat teal `#2dd4bf`, hot
pink `#ec4899`, yellow `#ffd54a`, mint `#3ddc84` and sky-blue `#4d96ff` fills.
Chunky sticker-like geometry, marker wobble, comic squash and stretch, strong
readable silhouettes. Pure RGB 0,0,0 black background. Locked camera, centered
composition, generous negative space. No camera movement, realistic lighting,
glow, bloom, 3D rendering, cinematic VFX, photorealism, humans, characters,
hands, text, or audio.

Timeline: 0.00-0.45 seconds empty pure black. 0.45-0.80 seconds a huge flat
teal cartoon defensive shield rapidly forms at center, with a thick uneven
connected black outline and small pink/yellow accents. 0.80-1.10 seconds the
shield braces. Exactly at 1.10 seconds a colorful incoming impact slams into
its front surface. The shield squashes backward dramatically like rubber,
producing a chunky yellow comic starburst, hot-pink rectangular fragments,
teal compression lines and connected black hand-drawn impact rays. 1.15-1.50
seconds the shield snaps forcefully forward and rebounds energy toward the
left, producing a short teal/pink counter-wave. 1.50-2.10 seconds the shield
settles and rapidly disappears. By 2.30 seconds the frame is completely empty
pure RGB black. Keep all black outline regions connected to the outer black
background wherever possible for alpha-key conversion.

## Integrated timeline

| Time | Beat |
| ---: | --- |
| 0 ms | Attacker advances; shield plate begins |
| 280 ms | Defender notices |
| 520 ms | Defender braces |
| 650 ms | Attacker commits the attack |
| 1,060 ms | Camera freeze |
| 1,100 ms | Shield contact, heavy haptic and shake |
| 1,120 ms | Attacker recoils |
| 1,280 ms | Attacker is knocked away |
| 1,940 ms | Defender celebrates |
| 2,700 ms | Cleanup, then existing defense-held payoff |

Black removal uses `scripts/convert_seedance_black.py`. Only near-black pixels
connected to a frame edge are cleared, preserving enclosed black outlines. A
blue-background composite at the impact frame confirmed a clean edge with no
grey halo and intact black ink.
