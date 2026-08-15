/**
 * Inter, bundled rather than fetched.
 *
 * The @expo-google-fonts packages ship the TTFs inside the package, so the
 * faces resolve from the bundle. That matters here: this app is for the moment
 * the network is gone, and a font that needs a request would never arrive.
 */

import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';

export function useAppFonts(): boolean {
  const [loaded, error] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });

  // A missing font must never hold the app hostage. If loading fails the
  // system face renders instead, which is ugly but usable.
  return loaded || error !== null;
}
