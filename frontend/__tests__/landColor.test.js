import { buildBoardFeatures, buildLandPortraits, landColor } from '../src/components/territoryBoard';
import { NEUTRAL } from '../src/state/clan';

const SQUARE = [[0, 0], [0, 1], [1, 1], [1, 0], [0, 0]];
const plot = (id, userId, extra = {}) => ({
  id,
  user_id: userId,
  username: `runner-${userId}`,
  avatar: { face: 'a' },
  polygon: SQUARE,
  freshness: 1,
  ...extra,
});

const GREEN = { fill: 'rgba(16,163,74,0.20)', stroke: '#15803d', glow: '#4ade80' };

describe('land colour', () => {
  it('gives two solo runners different colours instead of one slate wash', () => {
    // The board used to hand every clubless plot the viewer's accent, which for
    // a viewer without a club is the neutral slate: one colour for the world.
    const a = landColor(plot('a', 'user-alpha'));
    const b = landColor(plot('b', 'user-bravo'));

    expect(a).not.toBe(NEUTRAL.stroke);
    expect(b).not.toBe(NEUTRAL.stroke);
    expect(a).not.toBe(b);
  });

  it('keeps a runner on the same colour every time it is asked', () => {
    const first = landColor(plot('a', 'user-alpha'));
    const again = landColor(plot('b', 'user-alpha'));
    expect(again).toBe(first);
  });

  it('paints club land in the club colour, whoever holds it', () => {
    expect(landColor(plot('a', 'user-alpha', { clan_color: GREEN }))).toBe(GREEN.stroke);
  });

  it('paints own land in the viewer accent', () => {
    expect(landColor(plot('a', 'me'), { mine: true, accent: '#ff0055' })).toBe('#ff0055');
  });

  it('gives a clubless viewer a colour for their own land too', () => {
    // Their accent IS the slate, so deferring to it would leave their land the
    // one grey plot on a coloured board.
    const own = landColor(plot('a', 'me'), { mine: true, accent: NEUTRAL.stroke });
    expect(own).not.toBe(NEUTRAL.stroke);
    expect(own).toBe(landColor(plot('a', 'me')));
  });
});

describe('board features', () => {
  const board = [plot('mine', 'me'), plot('theirs', 'user-bravo'), plot('club', 'user-charlie', { clan_color: GREEN })];

  it('colours every plot by its owner and fills the land, not just its edge', () => {
    const features = buildBoardFeatures(board, { userId: 'me', accent: '#ff0055' });
    const byId = Object.fromEntries(features.map((f) => [f.properties.territoryId, f.properties]));

    expect(byId.mine.fillColor).toBe('#ff0055');
    expect(byId.club.fillColor).toBe(GREEN.stroke);
    expect(byId.theirs.fillColor).not.toBe(NEUTRAL.stroke);
    expect(byId.theirs.fillColor).not.toBe(byId.club.fillColor);
    // Stroke follows the fill so a plot is one colour, never a coloured edge
    // around grey ground.
    features.forEach((f) => expect(f.properties.strokeColor).toBe(f.properties.fillColor));
    features.forEach((f) => expect(f.properties.fillOpacity).toBeGreaterThan(0.2));
  });

  it('rings each owner portrait in the colour of the land under it', () => {
    const portraits = buildLandPortraits(board, { userId: 'me', accent: '#ff0055', equipped: { face: 'z' } });
    const byId = Object.fromEntries(portraits.map((p) => [p.id, p]));

    expect(byId.mine.ring).toBe('#ff0055');
    expect(byId.club.ring).toBe(GREEN.stroke);
    expect(byId.theirs.ring).toBe(landColor(plot('theirs', 'user-bravo')));
  });
});
