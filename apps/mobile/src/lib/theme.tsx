/**
 * The FreeFounders look on the phone: the same tokens as the web (packages/theme, hex copy), light or dark from the
 * phone setting, and the company brand colour (Settings Center) in place of the primary colour, like the web.
 */
import { dark, light, radius, type ColorToken } from '@freefounders/theme/native';
import { createContext, type ReactNode, useContext, useMemo } from 'react';
import { useColorScheme } from 'react-native';
import { parseHex, readableOn } from './colour';

export type Colors = Record<ColorToken, string>;

export interface Theme {
  dark: boolean;
  colors: Colors;
  radius: number;
}

export const FONTS = {
  regular: 'PlusJakartaSans_400Regular',
  medium: 'PlusJakartaSans_500Medium',
  semibold: 'PlusJakartaSans_600SemiBold',
  bold: 'PlusJakartaSans_700Bold',
  extrabold: 'PlusJakartaSans_800ExtraBold',
} as const;

export function makeTheme(isDark: boolean, brand?: string | null): Theme {
  const base: Colors = { ...(isDark ? dark : light) };
  if (brand && parseHex(brand)) {
    base.primary = brand;
    base.ring = brand;
    base.brand_2 = brand;
    base.primaryForeground = readableOn(brand);
  }
  return { dark: isDark, colors: base, radius };
}

const ThemeContext = createContext<Theme>(makeTheme(false));

export function ThemeProvider({ brand, children }: { brand?: string | null; children: ReactNode }) {
  const scheme = useColorScheme();
  const theme = useMemo(() => makeTheme(scheme === 'dark', brand), [scheme, brand]);
  return <ThemeContext.Provider value={theme}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
