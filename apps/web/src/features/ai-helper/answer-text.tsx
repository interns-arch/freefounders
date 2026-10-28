/**
 * A small, safe Markdown subset for AI answers (PLAN.md §24.3 UI v2): paragraphs and line breaks, "- " / "* " / "• "
 * bullets, "1." / "1)" numbered lists, "# " headings (shown as bold lines) and **bold**. Everything is rendered as React
 * text nodes, never as HTML, so an answer can not inject markup.
 */
import { Fragment, type ReactNode } from 'react';

type Block = { kind: 'p'; lines: string[] } | { kind: 'ul' | 'ol'; items: string[]; start: number } | { kind: 'h'; text: string };

const BULLET = /^\s*(?:[-*•])\s+(.*)$/;
const NUMBER = /^\s*(\d{1,3})[.)]\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

function blocks(text: string): Block[] {
  const out: Block[] = [];
  for (const raw of text.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trimEnd();
    const last = out.at(-1);
    if (!line.trim()) {
      // A blank line ends a paragraph; lists may continue after one ("1. …\n\n2. …").
      if (last?.kind === 'p') out.push({ kind: 'p', lines: [] });
      continue;
    }
    const b = BULLET.exec(line);
    const n = NUMBER.exec(line);
    const h = HEADING.exec(line);
    if (b) {
      if (last?.kind === 'ul') last.items.push(b[1]);
      else out.push({ kind: 'ul', items: [b[1]], start: 1 });
    } else if (n) {
      if (last?.kind === 'ol') last.items.push(n[2]);
      else out.push({ kind: 'ol', items: [n[2]], start: Number(n[1]) || 1 });
    } else if (h) {
      out.push({ kind: 'h', text: h[1] });
    } else if (last?.kind === 'p') {
      last.lines.push(line);
    } else {
      out.push({ kind: 'p', lines: [line] });
    }
  }
  return out.filter((b) => b.kind !== 'p' || b.lines.length);
}

/** `**bold**` → <strong>; any other characters stay plain text. */
function inline(text: string): ReactNode {
  const parts = text.split(/(\*\*[^*]+?\*\*)/g);
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') && p.length > 4 ? (
      <strong key={i} className="font-semibold">
        {p.slice(2, -2)}
      </strong>
    ) : (
      <Fragment key={i}>{p.replace(/(^|\s)\*(\S[^*]*?)\*(?=\s|$|[.,!?])/g, '$1$2')}</Fragment>
    ),
  );
}

export function AnswerText({ text }: { text: string }) {
  return (
    <div className="space-y-2">
      {blocks(text).map((b, i) => {
        if (b.kind === 'h') return <p key={i} className="font-semibold">{inline(b.text)}</p>;
        if (b.kind === 'p')
          return (
            <p key={i}>
              {b.lines.map((l, j) => (
                <Fragment key={j}>
                  {j > 0 && <br />}
                  {inline(l)}
                </Fragment>
              ))}
            </p>
          );
        const items = b.items.map((it, j) => (
          <li key={j} className="pl-1">
            {inline(it)}
          </li>
        ));
        return b.kind === 'ul' ? (
          <ul key={i} className="list-disc space-y-1 pl-5 marker:text-muted-foreground">
            {items}
          </ul>
        ) : (
          <ol key={i} start={b.start} className="list-decimal space-y-1 pl-5 marker:text-muted-foreground">
            {items}
          </ol>
        );
      })}
    </div>
  );
}
