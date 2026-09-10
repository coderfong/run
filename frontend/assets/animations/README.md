# Game animations

These are transparent, 20 fps animated WebP derivatives of the supplied VP8
WebMs. They retain alpha, play once by default, and are rendered through
`src/components/GameAnimation.js` so iOS, Android, and web use the same asset.

27 files were supplied; they contain 23 distinct animations. Skipped:
`Untitled filej.webm` (0 bytes), `Bubble Explosion (1).webm` and
`lsDEPLqnAy (1).webm` (byte-identical re-downloads), and `well Done.mp4`
(the same clip as `well Done.webm`, but MP4 carries no alpha channel).

| Supplied file | Catalog key | Placement |
| --- | --- | --- |
| `Medal.webm` | `medal` | Earned profile trophies |
| `Trophy.webm` | `trophy` | Season standings |
| `level-up-bronze.webm` | `levelUpBronze` | Level-up payoff |
| `Bubble Explosion*.webm` | `bubbleBurst` | New- and captured-territory impact |
| `Confetti.webm` | `confettiRibbons` | Onboarding completion |
| `37eJxBDoRU.webm` | `victoryRays` | New-territory victory |
| `o7aO0ywTLK.webm` | `shieldSafe` | Defended/captured territory |
| `Untitled file.webm` | `shieldDanger` | Stolen territory |
| `xcjstsu3NM.webm` | `trophyPodium` | Level-up payoff |
| `AXHplvUUi8.webm` | `achievementBadge` | Personal records |
| `sIWCup1evR.webm` | `coinSpin` | Confirmed shop purchase |
| `z09DggEPah.webm` | `sparklesGreen` | Energy-cap reward |
| `c7uLi5lZqA.webm` | `sparkleStar` | Border/shape reward |
| `GPAn1Jw9go.webm` | `rewardBurst` | Every reward reveal; shop rare-or-better purchase (**re-keyed**, see below) |
| `0uPHk22CA5.webm` | `impactRed` | Stolen-territory impact |
| `AjrFnMOGSc.webm` | `confettiBurst` | Level-up payoff |
| `4j31DE73V2.webm` | `impactGold` | Defended/captured impact |
| `iUWe7cfBIz.webm` | `giftPop` | Lootbox/cosmetic reveal |
| `eVeCaub5e6.webm` | `giftBox` | Lootbox/cosmetic reveal |
| `axgSA7b6vI.webm` | `smokePuff` | Stolen-territory impact |
| `lsDEPLqnAy.webm` | `locationPulse` | Location permission screen |
| `well Done.webm` | `wellDoneSparkles` | Onboarding completion |
| `well Done (1).webm` | `wellDone` | Onboarding completion |

### `rewardBurst` was opaque

The first `reward-burst.webp` shipped with a **flat 255 alpha channel and a
solid near-black card behind the confetti**, so the one asset laid over every
reward reveal painted a black square across the screen. The master tags itself
`alpha_mode=1`, which is why it looked fine on paper — but its alpha plane is
uniformly opaque, so no decoder flag recovers it and the card has to be keyed
out. It now runs through `convert-scene-animations.py` in the `glow` mode added
for it: alpha off the max channel with the colour un-premultiplied back out of
the black, which keeps every particle's soft edge. A connectivity key (`black`)
would have been wrong here — loose confetti has no enclosing outline, so every
piece would have kept a hard black rim.

The black floor matters: this master's card measures a flat max-channel **12**,
not 0, so the key's `lo` sits at 16. Any other black-carded source should have
its floor checked before assuming the default clears it.

## Scenery vs reactions

Everything in the table above is a REACTION: one shot at an earned moment, then
gone. The files below are FURNITURE, encoded with an INFINITE loop count
(`-loop 0`) so the decoder cycles them, and carrying `selfLooping: true` in the
catalogue. That flag tells `GameAnimation` two things — never remount it on a
timer, and under Reduce Motion hold its first frame rather than removing it,
since a shop sign or a bowl of fruit that disappears is a missing object rather
than a calmer screen.

| Supplied file | Catalog key | Size | Placement |
| --- | --- | --- | --- |
| `Open.webm` | `openSign` | 216 KB | Shop — the tent peak, the stall's only signage, drawn LAST |
| `Yellow Lightning Burst.mp4` | `revealLightning` | 84 KB | Lootbox reveal — bolts over the whole screen (**bolts only**, see below) |
| `Coconut Drink.mp4` | `propCoconut` | 223 KB | Shop — counter, far left |
| `Watermelon.mp4` | `propWatermelon` | 148 KB | Shop — counter, in front of the attendant |
| `Soda Drinks.mp4` | `propSodaBottles` | 357 KB | Shop — counter, rides the helper's `presentBeat` |

Between them these retired every drawn prop the counter had — towels, cooler,
gel tray, fruit bowl — plus the painted banner.

Three supplied clips were converted and then cut: `caipirinha-…-6102764.mp4`
(`propCocktail`, the counter got too crowded), `decoration-…-6102767.mp4`
(`propGarland`, the back wall carries no flags now) and
`balloons-…-6102763.mp4` (`propBalloons`, the canopy's own bunting is the
tent's decoration and the balloons neither held stock nor reacted to anything).
Their entries are still in the conversion script, so any of them comes back
with one command. The cocktail and garland `.webp` files are deleted;
`prop-balloons.webp` is still on disk but nothing `require`s it, so it is out
of the bundle.

### `revealLightning` is the bolts, not the clip

`Yellow Lightning Burst.mp4` is a whole background — a rotating gold sunburst
with white bolts cracking across it — and it is the only entry here that was
deliberately taken apart rather than converted.

Shipping it whole meant a full-screen opaque raster: 16:9 art cropped to a
9:19.5 phone, magnified past 3x, four seconds of every pixel on the display.
`RewardReveal` had already learned that with `victoryRays` and drew its ray fan
in SVG instead. So the clip splits the same way. The sunburst is eight
12.8-degree wedges on a 45-degree pitch turning 45 deg/s clockwise, `#FCFD0D`
on `#FDD60C` — four numbers, measured off the master and living in
`RewardReveal.js`, sharp at any screen size for free. Only the bolts come out
of the conversion, as 30 transparent frames (the 4s master is a 1s cycle played
four times), 84 KB.

The key is the `white_on_yellow` mode, and it keys on the **blue channel**.
Yellow has no blue in it: with no bolt on screen the card, its rays and the
supplier's watermark all measure blue ≤ 46, while a bolt is pure white. Neither
of the other modes works — luma barely separates a white stroke from a yellow
card, and connectivity cannot, because the card is the strokes' own background
rather than a region they sit apart from.

**That is also why this one is not watermarked.** It was an Iconscout preview
like the props below, but its `iconscout / Vector Squad` mark is printed on the
background in the background's own hue, so keying the bolts leaves it behind
with the card. The shipped `reveal-lightning.webp` is clean. The props are not,
because their mark sits ON the subject.

`openSign` is the odd one out: it was RE-CUT, not re-converted. Its first pass
kept the master's empty margin, so the badge drew at about a third of its
layout frame. The crop runs over the ALREADY-KEYED asset — see `explode_frames`
in the script for why re-keying `Open.webm` cannot reproduce that alpha.

Four looping decoders share the SHOP screen (`revealLightning` is not one of
them — it belongs to the reveal modal). That is the number to watch if the shop
ever feels heavy on a low-end device; the cheapest lever is `PROP_FPS` in the
conversion script, then dropping a prop, in that order.

**The three remaining Iconscout props are watermarked.** `propCoconut`,
`propWatermelon` and `propSodaBottles` were supplied as PREVIEW downloads and
carry `iconscout / Graphiqa Studio` baked across the middle of the subject.
They are wired up and correct in every other respect, but they cannot go in a
store build as they are. Replace the files under the same names and nothing
else needs to change.

## Podium badges

`placeFirst`, `placeSecond` and `placeThird` are the 1st/2nd/3rd medals on a
standings row (`LeaderboardRow`) and under the three podium columns on the
leaderboard screen. They replaced the static `badge-1st/2nd/3rd.png` stickers;
those files are still in `assets/art/ui` and still registered in
`config/onboardingArt.js`, they are simply no longer what a row draws.

They are **scenery, not reactions**, and that is not a stylistic call: a rank
badge *is* the row's rank. It has to stay on screen for as long as the row does,
it must not replay on a timer while the list scrolls past it, and under Reduce
Motion it has to become a still badge rather than vanish and leave rank 1 blank.
`selfLooping: true` buys all three.

**Frame one has to be a readable badge**, because that is the frame Reduce
Motion holds. Both medal clips are authored spinning and their masters open on
the blank BACK of the disc, so the conversion rotates the finished cycle with
`phase` — free in playback, since a self-looping asset has a seam rather than a
first frame. Anything added here that spins needs the same treatment; check it
by opening frame 0 of the `.webp` rather than by watching it play.

**`placeSecond` and `placeThird` are watermarked**, the same way the three props
above are: Iconscout PREVIEW downloads with the mark baked across the medal
face, where no honest key can leave it behind. They cannot go in a store build
as they are — replace the two files under the same names and re-run the script.
`placeFirst` was supplied clean, as a VP8 WebM that already carried its own
alpha (`mode: "alpha"` — nothing to key).

## Regenerating

`scripts/convert-scene-animations.py` converts every supplied clip in this set,
and is the place the keying decisions are written down. The Iconscout props sit
on a white card, which has to be keyed by CONNECTIVITY rather than by colour: a
global white key punches holes through a balloon highlight, an ice cube and
coconut flesh. Black-backed stock takes the same test inverted.

Not every clip belongs here. The supplied cloud clip was a rigid scroll of a
repeating band, so it ships as a single still frame at
`assets/art/shop/pitstop-cloud-band.png` and `PitStopScene` scrolls it at three
speeds for parallax — one asset instead of three decoders, and 5 KB instead of
1.2 MB.
