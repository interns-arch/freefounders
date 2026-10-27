/**
 * Calendly's embed (PLAN.md §24.2): https://assets.calendly.com/assets/external/widget.js (+ widget.css) is loaded only
 * when someone presses "Book a demo", never with the page. Calendly itself sends the confirmation and reminder emails
 * to the address the person gives there; Kaampilot keeps nothing. The gateway CSP allows calendly.com and
 * assets.calendly.com for it (infra/deploy/Caddyfile, infra/gateway/Caddyfile).
 */
const SCRIPT = 'https://assets.calendly.com/assets/external/widget.js';
const STYLE = 'https://assets.calendly.com/assets/external/widget.css';

interface CalendlyApi {
  initPopupWidget(options: { url: string; prefill?: { name?: string; email?: string } }): void;
  closePopupWidget?: () => void;
}

declare global {
  interface Window {
    Calendly?: CalendlyApi;
  }
}

let loading: Promise<CalendlyApi> | null = null;

/** Loads Calendly's widget once (a failed load can be tried again). */
export function loadCalendly(): Promise<CalendlyApi> {
  if (window.Calendly) return Promise.resolve(window.Calendly);
  if (loading) return loading;
  loading = new Promise<CalendlyApi>((resolve, reject) => {
    if (!document.querySelector(`link[href="${STYLE}"]`)) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = STYLE;
      document.head.appendChild(css);
    }
    const s = document.createElement('script');
    s.src = SCRIPT;
    s.async = true;
    s.onload = () => (window.Calendly ? resolve(window.Calendly) : reject(new Error('Calendly did not load')));
    s.onerror = () => {
      s.remove();
      reject(new Error('Calendly could not be reached'));
    };
    document.head.appendChild(s);
  }).catch((e: unknown) => {
    loading = null;
    throw e;
  });
  return loading;
}

/** Only an https link on calendly.com is opened (the address comes from the Platform's settings). */
export function isCalendlyUrl(url: string | null | undefined): url is string {
  if (!url) return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && (u.hostname === 'calendly.com' || u.hostname.endsWith('.calendly.com'));
  } catch {
    return false;
  }
}

/** Opens Calendly's booking pop-up, with the name and email filled in when given. */
export async function openCalendly(url: string, prefill: { name?: string; email?: string } = {}): Promise<void> {
  const calendly = await loadCalendly();
  const clean = Object.fromEntries(Object.entries(prefill).filter(([, v]) => v && v.trim())) as { name?: string; email?: string };
  calendly.initPopupWidget({ url, prefill: clean });
}

export const SUPPORT_EMAIL = 'support@kaampilot.com';
export const DEMO_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Kaampilot demo')}`;
