// Transparent, cross-platform motion accents used at earned moments.
//
// The supplied sources are VP8 WebM files. Native iOS playback does not
// reliably support that container, so the checked-in assets are animated
// WebP derivatives. expo-image renders animated WebP on Android, iOS and web
// while preserving the transparent background.

export const GAME_ANIMATIONS = {
  medal: {
    source: require('../../assets/animations/medal.webp'),
    duration: 5000,
    aspect: 1,
  },
  trophy: {
    source: require('../../assets/animations/trophy.webp'),
    duration: 4000,
    aspect: 1,
  },
  levelUpBronze: {
    source: require('../../assets/animations/level-up-bronze.webp'),
    duration: 1670,
    aspect: 1,
  },
  // The three supplied "Bubble Explosion" clips decode to the same frames, so
  // they collapse to one asset rather than three copies in the bundle.
  bubbleBurst: {
    source: require('../../assets/animations/bubble-burst.webp'),
    duration: 1370,
    aspect: 2,
  },
  confettiRibbons: {
    source: require('../../assets/animations/confetti-ribbons.webp'),
    duration: 2000,
    aspect: 1,
  },
  victoryRays: {
    source: require('../../assets/animations/victory-rays.webp'),
    duration: 5020,
    aspect: 1,
  },
  shieldSafe: {
    source: require('../../assets/animations/shield-safe.webp'),
    duration: 1470,
    aspect: 1,
  },
  shieldDanger: {
    source: require('../../assets/animations/shield-danger.webp'),
    duration: 2030,
    aspect: 1,
  },
  trophyPodium: {
    source: require('../../assets/animations/trophy-podium.webp'),
    duration: 2370,
    aspect: 1,
  },
  achievementBadge: {
    source: require('../../assets/animations/achievement-badge.webp'),
    duration: 2000,
    aspect: 1,
  },
  coinSpin: {
    source: require('../../assets/animations/coin-spin.webp'),
    duration: 2550,
    aspect: 1,
  },
  sparklesGreen: {
    source: require('../../assets/animations/sparkles-green.webp'),
    duration: 2900,
    aspect: 1,
  },
  sparkleStar: {
    source: require('../../assets/animations/sparkle-star.webp'),
    duration: 2000,
    aspect: 1,
  },
  // RE-KEYED 2026-08-05. This shipped fully opaque — a solid near-black card
  // behind the confetti — so it painted a black square over every reward
  // reveal and every rare shop purchase. Its master tags itself alpha_mode=1
  // but the alpha plane is flat 255, so no decoder flag recovers it; the card
  // is keyed out by brightness in scripts/convert-scene-animations.py ("glow").
  rewardBurst: {
    source: require('../../assets/animations/reward-burst.webp'),
    duration: 1350,
    aspect: 1,
  },
  impactRed: {
    source: require('../../assets/animations/impact-red.webp'),
    duration: 1500,
    aspect: 1,
  },
  confettiBurst: {
    source: require('../../assets/animations/confetti-burst.webp'),
    duration: 1970,
    aspect: 1,
  },
  impactGold: {
    source: require('../../assets/animations/impact-gold.webp'),
    duration: 1500,
    aspect: 1,
  },
  giftPop: {
    source: require('../../assets/animations/gift-pop.webp'),
    duration: 3000,
    aspect: 150 / 84,
  },
  giftBox: {
    source: require('../../assets/animations/gift-box.webp'),
    duration: 1670,
    aspect: 1,
  },
  smokePuff: {
    source: require('../../assets/animations/smoke-puff.webp'),
    duration: 920,
    aspect: 150 / 84,
  },
  locationPulse: {
    source: require('../../assets/animations/location-pulse.webp'),
    duration: 2000,
    aspect: 1,
  },
  wellDoneSparkles: {
    source: require('../../assets/animations/well-done-sparkles.webp'),
    duration: 1570,
    aspect: 150 / 112,
  },
  wellDone: {
    source: require('../../assets/animations/well-done.webp'),
    duration: 1570,
    aspect: 150 / 112,
  },

  // --- scenery -------------------------------------------------------------
  //
  // Everything above is a REACTION: it fires once at an earned moment and is
  // gone. Everything below is FURNITURE, encoded with an infinite loop count so
  // expo-image cycles it natively. Two rules follow from that and neither is
  // optional:
  //
  //   1. `GameAnimation` must NOT be given the `loop` prop for these — that
  //      would remount a clip the decoder is already cycling, mid-cycle.
  //   2. `selfLooping: true` is what makes Reduce Motion hold the first frame
  //      instead of removing the element. A reaction that disappears is a
  //      calmer screen; a shop sign, a bowl of fruit or a row of bottles that
  //      disappears is a missing object.

  // Re-cut to its content by scripts/convert-scene-animations.py, so the badge
  // fills its layout frame instead of floating in a third of it. Re-encoding
  // at the prop rate also stretched the sway from 2870ms to 3500ms, which is
  // the calmer of the two for a sign that hangs in front of everything.
  openSign: {
    source: require('../../assets/animations/open-sign.webp'),
    duration: 3500,
    aspect: 1,
    selfLooping: true,
  },

  // The lightning across the lootbox reveal. Scenery rather than a reaction:
  // it crackles for as long as the reveal is up, so the decoder cycles it and
  // nothing remounts it.
  //
  // BOLTS ONLY — the yellow sunburst its master was drawn on is drawn in SVG
  // by RewardReveal instead, because a full-screen backdrop is the one thing
  // a small raster cannot be (see the `victoryRays` note in that file). Keying
  // the bolts out is also what leaves the supplier's watermark behind with the
  // card it was printed on, so unlike the props below this one is clean.
  //
  // Its Reduce Motion still would be frame one, which is empty — so
  // RewardReveal does not mount it at all when motion is reduced, and the
  // drawn fan carries the backdrop on its own.
  revealLightning: {
    source: require('../../assets/animations/reveal-lightning.webp'),
    duration: 1000,
    aspect: 1400 / 788,
    selfLooping: true,
  },

  // Pit Stop props, placed by the frames in config/pitStop.js. Generated from
  // the supplied masters by scripts/convert-scene-animations.py, which crops
  // each one to its content and trims the repeated cycle out of it — hence
  // the ~3.2s durations against 6.2s sources: most were authored as one cycle
  // played twice, and a self-looping WebP replays whatever it holds.
  // `duration` is informational for a self-looping asset (nothing remounts it
  // on a timer), but keep it honest so the numbers can be trusted.
  //
  // The supplied cocktail and garland clips were converted and then dropped
  // from the scene. Their entries and files are gone; re-running the script
  // for `propCocktail` or `propGarland` brings either back in one command.
  //
  // !! WATERMARKED. All three were supplied as Iconscout PREVIEW downloads and
  // carry "iconscout / Graphiqa Studio" baked across the middle of the
  // subject. They are wired up and correct in every other respect, but they
  // CANNOT GO IN A STORE BUILD as they are — replace the three files with
  // licensed, un-watermarked downloads (same filenames) and nothing else here
  // needs to change.
  // `propBalloons` was here. The balloons are off the scene — the canopy's own
  // bunting is decoration enough — and the entry goes with them, because the
  // entry is what `require`s the file into the bundle. assets/animations still
  // holds prop-balloons.webp; re-adding four lines brings it back.
  propCoconut: {
    source: require('../../assets/animations/prop-coconut.webp'),
    duration: 3167,
    aspect: 1,
    selfLooping: true,
  },
  propSodaBottles: {
    source: require('../../assets/animations/prop-soda-bottles.webp'),
    duration: 6250,
    aspect: 1,
    selfLooping: true,
  },
  propWatermelon: {
    source: require('../../assets/animations/prop-watermelon.webp'),
    duration: 3167,
    aspect: 1,
    selfLooping: true,
  },

  // --- podium badges -------------------------------------------------------
  //
  // The 1st/2nd/3rd stickers on a standings row. Scenery rather than
  // reactions, and for once that is not a stylistic call: a rank badge is the
  // row's rank. It has to be on screen the whole time the row is, it must not
  // replay on a timer while the list scrolls past it, and under Reduce Motion
  // it has to become a still badge rather than vanish and leave rank 1 blank.
  // `selfLooping: true` is what buys all three.
  //
  // These replace the three static PNGs in assets/art/ui (`badge1st` and
  // friends in config/onboardingArt.js). Those files stay — nothing else
  // references them, but they are the fallback if these ever have to come out.
  //
  // !! placeSecond and placeThird carry an iconscout preview watermark across
  // the medal face, exactly like the Pit Stop props above, and cannot go in a
  // store build as they are. Replace assets/animations/place-2nd.webp and
  // place-3rd.webp with licensed downloads (same filenames) and nothing here
  // changes. placeFirst was supplied clean.
  placeFirst: {
    source: require('../../assets/animations/place-1st.webp'),
    duration: 4917,
    aspect: 1,
    selfLooping: true,
  },
  placeSecond: {
    source: require('../../assets/animations/place-2nd.webp'),
    duration: 1000,
    aspect: 1,
    selfLooping: true,
  },
  placeThird: {
    source: require('../../assets/animations/place-3rd.webp'),
    duration: 1000,
    aspect: 1,
    selfLooping: true,
  },
};

export function animationSpec(name) {
  return GAME_ANIMATIONS[name] || null;
}
