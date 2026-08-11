import { EFFECT_ANCHOR } from './effectTypes';

export const DEFAULT_EFFECT_SAFE_INSETS = Object.freeze({ top: 16, right: 16, bottom: 16, left: 16 });

function finitePoint(point) {
  return point && Number.isFinite(point.x) && Number.isFinite(point.y);
}

function center(bounds) {
  return { x: (bounds?.width || 0) / 2, y: (bounds?.height || 0) / 2 };
}

function safeRect(bounds, insets = DEFAULT_EFFECT_SAFE_INSETS) {
  const width = Math.max(0, bounds?.width || 0);
  const height = Math.max(0, bounds?.height || 0);
  const left = Math.min(width / 2, Math.max(0, insets.left || 0));
  const right = Math.max(left, width - Math.max(0, insets.right || 0));
  const top = Math.min(height / 2, Math.max(0, insets.top || 0));
  const bottom = Math.max(top, height - Math.max(0, insets.bottom || 0));
  return { left, right, top, bottom, width: right - left, height: bottom - top };
}

function clampPoint(point, rect) {
  const fallback = { x: (rect.left + rect.right) / 2, y: (rect.top + rect.bottom) / 2 };
  const value = finitePoint(point) ? point : fallback;
  return {
    x: Math.min(rect.right, Math.max(rect.left, value.x)),
    y: Math.min(rect.bottom, Math.max(rect.top, value.y)),
  };
}

function pointInRing(point, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i, i += 1) {
    const a = ring[i];
    const b = ring[j];
    if (!finitePoint(a) || !finitePoint(b)) continue;
    const crosses = (a.y > point.y) !== (b.y > point.y)
      && point.x < ((b.x - a.x) * (point.y - a.y)) / ((b.y - a.y) || Number.EPSILON) + a.x;
    if (crosses) inside = !inside;
  }
  return inside;
}

export function pointInTerritory(point, rings = []) {
  if (!finitePoint(point)) return false;
  // SVG uses even-odd fill for these projected rings. Matching that rule also
  // keeps a visual anchor out of any hole without changing backend geometry.
  return rings.reduce((inside, ring) => (
    ring?.length >= 3 && pointInRing(point, ring) ? !inside : inside
  ), false);
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  if (!dx && !dy) return Math.hypot(point.x - a.x, point.y - a.y);
  const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy)));
  return Math.hypot(point.x - (a.x + t * dx), point.y - (a.y + t * dy));
}

function boundaryDistance(point, rings, rect) {
  let distance = Math.min(
    point.x - rect.left,
    rect.right - point.x,
    point.y - rect.top,
    rect.bottom - point.y
  );
  rings.forEach((ring) => {
    for (let index = 0; index < ring.length; index += 1) {
      const a = ring[index];
      const b = ring[(index + 1) % ring.length];
      if (finitePoint(a) && finitePoint(b)) distance = Math.min(distance, distanceToSegment(point, a, b));
    }
  });
  return Math.max(0, distance);
}

function polygonCentroid(ring) {
  let area = 0;
  let x = 0;
  let y = 0;
  for (let index = 0; index < ring.length; index += 1) {
    const a = ring[index];
    const b = ring[(index + 1) % ring.length];
    if (!finitePoint(a) || !finitePoint(b)) continue;
    const cross = a.x * b.y - b.x * a.y;
    area += cross;
    x += (a.x + b.x) * cross;
    y += (a.y + b.y) * cross;
  }
  return Math.abs(area) > Number.EPSILON
    ? { x: x / (3 * area), y: y / (3 * area) }
    : null;
}

function territoryBounds(rings = []) {
  const points = flattenTerritoryRings(rings).filter(finitePoint);
  if (!points.length) return null;
  return points.reduce((box, point) => ({
    left: Math.min(box.left, point.x), right: Math.max(box.right, point.x),
    top: Math.min(box.top, point.y), bottom: Math.max(box.bottom, point.y),
  }), { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity });
}

function visualCandidates(rings, bounds, insets, preferred) {
  const rect = safeRect(bounds, insets);
  const box = territoryBounds(rings);
  if (!box || !rect.width || !rect.height) return { rect, candidates: [] };
  const sample = {
    left: Math.max(rect.left, box.left), right: Math.min(rect.right, box.right),
    top: Math.max(rect.top, box.top), bottom: Math.min(rect.bottom, box.bottom),
  };
  if (sample.right < sample.left || sample.bottom < sample.top) return { rect, candidates: [] };

  const seeds = [preferred, {
    x: (sample.left + sample.right) / 2,
    y: (sample.top + sample.bottom) / 2,
  }, ...rings.map(polygonCentroid)].filter(finitePoint);
  const candidates = [];
  const add = (point) => {
    if (
      point.x < rect.left || point.x > rect.right || point.y < rect.top || point.y > rect.bottom
      || !pointInTerritory(point, rings)
    ) return;
    candidates.push({ point, score: boundaryDistance(point, rings, rect) });
  };
  seeds.forEach(add);

  // A bounded grid plus local refinement is a small, deterministic polylabel
  // approximation. Unlike a geometric centroid it remains inside concave land
  // and favours the broadest visible part of a partly off-screen polygon.
  const divisions = 22;
  for (let row = 0; row <= divisions; row += 1) {
    for (let column = 0; column <= divisions; column += 1) {
      add({
        x: sample.left + (sample.right - sample.left) * (column / divisions),
        y: sample.top + (sample.bottom - sample.top) * (row / divisions),
      });
    }
  }
  let best = candidates.reduce((winner, candidate) => (
    !winner || candidate.score > winner.score ? candidate : winner
  ), null);
  if (best) {
    let stepX = Math.max(1, (sample.right - sample.left) / divisions / 2);
    let stepY = Math.max(1, (sample.bottom - sample.top) / divisions / 2);
    for (let pass = 0; pass < 3; pass += 1) {
      for (let y = -1; y <= 1; y += 1) {
        for (let x = -1; x <= 1; x += 1) add({ x: best.point.x + x * stepX, y: best.point.y + y * stepY });
      }
      best = candidates.reduce((winner, candidate) => (
        !winner || candidate.score > winner.score ? candidate : winner
      ), best);
      stepX /= 2;
      stepY /= 2;
    }
  }
  return { rect, candidates };
}

function seededIndex(seed, length) {
  let hash = 2166136261;
  for (const char of String(seed || 'paser')) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash) % Math.max(1, length);
}

export function territoryVisualCenter(rings, bounds, insets, preferred) {
  return buildTerritoryAnchorModel({ rings, bounds, insets, preferred }).visual;
}

export function buildTerritoryAnchorModel({ rings = [], bounds, insets, preferred } = {}) {
  const { rect, candidates } = visualCandidates(rings, bounds, insets, preferred);
  const winner = candidates.reduce((best, candidate) => (
    !best || candidate.score > best.score ? candidate : best
  ), null);
  const visual = winner?.point || clampPoint(preferred || center(bounds), rect);
  const viable = candidates.filter((candidate) => candidate.score > 0).sort((a, b) => b.score - a.score);
  return { rect, visual, viable };
}

export function resolveEffectAnchor(anchor, context = {}, seed = '') {
  const bounds = context.bounds || context.mapBounds || { width: 0, height: 0 };
  const rect = safeRect(bounds, context.safeInsets);
  const screenCenter = clampPoint(center(bounds), rect);
  const claimPoint = finitePoint(context.claimPoint) ? context.claimPoint : screenCenter;
  const rings = context.territoryRings || [];
  const points = context.territoryPoints || flattenTerritoryRings(rings);
  const rawTerritoryCenter = finitePoint(context.territoryCenter) ? context.territoryCenter : claimPoint;
  const model = context.anchorModel || buildTerritoryAnchorModel({
    rings, bounds, insets: context.safeInsets, preferred: rawTerritoryCenter,
  });
  const visual = model.visual;
  const character = context.characterRect;
  const viable = model.viable;

  let resolved;
  switch (anchor) {
    case EFFECT_ANCHOR.TERRITORY_CENTER:
      resolved = rawTerritoryCenter;
      break;
    case EFFECT_ANCHOR.TERRITORY_VISUAL_CENTER:
      resolved = visual;
      break;
    case EFFECT_ANCHOR.TERRITORY_TOP:
      resolved = (viable.slice(0, 30).sort((a, b) => a.point.y - b.point.y)[0] || {}).point || visual;
      break;
    case EFFECT_ANCHOR.TERRITORY_BOTTOM:
      resolved = (viable.slice(0, 30).sort((a, b) => b.point.y - a.point.y)[0] || {}).point || visual;
      break;
    case EFFECT_ANCHOR.CHARACTER_HEAD:
      resolved = character ? { x: character.x + character.width / 2, y: character.y } : visual;
      break;
    case EFFECT_ANCHOR.CHARACTER_FEET:
      resolved = character ? { x: character.x + character.width / 2, y: character.y + character.height } : visual;
      break;
    case EFFECT_ANCHOR.CHARACTER_CENTER:
      resolved = character ? { x: character.x + character.width / 2, y: character.y + character.height / 2 } : visual;
      break;
    case EFFECT_ANCHOR.RANDOM_TERRITORY_POINT: {
      const choices = viable.slice(0, Math.min(16, viable.length));
      resolved = choices.length ? choices[seededIndex(seed, choices.length)].point : visual;
      break;
    }
    case EFFECT_ANCHOR.SCREEN_TOP:
      resolved = { x: screenCenter.x, y: rect.top };
      break;
    case EFFECT_ANCHOR.SCREEN_BOTTOM:
      resolved = { x: screenCenter.x, y: rect.bottom };
      break;
    case EFFECT_ANCHOR.MAP_CENTER:
    case EFFECT_ANCHOR.SCREEN_CENTER:
    default:
      resolved = screenCenter;
  }
  return clampPoint(resolved, rect);
}

export function fitEffectInBounds(anchor, requestedSize, bounds, safeInsets, visualScale = 1) {
  const rect = safeRect(bounds, safeInsets);
  const scale = Number.isFinite(visualScale) && visualScale > 0 ? visualScale : 1;
  const maxRendered = Math.max(1, Math.min(rect.width, rect.height));
  const size = Math.max(1, Math.min(Number.isFinite(requestedSize) ? requestedSize : 200, maxRendered / scale));
  const half = (size * scale) / 2;
  const layoutRect = {
    left: Math.min(rect.right, rect.left + half),
    right: Math.max(rect.left + half, rect.right - half),
    top: Math.min(rect.bottom, rect.top + half),
    bottom: Math.max(rect.top + half, rect.bottom - half),
  };
  return { anchor: clampPoint(anchor, layoutRect), size };
}

export function flattenTerritoryRings(rings = []) {
  return rings.flatMap((ring) => ring || []);
}
