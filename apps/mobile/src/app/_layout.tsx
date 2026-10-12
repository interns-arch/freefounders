/**
 * Root of the phone app: shared logic (@freefounders/core) wired for the phone, fonts, theme with the company brand
 * colour, and the sign-in gate (signed out → sign-in; signed in → the tabs, Attendance first).
 */
import '@/lib/core';
import { PlusJakartaSans_400Regular } from '@expo-google-fonts/plus-jakarta-sans/400Regular';
import { PlusJakartaSans_500Medium } from '@expo-google-fonts/plus-jakarta-sans/500Medium';
import { PlusJakartaSans_600SemiBold } from '@expo-google-fonts/plus-jakarta-sans/600SemiBold';
import { PlusJakartaSans_700Bold } from '@expo-google-fonts/plus-jakarta-sans/700Bold';
import { PlusJakartaSans_800ExtraBold } from '@expo-google-fonts/plus-jakarta-sans/800ExtraBold';
import { useClaims, usePlatformMe } from '@freefounders/core';
import { QueryClientProvider } from '@tanstack/react-query';
import { useFonts } from 'expo-font';
import { DarkTheme, DefaultTheme, Stack, ThemeProvider as NavThemeProvider } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { type ReactNode, useEffect } from 'react';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Button, Notice, T } from '@/components/ui';
import { API_URL } from '@/lib/api-url';
import { useBoot } from '@/lib/boot';
import { queryClient } from '@/lib/core';
import { FONTS, ThemeProvider, useTheme } from '@/lib/theme';

void SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    PlusJakartaSans_400Regular,
    PlusJakartaSans_500Medium,
    PlusJakartaSans_600SemiBold,
    PlusJakartaSans_700Bold,
    PlusJakartaSans_800ExtraBold,
  });
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <BrandTheme>
          <Gate fontsReady={fontsLoaded || !!fontError} />
        </BrandTheme>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}

/** The company colour from the Settings Center (once signed in). */
function BrandTheme({ children }: { children: ReactNode }) {
  const me = usePlatformMe();
  return <ThemeProvider brand={me.data?.company.colour}>{children}</ThemeProvider>;
}

function Gate({ fontsReady }: { fontsReady: boolean }) {
  const boot = useBoot();
  const claims = useClaims();
  const theme = useTheme();
  const ready = fontsReady && boot.state !== 'starting';
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);
  if (!ready) return null;

  const nav = theme.dark ? DarkTheme : DefaultTheme;
  const navTheme = {
    ...nav,
    colors: { ...nav.colors, primary: theme.colors.primary, background: theme.colors.background, card: theme.colors.card, text: theme.colors.foreground, border: theme.colors.border },
  };

  return (
    <NavThemeProvider value={navTheme}>
      <StatusBar style={theme.dark ? 'light' : 'dark'} />
      {boot.state === 'offline' && !claims ? (
        <Offline onRetry={boot.retry} />
      ) : (
        <Stack
          screenOptions={{
            headerShown: false,
            contentStyle: { backgroundColor: theme.colors.background },
            headerStyle: { backgroundColor: theme.colors.card },
            headerTintColor: theme.colors.foreground,
            headerTitleStyle: { fontFamily: FONTS.bold },
          }}
        >
          <Stack.Screen name="index" />
          <Stack.Protected guard={!!claims}>
            <Stack.Screen name="(tabs)" />
            <Stack.Screen name="leave-apply" options={{ presentation: 'modal', headerShown: true, title: 'Apply for leave' }} />
          </Stack.Protected>
          <Stack.Protected guard={!claims}>
            <Stack.Screen name="(auth)" />
          </Stack.Protected>
        </Stack>
      )}
    </NavThemeProvider>
  );
}

/** Signed in earlier, but FreeFounders cannot be reached right now. */
function Offline({ onRetry }: { onRetry: () => void }) {
  const { colors } = useTheme();
  return (
    <View style={{ flex: 1, backgroundColor: colors.background, padding: 24, justifyContent: 'center', gap: 16 }}>
      <T variant="title" accessibilityRole="header">
        Cannot reach FreeFounders
      </T>
      <Notice tone="warning">
        {`The phone could not reach ${API_URL}. Check that the phone is on the same Wi-Fi as the office PC and that FreeFounders is running there, then try again.`}
      </Notice>
      <Button label="Try again" icon="refresh" onPress={onRetry} big />
    </View>
  );
}
