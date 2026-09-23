const fs = require('fs');
const path = require('path');

const read = (relative) => fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');

describe('tester feedback regressions', () => {
  test('signup requires a recovery email and shows errors instead of rule hints', () => {
    const auth = read('src/screens/AuthScreen.js');
    expect(auth).toContain("Enter an email so you can reset your password.");
    expect(auth).toContain('emailError(email, true)');
    expect(auth).not.toContain('Optional. It is the only way to reset your password');
    expect(auth).not.toContain('3 to 32 characters: letters, numbers, underscore.');
  });

  test('the starting avatar choice is about style, not binary gender', () => {
    const step = read('src/onboarding/steps/GenderStep.js');
    expect(step).toContain('Pick a starting style');
    expect(step).toContain("label: 'Short hair'");
    expect(step).toContain("label: 'Long hair'");
    expect(step).not.toContain("label: 'Man'");
    expect(step).not.toContain("label: 'Woman'");
  });

  // The v1 overlay this used to read (src/onboarding/TutorialOverlay.js) was
  // never imported and was deleted with the 2026-09-23 tutorial rebuild. The
  // live tutorial is src/tutorial/steps.js: it opens on the objective and
  // never talks about anti cheat.
  test('the tutorial states the objective and never talks about fair play', () => {
    const tutorial = read('src/tutorial/steps.js');
    expect(tutorial).toContain("'Run in the real world.', 'Claim the map.', 'Defend your land.', 'Climb the ranks.'");
    expect(tutorial).not.toContain('fair play');
  });

  test('the long-running run marker has no permanent animation loops', () => {
    const run = read('src/screens/RunningScreen.js');
    expect(run).not.toContain('<Pulse');
    expect(run).not.toContain('name="routeHead"');
    expect(run).toContain('.slice(0, 12)');
  });

  test('screen pushes and tab changes animate unless Reduce Motion is enabled', () => {
    const app = read('App.js');
    expect(app).toContain("animation: reduced ? 'none' : 'slide_from_right'");
    expect(app).toContain('fullScreenGestureEnabled: !reduced');
    expect(app).toContain('animationEnabled: !reduced');
  });
});
