// Touching land held by one runner is ONE territory, as far as the board is
// concerned.
//
// THE SEAMS ARE AN ARTEFACT OF HOW A CLAIM LANDS, not of how the land is held.
// When a run overlaps ground its owner already holds, the claim endpoint keeps
// the new footprint as one row and re-inserts what is left of each old plot —
// `ST_Difference(old, footprint)` — as its own row, deliberately: a run's
// footprint has to stay separable so an old solo claim is not promoted under a
// clubmate's later one, and each piece keeps its own expiry, strength and club
// badge. The rows are right. What they draw is not: every remainder shares an
// edge with the claim that cut it, so the board traces that cut at full stroke
// weight and pins a second copy of the same runner's face beside the first.
// A commuter who runs the same road every week ends up as a fan of slivers
// under a stack of identical portraits.
//
// So the merge belongs HERE, in presentation, and not in the table. Same
// runner, same club badge, geometry that touches -> one shape, one outline,
// one portrait. The rows behind it are untouched, and because each merged
// holding carries its largest member's id, a tap still resolves to a real
// territory and its sheet still shows a real claim.
//
// PIECES THAT MEET AT A SINGLE POINT ARE NOT MERGED. `union` treats a corner
// touch as two components, which is the reading we want: land pinched to a
// point is two plots that happen to graze, not one holding.
//
// THE CLIPPER ONLY EVER SEES PLOTS THAT COULD TOUCH. A full viewport is up to
// two thousand claims and this runs again every time the camera settles on new
// ground, so handing the sweep-line the whole board would cost a few hundred
// milliseconds of blocked JS per pan — on a board where most plots touch
// nothing at all. A bounding-box pass first splits each holder's rows into
// clusters that could possibly meet; a cluster of one is passed through
// untouched, and only the rest are worth a union. Boxes that merely overlap
// need not touch, so the pass over-collects on purpose: it is a filter for the
// clipper, never the answer.

import polygonClipping from 'polygon-clipping';
import { territoryRings } from '../components/claim/geometry';
import { pointInRing, ringCentroid } from '../components/territoryBoard';

// What counts as "the same holder". NOT just the runner: a claim splits its
// footprint by club attribution (`kept_clubs` in the claim SQL), so one runner
// can hold neighbouring pieces under two different badges — and the badge is
// what colours the plot. Merging across it would paint one club's ground in
// another's colour, which is a worse lie than the seam.
function holdingKey(t) {
  return `${t.user_id}|${t.clan_tag || ''}`;
}

function closeRing(ring) {
  const first = ring[0];
  const last = ring[ring.length - 1];
  return first[0] === last[0] && first[1] === last[1] ? ring : [...ring, first];
}

// Every ring the payload carries for one row, as separate single-ring polygons
// in the shape polygon-clipping wants. The server sends EXTERIOR rings only
// (`geometry_to_rings`), one per piece, largest first — so a ring is a piece of
// land, never a hole, and each can be fed in on its own.
function ringsAsPolygons(t) {
  return territoryRings(t)
    .filter((ring) => Array.isArray(ring) && ring.length >= 3)
    .map((ring) => [closeRing(ring)]);
}

// Which merged component a ring ended up inside. The anchor is the ring's own
// interior point, so it is inside the union too, and the components are
// disjoint — exactly one of them can contain it. Components are compared on
// their OUTER ring alone, which is enough: a hole in the union cannot hold any
// part of the land that built it.
function componentOf(components, ring) {
  const at = ringCentroid(ring);
  if (!at) return -1;
  for (let i = 0; i < components.length; i++) {
    if (pointInRing(at.longitude, at.latitude, components[i][0])) return i;
  }
  return -1;
}

// One merged row, wearing its largest member's identity.
//
// The dominant piece is the representative on purpose: its id is what a tap
// resolves against, and its freshness and reinforcements are what the fill
// reads, so a holding fades and saturates like the plot that makes up most of
// it rather than like whichever sliver happened to sort first. `contested` is
// the exception and is OR-ed across every member — that is the heat signal,
// and a merge must not be able to hide a fight.
function mergedRow(members, rings) {
  const lead = members.reduce(
    (best, t) => ((t.area_m2 || 0) > (best.area_m2 || 0) ? t : best),
    members[0]
  );
  return {
    ...lead,
    rings,
    polygon: rings[0],
    // Summed, because same-runner land cannot overlap itself — the claim
    // endpoint unions it on the way in. A row whose pieces straddle two
    // holdings is counted in both; this drives portrait priority and the
    // legend, not the economy.
    area_m2: members.reduce((sum, t) => sum + (t.area_m2 || 0), 0),
    contested: members.some((t) => !!t.contested),
    // What the merge swallowed, for anything that wants the real claims back.
    mergedFrom: members.map((t) => t.id),
  };
}

// Rows that could conceivably touch, by bounding box alone.
//
// Union-find over ROWS rather than rings: a row has to come out of this whole
// or not at all, and a remainder cut in two by a claim is one row with two
// pieces that can sit at either end of the same holding.
function touchClusters(group) {
  const boxes = group.map((t) =>
    territoryRings(t)
      .filter((ring) => Array.isArray(ring) && ring.length >= 3)
      .map((ring) => {
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const [x, y] of ring) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
        return { minX, minY, maxX, maxY };
      })
  );

  const parent = group.map((_, i) => i);
  const find = (i) => {
    let r = i;
    while (parent[r] !== r) r = parent[r];
    while (parent[i] !== r) { const next = parent[i]; parent[i] = r; i = next; }
    return r;
  };
  // Touching plots share exact coordinates, so their boxes meet exactly. The
  // epsilon is only there so a float that lands a fraction short of its
  // neighbour still counts — at ~0.1mm it cannot pull in land that is really
  // apart.
  const EPS = 1e-9;
  const meets = (a, b) => a.minX <= b.maxX + EPS && b.minX <= a.maxX + EPS
    && a.minY <= b.maxY + EPS && b.minY <= a.maxY + EPS;

  for (let i = 0; i < group.length; i++) {
    for (let j = i + 1; j < group.length; j++) {
      if (find(i) === find(j)) continue;
      if (boxes[i].some((a) => boxes[j].some((b) => meets(a, b)))) {
        parent[find(i)] = find(j);
      }
    }
  }

  const clusters = new Map();
  group.forEach((t, i) => {
    const root = find(i);
    const cluster = clusters.get(root);
    if (cluster) cluster.push(t);
    else clusters.set(root, [t]);
  });
  return [...clusters.values()];
}

// Collapse touching same-holder land into one row per connected piece.
//
// Returns rows in the SAME shape the payload uses, so every board helper
// downstream — features, portraits, the legend, the intelligence layers —
// keeps working on them unchanged and gets the merge for free.
export function mergeTouchingLand(territories) {
  const rows = Array.isArray(territories) ? territories : [];
  const groups = new Map();
  for (const t of rows) {
    if (!t) continue;
    const key = holdingKey(t);
    const group = groups.get(key);
    if (group) group.push(t);
    else groups.set(key, [t]);
  }

  const out = [];
  for (const group of groups.values()) {
    // One plot is already its own holding, and unioning it would only cost a
    // trip through the clipper and lose the untouched row's identity.
    if (group.length < 2) {
      out.push(...group);
      continue;
    }

    for (const cluster of touchClusters(group)) {
      if (cluster.length < 2) {
        out.push(...cluster);
        continue;
      }

      const polygons = [];
      const owners = [];
      for (const t of cluster) {
        for (const poly of ringsAsPolygons(t)) {
          polygons.push(poly);
          owners.push(t);
        }
      }
      if (polygons.length < 2) {
        out.push(...cluster);
        continue;
      }

      let components = null;
      try {
        components = polygonClipping.union(polygons[0], ...polygons.slice(1));
      } catch (e) {
        components = null;
      }
      // A clipper that cannot make sense of the input must not take the board
      // down with it: fall back to the unmerged rows, seams and all.
      if (!Array.isArray(components) || !components.length) {
        out.push(...cluster);
        continue;
      }

      const members = components.map(() => []);
      let unplaced = false;
      polygons.forEach((poly, i) => {
        const at = componentOf(components, poly[0]);
        if (at < 0) {
          unplaced = true;
          return;
        }
        const bucket = members[at];
        if (!bucket.includes(owners[i])) bucket.push(owners[i]);
      });
      // Every piece must land somewhere. If one did not, the union does not
      // describe this cluster and merging on it would drop land off the map.
      if (unplaced || members.some((m) => !m.length)) {
        out.push(...cluster);
        continue;
      }

      components.forEach((component, i) => {
        // Holes are dropped to match the payload's own contract: `rings` is
        // exterior rings only, and the board draws one filled shape per ring.
        out.push(mergedRow(members[i], [component[0]]));
      });
    }
  }
  return out;
}
