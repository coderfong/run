/**
 * The plaza, and the banner that sends you to it.
 *
 * Four things are pinned here, and each of them has already been wrong once:
 *
 *   * WHO ARRIVES. Arriving at the Crossroads marks everybody seen, and the
 *     refresh behind that carries `seen: true` for the whole list. The screen
 *     therefore latches the newcomers on the FIRST list it is given; if that
 *     ever moves back into an effect, or starts reading the live list, nobody
 *     ever arrives again and the feature silently becomes a static picture.
 *
 *   * THE GREETING IS SKIPPABLE. Newcomers are greeted one at a time behind a
 *     dim (components/paserby/ArrivalCeremony), which is a couple of seconds
 *     each. A tap on the dim has to end the whole thing — without it, a plaza
 *     with a queue in it is a cutscene you cannot get out of.
 *
 *   * YOUR OWN RUNNER IS ON THE SCREEN. The arrival and the high five are both
 *     aimed at it. Without it they are two characters bouncing at nothing.
 *
 *   * THE CARD'S ACTIONS. View and Remove; Report and Block moved one tap in,
 *     onto the runner's own profile. The rule that must not silently break is
 *     that Remove is `hideEncounter` — one-sided and local to your plaza — and
 *     not a block.
 *
 *   * THE BANNER ONLY ANSWERS ITS OWN PUSH. `paserby` also carries high fives,
 *     which are somebody reacting to you rather than somebody turning up.
 */

import React from 'react';
import renderer, { act } from 'react-test-renderer';
import { Alert, Text } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { publishNotificationEvent } from '../src/notifications/events';

let mockCrossroads = { encounters: [], unseen: 0, total: 0, enabled: true };

jest.mock('../src/api/client', () => {
  const named = {
    crossroads: jest.fn(() => Promise.resolve(mockCrossroads)),
    markPaserbySeen: jest.fn(() => Promise.resolve({})),
  };
  return {
    api: new Proxy(named, {
      get: (target, prop) =>
        target[prop] || (target[prop] = jest.fn(() => Promise.resolve({}))),
    }),
    ApiError: class ApiError extends Error {},
    API_BASE: 'http://test',
  };
});

jest.mock('../src/api/cache', () => ({
  fetchAndCache: jest.fn((_key, fetcher) => fetcher()),
  getCached: jest.fn(() => undefined),
  setCached: jest.fn(),
  markAttempt: jest.fn(),
  touchedAt: jest.fn(() => 0),
  subscribeCached: jest.fn(() => jest.fn()),
  invalidate: jest.fn(),
}));

jest.mock('../src/state/avatar', () => ({
  useAvatar: () => ({ equipped: { face: 'smile' }, rankKey: 'wood' }),
}));
jest.mock('../src/state/profile', () => ({
  useProfile: () => ({
    profile: { crossroadsIntroSeen: true },
    loading: false,
    completeCrossroadsIntro: jest.fn(),
  }),
}));
jest.mock('../src/utils/runnerAssetPreload', () => ({ preloadRunnerAssets: jest.fn() }));

import { api } from '../src/api/client';
import CrossroadsScreen from '../src/screens/CrossroadsScreen';
import { CrossroadsAlertHost, setAtCrossroads } from '../src/components/CrossroadsAlert';
import CharacterRig from '../src/components/character/CharacterRig';
import ArrivalSpotlight from '../src/components/paserby/ArrivalCeremony';
import { crossroadsWaitingLine } from '../src/config/paserby';

const navigation = {
  navigate: jest.fn(),
  goBack: jest.fn(),
  canGoBack: () => true,
  addListener: jest.fn(() => jest.fn()),
  removeListener: jest.fn(),
  isFocused: () => true,
  setOptions: jest.fn(),
  getParent: () => ({ goBack: jest.fn(), navigate: jest.fn() }),
};

const encounter = (over = {}) => ({
  id: 'e1',
  user_id: 'u2',
  username: 'someone',
  avatar: {},
  level: 3,
  rank_key: 'wood',
  when: 'This week',
  times_crossed: 1,
  familiarity: 'crossed_paths',
  familiarity_label: 'Crossed Paths',
  seen: true,
  high_fived: false,
  high_five_received: false,
  ...over,
});

// The plaza measures itself before it draws anybody — `plazaPoint` needs the
// box the scene was laid out in. Nothing has a layout under react-test-renderer,
// so it has to be handed one.
function layOut(tree, width = 390, height = 700) {
  const layers = tree.root.findAll(
    (n) => typeof n.type === 'string' && typeof n.props.onLayout === 'function',
    { deep: true }
  );
  act(() => {
    layers.forEach((layer) =>
      layer.props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height } } })
    );
  });
}

async function mount() {
  let tree;
  await act(async () => {
    tree = renderer.create(
      <NavigationContext.Provider value={navigation}>
        <CrossroadsScreen navigation={navigation} />
      </NavigationContext.Provider>
    );
  });
  layOut(tree);
  return tree;
}

// The nearest node that can be pressed for a given accessibility label. Both
// the character and the sheet's buttons carry one, and the label is the only
// stable handle on either — the plaza has no rows and no test ids.
const pressable = (tree, label) =>
  tree.root.findAll((n) => n.props.accessibilityLabel === label && n.props.onPress, {
    deep: true,
  })[0];

const textsOf = (tree) =>
  tree.root.findAllByType(Text, { deep: true }).map((n) =>
    (Array.isArray(n.props.children) ? n.props.children : [n.props.children])
      .filter((c) => typeof c === 'string')
      .join('')
  );

describe('the Crossroads plaza', () => {
  beforeEach(() => {
    mockCrossroads = { encounters: [], unseen: 0, total: 0, enabled: true };
    jest.clearAllMocks();
  });

  it('renders an empty plaza with your own runner already standing in it', async () => {
    const tree = await mount();
    // One rig, and it is yours: the square is empty but the place is not.
    expect(tree.root.findAllByType(CharacterRig).length).toBe(1);
    act(() => tree.unmount());
  });

  it('keeps drawing the newcomers even after the list says they have been seen', async () => {
    mockCrossroads = {
      encounters: [encounter({ id: 'new', seen: false }), encounter({ id: 'old', seen: true })],
      unseen: 1,
      total: 2,
      enabled: true,
    };
    const tree = await mount();
    // Two visitors plus you.
    expect(tree.root.findAllByType(CharacterRig).length).toBe(3);

    // Now the refresh lands with everything marked seen — which is exactly what
    // opening this screen causes. The arrival set is latched, so this must not
    // change who is on the plaza or how they got there.
    mockCrossroads = {
      encounters: [encounter({ id: 'new', seen: true }), encounter({ id: 'old', seen: true })],
      unseen: 0,
      total: 2,
      enabled: true,
    };
    await act(async () => {});
    expect(tree.root.findAllByType(CharacterRig).length).toBe(3);
    act(() => tree.unmount());
  });

  it('dims the plaza for newcomers, and gives up the whole ceremony on one tap', async () => {
    mockCrossroads = {
      encounters: [
        encounter({ id: 'a', seen: false }),
        encounter({ id: 'b', seen: false }),
        encounter({ id: 'c', seen: true }),
      ],
      unseen: 2,
      total: 3,
      enabled: true,
    };
    const tree = await mount();
    const dim = () => tree.root.findAllByType(ArrivalSpotlight)[0];

    // Somebody is arriving, so the rest of the square is under the wash.
    expect(dim().props.on).toBe(true);

    // One tap ends it — every runner still queued is simply standing there.
    await act(async () => pressable(tree, 'Skip the arrivals').props.onPress());
    expect(dim().props.on).toBe(false);
    act(() => tree.unmount());
  }, 30000);

  it('offers View and Remove on a runner, and Remove hides rather than blocks', async () => {
    mockCrossroads = {
      encounters: [encounter({ username: 'nextdoor' })],
      unseen: 0,
      total: 1,
      enabled: true,
    };
    const tree = await mount();

    // Tap the character. The whole runner is the control — there is no row.
    const person = pressable(tree, 'nextdoor, Crossed Paths');
    await act(async () => person.props.onPress());

    const labels = textsOf(tree);
    expect(labels).toContain('View runner');
    expect(labels).toContain('Remove');
    // Both of these are one tap further in now, on the runner's own profile.
    expect(labels).not.toContain('Report');
    expect(labels).not.toContain('Block');

    // Removing confirms, then hides. It must never reach for a block: this is
    // "not in my plaza", not "never speak to me again".
    const alerted = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await act(async () => pressable(tree, 'Remove').props.onPress());
    const buttons = alerted.mock.calls.at(-1)[2];
    await act(async () => buttons.find((b) => b.text === 'Remove').onPress());
    expect(api.hideEncounter).toHaveBeenCalledWith('e1');
    expect(api.blockUser).not.toHaveBeenCalled();
    alerted.mockRestore();
    act(() => tree.unmount());
    // Mounting the plaza means mounting a rig per visitor plus the sheet's own
    // bust, each of which is a stack of image layers. Slow, not hanging.
  }, 30000);
});

describe('the arrival banner', () => {
  const push = (data) => {
    act(() => publishNotificationEvent({ ...data, data }));
  };

  beforeEach(() => {
    jest.clearAllMocks();
    // The plaza sets this while it is on screen, and it is module state — a
    // case above that left its tree mounted would otherwise silence the banner
    // here for reasons that have nothing to do with the banner.
    setAtCrossroads(false);
  });

  it('says the same sentence the server pushed, and opens the plaza', async () => {
    const onOpen = jest.fn();
    let tree;
    await act(async () => {
      tree = renderer.create(<CrossroadsAlertHost onOpen={onOpen} />);
    });
    expect(tree.toJSON()).toBeNull();

    push({ category: 'paserby', kind: 'paserby_arrival', count: 2 });
    expect(textsOf(tree)).toContain(crossroadsWaitingLine(2));

    act(() => pressable(tree, crossroadsWaitingLine(2)).props.onPress());
    expect(onOpen).toHaveBeenCalled();
    act(() => tree.unmount());
  });

  it('ignores a high five, which rides the same category', async () => {
    let tree;
    await act(async () => {
      tree = renderer.create(<CrossroadsAlertHost onOpen={jest.fn()} />);
    });
    push({ category: 'paserby', kind: 'paserby_high_five' });
    expect(tree.toJSON()).toBeNull();
    push({ category: 'stolen' });
    expect(tree.toJSON()).toBeNull();
    act(() => tree.unmount());
  });
});
