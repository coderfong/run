// The font files App.js loads before the first frame. The keys are the family
// names `fonts` (theme/tokens.js) hands to style objects, so the two must
// agree — __tests__/fonts.test.js holds them to it.
//
// One face, three pen widths: Pistachio Cloud Magnolia, traced out of the
// hand-lettered specimen sheet by scripts/fonts/build-handwriting-font.py.
// Change the face by re-running that script, never by editing these TTFs.
export const FONT_FILES = {
  PistachioCloudMagnolia_400Regular: require('../../assets/fonts/PistachioCloudMagnolia-Regular.ttf'),
  PistachioCloudMagnolia_500Medium: require('../../assets/fonts/PistachioCloudMagnolia-Medium.ttf'),
  PistachioCloudMagnolia_700Bold: require('../../assets/fonts/PistachioCloudMagnolia-Bold.ttf'),
};
