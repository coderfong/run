import { boardPresentation, CLUB_DETAIL_MIN_ZOOM } from '../src/map/presentation';

const rows = [
  { id: 'club-a', clan_tag: 'RUN' },
  { id: 'solo', clan_tag: null },
  { id: 'club-b', clan_tag: 'PACE' },
];

describe('map board presentation', () => {
  it('turns a wide Club view into a quiet club-only overview', () => {
    const board = boardPresentation(rows, {
      clubView: true,
      zoom: CLUB_DETAIL_MIN_ZOOM - 0.01,
    });

    expect(board.rows.map((row) => row.id)).toEqual(['club-a', 'club-b']);
    expect(board.overview).toBe(true);
    expect(board.showTerritoryDetail).toBe(false);
  });

  it('restores club borders after zooming in', () => {
    const board = boardPresentation(rows, {
      clubView: true,
      zoom: CLUB_DETAIL_MIN_ZOOM,
    });

    expect(board.rows.map((row) => row.id)).toEqual(['club-a', 'club-b']);
    expect(board.overview).toBe(false);
    expect(board.showTerritoryDetail).toBe(true);
  });

  it('keeps every territory and full detail on ranked boards', () => {
    const board = boardPresentation(rows, { clubView: false, zoom: 9 });

    expect(board.rows).toEqual(rows);
    expect(board.overview).toBe(false);
    expect(board.showTerritoryDetail).toBe(true);
  });
});
