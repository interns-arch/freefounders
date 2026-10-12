/**
 * Colours of the shell itself (splash, status bar, offline screen, selfie camera): the same design tokens as the web
 * (packages/theme, hex copy) in light or dark from the phone. The web app draws its own colours inside the WebView.
 */
import { dark, light, radius } from '@freefounders/theme/native';
import { useColorScheme } from 'react-native';

export type Palette = Record<keyof typeof light, string> & { isDark: boolean; radius: number };

export function usePalette(): Palette {
  const isDark = useColorScheme() === 'dark';
  return { ...(isDark ? dark : light), isDark, radius };
}
