import { Fragment } from 'react';

const URL_RE = /((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi;

/** Text with its web addresses turned into links (only http(s) and www. addresses; everything else stays text). */
export function Linkify({ text }: { text: string | null | undefined }) {
  if (!text) return null;
  const parts = String(text).split(URL_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return <Fragment key={i}>{part}</Fragment>;
        const href = part.startsWith('www.') ? `http://${part}` : part;
        return (
          <a key={i} href={href} target="_blank" rel="noreferrer" className="break-all text-primary underline-offset-2 hover:underline" onClick={(e) => e.stopPropagation()}>
            {part}
          </a>
        );
      })}
    </>
  );
}
