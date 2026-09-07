// Presentation rules for the territory board.
//
// Club view is an overview, not another copy of the individual board. At city
// scale, thousands of outlined route-shaped plots turn into coloured static;
// keep only club-owned ground and defer borders/contest detail until the user
// zooms in. Planning is handled by the caller and deliberately opts back into
// the full board because a route preview must account for every territory.
//
// THE SCOPE ITSELF MOVED TO THE SERVER. This used to be the only thing keeping
// the clubs view from drawing solo land, on a response that carried every club
// in the world because that board sent no rank at all. `/map-polygons?board=club`
// now inner joins clans AND scopes by the owning CLUB's tier, so the rows
// arriving here are already the right ones. The filter below stays as a guard
// for a cached response from before that change; it is no longer the mechanism.

export const CLUB_DETAIL_MIN_ZOOM = 13.25;

export function boardPresentation(rows, { clubView = false, zoom = 0 } = {}) {
  const allRows = Array.isArray(rows) ? rows : [];
  const visibleRows = clubView
    ? allRows.filter((row) => !!row?.clan_tag)
    : allRows;
  const overview = clubView && (Number(zoom) || 0) < CLUB_DETAIL_MIN_ZOOM;

  return {
    rows: visibleRows,
    overview,
    showTerritoryDetail: !overview,
  };
}
