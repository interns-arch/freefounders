/**
 * The same design tokens as ../tokens.css, for places that cannot read CSS variables (charts; the React Native app
 * reads the hex copy tokens.native.ts, generated from this file by scripts/build-native.mjs). Keep them in step:
 * scripts/check-web-rules.mjs fails the build when tokens.css, this file and tokens.native.ts differ.
 */
export const radius = 14; // px, = 0.875rem

export const light = {
  background: 'oklch(0.97 0.005 170)',
  foreground: 'oklch(0.22 0.02 170)',
  card: 'oklch(1 0 0)',
  cardForeground: 'oklch(0.22 0.02 170)',
  popover: 'oklch(1 0 0)',
  popoverForeground: 'oklch(0.22 0.02 170)',
  primary: 'oklch(0.5 0.12 168)',
  primaryForeground: 'oklch(0.99 0 0)',
  brand_2: 'oklch(0.68 0.15 166)',
  secondary: 'oklch(0.955 0.01 170)',
  secondaryForeground: 'oklch(0.3 0.05 168)',
  muted: 'oklch(0.96 0.007 170)',
  mutedForeground: 'oklch(0.5 0.02 170)',
  accent: 'oklch(0.945 0.035 166)',
  accentForeground: 'oklch(0.35 0.1 168)',
  destructive: 'oklch(0.55 0.18 28)',
  success: 'oklch(0.5 0.13 160)',
  warning: 'oklch(0.53 0.15 55)',
  info: 'oklch(0.52 0.19 272)',
  border: 'oklch(0.92 0.01 170)',
  input: 'oklch(0.88 0.014 170)',
  ring: 'oklch(0.68 0.15 166)',
  sidebar: 'oklch(0.2 0.02 170)',
  sidebarForeground: 'oklch(0.88 0.02 168)',
  sidebarAccent: 'oklch(0.3 0.045 168)',
  sidebarBorder: 'oklch(0.3 0.025 170)',
  appAttendance: 'oklch(0.55 0.2 295)',
  appTasks: 'oklch(0.5 0.14 166)',
  appAssets: 'oklch(0.52 0.19 272)',
  appAdmin: 'oklch(0.53 0.13 55)',
} as const;

export const dark: Record<keyof typeof light, string> = {
  background: 'oklch(0.15 0.012 170)',
  foreground: 'oklch(0.94 0.01 168)',
  card: 'oklch(0.195 0.016 170)',
  cardForeground: 'oklch(0.94 0.01 168)',
  popover: 'oklch(0.21 0.016 170)',
  popoverForeground: 'oklch(0.94 0.01 168)',
  primary: 'oklch(0.72 0.15 166)',
  primaryForeground: 'oklch(0.13 0.03 168)',
  brand_2: 'oklch(0.8 0.15 166)',
  secondary: 'oklch(0.26 0.02 170)',
  secondaryForeground: 'oklch(0.92 0.01 168)',
  muted: 'oklch(0.24 0.016 170)',
  mutedForeground: 'oklch(0.7 0.02 168)',
  accent: 'oklch(0.28 0.05 166)',
  accentForeground: 'oklch(0.94 0.01 168)',
  destructive: 'oklch(0.66 0.18 25)',
  success: 'oklch(0.72 0.14 160)',
  warning: 'oklch(0.78 0.14 70)',
  info: 'oklch(0.72 0.13 272)',
  border: 'oklch(0.29 0.02 170)',
  input: 'oklch(0.34 0.022 170)',
  ring: 'oklch(0.72 0.15 166)',
  sidebar: 'oklch(0.13 0.012 170)',
  sidebarForeground: 'oklch(0.86 0.02 168)',
  sidebarAccent: 'oklch(0.27 0.05 166)',
  sidebarBorder: 'oklch(0.24 0.02 170)',
  appAttendance: 'oklch(0.74 0.16 295)',
  appTasks: 'oklch(0.74 0.14 166)',
  appAssets: 'oklch(0.72 0.13 272)',
  appAdmin: 'oklch(0.76 0.13 65)',
};

export type ColorToken = keyof typeof light;
