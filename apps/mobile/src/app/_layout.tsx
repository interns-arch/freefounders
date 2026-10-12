/** Root of the phone app: one screen, the web app in a native shell (PLAN.md §19.17). */
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { usePalette } from '@/lib/palette';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const p = usePalette();
  return (
    <SafeAreaProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: p.background } }} />
    </SafeAreaProvider>
  );
}
