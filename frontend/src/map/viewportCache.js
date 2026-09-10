// Keep navigation responsive without starting a request for every camera tick.
export function bboxContains(outer, inner) {
  return !!outer && inner.minLon >= outer.minLon && inner.maxLon <= outer.maxLon
    && inner.minLat >= outer.minLat && inner.maxLat <= outer.maxLat;
}

export function padBbox(b, factor = 0.6) {
  const x = (b.maxLon - b.minLon) * factor;
  const y = (b.maxLat - b.minLat) * factor;
  return { minLon: Math.max(-180, b.minLon - x), minLat: Math.max(-90, b.minLat - y),
    maxLon: Math.min(180, b.maxLon + x), maxLat: Math.min(90, b.maxLat + y) };
}

const sameScope = (a, b) => a.rank === b.rank && a.board === b.board && a.capped === b.capped;

export function createViewportCache({ request, onData, onError, now = Date.now }) {
  let regions = [];
  const pending = new Set();
  let desired = null;
  let shown = null;
  let serial = 0;
  let disposed = false;

  function publish() {
    if (!desired || disposed) return;
    const hit = regions.find((r) => sameScope(r, desired) && bboxContains(r.bbox, desired.bbox));
    if (hit && hit !== shown) {
      shown = hit;
      onData(hit.territories);
    }
  }

  function pump() {
    if (!desired || disposed) return;
    const target = desired;
    // Start fetching before the camera exhausts the loaded margin.
    const ahead = padBbox(target.bbox, 0.2);
    const fresh = regions.some((r) => sameScope(r, target) && r.id >= target.minId
      && now() - r.at < 30000 && bboxContains(r.bbox, ahead));
    if (fresh || [...pending].some((r) => sameScope(r, target)
      && r.id >= target.minId && bboxContains(r.bbox, ahead))) return;
    // Two requests maximum; after either finishes, request only the latest
    // camera position. Superseded replies still warm the back-navigation cache.
    if (pending.size >= 2) return;
    const job = { ...target, bbox: padBbox(target.bbox), id: ++serial };
    pending.add(job);
    Promise.resolve().then(() => request(job.bbox, job.zoom, { rank: job.rank, board: job.board }))
      .then((data) => {
        if (disposed) return;
        const region = { ...job, territories: data.territories, at: now() };
        regions = [region, ...regions].sort((a, b) => b.id - a.id).slice(0, 12);
        publish();
      })
      .catch(() => {
        if (!disposed && desired === target) onError();
      })
      .finally(() => {
        pending.delete(job);
        // Don't spin on failed requests. A new camera event/focus retries.
        if (desired !== target) pump();
      });
  }

  return {
    load(bbox, zoom, { rank, board, force = false }) {
      if (disposed) return;
      const capped = zoom < 11;
      if (shown && (shown.rank !== rank || shown.board !== board)) {
        shown = null;
        onData([]);
      }
      const minId = force ? serial + 1 : (
        desired && sameScope(desired, { rank, board, capped }) ? desired.minId : 0
      );
      desired = { bbox, zoom, rank, board, capped, minId };
      publish();
      pump();
    },
    dispose() { disposed = true; regions = []; },
  };
}

// Visible portraits win the limited native marker slots; preload margin land
// must not push smaller on-screen owners out of the first forty.
export function selectPortraits(portraits, bbox, limit = 40) {
  const inside = (p) => !bbox || bboxContains(bbox, {
    minLon: p.at.longitude, maxLon: p.at.longitude,
    minLat: p.at.latitude, maxLat: p.at.latitude,
  });
  return portraits.slice().sort((a, b) => Number(inside(b)) - Number(inside(a))
    || b.area - a.area).slice(0, limit);
}
