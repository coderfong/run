// The territory report under the post-run result card. It used to repeat the
// hero's new ground as its own headline and nest "Your form" in a second box;
// these pin the 2026-09-23 layout: on the result screen the standing leads and
// the hero's figures stay out, and read back later the full summary returns.
const React = require('react');
const renderer = require('react-test-renderer');
const { act } = renderer;
const { Text } = require('react-native');

let mockData = null;
jest.mock('../src/hooks/useQuery', () => ({ useQuery: () => ({ data: mockData, loading: false }) }));
jest.mock('../src/pro/ProProvider', () => ({ useProEntitlement: () => ({ openPaywall: jest.fn() }) }));
jest.mock('../src/components/ProTeaser', () => 'ProTeaser');

const TerritoryInsights = require('../src/components/TerritoryInsights').default;

const base = {
  run_id: 7,
  territory_m2: 380000,
  land_gained_m2: 380000,
  stolen_m2: 0,
  rivals_taken: 0,
  biggest_capture_m2: 380000,
  rivals_held: 0,
  standing_rank: 18,
  standing_field: 387,
};

function render(data, props) {
  mockData = data;
  let tree;
  act(() => { tree = renderer.create(<TerritoryInsights runId={7} {...props} />); });
  const words = tree.root.findAllByType(Text).map((n) => [].concat(n.props.children).join(''));
  act(() => tree.unmount());
  return words;
}

test('on the result screen the standing leads and the hero ground is not repeated', () => {
  const words = render({ ...base, pro: null }, { hideClaimSummary: true });
  expect(words).toContain('Territory report');
  expect(words[words.indexOf('Current standing') + 1]).toBe('18th of 387');
  expect(words).not.toContain('New ground');
  expect(words).not.toContain('Biggest capture');
  expect(words.some((w) => w.includes('0.38'))).toBe(false);
});

test('read back later, the full claim summary is still there', () => {
  const words = render({ ...base, pro: null }, {});
  expect(words).toContain('Land claimed');
  expect(words).toContain('New ground');
  expect(words).toContain('Current standing');
});

test('your form is one flat group with its comparison as a badge', () => {
  const words = render({
    ...base,
    pro: {
      m2_per_km: 74000,
      m2_per_km_30d: 50000,
      claims_30d: 16,
      distance_m_30d: 90000,
      stolen_m2_30d: 1020000,
      at_risk_count: 2,
      at_risk_m2: 93000,
    },
  }, { hideClaimSummary: true });
  for (const w of ['Your form', 'Land per kilometre', 'Above your usual', '16 claims', 'Taken off rivals', 'Expiring soon', '2 plots']) {
    expect(words.join('|')).toContain(w);
  }
});
