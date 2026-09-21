import { boardPresentation, DETAIL_MIN_ZOOM } from '../src/map/presentation';

const rows = [
  { id: 'club-a', clan_tag: 'RUN' },
  { id: 'solo', clan_tag: null },
  { id: 'club-b', clan_tag: 'PACE' },
];

describe('map board presentation', () => {
  it('turns a wide Club view into a quiet club-only overview', () => {
    const board = boardPresentation(rows, {
      clubView: true,
      zoom: DETAIL_MIN_ZOOM - 0.01,
    });

    expect(board.rows.map((row) => row.id)).toEqual(['club-a', 'club-b']);
    expect(board.overview).toBe(true);
    expect(board.showTerritoryDetail).toBe(false);
  });

  it('restores club borders after zooming in', () => {
    const board = boardPresentation(rows, {
      clubView: true,
      zoom: DETAIL_MIN_ZOOM,
    });

    expect(board.rows.map((row) => row.id)).toEqual(['club-a', 'club-b']);
    expect(board.overview).toBe(false);
    expect(board.showTerritoryDetail).toBe(true);
  });

  // The runners board is the DENSER of the two at the same camera, so the calm
  // treatment belongs to it at least as much as to the club board. It keeps
  // every territory either way — only the borders go.
  it('calms the runners board down when it is pulled back too', () => {
    const board = boardPresentation(rows, { clubView: false, zoom: 9 });

    expect(board.rows).toEqual(rows);
    expect(board.overview).toBe(true);
    expect(board.showTerritoryDetail).toBe(false);
  });

  it('restores runner borders after zooming in', () => {
    const board = boardPresentation(rows, { clubView: false, zoom: DETAIL_MIN_ZOOM });

    expect(board.rows).toEqual(rows);
    expect(board.overview).toBe(false);
    expect(board.showTerritoryDetail).toBe(true);
  });

  // A border you cannot see is one you cannot route around, so the planner
  // keeps the precise board however far out the camera is.
  it('keeps full detail while planning at any zoom', () => {
    const board = boardPresentation(rows, { clubView: false, zoom: 9, planning: true });

    expect(board.overview).toBe(false);
    expect(board.showTerritoryDetail).toBe(true);
  });
});
