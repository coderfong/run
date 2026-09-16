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

  test('the tutorial states the objective and separates safety from fair play', () => {
    const tutorial = read('src/onboarding/TutorialOverlay.js');
    expect(tutorial).toContain('Run outside, claim the ground you cover');
    expect(tutorial).toContain('This is about safety: stop at crossings.');
    expect(tutorial).not.toContain('Runs are checked for fair play.');
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
