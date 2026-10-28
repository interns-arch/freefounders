/**
 * "Ask Kaampilot" (PLAN.md §24.3): a round help button bottom-right that opens a small chat panel. Answers come from the
 * Platform's AI helper (knowledge about Kaampilot only). The chat lives in memory for this visit only. While the helper
 * is switched off (GET /ai/status → enabled false) the button still shows (founder 2026-10-28: "so I can check the
 * frontend") and the panel says it is coming soon.
 *
 * Phones: in the app frame it sits above the bottom bar (Attendance · Home · …), never over it; the Punch button is in
 * the page flow at the top of Home / Attendance, so it is never covered. On a page without the bottom bar (website),
 * pass `aboveBottomBar={false}`.
 */
import { errorMessage } from '@kaampilot/core';
import { AI_MAX_QUESTION, isAiOff, useAiStatus, useAskAi, type AiTurn } from '@kaampilot/core/ai';
import { type FormEvent, useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router';
import { Loader2, Send, Sparkles, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const SUGGESTIONS = ['How do I punch in?', 'How do I fix a missed punch?', 'How do I add a task?', 'What does Kaampilot cost?'];
const OFF_TEXT = "The AI helper isn't set up yet.";

/** Answers are plain text; drop Markdown emphasis marks the model may still use. */
function plain(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/^#+\s*/gm, '');
}

export function AiHelper({ aboveBottomBar = true }: { aboveBottomBar?: boolean } = {}) {
  const status = useAiStatus();
  const ask = useAskAi();
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [turns, setTurns] = useState<AiTurn[]>([]);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, ask.isPending, error]);

  if (status.isLoading) return null;
  const off = !status.data?.enabled;

  const close = () => {
    setOpen(false);
    buttonRef.current?.focus();
  };

  const send = (text: string) => {
    const question = text.trim().slice(0, AI_MAX_QUESTION);
    if (!question || ask.isPending) return;
    const history = turns;
    setTurns([...history, { role: 'user', text: question }]);
    setDraft('');
    setError(null);
    ask.mutate(
      { question, history, page: pathname },
      {
        onSuccess: (r) => setTurns((t) => [...t, { role: 'assistant', text: r.answer }]),
        onError: (err) => {
          setError(isAiOff(err) ? OFF_TEXT : errorMessage(err));
          // Take the unanswered question back into the box so it can be sent again.
          setTurns((t) => (t.at(-1)?.role === 'user' ? t.slice(0, -1) : t));
          setDraft(question);
        },
      },
    );
  };

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    send(draft);
  };

  // Above the phone bottom bar (min-h-14 + the safe area) in the app; the usual corner otherwise and on large screens.
  const bottom = aboveBottomBar ? 'bottom-[calc(4.25rem+env(safe-area-inset-bottom))] lg:bottom-6' : 'bottom-[calc(1rem+env(safe-area-inset-bottom))] lg:bottom-6';

  return (
    <>
      {!open && (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-haspopup="dialog"
          aria-label="Ask Kaampilot"
          title="Ask Kaampilot"
          className={cn(
            'fixed right-4 z-40 grid size-12 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground shadow-md outline-none transition-[filter] hover:brightness-95 focus-visible:ring-[3px] focus-visible:ring-ring/40 lg:right-6',
            bottom,
          )}
        >
          <Sparkles className="size-5" />
        </button>
      )}
      {open && (
        <section
          role="dialog"
          aria-modal="false"
          aria-labelledby={titleId}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.stopPropagation();
              close();
            }
          }}
          className={cn(
            'fixed inset-x-2 z-40 flex max-h-[min(70dvh,560px)] flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-lg sm:inset-x-auto sm:right-4 sm:w-[380px] lg:right-6',
            bottom,
          )}
        >
          <header className="flex items-center gap-2 border-b px-3 py-2">
            <span className="grid size-7 shrink-0 place-items-center rounded-md bg-primary/10 text-primary" aria-hidden>
              <Sparkles className="size-4" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="text-sm font-semibold">
                Ask Kaampilot
              </h2>
              <p className="truncate text-xs text-muted-foreground">How-to help in English, Hindi or Hinglish</p>
            </div>
            <Button variant="ghost" size="icon-sm" onClick={close} aria-label="Close Ask Kaampilot">
              <X />
            </Button>
          </header>

          <div ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-3 py-3" aria-live="polite" aria-busy={ask.isPending}>
            {off && turns.length === 0 && (
              <p className="rounded-md border border-dashed px-3 py-2 text-sm text-muted-foreground">
                The AI helper is coming soon. Until then, write to support@kaampilot.com and we will help.
              </p>
            )}
            {turns.length === 0 && (
              <div className="space-y-2">
                <p className="text-sm text-muted-foreground">Ask how to do something in Kaampilot. Try:</p>
                <ul className="flex flex-col gap-1.5">
                  {SUGGESTIONS.map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        onClick={() => send(s)}
                        disabled={ask.isPending}
                        className="w-full cursor-pointer rounded-md border bg-background px-3 py-2 text-left text-sm outline-none hover:border-primary/40 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50"
                      >
                        {s}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {turns.map((t, i) => (
              <div key={i} className={cn('flex', t.role === 'user' ? 'justify-end' : 'justify-start')}>
                <p
                  className={cn(
                    'max-w-[85%] rounded-lg px-3 py-2 text-sm break-words whitespace-pre-wrap',
                    t.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-muted text-foreground',
                  )}
                >
                  <span className="sr-only">{t.role === 'user' ? 'You: ' : 'Kaampilot: '}</span>
                  {t.role === 'assistant' ? plain(t.text) : t.text}
                </p>
              </div>
            ))}
            {ask.isPending && (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Thinking…
              </p>
            )}
            {error && (
              <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                {error}
              </p>
            )}
          </div>

          <form onSubmit={onSubmit} className="flex items-end gap-2 border-t p-2">
            <label htmlFor={`${titleId}-q`} className="sr-only">
              Your question
            </label>
            <textarea
              id={`${titleId}-q`}
              ref={inputRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value.slice(0, AI_MAX_QUESTION))}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
                  e.preventDefault();
                  send(draft);
                }
              }}
              rows={1}
              maxLength={AI_MAX_QUESTION}
              placeholder="Type your question…"
              className="max-h-28 min-h-10 flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-base outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/40 sm:text-sm"
            />
            <Button type="submit" size="icon" disabled={!draft.trim() || ask.isPending} aria-label="Send question">
              <Send />
            </Button>
          </form>
          <p className="px-3 pb-2 text-[11px] text-muted-foreground">AI answers can be wrong. Support: support@kaampilot.com</p>
        </section>
      )}
    </>
  );
}
