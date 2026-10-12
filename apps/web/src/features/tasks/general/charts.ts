/** Chart.js set-up for the Tasks screens: colours are read from the theme's CSS variables at run time. */
import { BarElement, CategoryScale, Chart as ChartJS, Legend, LinearScale, type Plugin, Tooltip } from 'chart.js';

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
    x: { grid: { display: false }, border: { display: false }, ticks: { color: muted, maxRotation: 0, autoSkip: true, font: { size: 12 } } },
    y: { beginAtZero: true, ticks: { color: muted, precision: 0, font: { size: 12 } }, grid: { color: grid }, border: { display: false } },
  };
}

/**
 * Writes each bar's value just above it, so the numbers can be read without hovering (phones, keyboard, colour-blind
 * readers). Skipped when there are too many bars to label cleanly. Give the chart `layout: { padding: { top: 18 } }`.
 */
export const barValueLabels: Plugin<'bar'> = {
  id: 'ffBarValueLabels',
  afterDatasetsDraw(chart) {
    const { ctx } = chart;
    const bars = chart.data.datasets.reduce((n, ds) => n + ds.data.length, 0);
    if (bars === 0 || bars > 24) return;
    ctx.save();
    ctx.font = `600 12px ${getComputedStyle(document.body).fontFamily}`;
    ctx.fillStyle = themeColour('foreground');
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    chart.data.datasets.forEach((ds, i) => {
      const meta = chart.getDatasetMeta(i);
      if (meta.hidden) return;
      meta.data.forEach((bar, j) => {
        const v = ds.data[j];
        if (v === null || v === undefined || typeof v !== 'number') return;
        const { x, y } = bar.getProps(['x', 'y'], true) as { x: number; y: number };
        ctx.fillText(String(v), x, y - 3);
      });
    });
    ctx.restore();
  },
};
