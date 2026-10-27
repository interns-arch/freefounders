/**
 * Title, description and Open Graph tags of a public page (PLAN.md §24.2). index.html carries the same tags for the
 * landing page (link previews do not run scripts); this keeps them right when someone moves between public pages and
 * puts the app's plain title back when the page is left.
 */
import { useEffect } from 'react';

const ORIGIN = 'https://kaampilot.com';

function setMeta(attr: 'name' | 'property', key: string, value: string): () => void {
  let el = document.head.querySelector<HTMLMetaElement>(`meta[${attr}="${key}"]`);
  const created = !el;
  const before = el?.content;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, key);
    document.head.appendChild(el);
  }
  el.content = value;
  return () => {
    if (created) el.remove();
    else if (before !== undefined) el.content = before;
  };
}

export function usePageMeta({ title, description, path }: { title: string; description: string; path: string }) {
  useEffect(() => {
    const oldTitle = document.title;
    document.title = title;
    const undo = [
      setMeta('name', 'description', description),
      setMeta('property', 'og:title', title),
      setMeta('property', 'og:description', description),
      setMeta('property', 'og:url', `${ORIGIN}${path}`),
      setMeta('name', 'twitter:title', title),
      setMeta('name', 'twitter:description', description),
    ];
    return () => {
      document.title = oldTitle;
      undo.forEach((u) => u());
    };
  }, [title, description, path]);
}
