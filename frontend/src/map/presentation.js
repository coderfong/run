// Presentation rules for the territory board.
//
// A CITY-SCALE BOARD IS AN OVERVIEW, NOT A SHRUNKEN COPY OF THE CLOSE-IN ONE.
// Pulled back over a whole town, outlined route-shaped plots turn into coloured
// static: hundreds of runs each traced at the same 2.5px stroke they get when
// one of them is the only thing on screen, with the contest pulse and whichever
// intelligence layer is on stacked over the top. At that camera the strokes are
// wider than the ground they enclose, so the board stops reading as ownership
// and starts reading as scribble. Past a zoom threshold every board therefore
// drops to muted fills — ownership as blocks of colour — and borders, contest
// pulses and layer outlines come back once the camera is close enough for a
// single plot to be worth looking at.
//
// This used to be the CLUB board's rule alone, on the theory that the club view
// was the only one ever looked at from that far out. It was the wrong half: the
// runners board carries every solo claim in the viewport where the club board
// carries only club-held ground, so at the same camera it is the denser of the
// two — the one actually turning into static, with the calm treatment sitting
// behind a toggle it had no reason to be behind. The threshold is the board's
// detail line now, not a club setting.
//
// PLANNING OPTS BACK IN at any zoom, because a route preview must account for
// every territory it crosses and a border you cannot see is one you cannot plan
// around.
//
// THE SCOPE ITSELF MOVED TO THE SERVER. This used to be the only thing keeping
// the clubs view from drawing solo land, on a response that carried every club
// in the world because that board sent no rank at all. `/map-polygons?board=club`
// now inner joins clans AND scopes by the owning CLUB's tier, so the rows
// arriving here are already the right ones. The filter below stays as a guard
// for a cached response from before that change; it is no longer the mechanism.

// The zoom at which a plot becomes worth drawing as a plot rather than as a
// patch of colour. Both boards switch on it, and the owner portraits pinned to
// each territory ride the same number — they are the same "close enough to care
// about one claim" line, and two copies of it would drift.
export const DETAIL_MIN_ZOOM = 13.25;

export function boardPresentation(rows, { clubView = false, zoom = 0, planning = false } = {}) {
  const allRows = Array.isArray(rows) ? rows : [];
  const visibleRows = clubView
    ? allRows.filter((row) => !!row?.clan_tag)
    : allRows;
  const overview = !planning && (Number(zoom) || 0) < DETAIL_MIN_ZOOM;

  return {
    rows: visibleRows,
    overview,
    showTerritoryDetail: !overview,
  };
}
