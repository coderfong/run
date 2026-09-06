// Presentation rules for the territory board.
//
// Club view is an overview, not another copy of the individual board. At city
// scale, thousands of outlined route-shaped plots turn into coloured static;
// keep only club-owned ground and defer borders/contest detail until the user
// zooms in. Planning is handled by the caller and deliberately opts back into
// the full board because a route preview must account for every territory.

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
