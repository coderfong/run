/**
 * The run card shows the claim ON THE MAP.
 *
 * It used to be a drawing on blank paper, which made every run the same pale
 * squiggle in a white box: you could not tell a park loop from a housing
 * estate, or your own street from a city you have never run in. The shape only
 * means something against the ground it was cut from.
 *
 * What is worth holding down here is not how it looks but the two things that
 * make it honest: the snapshot is framed on the SAME centre and zoom the claim
 * is drawn with (fit them apart and the outline slides off its own streets),
 * and the card still has a picture when there is no map to be had.
 */

let mockMapReady = true;
jest.mock('../src/config/map', () => ({
  get MAP_READY() { return mockMapReady; },
  MAPBOX_PUBLIC_TOKEN: 'pk.test-token',
  styleForTheme: (theme) => (theme === 'dark'
    ? 'mapbox://styles/mapbox/dark-v11'
    : 'mapbox://styles/mapbox/light-v11'),
  MAP_SURFACE: { light: '#F0ECE6', dark: '#1A1B1D' },
  mapSurfaceFor: (theme) => (theme === 'dark' ? '#1A1B1D' : '#F0ECE6'),
}));

import renderer, { act } from 'react-test-renderer';
import React from 'react';

import RouteThumb from '../src/components/RouteThumb';
import { Image as UIImage } from '../src/ui/image';
import { fitLayersToBox, staticMapUrl } from '../src/utils/staticMercator';
import { THUMB_H, THUMB_W } from '../src/components/RouteThumb';

const ring = [
  [103.8198, 1.3521],
  [103.8210, 1.3521],
  [103.8210, 1.3533],
  [103.8198, 1.3533],
];
const path = [
  [103.8201, 1.3524],
  [103.8206, 1.3527],
  [103.8208, 1.3530],
];

const draw = (props = {}) => {
  let tree;
  act(() => {
    tree = renderer.create(
      <RouteThumb id="run-1" rings={[ring]} path={path} color="#2563eb" {...props} />
    );
  });
  return tree;
};

const snapshots = (tree) => tree.root
  .findAllByType(UIImage)
  .map((node) => node.props.source?.uri)
  .filter(Boolean);

beforeEach(() => { mockMapReady = true; });

describe('the run card', () => {
  it('puts a map snapshot under the claim', () => {
    const urls = snapshots(draw());
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('api.mapbox.com/styles/v1/mapbox/light-v11/static/');
  });

  it('frames that snapshot on exactly the ground the claim is drawn over', () => {
    // The same fit the component does, computed here independently: if the two
    // ever drift the outline stops sitting on its own streets.
    const view = fitLayersToBox([ring, path], { width: THUMB_W, height: THUMB_H }, { padding: 10, maxZoom: 17 });
    const expected = staticMapUrl({
      ...view, width: THUMB_W, height: THUMB_H, scheme: 'light', detail: 2,
    });
    expect(snapshots(draw())[0]).toBe(expected);
  });

  it('keeps the drawing when there is no map to put under it', () => {
    mockMapReady = false;
    const tree = draw();
    expect(snapshots(tree)).toHaveLength(0);
    // The claim itself is still there — the paper drawing is the fallback, not
    // an empty box.
    expect(tree.root.findAllByType('RNSVGPath').length).toBeGreaterThan(0);
  });

  it('falls back to paper when the snapshot itself fails', () => {
    const tree = draw();
    const image = tree.root.findAllByType(UIImage)[0];
    act(() => { image.props.onError(); });

    expect(snapshots(tree)).toHaveLength(0);
    expect(tree.root.findAllByType('RNSVGPath').length).toBeGreaterThan(0);
  });

  it('draws the square picture behind the claim, not beside it', () => {
    // The snapshot fills the frame; the claim is drawn over it. If the image
    // ever lands as a sibling ABOVE the drawing it hides the thing the card is
    // about, and nothing else in the tree would notice.
    const tree = draw();
    const image = tree.root.findAllByType(UIImage)[0];
    const flattened = Array.isArray(image.props.style) ? image.props.style : [image.props.style];
    expect(flattened.some((s) => s && s.position === 'absolute')).toBe(true);
  });
});
