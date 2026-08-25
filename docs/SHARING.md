# Sharing a run — Instagram Stories and the system sheet

Added 2026-08-05. What the Share button on the post-run screen does now, and
the two things only you can finish.

## What ships

`ResultScreen`'s Share button no longer screenshots the on-screen recap card.
It opens **`RunShareSheet`** (`frontend/src/components/share/`), which is the
Strava-shaped flow:

1. **One shape: the story** — 9:16, exported 1080×1920. There is no format
   picker.

   A 1:1 "Post" sat beside it until **2026-08-17**, and it went on the user's
   call: this card exists to land in a story as a sticker. The square was never
   the same picture at a different crop either — the safe areas, the route
   column and the stat block are all measured against the story's height, so the
   square quietly re-cut every one of them and shipped a second layout nobody
   was tuning. `SHARE_FORMATS` is a single `SHARE_FORMAT` now, and every other
   destination (Save, Copy, More) gets that same story-shaped PNG.
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
3. **Customise it** — under the preview. **The three that change how the card
   LOOKS are PASER PRO** (2026-08-24): Accent, Placement and Stats each carry
   the gold padlock, dim to 0.4 and open the paywall on a tap. What is on the
   card — the route, the runner, the flip — stays free, and so does previewing
   any of it. See "What PRO buys" below.
   * **Accent** *(PRO)* — the clan colour first, then eight swatches (including
     ink, for a bright story). Drives the territory number, the route's end dot,
     the wordmark badge and the trail decorations.
   * **Placement** *(PRO)* — Left / Centre / Right, and on the rebuilt card it
     is the LAYOUT rather than the rag. Left and right stand the numbers down
     that side with the route and the runner in the column opposite; centre is
     the older stacked shape, route in a band across the top with the numbers
     under it. Which side matters on a story: the runner puts the numbers where
     their own face is not.

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
   * **On the card** *(free)* — Route, Runner, Flip, in one row because they are
     one question and none of them is a look. The runner is the PASER mark
     wearing the player's head, feet on the end dot of their own route (the one
     point on the card that means something), clamped so a run that finished
     high or low doesn't put it through the numbers; with Route off it stands
     centred in the space the route would have had. **On by default** since
     2026-08-17. See "The runner on the route".

     Route used to be a chip inside the Stats row. It was moved out on
     2026-08-24 for one reason: the moment the metrics went PRO, the padlock
     over that row took the route and the runner with it, and "you cannot take
     your own avatar off your own card" is not a thing worth selling.
   * **Stats** *(PRO)* — chips for every metric the run actually has (Distance,
     Pace, Time, Elev gain, Best km, Avg speed, Territory). Bounded at one
     minimum and six maximum: zero leaves a hole the runner cannot see, and
     seven is more rows than the type can shrink for with anywhere left to draw
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

### What PRO buys

**Free gets a finished card.** Three numbers — distance, pace, time — the route,
the runner, the clan's own colour, and every destination. Nothing about it is
crippled and most runners will post it untouched. What PASER PRO buys is making
it *yours*: **your colour** (Accent), **your side of the story** (Placement),
**your numbers** (Stats).

The line moved here on 2026-08-24. It was Accent and Placement only, with the
metrics free; the card's redesign is what moved it, because the default card
became good enough to give away whole.

Not gated, and deliberately: **the route and the runner** (they decide what the
card *shows*, not how it looks), and **previewing anything** — including the PRO
*styles*, which are gated on EXPORT instead, in one place, in `perform()`. A
paywall sprung at the moment of posting would be the worst possible place for
one, so the sheet says so in a line under the Style row rather than leaving
somebody to find out at the last step.

Mechanically it is the `Row` component's `locked` / `onLockedPress` pair — the
AvatarStudio padlock pattern: a gold `Lock` and a PRO tag on the label, controls
dimmed to 0.4 behind `pointerEvents="none"`, and one full-row `Pressable` over
the top that opens `openPaywall('share')`. The gate is `!isPro && canShowPro`,
so subscribers and builds with no store see **no dead padlocks at all**.
`__tests__/shareProGating.test.js` pins exactly which rows are locked, because
adding a control to the wrong row silently either gives away something meant to
be sold or, much worse, locks something meant to be free.


### The card

**Three things: numbers, route, wordmark — side by side.** The numbers stack
one per line down one column at poster size; the route and the runner stand in
the column opposite, overlapping them vertically; the wordmark badge sits under
the numbers. Everything is sized off `u = width / 360`, so one component serves
the small preview and the 1080-wide export.

**Rebuilt 2026-08-24** to the reference card the user brought: three enormous
figures down one side, the run's own graphic beside them. What changed and why:

* **The labels came off the numbers.** A 12pt `DISTANCE` over every figure was
  the last caption-shaped furniture on the card and it carried no information —
  `18.23 KM` is not mistakable for a duration. It cost a third of the height of
  every row and put a second type size on a card whose whole idea is one
  enormous one. The **unit** says what the number is, raised at the shoulder
  like a superscript (`UNIT_RATIO`, `UNIT_RISE`). `bestKm`'s unit became
  `best/km` in the same pass, because a bare `/km` under a pace of `/km` is two
  numbers claiming to be the same thing.
* **The 2×2 grid became one column.** A pair of poster-sized figures sharing a
  line is two numbers neither of which is readable, so `perRow` is gone and
  `stats.length` is the row count.
* **ONE SIZE for every number**, chosen so the widest string fits the column:
  `VALUE_FOR_ROWS[n]` is the ceiling and `typeW / widestEm` is what the column
  can actually take. `fit` is still on underneath as the backstop, but it is no
  longer the mechanism — letting each number shrink on its own drew a card with
  three different type sizes in one column, which is the one thing the poster
  layout must not do. `emWidth` is a rough per-glyph table for Anton; it only
  has to be about right.
* **The route moved beside the numbers.** `ART_COL` (46% of the inner width) ×
  `ART_ASPECT`, sat at `ART_RISE` of the band so the two columns OVERLAP
  vertically — without that overlap the card reads as two unrelated things on a
  diagonal. `projectGroups` now runs against the column's box, so `route.end` is
  in the column's pixels and the runner's `left` has to add `artLeft` back in.
  Centre keeps the old full-width band capped at `ROUTE_SHARE`.
* **Default stats went to distance / pace / time.** Pace was off by default when
  four numbers meant a 2×2 block; stacked at poster size, four is a column that
  runs into the route, and elevation is the least interesting thing anybody ran.
  Territory is a chip rather than a default.
* **The wordmark matches the numbers.** Same face (Anton) as before, but 15u
  tracked out to 2.6u read as a wider typeface under a column of condensed
  figures — letterspacing that heavy un-condenses a narrow poster face. 18u at
  1.2u instead, and `signatureH` was re-measured to 46u to match. Keep the two
  in step.
* **The runner no longer needs a route.** With the route off it stands centred
  in the space the route would have had, at `width * 0.42`. It used to keep
  standing where the INVISIBLE line ended, which is why the "Character
  showcase" preset — `showRoute: false, showCharacter: true` — rendered no
  character at all.

Kept from the 2026-08-16 simplification: no territory headline (area is a
number, not an eyebrow over a 44pt km²), no brand mark beside the wordmark, the
route capped rather than owning the card, and the accent colouring the
**Territory** value — the one number Strava does not have.

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

#### Standing it on the line

Two numbers, both exported from `LogoRunner` and both properties of the ART, not
of the layout:

* `MARK_FEET` — how far DOWN the box the soles are. The component stands the
  figure on the floor of its own square, so this is 1 and the card can treat the
  box bottom as the soles.
* `MARK_FOOT` — how far ACROSS the box the planted foot is. **This is not 0.5.**
  The mark is a running pose: the ink along the bottom edge of
  `paser-mark-body.png` is centred at 0.67 of its width, which becomes ~0.63 of
  the `LogoRunner` box once `BODY_SCALE` is folded in.

The card anchored the figure by the middle of its box until **2026-08-17**,
which stood the runner a clear stride to the RIGHT of wherever the run actually
ended — the complaint was that the mascot was not on the route, and it was not.
It anchors on `MARK_FOOT` now, mirrored when **Flip** is on because flip mirrors
the whole box. Since 2026-08-24 the route is drawn in its own COLUMN rather than
across the card, so `route.end` is in the column's pixels and `artLeft` has to
be added back on — leave it out and the figure stands one column's width away
from its own line, which is the same bug in a new place.

Both fractions were measured off the asset's own alpha channel (the contact
patch centroid is stable from the bottom 1% to the bottom 5% of the image).
**Re-measure them if the mark art ever changes** — they are the only thing
holding the figure to the line.

### Export rules

* **Transparent, always.** The card paints nothing, the PNG keeps its alpha, and
  `socialShare` passes it as `stickerImage` rather than `backgroundImage`.
  `CARD_INK` is still handed to Instagram as the canvas colour behind the
  sticker, until the runner picks their own background.
* **Type carries its own legibility.** There is no scrim to hide behind: the
  numbers wear a real ink OUTLINE (`OutlinedText`, eight offset copies) and the
  small units a hard zero-blur drop, because a translucent mark vanishes on a
  pale sky or a white t-shirt. Everything is fully opaque (`TONE`).
* **Measured, not hand-tuned.** The stat block is sized from its own type
  (`stats.length × lineH`), the wordmark from a hand-measured `signatureH`, and
  the route column gets what those two leave — which is what stops a long route
  being drawn straight through the numbers. The type in turn is sized from the
  column: one `valueSize` for the whole block, taken from the widest string in
  it.
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
| Card content clipped | A block grew past its estimate in `RunShareCard` (`statsH` / `signatureH`) — `signatureH` is a hand-measured constant, so it goes stale whenever the wordmark's size or padding changes |
| The runner stands beside its own route | `artLeft` missing from the runner's `left` — `route.end` is in the art column's pixels, not the card's |
| Numbers at different sizes down the column | `valueSize` is meant to be one number for the whole block; per-string `fit` shrinking means the block was not sized to its widest member |
| A padlock on a control that should be free | Check `__tests__/shareProGating.test.js` — free is route, runner, flip; PRO is accent, placement, stats |
| A metric has no chip | `availableStats` dropped it — the run has no honest number for it (elevation needs altitude, which only runs recorded after 2026-08-06 carry) |
| An old run offers fewer stats than a fresh one | The feed ships distance, duration and area and nothing else — elevation, best km and average speed exist only on the post-run path |
| No Trail row on the sheet | Expected — `TRAIL_DECORATIONS_ENABLED` is false. That is the switch, not a bug |
| No trail decorations on a very short route (once switched on) | There is always at least one; if there are none at all the route itself did not draw (fewer than two usable points) |
| A trail decoration lying on its side | Nothing should ever follow the route's tangent — check `lean` in `TRAIL_DECORATIONS`, it is a tilt in degrees, not a rotation |
| No Save / Copy button | A binary built before `expo-media-library` / `expo-clipboard` |
| Preview looks like grey squares | That is the transparency checkerboard, not the card |
