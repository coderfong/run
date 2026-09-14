// The font files App.js loads before the first frame. The keys are the family
// names `fonts` (theme/tokens.js) hands to style objects, so the two must
// agree — __tests__/fonts.test.js holds them to it.
//
// Poppins Black for headings, Space Grotesk for stats, Inter for everything
// else, and Inter Black for the share card's poster face.
//
// Each weight comes from its own subpath on purpose. A package's index
// requires every weight it ships (18 for Inter and Poppins each), and Metro
// bundles every file that is required, so importing through the index would
// put all of them in the app to use a handful.
import { Poppins_900Black } from '@expo-google-fonts/poppins/900Black';
import { SpaceGrotesk_500Medium } from '@expo-google-fonts/space-grotesk/500Medium';
import { SpaceGrotesk_700Bold } from '@expo-google-fonts/space-grotesk/700Bold';
import { Inter_400Regular } from '@expo-google-fonts/inter/400Regular';
import { Inter_500Medium } from '@expo-google-fonts/inter/500Medium';
import { Inter_600SemiBold } from '@expo-google-fonts/inter/600SemiBold';
import { Inter_700Bold } from '@expo-google-fonts/inter/700Bold';
import { Inter_900Black } from '@expo-google-fonts/inter/900Black';

export const FONT_FILES = {
  Poppins_900Black,
  SpaceGrotesk_500Medium,
  SpaceGrotesk_700Bold,
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  Inter_900Black,
};
