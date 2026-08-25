// Route-level art groups for iOS image-cache warming. Keep large families
// separate: decoding the complete cosmetics catalogue at launch would trade a
// brief visual pop for excessive startup time and memory use.

import { InteractionManager } from 'react-native';
import { ICONS } from '../components/AppIcon';
import { preloadImages } from '../utils/imagePreload';
import { art } from './onboardingArt';
import { SEASON_CATEGORY_ART, SEASON_SCOPE_ART } from './seasonArt';

const present = (sources) => sources.flat(Infinity).filter(Boolean);
const artKeys = (...keys) => keys.map((key) => art(key));

const TAB_ICONS = ['tab-home', 'tab-map', 'tab-record', 'tab-club', 'tab-you']
  .map((key) => ICONS[key]);

// The only art the FIRST frame can possibly show: the loading mascot, the tab
// bar, and the signed-out hero. This is the set launch is allowed to wait on —
// the wider startup family below warms behind the app once it is on screen.
export const CRITICAL_IMAGE_ASSETS = present([
  ...TAB_ICONS,
  require('../../assets/art/loading.png'),
  require('../../assets/art/auth-hero.png'),
]);

export const STARTUP_IMAGE_ASSETS = present([
  ...TAB_ICONS,
  ICONS.bell,
  ICONS.energy,
  require('../../assets/art/loading.png'),
  require('../../assets/art/auth-hero.png'),
  require('../../assets/art/season-banner.png'),
  require('../../assets/art/card-clubs.png'),
  require('../../assets/art/card-solo.png'),
  require('../../assets/art/club-crew.png'),
  artKeys('headerClub', 'profileBanner', 'profileBannerDark'),
]);

const SCREEN_IMAGE_ASSETS = {
  SharedIcons: present(Object.values(ICONS)),
  Home: present([
    ...TAB_ICONS,
    ICONS.bell,
    ICONS.energy,
    require('../../assets/art/season-banner.png'),
    require('../../assets/art/card-clubs.png'),
    require('../../assets/art/card-solo.png'),
    require('../../assets/art/empty-runs.png'),
    artKeys('railPass', 'railShop'),
  ]),
  Club: present([
    require('../../assets/art/club-crew.png'),
    require('../../assets/art/empty-club.png'),
    artKeys('headerClub'),
  ]),
  Map: present([
    ICONS.layers,
    ICONS.locate,
    ICONS['map-pin'],
    ICONS.route,
  ]),
  You: present([
    artKeys('profileBanner', 'profileBannerDark', 'proCrew'),
    ICONS.customize,
    ICONS.invite,
  ]),
  Season: present([
    Object.values(SEASON_SCOPE_ART).map((entry) => entry.source),
    Object.values(SEASON_CATEGORY_ART).map((entry) => entry.source),
  ]),
  Progression: present([
    artKeys(
      'passBanner',
      'stampClaimed',
      'diamondLocked',
      'diamondReached',
      'diamondCurrent',
      'diamondPro',
      'chipLocked',
      'chipLockedPro',
      'chipClaimed',
      'crestPro'
    ),
  ]),
  Shop: present([
    ICONS.coin,
    ICONS['coin-pouch'],
    ICONS['coin-sack'],
    ICONS['coin-chest'],
    ICONS['coin-vault'],
    // The per-rarity crates used to be warmed here for the reward reveal a
    // purchase opens. That reveal draws the animated gift box now, so warming
    // them was four decodes for art nothing renders.
    ICONS.sparkles,
  ]),
  Record: present([
    ICONS.locate,
    ICONS.pause,
    ICONS.play,
    ICONS.route,
    ICONS.timer,
  ]),
  AvatarStudio: present([
    artKeys('profileBanner', 'stage'),
    ICONS.randomize,
  ]),
  // Both pages draw one cut-out on a flat `panel` header. The full-bleed
  // headerPasers/headerRivals squares they used to show are no longer rendered
  // by either screen, so warming them would be two decodes for nothing.
  Pasers: present([artKeys('panelPasers')]),
  Rivals: present([artKeys('panelRivals')]),
  // The plaza is warmed with the Crossroads header because the two arrive
  // together in practice: the reveal that opens the plaza is also what puts a
  // badge on the rail, and a backdrop that decodes while it is fading in is
  // exactly the pop this warming exists to remove.
  Crossroads: present([artKeys('panelCrossroads', 'paserbyPlaza', 'pitStopCloudBand')]),
  Notifications: present([
    require('../../assets/art/empty-notifications.png'),
  ]),
  Leaderboard: present([
    require('../../assets/art/empty-leaderboard.png'),
  ]),
  Onboarding: present([
    artKeys(
      'claim',
      'clans',
      'safety',
      'energy',
      'pasers',
      'rewards',
      'leaderboard',
      'cutName',
      'cutBirthday',
      'cutReady',
      'stage',
      'proHero'
    ),
  ]),
};

export function assetsForScreens(names) {
  const list = Array.isArray(names) ? names : [names];
  return present(list.map((name) => SCREEN_IMAGE_ASSETS[name] || []));
}

export function preloadCriticalImages() {
  return preloadImages(CRITICAL_IMAGE_ASSETS);
}

export function preloadStartupImages() {
  return preloadImages(STARTUP_IMAGE_ASSETS);
}

export function preloadScreenImages(names) {
  return preloadImages(assetsForScreens(names));
}

export function preloadScreenImagesAfterInteractions(names) {
  const queue = Array.isArray(names) ? names : [names];
  let cancelled = false;
  const task = InteractionManager.runAfterInteractions(async () => {
    // Keep each screen's images parallel, but move screen groups through the
    // decoder one at a time so background warming cannot create its own frame
    // hitch on older iPhones.
    for (const name of queue) {
      if (cancelled) return;
      await preloadScreenImages(name);
    }
  });

  return () => {
    cancelled = true;
    task.cancel?.();
  };
}
