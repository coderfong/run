// Territory intelligence — the map's PRO overlays, and the honesty rule.
//
// THE RULE: A LAYER MAY ONLY EXIST IF THE DATA FOR IT ALREADY EXISTS.
//
// It would be very easy to ship seven beautiful overlays by inventing five of
// them — a "contest heat" that is really just area, a "threat level" that is
// really `Math.random()` smoothed. Every one of those would look convincing,
// and every one would be a lie sold for money. A runner who pays for
// intelligence and then plans a real run around a made-up number has been
// defrauded, not upsold.
//
// So each layer below declares its `source` — the exact field on the
// /map-polygons response it reads — and `available`. A layer whose data the
// backend does not yet return is DECLARED, so the UI contract is real and the
// gap is visible in code, but it renders NOTHING and says so on the sheet.
// See docs/PRO_BACKEND.md for what each unavailable one needs.
//
// EVERY FIELD USED HERE IS SERVER COMPUTED. `freshness` in particular is the
// decay position PostGIS worked out against the stored expiry — the client
// never recomputes it, because the client does not know the strength formula
// or the life-per-strength setting.

import { GOLD } from '../config/pro';
import { serverTime } from '../utils/time';

// Below this share of life remaining, land is close enough to going that it is
// worth telling somebody about. Matches the three-day framing the run insights
// endpoint already uses (backend/app/routes/insights.py, AT_RISK_DAYS) closely
// enough to not contradict it on screen.
export const AT_RISK_FRESHNESS = 0.25;

// A plot is a "stronghold" when it is BOTH strong and defended. Either alone
// is common; together is the thing actually worth avoiding.
export const STRONGHOLD_STRENGTH = 1.5;
export const STRONGHOLD_DEFENDERS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Age of a territory in days, from the server's `created_at`. */
export function ageDays(territory, now = Date.now()) {
  const raw = territory?.created_at;
  if (!raw) return null;
  const at = serverTime(raw);
  if (!Number.isFinite(at)) return null;
  return Math.max(0, (now - at) / DAY_MS);
}

/**
 * The layer catalogue.
 *
 * `match(territory, ctx)` decides membership. `ctx` carries `{ userId }`.
 * `pro: false` layers are what the board has always shown and stay free.
 */
export const LAYERS = [
  // --- free -------------------------------------------------------------
  {
    key: 'all',
    label: 'All territory',
    blurb: 'Every claim in view, coloured by club.',
    pro: false,
    available: true,
    source: 'map-polygons',
    match: () => true,
  },
  {
    key: 'mine',
    label: 'Your territory',
    blurb: 'Just the ground you hold.',
    pro: false,
    available: true,
    source: 'map-polygons.user_id',
    tint: null, // uses the player accent, applied by the screen
    match: (t, ctx) => String(t.user_id) === String(ctx.userId),
  },
  {
    key: 'contested',
    label: 'Recently captured',
    blurb: 'Land claimed in the last few days.',
    pro: false,
    available: true,
    source: 'map-polygons.contested',
    tint: '#f97316',
    match: (t) => !!t.contested,
  },

  // --- PRO --------------------------------------------------------------
  {
    key: 'at_risk',
    label: 'Your land at risk',
    blurb: 'Your land that is closest to expiring.',
    pro: true,
    available: true,
    source: 'map-polygons.freshness',
    tint: '#ef4444',
    match: (t, ctx) =>
      String(t.user_id) === String(ctx.userId) &&
      t.freshness != null &&
      t.freshness <= AT_RISK_FRESHNESS,
    // What the sheet says next to the count, built from the same real field.
    summarise: (rows) =>
      rows.length
        ? `${rows.length} ${rows.length === 1 ? 'plot' : 'plots'} under ${Math.round(AT_RISK_FRESHNESS * 100)}% of their life left`
        : 'Nothing of yours is close to expiring in view.',
  },
  {
    key: 'vulnerable',
    label: 'Vulnerable territories',
    blurb: "Other players' land that is weak and close to expiring.",
    pro: true,
    available: true,
    source: 'map-polygons.freshness + strength',
    tint: '#22c55e',
    match: (t, ctx) =>
      String(t.user_id) !== String(ctx.userId) &&
      t.freshness != null &&
      t.freshness <= AT_RISK_FRESHNESS &&
      (t.strength ?? 1) < STRONGHOLD_STRENGTH,
    summarise: (rows) =>
      rows.length
        ? `${rows.length} weakly held ${rows.length === 1 ? 'plot' : 'plots'} in view`
        : 'No weakly held ground in view right now.',
  },
  {
    key: 'strongholds',
    label: 'Enemy strongholds',
    blurb: "Other players' land that is strong and well defended.",
    pro: true,
    available: true,
    source: 'map-polygons.strength + defenders',
    tint: '#a855f7',
    match: (t, ctx) =>
      String(t.user_id) !== String(ctx.userId) &&
      ((t.strength ?? 1) >= STRONGHOLD_STRENGTH ||
        (t.defenders ?? 1) >= STRONGHOLD_DEFENDERS),
    summarise: (rows) =>
      rows.length
        ? `${rows.length} heavily held ${rows.length === 1 ? 'plot' : 'plots'} in view`
        : 'No strongholds in view.',
  },
  {
    key: 'age',
    label: 'Territory age',
    blurb: 'Each claim shaded by how old it is.',
    pro: true,
    available: true,
    source: 'map-polygons.created_at',
    tint: GOLD,
    // Everything with a readable age is in the layer; the SHADE carries the
    // information, not the membership (see `shade` below).
    match: (t) => ageDays(t) != null,
    // 0..1 across a fortnight, which is roughly the life of an undefended
    // claim. Older than that saturates rather than continuing to lighten.
    shade: (t) => Math.min(1, (ageDays(t) ?? 0) / 14),
    summarise: (rows) => {
      const ages = rows.map((r) => ageDays(r)).filter((a) => a != null);
      if (!ages.length) return 'No datable claims in view.';
      const oldest = Math.max(...ages);
      return `Oldest claim in view: ${oldest < 1 ? 'today' : `${Math.round(oldest)} days`}`;
    },
  },

  // --- PRO, declared but NOT AVAILABLE ----------------------------------
  // The UI contract is real so the layer can be switched on the day the
  // endpoint lands. It renders nothing until then and the sheet says why.
  // Do not "temporarily" derive this from area, strength or age: those are
  // different things, and a plausible wrong answer is worse than none.
  {
    key: 'churn',
    label: 'Highly contested',
    blurb: 'Land that has changed hands the most.',
    pro: true,
    available: false,
    // The data exists in the database (territory_events, migration 0038) but
    // /map-polygons does not aggregate or return it. See docs/PRO_BACKEND.md.
    source: 'territory_events.owner_changes (NOT RETURNED BY /map-polygons)',
    requires: 'GET /map-polygons → territory.owner_changes:int',
    tint: '#ec4899',
    match: () => false,
  },
];

export const PRO_LAYERS = LAYERS.filter((l) => l.pro);
export const FREE_LAYERS = LAYERS.filter((l) => !l.pro);

export function layerByKey(key) {
  return LAYERS.find((l) => l.key === key) || LAYERS[0];
}

/**
 * Territories belonging to a layer, in the order the sheet should list them.
 *
 * An unavailable layer returns nothing, always — that is the mechanism that
 * makes the honesty rule structural rather than a comment somebody has to
 * remember to obey.
 */
export function territoriesForLayer(layer, territories, ctx) {
  if (!layer?.available) return [];
  return (territories || []).filter((t) => layer.match(t, ctx || {}));
}

/**
 * The highlight overlay for a layer, as a Mapbox FeatureCollection.
 *
 * Reuses the ring extraction and the per-feature `strokeColor` convention the
 * contested outline already established, so this needs no new native layer
 * component — GameMap's ContestedOutline draws it.
 */
export function layerFeatureCollection(layer, territories, ctx, ringsOf) {
  const rows = territoriesForLayer(layer, territories, ctx);
  const features = [];
  for (const t of rows) {
    const shade = layer.shade ? layer.shade(t) : 1;
    ringsOf(t).forEach((ring, index) => {
      const coords = ring.map(([lon, lat]) => [lon, lat]);
      if (
        coords.length &&
        (coords[0][0] !== coords[coords.length - 1][0] ||
          coords[0][1] !== coords[coords.length - 1][1])
      ) {
        coords.push(coords[0]);
      }
      features.push({
        type: 'Feature',
        id: `${layer.key}-${t.id}-${index}`,
        geometry: { type: 'Polygon', coordinates: [coords] },
        properties: {
          territoryId: t.id,
          strokeColor: layer.tint || '#ffffff',
          // 0.35..1 so even the freshest claim on the age layer is visible;
          // a stroke at 0 opacity reads as a bug, not as information.
          shade: 0.35 + 0.65 * shade,
        },
      });
    });
  }
  return { type: 'FeatureCollection', features };
}
