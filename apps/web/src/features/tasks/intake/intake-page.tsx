/** /tasks/intake — the AI inbox: inbound WhatsApp / Gmail messages, how the AI read them, and the lead each became (old pages/Intake.jsx). */
import { errorMessage, useAccess } from '@kaampilot/core';
import { INTAKE_CHANNELS, INTAKE_STATUSES, type InboundMessage, type IntakeChannel, type IntakeStatus, tasksExports, useIntakeMessages, useSimulateIntake } from '@kaampilot/core/tasks';
import { fileSlug, todayStamp } from '@kaampilot/core/export';
import { DownloadMenu } from '@/components/common/download-menu';
import { Bot, Mail, MessageCircle, Send } from '@/components/icons';
import { useState } from 'react';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { EmptyState, ErrorState, PageHeader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Input, Label, NativeSelect, Textarea } from '@/components/ui/input';
import { Card, Skeleton } from '@/components/ui/primitives';
import { Chip, ErrorNote, Panel, Segmented, type Tone, fmtWhen } from '../general/parts';

const STATUS_TONE: Record<IntakeStatus, Tone> = { pending: 'neutral', processed: 'success', ignored: 'warning', failed: 'danger' };

export function IntakePage() {
  const access = useAccess();
  const canSimulate = access.tasks.can('settings.manage');
  const [channel, setChannel] = useState<IntakeChannel | ''>('');
  const [status, setStatus] = useState<IntakeStatus | ''>('');
  const q = useIntakeMessages({ channel, status });

  return (
    <div className="space-y-4">
      <PageHeader
        className="mb-0"
        title="AI inbox"
        description="Incoming WhatsApp and Gmail messages, how the AI classified them, and the lead each became. Channels go live once their credentials are set for the company."
        actions={
          <DownloadMenu
            target={tasksExports.intake({ channel, status })}
            filename={fileSlug('tasks', 'ai-inbox', channel, status, todayStamp())}
            empty={q.data?.length === 0}
            loading={!q.data && !q.error}
          />
        }
      />
      {canSimulate && <Simulator />}
      <div className="flex flex-wrap items-center gap-2">
        <Segmented
          label="Channel filter"
          value={channel}
          onChange={setChannel}
          options={[['', 'All channels'], ...INTAKE_CHANNELS.map(([v, l]) => [v, l] as [IntakeChannel | '', string])]}
        />
        <NativeSelect aria-label="Status" className="w-auto" value={status} onChange={(e) => setStatus(e.target.value as IntakeStatus | '')}>
          <option value="">Any status</option>
          {INTAKE_STATUSES.map(([v, l]) => (
            <option key={v} value={v}>
              {l}
            </option>
          ))}
        </NativeSelect>
      </div>
      {q.error && <ErrorState error={q.error} onRetry={() => q.refetch()} />}
      {!q.data && !q.error && <Skeleton className="h-40" />}
      {q.data?.length === 0 && (
        <Card>
          <EmptyState icon={Bot} title="No inbound messages yet" description={channel || status ? 'Nothing matches this filter.' : 'Messages show up here as soon as a channel is live.'} />
        </Card>
      )}
      <ul className="grid gap-2">
        {q.data?.map((m) => (
          <li key={m.id}>
            <MessageRow m={m} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function MessageRow({ m }: { m: InboundMessage }) {
  const ai = m.ai_result;
  const ChannelIcon = m.channel === 'whatsapp' ? MessageCircle : Mail;
  return (
    <Card className="p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <Chip tone={m.channel === 'whatsapp' ? 'success' : 'info'}>
          <ChannelIcon className="size-3" aria-hidden /> {m.channel === 'whatsapp' ? 'WhatsApp' : 'Gmail'}
        </Chip>
        <strong className="text-sm">{m.sender_name || m.sender}</strong>
        <span className="text-xs text-muted-foreground">{m.sender}</span>
        <Chip tone={STATUS_TONE[m.status] ?? 'neutral'}>{m.status}</Chip>
        <span className="text-xs text-muted-foreground sm:ml-auto">{fmtWhen(m.created_at)}</span>
      </div>
      {m.subject && <div className="mt-1.5 text-sm font-medium">{m.subject}</div>}
      <p className="mt-1 text-sm whitespace-pre-line">{m.body || '—'}</p>
      {m.media?.length > 0 && (
        <p className="mt-1 text-xs text-muted-foreground">
          {m.media.length} attachment{m.media.length === 1 ? '' : 's'}: {m.media.map((x) => x.caption || x.mime_type || 'file').join(', ')}
        </p>
      )}
      {ai?.intent && (
        <div className="mt-2 flex flex-wrap gap-1.5" aria-label="AI reading">
          <Chip tone="primary">intent: {ai.intent}</Chip>
          {ai.vehicle && <Chip>vehicle: {ai.vehicle}</Chip>}
          {(ai.items ?? []).map((it, i) => (
            <Chip key={i} tone="info">
              {it.quantity ? `${it.quantity}× ` : ''}
              {it.name}
            </Chip>
          ))}
          {ai.priority && <Chip>priority: {ai.priority}</Chip>}
          {ai.department && <Chip>dept: {ai.department}</Chip>}
          {ai.provider && <Chip tone="neutral">via {ai.provider}</Chip>}
        </div>
      )}
      {m.lead && (
        <p className="mt-2 text-sm">
          → Lead:{' '}
          <Link to={`/tasks/leads?lead=${m.lead}`} className="font-medium text-primary hover:underline">
            {m.lead_name || `#${m.lead}`}
          </Link>
        </p>
      )}
      {m.error && <ErrorNote className="mt-2">{m.error}</ErrorNote>}
    </Card>
  );
}

function Simulator() {
  const run = useSimulateIntake();
  const [f, setF] = useState({ channel: 'whatsapp' as IntakeChannel, sender: '919876543210', sender_name: 'Suresh Kumar', subject: '', body: '' });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value }));
  const ready = !!f.body.trim() && !!f.sender.trim();

  const send = () => {
    if (!ready) return;
    run.mutate(f, {
      onSuccess: (m) => {
        setF((p) => ({ ...p, body: '' }));
        toast.success(m.lead ? `Processed — became lead "${m.lead_name}"` : `Processed (${m.status})`);
      },
    });
  };

  return (
    <Panel title="Simulator" description="Runs the real pipeline on the text below — for testing before the live webhook is connected.">
      <form
        className="grid gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="grid gap-1.5">
            <Label htmlFor="sim-channel">Channel</Label>
            <NativeSelect id="sim-channel" value={f.channel} onChange={set('channel')}>
              {INTAKE_CHANNELS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </NativeSelect>
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sim-sender">{f.channel === 'whatsapp' ? 'Phone' : 'Email'} *</Label>
            <Input id="sim-sender" value={f.sender} onChange={set('sender')} placeholder={f.channel === 'whatsapp' ? 'e.g. 9198…' : 'name@example.com'} required />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="sim-name">Sender name</Label>
            <Input id="sim-name" value={f.sender_name} onChange={set('sender_name')} />
          </div>
          {f.channel === 'gmail' && (
            <div className="grid gap-1.5 sm:col-span-3">
              <Label htmlFor="sim-subject">Subject</Label>
              <Input id="sim-subject" value={f.subject} onChange={set('subject')} />
            </div>
          )}
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="sim-body">Message *</Label>
          <Textarea
            id="sim-body"
            rows={2}
            value={f.body}
            onChange={set('body')}
            placeholder='Try: "Need brake pad and oil filter for Tata 407."'
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                send();
              }
            }}
          />
        </div>
        {run.error && <ErrorNote>{errorMessage(run.error)}</ErrorNote>}
        <div className="flex justify-end">
          <Button type="submit" disabled={!ready} loading={run.isPending}>
            <Send /> {run.isPending ? 'Processing…' : 'Send'}
          </Button>
        </div>
      </form>
    </Panel>
  );
}
