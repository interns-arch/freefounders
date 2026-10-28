/**
 * "Ask Kaampilot" (PLAN.md §24.3, UI v2 2026-10-28): an "Ask AI" button in the top header, next to the bell (app frame)
 * or the theme switch (website), opening a full-height panel from the right, like a Notion AI / ChatGPT side panel.
 *
 * - From 1280 px the panel sits beside the page: `html[data-ai-panel]` gives the body a right padding as wide as the
 *   panel (index.css), so nothing is covered and the page stays usable (non-modal).
 * - 640–1279 px: the panel lies over the page with a light scrim (click it to close); Tab stays inside the panel.
 * - Phones: full screen above the bottom bar, sized to the visual viewport so the keyboard never hides the box (the
 *   phone app is this page in a WebView), with Back at the top left and safe-area padding.
 * - Esc closes, focus goes into the panel and back to the button; Ctrl+/ (⌘/ on a Mac) opens and closes it.
 * Answers come from the Platform's AI helper (Kaampilot knowledge only) and are shown with a small safe Markdown subset
 * (answer-text.tsx). The chat is kept for this visit (sessionStorage). While /ai/status says disabled the button still
 * shows and the panel says it is coming soon (founder 2026-10-28: "so I can check the frontend").
 */
import { errorMessage } from '@kaampilot/core';
import { AI_MAX_QUESTION, isAiOff, useAiStatus, useAskAi, type AiTurn } from '@kaampilot/core/ai';
import { type KeyboardEvent as ReactKeyboardEvent, useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation } from 'react-router';
import { BrandMark } from '@/components/brand';
import { ArrowLeft, Check, Copy, Loader2, Plus, RefreshCw, Send, Sparkles, X } from '@/components/icons';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { AnswerText } from './answer-text';
import { suggestionsFor } from './suggestions';

const OFF_TEXT = "The AI helper isn't set up yet.";
const STORE = 'ff-ai-chat';
/** The counter shows from here on. */
const COUNT_FROM = AI_MAX_QUESTION - 200;
const MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
const SHORTCUT = MAC ? '⌘/' : 'Ctrl+/';

function loadTurns(): AiTurn[] {
  try {
    const raw = sessionStorage.getItem(STORE);
    const v: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(v) ? v.filter((t): t is AiTurn => (t?.role === 'user' || t?.role === 'assistant') && typeof t.text === 'string') : [];
  } catch {
    return [];
  }
}

function saveTurns(turns: AiTurn[]) {
  try {
    if (turns.length) sessionStorage.setItem(STORE, JSON.stringify(turns.slice(-40)));
    else sessionStorage.removeItem(STORE);
  } catch {
    /* private mode / storage blocked: the chat just isn't kept */
  }
}

function useMedia(query: string) {
  const [on, setOn] = useState(() => typeof window !== 'undefined' && window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const fn = () => setOn(mq.matches);
    fn();
    mq.addEventListener('change', fn);
    return () => mq.removeEventListener('change', fn);
  }, [query]);
  return on;
}

/** The visible part of the screen on a phone (shrinks when the keyboard opens). */
function useVisualViewport(active: boolean) {
  const [box, setBox] = useState<{ height: number; top: number } | null>(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!active || !vv) {
      setBox(null);
      return;
    }
    const on = () => setBox({ height: vv.height, top: vv.offsetTop });
    on();
    vv.addEventListener('resize', on);
    vv.addEventListener('scroll', on);
    return () => {
      vv.removeEventListener('resize', on);
      vv.removeEventListener('scroll', on);
    };
  }, [active]);
  return box;
}

type Failure = { text: string; question: string; off: boolean };

/**
 * The header button and its panel. `site` = the public website (website questions, no app context).
 */
export function AskAi({ site = false, className }: { site?: boolean; className?: string }) {
  const [open, setOpen] = useState(false);
  // The panel is mounted on first open and then kept, so closing can slide out.
  const [mounted, setMounted] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  const show = useCallback(() => {
    setMounted(true);
    setOpen(true);
  }, []);
  const close = useCallback(() => {
    setOpen(false);
    buttonRef.current?.focus();
  }, []);

  // Ctrl+/ (⌘/): open, or close when open. Works while typing too.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.altKey || e.shiftKey || !(MAC ? e.metaKey : e.ctrlKey)) return;
      e.preventDefault();
      if (open) close();
      else show();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close, show]);

  return (
    <>
      <Button
        ref={buttonRef}
        variant="ghost"
        onClick={() => (open ? close() : show())}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={mounted ? panelId : undefined}
        aria-label="Ask AI"
        title={`Ask Kaampilot (${SHORTCUT})`}
        className={cn(
          'h-9 gap-1.5 px-3 text-muted-foreground hover:text-primary max-md:px-0 max-sm:size-11 sm:max-md:size-9',
          open && 'bg-primary/10 text-primary',
          className,
        )}
      >
        <Sparkles className="size-5 md:size-4" />
        <span className="max-md:hidden">Ask AI</span>
      </Button>
      {mounted && createPortal(<Panel id={panelId} open={open} onClose={close} site={site} />, document.body)}
    </>
  );
}

function Panel({ id, open, onClose, site }: { id: string; open: boolean; onClose: () => void; site: boolean }) {
  const status = useAiStatus();
  const ask = useAskAi();
  const { pathname } = useLocation();
  const wide = useMedia('(min-width: 1280px)');
  const phone = useMedia('(max-width: 639px)');
  const coarse = useMedia('(pointer: coarse)');
  const vv = useVisualViewport(open && phone);
  const [turns, setTurns] = useState<AiTurn[]>(loadTurns);
  const [draft, setDraft] = useState('');
  const [failure, setFailure] = useState<Failure | null>(null);
  const [copied, setCopied] = useState<number | null>(null);
  const panelRef = useRef<HTMLElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const titleId = `${id}-title`;
  const off = status.data ? !status.data.enabled : status.isError;

  useEffect(() => saveTurns(turns), [turns]);

  // Beside the page from 1280 px (index.css pads the body while this is set).
  useEffect(() => {
    const html = document.documentElement;
    if (open) html.dataset.aiPanel = '';
    else delete html.dataset.aiPanel;
    return () => {
      delete html.dataset.aiPanel;
    };
  }, [open]);

  // Focus into the panel: the question box with a keyboard; the title on touch screens (no keyboard popping up).
  useEffect(() => {
    if (!open) return;
    const t = window.setTimeout(() => (coarse ? headingRef.current : inputRef.current)?.focus({ preventScroll: true }), 30);
    return () => window.clearTimeout(t);
  }, [open, coarse]);

  // Keep the newest message in view.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns, ask.isPending, failure, open]);

  // Grow the question box with its text (up to ~6 lines).
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [draft]);

  const send = (text: string) => {
    const question = text.trim().slice(0, AI_MAX_QUESTION);
    if (!question || ask.isPending) return;
    const history = turns;
    setTurns([...history, { role: 'user', text: question }]);
    setDraft('');
    setFailure(null);
    ask.mutate(
      { question, history, page: pathname },
      {
        onSuccess: (r) => setTurns((t) => [...t, { role: 'assistant', text: r.answer }]),
        onError: (err) => {
          const isOff = isAiOff(err);
          setFailure({ text: isOff ? OFF_TEXT : errorMessage(err), question, off: isOff });
          // Take the unanswered question back into the box so it can be changed or sent again.
          setTurns((t) => (t.at(-1)?.role === 'user' ? t.slice(0, -1) : t));
          setDraft(question);
        },
      },
    );
  };

  const newChat = () => {
    setTurns([]);
    setFailure(null);
    setDraft('');
    ask.reset();
    inputRef.current?.focus();
  };

  const copy = async (i: number, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(i);
      window.setTimeout(() => setCopied((c) => (c === i ? null : c)), 1500);
    } catch {
      setCopied(null);
    }
  };

  const onKeyDown = (e: ReactKeyboardEvent<HTMLElement>) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      onClose();
      return;
    }
    // Over the page (under 1280 px) Tab stays inside the panel.
    if (e.key === 'Tab' && !wide && panelRef.current) {
      const items = [...panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), textarea, a[href], [tabindex]:not([tabindex="-1"])')];
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === headingRef.current)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  const suggestions = suggestionsFor(pathname, site);
  const empty = turns.length === 0;

  return (
    <>
      {/* Light scrim over the page from 640 to 1279 px (no blur); phones are full screen, wide screens push the page. */}
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-foreground/10 transition-opacity duration-200 motion-reduce:transition-none max-sm:hidden xl:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0',
        )}
      />
      <section
        ref={panelRef}
        id={id}
        role="dialog"
        aria-modal={!wide}
        aria-labelledby={titleId}
        inert={!open}
        onKeyDown={onKeyDown}
        data-testid="ask-ai-panel"
        style={phone && vv ? { top: vv.top, height: vv.height } : undefined}
        className={cn(
          'fixed z-50 flex flex-col bg-card text-card-foreground',
          'inset-x-0 top-0 h-dvh pt-[env(safe-area-inset-top)] pb-[env(safe-area-inset-bottom)]',
          'sm:inset-x-auto sm:right-0 sm:w-[var(--kp-ai-w)] sm:border-l sm:pt-0 sm:pb-0 sm:shadow-lg xl:shadow-none',
          'transition-[transform,opacity,visibility] duration-250 ease-out motion-reduce:transition-none',
          open ? 'visible translate-x-0 opacity-100' : 'invisible translate-x-8 opacity-0 sm:translate-x-full',
        )}
      >
        <header className="flex shrink-0 items-center gap-2 border-b px-2 py-2 sm:px-3">
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close Ask Kaampilot" className="sm:hidden">
            <ArrowLeft className="size-5" />
          </Button>
          <span className="grid size-8 shrink-0 place-items-center rounded-md bg-primary/10 text-primary max-sm:hidden" aria-hidden>
            <Sparkles className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id={titleId} ref={headingRef} tabIndex={-1} className="text-[15px] leading-tight font-semibold outline-none">
              Ask Kaampilot
            </h2>
            <p className="truncate text-xs text-muted-foreground">Help in English, Hindi or Hinglish</p>
          </div>
          <Button variant="ghost" size="sm" onClick={newChat} disabled={empty && !failure && !draft} title="Start a new chat" className="text-muted-foreground hover:text-foreground">
            <Plus /> New chat
          </Button>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close Ask Kaampilot" title="Close (Esc)" className="max-sm:hidden">
            <X />
          </Button>
        </header>

        <div ref={listRef} className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 scrollbar-thin" aria-live="polite" aria-busy={ask.isPending}>
          {empty ? (
            <div className="mx-auto flex max-w-sm flex-col gap-4 pt-2 sm:pt-6">
              <div className="flex flex-col items-center text-center">
                <BrandMark size={44} />
                <p className="mt-3 text-lg font-semibold">Namaste! How can I help?</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {site ? 'Ask anything about Kaampilot: features, prices, the free trial or the phone app.' : 'Ask how to do something in Kaampilot. Hindi or Hinglish is fine too.'}
                </p>
              </div>
              {off && (
                <p className="rounded-md border border-dashed bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground" data-testid="ask-ai-coming-soon">
                  The AI helper is coming soon. Until then, write to <span className="font-medium text-foreground">support@kaampilot.com</span> and we will help.
                </p>
              )}
              <div>
                <p className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">Try asking</p>
                <ul className="flex flex-col gap-2">
                  {suggestions.map((s) => (
                    <li key={s}>
                      <button
                        type="button"
                        onClick={() => send(s)}
                        disabled={ask.isPending}
                        className="flex w-full cursor-pointer items-center gap-2 rounded-md border bg-background px-3 py-2.5 text-left text-sm transition-colors outline-none hover:border-primary/40 hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50 max-sm:min-h-11"
                      >
                        <Sparkles className="size-3.5 shrink-0 text-primary" aria-hidden />
                        <span className="min-w-0 flex-1">{s}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ) : (
            <ol className="flex flex-col gap-4" aria-label="Chat">
              {turns.map((t, i) =>
                t.role === 'user' ? (
                  <li key={i} className="flex justify-end">
                    <p className="max-w-[85%] rounded-lg rounded-br-sm bg-primary px-3 py-2 text-sm break-words whitespace-pre-wrap text-primary-foreground">
                      <span className="sr-only">You: </span>
                      {t.text}
                    </p>
                  </li>
                ) : (
                  <li key={i} className="flex gap-2.5">
                    <BrandMark size={24} className="mt-0.5" />
                    <div className="min-w-0 max-w-[88%]">
                      <div className="rounded-lg rounded-tl-sm bg-muted px-3 py-2 text-sm leading-relaxed break-words text-foreground">
                        <span className="sr-only">Kaampilot: </span>
                        <AnswerText text={t.text} />
                      </div>
                      <Button variant="ghost" size="xs" onClick={() => copy(i, t.text)} className="mt-1 h-7 text-muted-foreground hover:text-foreground" aria-label={copied === i ? 'Answer copied' : 'Copy answer'}>
                        {copied === i ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                        {copied === i ? 'Copied' : 'Copy'}
                      </Button>
                    </div>
                  </li>
                ),
              )}
            </ol>
          )}
          {ask.isPending && (
            <div className="mt-4 flex gap-2.5">
              <BrandMark size={24} className="mt-0.5" />
              <p className="flex items-center gap-2 rounded-lg rounded-tl-sm bg-muted px-3 py-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin motion-reduce:animate-none" /> Thinking…
              </p>
            </div>
          )}
          {failure && (
            <div role="alert" className="mt-4 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
              <p className="min-w-0 flex-1 py-0.5">{failure.text}</p>
              {!failure.off && (
                <Button variant="outline" size="xs" onClick={() => send(failure.question)} disabled={ask.isPending}>
                  <RefreshCw className="size-3.5" /> Retry
                </Button>
              )}
            </div>
          )}
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            send(draft);
          }}
          className="shrink-0 border-t px-3 pt-3 pb-2"
        >
          <div className="flex items-end gap-2 rounded-lg border border-input bg-background p-1.5 focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/40">
            <label htmlFor={`${id}-q`} className="sr-only">
              Your question
            </label>
            <textarea
              id={`${id}-q`}
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
              placeholder="Ask a question…"
              className="max-h-40 min-h-9 flex-1 resize-none bg-transparent px-2 py-1.5 text-base outline-none placeholder:text-muted-foreground sm:text-sm"
            />
            <Button type="submit" size="icon-sm" disabled={!draft.trim() || ask.isPending} aria-label="Send question">
              <Send />
            </Button>
          </div>
          {draft.length >= COUNT_FROM && (
            <div className="mt-1.5 flex justify-end text-[11px] text-muted-foreground">
              <span aria-live="polite" className={cn('tabular-nums', draft.length >= AI_MAX_QUESTION && 'font-semibold text-destructive')}>
                {draft.length}/{AI_MAX_QUESTION}
              </span>
            </div>
          )}
        </form>
      </section>
    </>
  );
}
