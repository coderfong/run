# Sharing a run — Instagram Stories and the system sheet

Added 2026-08-05. What the Share button on the post-run screen does now, and
the two things only you can finish.

## What ships

`ResultScreen`'s Share button no longer screenshots the on-screen recap card.
It opens **`RunShareSheet`** (`frontend/src/components/share/`), which is the
Strava-shaped flow:

1. **Pick a format** — Story (9:16, exported 1080×1920) or Post (1:1, exported
   1080×1080).
2. **The background is always transparent.** There is no chooser. The card
   exports as a TRANSPARENT PNG and goes to Instagram as a *sticker*, so the
   runner's own selfie or photo — whatever they already put on the story — is
   the background and the stats sit over it.

   The colour wash and the photo picker were both **removed on 2026-08-11**.
   Either one covers the story it is posted onto, so the runner ends up with two
   backgrounds fighting for the same 9:16, and a sticker with an opaque
   background is just a background they have to drag around. `expo-image-picker`
   came out of `package.json` and `app.json` with the photo option, and the
   photo-library *read* permission string went with it.

   The preview sits on a **checkerboard** with a `TRANSPARENT` badge on it,
   because "transparent" and "dark grey" look identical against a dark screen.
3. **Customise it** — under the preview:
   * **Accent** — the clan colour first, then eight swatches (including ink,
     for a bright story). Drives the territory number, the route's end dot and
     the trail decorations.
   * **Text** — Left / Centre / Right, applied to the headline, the stat grid
     and the signature together.

     The type itself is **WHITE and only white**. There used to be a Light /
     Dark switch here, and it was **cut on 2026-08-16**: ink type on a card with
     no background of its own is the one combination that disappears, and it was
     never what anyone wanted over their own story. `RunShareCard`'s `TONE` is a
     constant now rather than a function of a prop.
   * **Trail** — **PARKED, NOT SHIPPED.** Built and then switched off the same
     day (2026-08-16). `TRAIL_DECORATIONS_ENABLED` in
     `src/config/releaseFeatures.js` is `false`, so the row is not on the sheet
     and `RunShareCard` pins `trail` to none whatever a caller passes — no
     screen can put decorations back on a card by passing a prop. Nothing else
     was removed: the module, the shapes, the placement maths, its tests and
     this section are all live, so flipping that one switch brings the whole
     thing back. The rest of this bullet describes it as built.

     What grows along the route: None, Flowers, Grass, Mushrooms, Trees,
     Hearts, Stars, Fire, Sparks.

     **Side on, not from above.** The route is a map, but these are not map
     symbols lying flat on it — each one is rooted on the line and sprouts UP
     out of it, drawn the way you would see it standing there. That is the whole
     look, and four things carry it:

     * nothing turns to the direction of travel (things grow towards the top of
       the card whichever way the runner was going), only a few degrees of lean;
     * a contact shadow where each one meets the line;
     * `depth` — 0 at the top of the route band, 1 at the bottom — sizes each
       mark, so the ones nearer the bottom of the card are bigger;
     * they are drawn nearest-last, so a mark lower down the card overlaps
       whatever is standing behind it.

     Spacing is by DISTANCE along the line (a recorder samples by time, so index
     spacing bunches everything up wherever the runner slowed down), between the
     start and finish dots only, and the lean is seeded off the index rather
     than `Math.random` — capture re-renders the card, so a random one would
     post a different picture than the preview.

     Everything lives in `components/share/trailDecorations.js`: each shape is
     react-native-svg primitives drawn in the same box — 20 wide, 20 tall, ORIGIN
     AT ITS ROOT, growing from y=0 up to y=-20 — so a new decoration is a shape
     in that box plus a line in `TRAIL_DECORATIONS`. The accent colours the part
     meant to be looked at (bloom, cap, flame) while stems, canopies and trunks
     keep natural colours: a green-stemmed flower in the runner's colour reads
     as a flower, an entirely pink one reads as a smudge. Every piece carries its
     own dark edge for the same reason the route carries its under stroke. The
     row hides itself when Route is switched off.
   * **Runner** — the PASER mark wearing the player's head, feet on the end dot
     of their own route (the one point on the card that means something),
     clamped so a run that finished high or low doesn't put it through the
     headline or the numbers. On/Off and Flip. See "The runner on the route".
   * **Stats** — chips for every metric the run actually has (Distance, Pace,
     Time, Elev gain, Best km, Avg speed, Territory), plus a Route toggle.
     Bounded at one minimum and six maximum: zero leaves a hole the runner
     cannot see, and seven is three rows of numbers with nowhere left to draw
     the route.
4. **See the real card** — the preview *is* the component that gets captured
   (`RunShareCard`), so there is no gap between preview and post.
5. **Send it** — a "Share to" row of round destinations, the shape every share
   sheet already uses:
   * **Instagram Story** — a direct handoff. Instagram opens with the card as a
     *sticker* over whatever background the runner picks. Only offered when
     Instagram is actually there.
   * **Save** — the camera roll (`expo-media-library`, add-only permission,
     asked at the moment of use).
   * **Copy** — the card on the clipboard AS AN IMAGE (`expo-clipboard`), ready
     to paste into a message or a story. Captured straight to base64 rather than
     read back off disk.
   * **More** — the system share sheet (Instagram feed, WhatsApp, Messages,
     Files). Always available, and every Instagram failure falls back to it
     rather than dead-ending.

   Save and Copy hide themselves when their native module is missing, the same
   way the Instagram button does, so an older binary simply shows fewer targets.

   There is no **Copy Link**: a run has no public URL to link to.

### Two ways in

* **Straight after a run** — `ResultScreen` mounts the sheet as its last stage
  (Continue), with everything the recorder measured.
* **From a run card on Home** (added 2026-08-16) — the share icon on a feed
  row, **your own runs only**: the card that gets posted carries your avatar and
  says the ground was claimed, which is not a thing to hand somebody about a run
  they did not do. It pushes `RunShare` (`screens/RunShareScreen.js`), a
  boundaried **root-stack full screen modal** — at the root for the same reason
  Record is, so the sheet is not posted from under the tab bar, and a screen
  rather than a `<Modal>` inside the card because the sheet positions itself
  with `absoluteFill` and `captureRef` has to rasterise the preview.

  Nothing is fetched between the tap and the preview: the feed row already
  carries the route, the rings and the numbers. Two consequences —
  the feed's `path` is `[lon, lat]` PAIRS where the recorder's is
  `{latitude, longitude}` objects (`RunShareCard` takes either, see `lonLat`),
  and a feed row knows nothing about elevation, best km or average speed, so an
  old run offers fewer stat chips than a fresh one.

### The card

**Three things: a route, four numbers, the wordmark.** Layout, top to bottom:
the route in a capped band, then Distance / Time / Elev gain / Territory as
**two above and two below**, then **PASER on its own** — no brand mark beside
it. Everything is sized off `u = width / 360`, so one component serves the small
preview and the 1080-wide export.

**Simplified 2026-08-16** to that Strava shape. What changed and why:

* **The territory headline came off** — an eyebrow (`TERRITORY CLAIMED`) over a
  44pt km². Area is one of the four numbers now, so the ground is said once
  instead of twice, and losing that block is most of what makes the card read as
  simple.
* **The route stopped owning the card.** It used to take every pixel the fixed
  furniture did not; it now gets a band capped at `ROUTE_SHARE` (30% of the
  card, both formats) and centred in the space between the safe area and the
  numbers. Whatever is left over stays empty, which on a sticker is not waste —
  it is the runner's own story showing through.
* **Each pair of numbers gets its own line.** `STAT_ROW_U` went 46 → 62: at 46
  the first row's digits ran into the second row's label and the four read as
  one block of text. The extra row height IS the gap, so the cells stay
  top-aligned and the space falls between the rows.
* **The brand mark came off the signature**, leaving the wordmark alone. That
  makes `SHARE_DEBUG_FLAGS.paserMark` dead; the key stays because those flags
  persist on device.
* **Pace is off by default**, because four numbers is a 2×2 block and five is a
  block with a gap in it. It is still a chip.
* **The runner figure starts off** (see "The runner on the route" — the code and
  the control both stay).
* The accent moved with the headline: it now colours the **Territory** value,
  the one number Strava does not have, so the swatches still drive something.

No handle, no clan, no date, no "took N km² from X". On somebody's own story the
handle is already at the top of the screen, the date is today, and the steal
line was a sentence of app copy in the middle of a picture.

Rules it has to keep:

* **Capture-safe.** No map view, no animation — a GL surface or a
  still-decoding image is what turns `captureRef` output into a black
  rectangle. The route is an SVG polyline, the claimed ground an SVG polygon,
  both projected through one shared bounding box so they stay registered, and
  the mark is a plain RN `Image`.

  The one exception is the head on the route runner, which comes from
  `CharacterRig` and so draws through `expo-image` (every other screen needs
  that cache). It is safe here for a reason rather than by construction: the rig
  is mounted in the preview the whole time the runner is choosing controls, so
  its layers are long decoded by the time anyone taps Share. The capture also
  waits 400 ms instead of 60 ms when the runner is on. If a card ever exports
  with a headless logo, that is the thing to suspect, and the fix is a
  `plainImages` prop on the rig rather than a longer sleep.

### The runner on the route

`components/character/LogoRunner.js` — the PASER mark running, wearing the
player's own head.

The mark already IS the running pose the brand owns: side-on, front knee up,
trailing leg extended. Nothing cut out of the front-facing paper doll gets near
it, and the attempts are worth recording so nobody repeats them:

* **Tilting the standing figure** reads as falling over, not running.
* **Cutting the doll into limbs and rotating them** (a jointed rig off the
  joints measured in the ink layer) does produce a real stride, and it even
  carries clothes if the layers are flattened before cutting. But the arms have
  nowhere to go on a front-facing body — swung in they hide behind the torso,
  swung out past ~28° they rise into the shoulder-cap piece that hides the arm
  cuts — and every cut edge lacks an outline, so knees and elbows show seams.
  That component was built, evaluated and removed.

So: the body is the logo and only the head is swapped, which is where face,
hair and headwear live anyway. `assets/brand/paser-mark-body.png` is the mark
with its own head removed — a separate connected shape in the art, so the cut is
exact — and `scripts/make-brand-mark.py` prints the head-slot fractions that
`LogoRunner` must stay in step with. Re-run it if the icon ever changes.

The head is drawn by `CharacterRig` in **`headOnly` mode** — the plate, face,
hair, glasses and hat, and nothing below the jaw.

It used to be the whole rig behind a rectangular window cut at the chin, and
that window was a bug (fixed 2026-08-11): the shirt collar and the shoulders sit
at y=214 of the 640-tall body art, *above* the chin at y=226, so they came
through under the jaw as a pale band, and any hair past the jaw was sliced off
in the same straight line. Skipping those layers at the source means there is
nothing to hide, so there is no window and nothing gets a flat edge — long hair
simply falls over the mark the way it falls over the doll. The 12° tilt now
carries an explicit `transformOrigin` at the head centre, because without the
window the box it rotates in is the rig's full height.

**The trade:** the player's cosmetics below the neck no longer show on the card.
Their face, hair and headwear do.

### Export rules

* **Transparent, always.** The card paints nothing, the PNG keeps its alpha, and
  `socialShare` passes it as `stickerImage` rather than `backgroundImage`.
  `CARD_INK` is still handed to Instagram as the canvas colour behind the
  sticker, until the runner picks their own background.
* **Type carries its own legibility.** There is no scrim to hide behind: the
  labels are fully opaque and the shadow is tight enough to read as an outline
  (`TONE`), because a translucent label vanishes on a pale sky or a white
  t-shirt.
* **Measured, not hand-tuned.** The route band takes the height the headline,
  stats, brag line and signature do not — that is what stops a long route being
  drawn straight through the numbers. The stat grid is two-up because a single
  row of four collided the moment a pace and a duration sat side by side.
* Story content stays inside Instagram's chrome (top 11%, bottom 15%).

## 1. A new native build is required — **YOU**

Instagram Stories sharing uses **`react-native-share`**; Save uses
**`expo-media-library`** and Copy uses **`expo-clipboard`**. All three ship
native code (plus `expo-build-properties` for the react-native-share config
plugin). The two added on 2026-08-11 arrived AFTER the 2.1.0 build, so a binary
built before them simply shows fewer destinations in the "Share to" row —
`socialShare.js` requires each lazily and reports "not available" instead of
throwing.

* `expo.version` was bumped **2.0.0 → 2.1.0** for this, and the
  `runtimeVersion` policy is `appVersion` — so 2.1.0 updates can only land on a
  2.1.0 binary. **Do not `eas update` this onto 2.0.0**: those binaries have no
  `RNShare` native module.
* The native build has NOT been run yet. Pick a profile from `eas.json`:

  ```bash
  cd frontend && npx eas-cli build --platform ios --profile development
  ```

  (`preview` for an internal build against Render, `production` for the store.)
  Heads-up: the `development` profile's `EXPO_PUBLIC_API_BASE` is a cloudflared
  tunnel URL that goes stale between sessions — point it at your current tunnel
  or at Render before building.
* Rebuild the local dev client too, or the Instagram button simply never
  appears on device.

The JS is written so an old binary degrades instead of crashing:
`react-native-share` resolves its native module with `getEnforcing` (which
throws at *import* time), so `src/utils/socialShare.js` requires it lazily and
treats the throw as "no Instagram destination" — the sheet then shows a plain
Share button wired to the system sheet.

The config plugin entry in `app.json` adds what the platforms need:

```json
["react-native-share", {
  "ios": ["instagram", "instagram-stories"],
  "android": ["com.instagram.android"]
}]
```

iOS gets `instagram` / `instagram-stories` in `LSApplicationQueriesSchemes`
(without them `Linking.canOpenURL` always says no, so the button would stay
hidden); Android gets the package into `<queries>` for the installed check.

## 2. Set a Meta app id — **YOU**

Instagram's story API wants the sharing app identified via `source_application`.
The documented value is a **Facebook (Meta) app id**:

1. <https://developers.facebook.com/apps> → create an app (type: Consumer).
2. Copy the App ID.
3. Put it in `app.json` → `expo.extra.facebookAppId`.

Until that is set, `socialShare.js` sends the bundle id (`com.pacerrun.app`),
which Instagram currently accepts for the background-image flow — but a real
app id is the supported path and the thing to fix if stories start bouncing.
No Meta SDK, no login, nothing else to configure.

## Where to look when it misbehaves

| Symptom | Cause |
| --- | --- |
| No Instagram button at all | Instagram not installed, or a binary built before `react-native-share` |
| "Opening the share sheet instead…" | Instagram refused the story — usually the app id, or an Android intent knocked back |
| Blank/black exported image | Something non-static got into `RunShareCard` (map, `expo-image`, animation) |
| Card content clipped | A text block grew past its estimate in `RunShareCard` (`headH` / `statsH` / `signatureH`) |
| A metric has no chip | `availableStats` dropped it — the run has no honest number for it (elevation needs altitude, which only runs recorded after 2026-08-06 carry) |
| An old run offers fewer stats than a fresh one | The feed ships distance, duration and area and nothing else — elevation, best km and average speed exist only on the post-run path |
| No Trail row on the sheet | Expected — `TRAIL_DECORATIONS_ENABLED` is false. That is the switch, not a bug |
| No trail decorations on a very short route (once switched on) | There is always at least one; if there are none at all the route itself did not draw (fewer than two usable points) |
| A trail decoration lying on its side | Nothing should ever follow the route's tangent — check `lean` in `TRAIL_DECORATIONS`, it is a tilt in degrees, not a rotation |
| No Save / Copy button | A binary built before `expo-media-library` / `expo-clipboard` |
| Preview looks like grey squares | That is the transparency checkerboard, not the card |
