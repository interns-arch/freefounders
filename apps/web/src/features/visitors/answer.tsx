/**
 * "Your visitor" (PLAN.md §22.11): /visitors/answer?visit=<id>, opened from the notification or the WhatsApp button.
 * The host says where the visitor should wait (a place from the company's list, "I'm coming to the gate" or "Not
 * available", + a note); the guard sees it at once.
 */
import { errorMessage } from '@kaampilot/core';
import { type HostAnswer, type VisitorConfig, useAnswerVisit, useVisit, useVisitPhoto } from '@kaampilot/core/visitors';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { toast } from 'sonner';
import { Check, Clock, MapPin, UserRoundX, Footprints } from '@/components/icons';
import { Field } from '@/components/common/form';
import { EmptyState, ErrorState, PageHeader, PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { PrivatePhoto, StatusBadge, clock } from './parts';

type Choice = { answer: HostAnswer; place?: string };

export function AnswerPage({ config }: { config: VisitorConfig }) {
  const [params] = useSearchParams();
  const id = Number(params.get('visit')) || null;
  const q = useVisit(id, true);
  const photo = useVisitPhoto(q.data?.has_photo ? q.data.id : null);
  const answer = useAnswerVisit();
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState('');
  const v = q.data;
  useEffect(() => {
    if (v?.host_answer) {
      setChoice({ answer: v.host_answer, place: v.host_place || undefined });
      setNote(v.host_note);
    }
  }, [v?.id, v?.host_answered_at]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!id) return <EmptyState title="No visitor picked" description="Open this from the notification about your visitor." />;
  if (q.error) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  if (!v) return <PageLoader />;
  const open = v.status === 'inside' || v.status === 'waiting_host';
  const choices: Array<{ key: string; label: string; icon: typeof MapPin; c: Choice }> = [
    ...config.waiting_places.map((p) => ({ key: `place:${p}`, label: p, icon: MapPin, c: { answer: 'place' as const, place: p } })),
    { key: 'coming', label: 'I’m coming to the gate', icon: Footprints, c: { answer: 'coming' } },
    { key: 'unavailable', label: 'Not available', icon: UserRoundX, c: { answer: 'unavailable' } },
  ];
  const keyOf = (c: Choice | null) => (c ? (c.answer === 'place' ? `place:${c.place}` : c.answer) : '');

  const send = async () => {
    if (!choice) return void toast.error('Pick where they should wait.');
    try {
      await answer.mutateAsync({ id: v.id, ...choice, note: note.trim() });
      toast.success('The guard has your answer');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <PageHeader title="Your visitor" description="Tell the guard where they should wait." />
      <Card>
        <CardContent className="flex gap-3 pt-4">
          <PrivatePhoto query={photo} alt={v.name} className="size-20 shrink-0" />
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">{v.name}</span>
              <StatusBadge visit={v} />
            </div>
            <p className="text-[13px] text-muted-foreground">{[v.company, v.purpose, v.people > 1 ? `${v.people} people` : null].filter(Boolean).join(' · ')}</p>
            <p className="flex items-center gap-1.5 text-[13px] text-muted-foreground">
              <Clock className="size-4" aria-hidden /> At the gate since {clock(v.check_in_at ?? v.created_at)}
              {v.location ? ` · ${v.location.name}` : ''}
            </p>
          </div>
        </CardContent>
      </Card>
      {v.status === 'waiting_host' && (
        <p className="rounded-md border bg-muted px-3 py-2 text-[13px]">
          First allow or deny them in <Link to={`/visitors/my?visit=${v.id}`} className="font-medium text-primary underline-offset-4 hover:underline">My visitors</Link>.
        </p>
      )}
      {!open ? (
        <EmptyState title="This visit is over" description={v.host_answer ? `You answered at ${clock(v.host_answered_at)}.` : 'Nothing to answer now.'} />
      ) : (
        <Card>
          <CardContent className="space-y-4 pt-4">
            <fieldset className="space-y-2">
              <legend className="text-[15px] font-semibold">Where should they wait?</legend>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Where should they wait?">
                {choices.map((x) => {
                  const on = keyOf(choice) === x.key;
                  return (
                    <button
                      key={x.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      data-testid={`answer-${x.key}`}
                      onClick={() => setChoice(x.c)}
                      className={cn(
                        'flex min-h-12 cursor-pointer items-center gap-2.5 rounded-md border px-3 py-2 text-left text-[15px] font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                        on ? 'border-primary bg-primary/10 text-primary' : 'bg-card hover:bg-muted',
                      )}
                    >
                      <x.icon className="size-5 shrink-0" aria-hidden />
                      <span className="flex-1">{x.label}</span>
                      {on && <Check className="size-5 shrink-0" aria-hidden />}
                    </button>
                  );
                })}
              </div>
            </fieldset>
            <Field label="Note for the guard (optional)">
              <Input value={note} onChange={(e) => setNote(e.target.value.slice(0, 200))} placeholder="e.g. 5 minutes, offer water" className="h-11" />
            </Field>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[13px] text-muted-foreground">{v.host_answered_at ? `Answered at ${clock(v.host_answered_at)}${v.sent_to_place_at ? ` · sent there at ${clock(v.sent_to_place_at)}` : ''}` : 'The guard sees your answer at once.'}</p>
              <Button variant="cta" size="lg" onClick={() => void send()} loading={answer.isPending} className="max-sm:w-full">
                {v.host_answered_at ? 'Update answer' : 'Send to the guard'}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
