// The two map boards, from the client's side.
//
// The clubs view used to send no rank at all, which the endpoint read as
// "every rank" — so every club in the world landed on one map and the view was
// unreadable at any zoom. Both boards now send a tier, and `board` says which
// ladder that tier is read against.

import { api } from '../src/api/client';
import { boardPresentation } from '../src/map/presentation';

function queryOf(url) {
  return Object.fromEntries(new URLSearchParams(String(url).split('?')[1] || ''));
}

describe('the map request', () => {
  let seen;
  beforeEach(() => {
    seen = [];
    global.fetch = jest.fn(async (url) => {
      seen.push(url);
      return { ok: true, status: 200, json: async () => ({ territories: [] }) };
    });
  });
  afterEach(() => { delete global.fetch; });

  const bbox = { minLon: 0, minLat: 0, maxLon: 1, maxLat: 1 };

  test('the runners board scopes by tier and names no board', () => {
    api.mapPolygons(bbox, 14, { rank: 3, board: 'solo' });
    const q = queryOf(seen[0]);
    expect(q.rank).toBe('3');
    // Omitted, so the query string stays exactly what it always was.
    expect(q.board).toBeUndefined();
  });

  test('the clubs board sends a tier AND the board', () => {
    api.mapPolygons(bbox, 14, { rank: 3, board: 'club' });
    const q = queryOf(seen[0]);
    expect(q.rank).toBe('3');
    expect(q.board).toBe('club');
  });

  test('every tier of the clubs board is addressable, including Wood', () => {
    // Wood is tier 0, and `rank: 0` must survive the falsy check that a
    // truthiness test here would silently eat.
    api.mapPolygons(bbox, 14, { rank: 0, board: 'club' });
    expect(queryOf(seen[0]).rank).toBe('0');
  });

  test('no options at all still requests a board', () => {
    api.mapPolygons(bbox, 14);
    const q = queryOf(seen[0]);
    expect(q.rank).toBeUndefined();
    expect(q.board).toBeUndefined();
  });
});

describe('what the club board draws', () => {
  const clubLand = { id: 'a', clan_tag: 'RUN', clan_rank_key: 'gold' };
  const soloLand = { id: 'b', clan_tag: null };

  test('club held land only', () => {
    const { rows } = boardPresentation([clubLand, soloLand], { clubView: true, zoom: 14 });
    expect(rows.map((r) => r.id)).toEqual(['a']);
  });

  test('the runners board draws everything', () => {
    const { rows } = boardPresentation([clubLand, soloLand], { clubView: false, zoom: 14 });
    expect(rows).toHaveLength(2);
  });

  test('far out it is an overview, close in it is the detailed board', () => {
    expect(boardPresentation([clubLand], { clubView: true, zoom: 11 }).showTerritoryDetail).toBe(false);
    expect(boardPresentation([clubLand], { clubView: true, zoom: 15 }).showTerritoryDetail).toBe(true);
  });
});
