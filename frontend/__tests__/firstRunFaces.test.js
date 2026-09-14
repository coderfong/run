// The first run's face step: a few free faces to start, never the collection.
//
// Faces are what the runner collects: most unlock as you run or come off the
// pass. The signup grid used to list all of them, and because /me/stats has
// usually not landed during signup (isUnlocked reads a stat gate with no stats
// behind it as open), the stat gated ones were free picks. The starter rack is
// the fix, so the rack is what these pin.

import { FIRST_RUN_ITEMS, ITEMS, firstRunItems } from '../src/config/cosmetics';

const ids = (items) => items.map((item) => item.id).sort();
const face = (id) => ITEMS.face.find((item) => item.id === id);

describe('the first run face rack', () => {
  test('lists free faces only', () => {
    expect(FIRST_RUN_ITEMS.face.length).toBeGreaterThan(0);
    for (const id of FIRST_RUN_ITEMS.face) {
      expect(face(id)).toBeTruthy();
      expect(face(id).unlock).toBeNull();
    }
  });

  test('offers the rack and nothing else, even with every face reading as open', () => {
    // The signup state: no stats yet, so the whole catalogue arrives as
    // "unlocked" and the rack alone decides what is on the grid.
    const shown = firstRunItems('face', ITEMS.face, 'smiley');
    expect(ids(shown)).toEqual([...FIRST_RUN_ITEMS.face].sort());
    expect(shown.every((item) => item.unlock === null)).toBe(true);
  });

  test('keeps the face already worn, even one outside the rack', () => {
    // An older account running only the character steps may already wear a
    // face it earned. A grid that cannot show it reads as the pick being lost.
    const shown = firstRunItems('face', ITEMS.face, 'sly');
    expect(ids(shown)).toEqual([...FIRST_RUN_ITEMS.face, 'sly'].sort());
  });
});

describe('every first run rack', () => {
  test('names only real catalogue items', () => {
    // firstRunItems skips an id it cannot find, so a renamed item would drop
    // out of the flow quietly rather than fail anywhere.
    for (const [slot, rack] of Object.entries(FIRST_RUN_ITEMS)) {
      const known = new Set((ITEMS[slot] || []).map((item) => item.id));
      expect({ slot, missing: rack.filter((id) => !known.has(id)) }).toEqual({ slot, missing: [] });
    }
  });
});
