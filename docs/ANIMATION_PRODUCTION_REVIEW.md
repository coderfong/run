# PASER animation production review

Review date: 2026-08-11

## Test matrix

All 16 capture definitions were exercised against empty, one-defender, and three-defender encounters; reduced motion; small, large, long/narrow, irregular, partially off-screen, and misleading-centroid projected territories; unmount; repeated replay; missing optional visuals; invalid metadata; unknown effects; duplicate callbacks; and callback timeout. The geometry matrix asserts that every resolved effect extent stays within safe screen insets.

Automated coverage includes 50 rapid replays with timer accounting. This detects retained JavaScript timers/callbacks, but it is not a substitute for Instruments/Android Studio native heap and thermal profiling on release devices.

## Findings and fixes

- Bounding-box/centroid anchors could land outside concave ground, against a narrow edge, under UI, or off-screen. `territoryVisualCenter` now selects a high-clearance visible polygon point and fitted effect bounds respect safe insets.
- Cancelled `useClaimSequence` waits cleared their timeout without resolving the promise, retaining suspended async closures. Timer cancellation now settles tracked waits.
- Capture visuals and the territory controller had independent reveal timing. The authored style now emits the cue; the controller owns and executes the actual reveal, with a fallback deadline.
- Completed sprites/Lotties could remain mounted until the whole capture style ended. Effects now unmount on completion and the stage is cleared at its hard duration.
- Renderer callbacks could fire twice or never fire. Completion is guarded at most once and backed by a bounded timeout.
- Finished sprite worklets remained active. The frame callback is explicitly disabled after finish, during pause, and on unmount.
- A partially filled sprite grid could advance into unused cells. Frame selection is clamped to the declared frame count.
- Replay/unmount left opportunities for scheduled steps and shake to outlive a run. Generation tokens, timer cleanup, and animation cancellation isolate each playback.
- Several sheets had transparent padding or off-centre art. Central `visualScale`/offset metadata corrects the render without screen-specific positioning code.
- Capture haptics were duplicated by encounter/reveal/victory layers. Each style now owns exactly one primary impact haptic.
- Reduced motion previously risked being interpreted as a faster full sequence. It is now an explicit reveal-only plan with no shake or decorative sprites.
- Uncertain-license assets could be copied and statically required. The importer and validator now enforce an approved-only registry and prune stale generated assets.
- The dev gallery route could remain statically imported despite UI guards. Both route/component imports and render paths are development-only.
- Web export lacked required Lottie and Mapbox peers. The minimum compatible peer dependencies were added; production web export now succeeds.
- The 44 approved effect sheets now include validated 1×, 2×, and 3× nearest-neighbour variants. Metro resolves each set as one logical native asset with scales `[1, 2, 3]`, preventing Retina interpolation blur while preserving the original frame geometry.

## Visual quality

| Style | Intro | Impact | Reveal | Secondary/ending | Assessment |
| --- | --- | --- | --- | --- | --- |
| Thunderstrike | violet charge | blue electric snap | at impact | solar aftershock | strongest; immediate and legible |
| Arcane Portal | stabilising red vortex | spectral bloom | portal landing | void fold | strongest; clear portal identity |
| Warm Detonation | high-resolution fuse burst | broad warm blast | detonation | ember trail | strong common style |
| Frostbite | contained frost nova | crystalline freeze | early freeze | bubbles dissipate | strong, but longest approved style |
| Inferno | rotating fire | rising column/hot centre | central blast | flame resolves | distinct from Warm Detonation |
| Void Collapse | red vortex | violet implosion | collapse | infinity afterimage compresses | strong epic style |
| Radiant Claim | golden pillar | solar ring | bright expansion | spectral finish | clean, less forceful |
| Earthshaker | ground rupture | hard shock | ground impact | warm seal | strongest physical style |
| Spellbound | long spell charge | arcane parry/projectile | projectile release | orb fades | readable after scale correction; slightly busy |
| Cosmic Bloom | blue nebula | spectral core | outward bloom | infinity afterimage | attractive but overlaps Void's cosmic language |
| Blue Nova | blue-fire coil | frost/electric core | electric finish | quick fade | distinct mixed-element identity |
| Solar Shatter | tightening ring | two-position shrapnel break | shatter | radiant seal | strongest spatial choreography |
| Acid Rain | falling droplet | acid pool splash | splash | bubbling residue | playful, projectile travel is abstract |
| Glitch Takeover | blocked portal is skipped | infinity/electric corruption | glitch cue | electric fade | weak until portal license is verified; blocked from production |
| Flower Power | radiant seed | spectral/nebula bloom | soft expansion | starlight resolves | strongest playful style |
| Lucky Duck | blocked duck is skipped | happy/radiant beat | radiant cue | reaction fades | identity depends on blocked art; blocked from production |

The closest pairs are Radiant Claim/Solar Shatter, Void Collapse/Cosmic Bloom, and Warm Detonation/Inferno. Their revised timing, spatial placement, and endings keep them more than recolors: pillar vs shrapnel, inward collapse vs outward bloom, and compact blast vs rotating/rising flame. Glitch Takeover overlaps Arcane Portal and remains blocked; Lucky Duck loses its defining asset under the license gate.

## Recommended initial six

1. Thunderstrike
2. Arcane Portal
3. Frostbite
4. Earthshaker
5. Solar Shatter
6. Flower Power

This set covers electric, portal, ice, physical, solar, and playful identities; every selected style is fully release-approved and none depends on a blocked optional asset.

## Residual release checks

- Perform a 10-15 minute repeated-capture soak on one representative low-memory Android device and one iPhone while observing native heap, GPU memory, frame pacing, and thermals.
- Resolve or formally accept the broader repository dependency audit separately from this FX change. `npm audit --omit=dev` currently reports 37 findings (2 critical, 19 high, 15 moderate, 1 low), led by transitive `tar`/`shell-quote` and Expo/Metro/React Native toolchain advisories. The suggested umbrella fixes require incompatible major framework changes, so they were not auto-applied during this scoped animation pass.
