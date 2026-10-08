/**
 * The same design tokens as ../tokens.css, for places that cannot read CSS variables (the React Native app in
 * Phase 7, charts). Keep the two in step: tokens.test (scripts/check-theme.mjs) fails the build when they differ.
 */
export const radius = 10; // px, = 0.625rem

export const light = {
  background: 'oklch(0.985 0.003 250)',
  foreground: 'oklch(0.21 0.02 260)',
  card: 'oklch(1 0 0)',
  cardForeground: 'oklch(0.21 0.02 260)',
  popover: 'oklch(1 0 0)',
  popoverForeground: 'oklch(0.21 0.02 260)',
  primary: 'oklch(0.52 0.2 262)',
  primaryForeground: 'oklch(0.99 0 0)',
  secondary: 'oklch(0.96 0.006 255)',
  secondaryForeground: 'oklch(0.26 0.02 260)',
  muted: 'oklch(0.965 0.005 255)',
  mutedForeground: 'oklch(0.53 0.018 258)',
  accent: 'oklch(0.955 0.014 262)',
  accentForeground: 'oklch(0.26 0.03 262)',
  destructive: 'oklch(0.58 0.21 27)',
  success: 'oklch(0.6 0.15 155)',
  warning: 'oklch(0.72 0.15 70)',
  info: 'oklch(0.6 0.13 235)',
  border: 'oklch(0.915 0.008 255)',
  input: 'oklch(0.885 0.01 255)',
  ring: 'oklch(0.52 0.2 262)',
  sidebar: 'oklch(0.975 0.004 255)',
  sidebarForeground: 'oklch(0.3 0.02 260)',
  sidebarAccent: 'oklch(0.93 0.016 262)',
  sidebarBorder: 'oklch(0.92 0.008 255)',
  appTasks: 'oklch(0.58 0.14 165)',
  appAssets: 'oklch(0.65 0.16 55)',
  appAdmin: 'oklch(0.55 0.17 300)',
} as const;

export const dark: Record<keyof typeof light, string> = {
  background: 'oklch(0.16 0.01 260)',
  foreground: 'oklch(0.95 0.005 255)',
  card: 'oklch(0.2 0.012 260)',
  cardForeground: 'oklch(0.95 0.005 255)',
  popover: 'oklch(0.21 0.012 260)',
  popoverForeground: 'oklch(0.95 0.005 255)',
  primary: 'oklch(0.68 0.17 262)',
  primaryForeground: 'oklch(0.15 0.02 262)',
  secondary: 'oklch(0.26 0.014 260)',
  secondaryForeground: 'oklch(0.93 0.005 255)',
  muted: 'oklch(0.24 0.012 260)',
  mutedForeground: 'oklch(0.69 0.015 258)',
  accent: 'oklch(0.28 0.03 262)',
  accentForeground: 'oklch(0.95 0.005 255)',
  destructive: 'oklch(0.66 0.19 25)',
  success: 'oklch(0.7 0.14 155)',
  warning: 'oklch(0.78 0.14 75)',
  info: 'oklch(0.7 0.12 235)',
  border: 'oklch(0.29 0.014 260)',
  input: 'oklch(0.34 0.016 260)',
  ring: 'oklch(0.68 0.17 262)',
  sidebar: 'oklch(0.18 0.011 260)',
  sidebarForeground: 'oklch(0.86 0.01 255)',
  sidebarAccent: 'oklch(0.26 0.022 262)',
  sidebarBorder: 'oklch(0.27 0.014 260)',
  appTasks: 'oklch(0.72 0.13 165)',
  appAssets: 'oklch(0.76 0.14 60)',
  appAdmin: 'oklch(0.7 0.15 300)',
};

export type ColorToken = keyof typeof light;
