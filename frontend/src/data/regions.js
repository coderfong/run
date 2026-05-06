// Singapore split into 5 territory regions for the home-page map.
// Each region is one player "team" the user could join. Polygons are
// rectangular bands chosen so they tile the Singapore bbox without gaps.
//
// bbox: lat 1.16 .. 1.47, lon 103.60 .. 104.05

const N_LAT = 1.40;   // boundary between Central and North
const S_LAT = 1.30;   // boundary between Central and South
const W_LON = 103.78; // boundary between West and Central
const E_LON = 103.92; // boundary between Central and East

const MIN_LAT = 1.16;
const MAX_LAT = 1.47;
const MIN_LON = 103.60;
const MAX_LON = 104.05;

function rect(latLo, latHi, lonLo, lonHi) {
  return [
    { latitude: latLo, longitude: lonLo },
    { latitude: latHi, longitude: lonLo },
    { latitude: latHi, longitude: lonHi },
    { latitude: latLo, longitude: lonHi },
  ];
}

export const SG_REGIONS = [
  {
    key: 'north',
    name: 'North',
    color: '#ef4444',
    coordinates: rect(N_LAT, MAX_LAT, MIN_LON, MAX_LON),
    center: { latitude: (N_LAT + MAX_LAT) / 2, longitude: (MIN_LON + MAX_LON) / 2 },
  },
  {
    key: 'south',
    name: 'South',
    color: '#3b82f6',
    coordinates: rect(MIN_LAT, S_LAT, MIN_LON, MAX_LON),
    center: { latitude: (MIN_LAT + S_LAT) / 2, longitude: (MIN_LON + MAX_LON) / 2 },
  },
  {
    key: 'east',
    name: 'East',
    color: '#22c55e',
    coordinates: rect(S_LAT, N_LAT, E_LON, MAX_LON),
    center: { latitude: (S_LAT + N_LAT) / 2, longitude: (E_LON + MAX_LON) / 2 },
  },
  {
    key: 'west',
    name: 'West',
    color: '#f59e0b',
    coordinates: rect(S_LAT, N_LAT, MIN_LON, W_LON),
    center: { latitude: (S_LAT + N_LAT) / 2, longitude: (MIN_LON + W_LON) / 2 },
  },
  {
    key: 'central',
    name: 'Central',
    color: '#a855f7',
    coordinates: rect(S_LAT, N_LAT, W_LON, E_LON),
    center: { latitude: (S_LAT + N_LAT) / 2, longitude: (W_LON + E_LON) / 2 },
  },
];

export const SG_VIEW_REGION = {
  latitude: (MIN_LAT + MAX_LAT) / 2,
  longitude: (MIN_LON + MAX_LON) / 2,
  latitudeDelta: MAX_LAT - MIN_LAT + 0.05,
  longitudeDelta: MAX_LON - MIN_LON + 0.05,
};

// Stable hash so the same username always lands in the same region.
// Keeps the home map feeling like the user "belongs" to one team.
export function regionForUser(username) {
  const s = String(username || '');
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) >>> 0;
  }
  return SG_REGIONS[h % SG_REGIONS.length];
}

// Bbox helper for /map-polygons calls bound to the Singapore view.
export const SG_BBOX = {
  minLat: MIN_LAT,
  maxLat: MAX_LAT,
  minLon: MIN_LON,
  maxLon: MAX_LON,
};
