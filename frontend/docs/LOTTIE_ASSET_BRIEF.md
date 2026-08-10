# PASER gameplay Lottie brief

The app now has named Lottie slots in `src/config/lottieAnimations.js`. Every
slot ships with its own new, original shape-only composition; unrelated events
do not reuse an old animation or a generic shared burst. The table below is
also the art-direction brief for upgrading those dedicated files later without
changing screen code.

## Delivery rules

- Bodymovin `.json`, transparent background, 512 × 512 composition.
- 30 fps preferred. Use 60 fps only where 30 visibly harms a fast impact.
- Shape layers only. No linked PNGs, fonts, text layers, audio or expressions.
- Do not bake words or numbers into an effect; PASER renders localized text.
- One-shots must finish visually empty (all layers at 0 opacity) so the mounted
  final frame never covers the interface.
- Loops must have a perfectly matching first and last frame.
- Keep ordinary files below 150 KB and hero files below 250 KB. The looping
  route-head effect should stay below 80 KB because it runs during GPS use.
- Effects are decorative and must remain readable over light and dark maps.
- Core palette: pink `#E82E7A`, teal `#2DD4BF`, purple `#8B44F2`, gold
  `#F9BF1F`, ink `#0B0D10`, white `#FFFFFF`.
- Avoid full-canvas opaque flashes. Bright flashes should peak below roughly
  70% opacity and last no longer than two frames.
- Submit the After Effects source beside the exported JSON for future edits.

## Included dedicated assets and production direction

| Priority | Registry key | Deliver as | Duration | Loop | Visual direction and trigger |
| --- | --- | --- | ---: | :---: | --- |
| P0 | `captureImpact` | `capture-impact.json` | 0.75–0.9 s | No | Chunky contact star, white centre, gold/pink spikes, small smoke curls. Fires exactly when attacker touches a defender. Keep the centre open enough that both live avatars remain visible. |
| P0 | `bombBlast` | `bomb-blast.json` | 0.9–1.1 s | No | White flash → orange/gold blast → cream smoke puffs → teal/pink debris. It layers over the existing bomb arc at detonation; do not include another bomb. |
| P0 | `runStart` | `run-start-burst.json` | 0.8–1.0 s | No | Starting-line paint swipe, radial speed streaks and two dust kicks. No “GO” text; the app supplies it. |
| P0 | `kilometre` | `kilometre-split.json` | 0.9–1.2 s | No | Circular lap stroke completes, pops into speed streaks and small stars. Must frame the dynamic “N KM” label rather than cover it. |
| P0 | `claimReady` | `claim-ready.json` | 1.1–1.4 s | No | Route line curls into a territory outline, flag pins down, one teal perimeter wave. No map, words, or fixed claim shape. |
| P0 | `kudos` | `fx-kudos-burst.json` | 0.7–1.0 s | No | Three to five hand-inked hearts with one tiny running-shoe spark. Rise and fan outward from the button. |
| P1 | `routeHead` | `route-head-loop.json` | 1.2–1.6 s | Yes | Very restrained comet head: a white/teal point with a soft trailing dash and one breathing ring. Designed for continuous map use at 54–64 px. |
| P1 | `energySpend` | `energy-spend.json` | 0.7–0.9 s | No | Pink bolt compresses, fragments fly inward, then the glow collapses. Reads as energy leaving rather than an error. |
| P1 | `energyGain` | `energy-gain.json` | 0.8–1.0 s | No | Tiny sparks converge into a bolt, which bounces once and emits a pink halo. |
| P1 | `streakStamp` | `fx-streak-ignite.json` | 1.0–1.25 s | No | Rubber-stamp impact ring followed by a two-tone orange/gold flame ignition. Must read clearly at 52 px. |
| P1 | `rankUp` | `rank-up.json` | 0.9–1.15 s | No | Teal chevrons climb through two positions, finish with a gold crown sparkle. No rank numeral. |
| P1 | `clubProgress` | `club-goal-progress.json` | 0.7–0.9 s | No | A bright runner-like dash travels through a short accent trail and pops at the new bar endpoint. Neutral color or recolorable shapes. |
| P1 | `clubComplete` | `club-goal-complete.json` | 1.4–1.8 s | No | Crest-shaped burst, two small flags, group-confetti arc. Keep the middle empty for the real club badge. |
| P2 | `rivalEntry` | `rival-entry.json` | 0.8–1.05 s | No | Red-orange perimeter scan, two opposing flag tips and a fast warning slash. Competitive, not dangerous or violent. |

## What should stay outside Lottie

- Player avatars, facial reactions and equipped clothes stay in
  `CharacterRig`; baking a generic runner into Lottie would show the wrong
  character.
- Live route geometry and territory polygons stay in Mapbox because their
  shapes come from real GPS data.
- Dynamic labels, distances, ranks and club colors stay native for
  localization, accessibility and real-time data.

Lottie supplies the authored effects around those live elements: impact,
smoke, particles, energy, fire, trails and celebration accents.

## Replacement workflow

1. Replace the dedicated file at the path listed above, keeping its filename.
2. If a supplier changes the filename, update only that key's static `require()`
   in `src/config/lottieAnimations.js`.
4. Test iOS, Android and web with Reduce Motion both on and off.
5. Verify the last frame is transparent and repeated taps replay cleanly.
