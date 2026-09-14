// Lottie effects used by repeatable gameplay events.
//
// Every event has a dedicated, original shape-only composition. Nothing here
// reuses the older animated WebPs or forces unrelated events through one
// generic burst. The production brief documents how to art-direct upgrades
// without changing screen logic.

export const LOTTIE_ANIMATIONS = {
  runStart: { source: require('../../assets/lottie/run-start-burst.json'), duration: 970 },
  routeHead: { source: require('../../assets/lottie/route-head-loop.json'), duration: 1200, loop: true },
  kilometre: { source: require('../../assets/lottie/kilometre-split.json'), duration: 1130 },
  claimReady: { source: require('../../assets/lottie/claim-ready.json'), duration: 1370 },
  rivalEntry: { source: require('../../assets/lottie/rival-entry.json'), duration: 1070 },
  captureImpact: { source: require('../../assets/lottie/capture-impact.json'), duration: 900 },
  bombBlast: { source: require('../../assets/lottie/bomb-blast.json'), duration: 1130 },
  energySpend: { source: require('../../assets/lottie/energy-spend.json'), duration: 870 },
  energyGain: { source: require('../../assets/lottie/energy-gain.json'), duration: 970 },
  kudos: { source: require('../../assets/lottie/fx-kudos-burst.json'), duration: 950 },
  streakStamp: { source: require('../../assets/lottie/fx-streak-ignite.json'), duration: 1200 },
  rankUp: { source: require('../../assets/lottie/rank-up.json'), duration: 1100 },
  levelUpArrow: { source: require('../../assets/lottie/level-up-arrow.json'), duration: 1100 },
  clubProgress: { source: require('../../assets/lottie/club-goal-progress.json'), duration: 870 },
  clubComplete: { source: require('../../assets/lottie/club-goal-complete.json'), duration: 1600 },
};

export function lottieSpec(name) {
  return LOTTIE_ANIMATIONS[name] || null;
}
