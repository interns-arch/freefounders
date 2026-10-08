/** Chart.js set-up for the Tasks screens: colours are read from the theme's CSS variables at run time. */
import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, Tooltip } from 'chart.js';

ChartJS.register(CategoryScale, LinearScale, BarElement, Tooltip, Legend);

/** The current value of a theme colour, e.g. themeColour('primary') → "oklch(…)". */
export function themeColour(name: string): string {
  if (typeof window === 'undefined') return '';
  const root = document.documentElement;
  return getComputedStyle(root).getPropertyValue(`--${name}`).trim();
}

/** Axis + grid colours for a bar chart that follows light/dark. */
export function axisOptions() {
  const muted = themeColour('muted-foreground');
  const grid = themeColour('border');
  return {
    x: { grid: { display: false }, border: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkip: true, font: { size: 11 } } },
    y: { beginAtZero: true, ticks: { color: muted, precision: 0, font: { size: 11 } }, grid: { color: grid }, border: { display: false } },
  };
}
