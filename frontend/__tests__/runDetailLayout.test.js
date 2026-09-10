const React = require('react');
const renderer = require('react-test-renderer');
const { act } = renderer;
const { Text, ScrollView } = require('react-native');
const mockFit = jest.fn();
const mockRun = {
  id: 1, username: 'Runner', is_you: true, created_at: '2026-09-09T14:27:53Z',
  distance_m: 10290, duration_s: 3552, closed_loop: true, area_m2: 630000,
  path: [[103.8, 1.3], [103.9, 1.4], [103.85, 1.35]],
  splits: Array.from({ length: 11 }, (_, i) => ({ km: i + 1, seconds: 345 + i })),
};
jest.mock('../src/hooks/useQuery', () => ({ useQuery: (key) => ({ data: key.endsWith(':comments') ? [] : mockRun, loading: false }) }));
jest.mock('@react-navigation/native', () => ({ useIsFocused: () => true }));
jest.mock('../src/components/home/HomeBackdrop', () => 'HomeBackdrop');
jest.mock('../src/components/TerritoryInsights', () => 'TerritoryInsights');
jest.mock('../src/components/ProLock', () => ({ ProLockedSection: ({ children }) => children }));
jest.mock('../src/components/GameMap', () => {
  const React = require('react');
  return { __esModule: true, MAP_READY: true,
    default: React.forwardRef((props, ref) => { React.useImperativeHandle(ref, () => ({ fitToPoints: mockFit })); return React.createElement('GameMap', props); }),
    TerritoryFill: 'TerritoryFill', Trail: 'Trail', MapPoint: 'MapPoint' };
});
const RunDetail = require('../src/screens/RunDetailScreen').default;
function mount() {
  let tree;
  act(() => { tree = renderer.create(<RunDetail navigation={{ goBack: jest.fn() }} route={{ params: { runId: 1 } }} />); });
  return tree;
}
function press(tree, label) {
  const node = tree.root.findAll((n) => n.props.accessibilityLabel === label && typeof n.props.onPress === 'function')[0];
  act(() => node.props.onPress());
}
function texts(tree) { return tree.root.findAllByType(Text).map(n => String(n.props.children)); }
test('fits all route points after the map is ready and laid out', () => {
  const tree = mount();
  act(() => tree.root.findByType('GameMap').props.onReady());
  const layout = tree.root.findAll(n => n.props.onLayout && n.props.style?.some?.(s => s?.minHeight === 100))[0];
  act(() => layout.props.onLayout({ nativeEvent: { layout: { width: 350, height: 250 } } }));
  expect(mockFit).toHaveBeenCalledWith(mockRun.path.map(([longitude, latitude]) => ({ longitude, latitude })), 32, 0);
  expect(tree.root.findByType('GameMap').props.constrainToCity).toBe(false);
  act(() => tree.unmount());
});
test('summary has no scrolling or reactions and all splits remain reachable', () => {
  const tree = mount();
  expect(tree.root.findAllByType(ScrollView)).toHaveLength(0);
  expect(tree.root.findAll(n => /Give kudos|Remove kudos|React to/.test(n.props.accessibilityLabel || ''))).toHaveLength(0);
  expect(texts(tree).join(' ')).toContain('1, km');
  press(tree, 'Next splits');
  press(tree, 'Next splits');
  expect(texts(tree).join(' ')).toContain('11, km');
  expect(texts(tree)).not.toContain('1, km');
  act(() => tree.unmount());
});
