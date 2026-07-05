// Per-city configuration. The whole game board is locked to one city at a
// time; the camera is hard-clamped to these bounds everywhere (GameMap sets
// maxBounds + min/max zoom from here). Adding a city later is a data change,
// not a code change.
//
// bounds: [[west, south], [east, north]] in lon/lat (Mapbox order).

export const CITIES = {
  SGP: {
    key: 'SGP',
    label: 'Singapore',
    bounds: [
      [103.55, 1.13], // south-west
      [104.12, 1.5], // north-east
    ],
    center: [103.8198, 1.3521], // lon, lat
    minZoom: 10.5,
    maxZoom: 17,
  },
};

// The active city. Single source of truth for the whole app.
export const ACTIVE_CITY_KEY = 'SGP';

export const activeCity = CITIES[ACTIVE_CITY_KEY];

// Bounds as a {ne, sw} pair for Mapbox <Camera maxBounds>.
export function cityMaxBounds(city = activeCity) {
  const [[w, s], [e, n]] = city.bounds;
  return { ne: [e, n], sw: [w, s] };
}

// Bounds as the {minLon, minLat, maxLon, maxLat} shape the API expects.
export function cityBbox(city = activeCity) {
  const [[w, s], [e, n]] = city.bounds;
  return { minLon: w, minLat: s, maxLon: e, maxLat: n };
}
