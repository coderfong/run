import { eloProgressCopy } from '../src/components/EloProgressCard';

describe('Elo progression copy', () => {
  test('explains how an unrated player starts', () => {
    expect(eloProgressCopy({ rating: 1000, nextRating: 1050, nextLabel: 'Bronze', matches: 0 }))
      .toBe('Play a rated territory battle to start moving');
  });

  test('shows the exact gap to the next tier', () => {
    expect(eloProgressCopy({ rating: 1016, nextRating: 1050, nextLabel: 'Bronze', matches: 1 }))
      .toBe('34 Elo to Bronze');
  });

  test('handles the top tier', () => {
    expect(eloProgressCopy({ rating: 2460, nextRating: null, nextLabel: null, matches: 30 }))
      .toBe('Highest rank reached');
  });
});
