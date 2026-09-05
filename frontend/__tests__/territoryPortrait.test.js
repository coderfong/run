import { ringCentroid } from '../src/components/territoryBoard';

test('a portrait stays inside a U-shaped territory instead of its empty centre', () => {
  const ring = [[0,0],[6,0],[6,6],[5,6],[5,1],[1,1],[1,6],[0,6],[0,0]];
  for (const points of [ring, [...ring].reverse()]) {
    const p = ringCentroid(points);
    expect(p.longitude >= 0 && p.longitude <= 6 && p.latitude >= 0 && p.latitude <= 6).toBe(true);
    expect(p.latitude <= 1 || p.longitude <= 1 || p.longitude >= 5).toBe(true);
  }
});

test('a regular territory keeps its central portrait', () => {
  expect(ringCentroid([[0,0],[2,0],[2,2],[0,2]])).toEqual({ latitude: 1, longitude: 1 });
  expect(ringCentroid([])).toBeNull();
});
