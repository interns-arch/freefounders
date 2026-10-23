/**
 * "Getting started" on Home (PLAN.md §20.5 step 5, §21.1), for the owner and admins of a self-serve company: office
 * location, invite the team, first attendance, the phone app, a plan. Each step is ticked from live data (the phone
 * app by hand). Hidden per company on this device, and by itself once everything is done.
 */
import type { Access } from '@freefounders/core';
import { usePeople } from '@freefounders/core/admin';
import { useAttendanceToday, useOfficeLocations } from '@freefounders/core/hr';
import { ArrowRight, Check, ChevronDown, X } from '@/components/icons';
import { useState } from 'react';
import { Link } from 'react-router';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

const key = (cid: string, what: string) => `ff-getting-started:${what}:${cid}`;
function read(k: string) {
  try {
    return localStorage.getItem(k) === '1';
  } catch {
    return false;
  }
}
function write(k: string, on: boolean) {
  try {
    if (on) localStorage.setItem(k, '1');
    else localStorage.removeItem(k);
  } catch {
    /* private mode */
  }
}

/** Shown to owners / admins of a company with an account and a subscription (not Complimentary installs). */
export function showsChecklist(a: Access) {
  return !!a.platform?.account && a.isAdmin && !!a.billing && a.billing.plan !== 'complimentary';
}

interface Item {
  id: string;
  title: string;
  text: string;
  done: boolean;
  to?: string;
  action?: string;
  manual?: boolean;
}

export function GettingStarted({ access, welcome }: { access: Access; welcome?: boolean }) {
  const cid = access.claims?.cid ?? '';
  const tasks = access.tasks.on;
  const offices = useOfficeLocations(tasks);
  const today = useAttendanceToday(tasks);
  const people = usePeople();
  const [hidden, setHidden] = useState(() => !welcome && read(key(cid, 'hidden')));
  const [phoneDone, setPhoneDone] = useState(() => read(key(cid, 'phone')));
  const [open, setOpen] = useState(true);

  const b = access.billing;
  const items: Item[] = [
    ...(tasks
      ? [
          {
            id: 'office',
            title: 'Set your office location',
            text: 'Attendance checks people punch in at the office (geo-fence).',
            done: (offices.data?.length ?? 0) > 0,
            to: '/attendance/settings',
            action: 'Add office',
          },
        ]
      : []),
    { id: 'invite', title: 'Invite your team', text: 'Share an invite link: they join with their mobile or email.', done: (people.data?.length ?? 0) > 1, to: '/people?invite=1', action: 'Invite' },
    ...(tasks
      ? [{ id: 'punch', title: 'Mark your first attendance', text: 'Punch in from Home or the Attendance page.', done: !!today.data?.attendance?.check_in, to: '/attendance', action: 'Punch in' }]
      : []),
    {
      id: 'phone',
      title: 'Install the phone app',
      text: 'On Android, open this address in Chrome and choose “Add to Home screen”, or install the Kaampilot app your admin shares.',
      done: phoneDone,
      manual: true,
    },
    {
      id: 'plan',
      title: 'Choose a plan',
      text: b?.state === 'trialing' ? `Your trial has ${b.daysLeft ?? 'a few'} days left.` : 'Free, or a paid plan for more users and apps.',
      done: !!b && b.state !== 'trialing' && (b.state === 'active' || b.plan === 'free'),
      to: '/billing',
      action: 'See plans',
    },
  ];
  const done = items.filter((i) => i.done).length;
  if (hidden || done === items.length) return null;

  const dismiss = () => {
    write(key(cid, 'hidden'), true);
    setHidden(true);
  };

  return (
    <section aria-labelledby="getting-started" className="rounded-xl border bg-card shadow-card">
      <div className="flex items-center gap-3 p-4 sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 id="getting-started" className="text-[17px] font-semibold tracking-tight">
            Getting started
          </h2>
          <p className="text-[13px] text-muted-foreground" aria-live="polite">
            {done} of {items.length} done
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-controls="getting-started-list" aria-label={open ? 'Collapse checklist' : 'Expand checklist'}>
          <ChevronDown className={cn('transition-transform', open && 'rotate-180')} />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={dismiss} aria-label="Hide checklist">
          <X />
        </Button>
      </div>
      <Progress value={(done / items.length) * 100} className="mx-4 h-1.5 w-auto sm:mx-5" />
      {open && (
        <ol id="getting-started-list" className="mt-2 divide-y">
          {items.map((i) => (
            <li key={i.id} className="flex items-start gap-3 px-4 py-3 sm:px-5">
              <span
                className={cn('mt-0.5 grid size-6 shrink-0 place-items-center rounded-md border', i.done ? 'border-success bg-success text-white dark:text-background' : 'border-input')}
                aria-hidden
              >
                {i.done && <Check className="size-3.5" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('text-[15px] font-medium', i.done && 'text-muted-foreground line-through')}>
                  {i.title}
                  <span className="sr-only">{i.done ? ' (done)' : ' (to do)'}</span>
                </p>
                {!i.done && <p className="text-[13px] text-muted-foreground">{i.text}</p>}
              </div>
              {!i.done &&
                (i.manual ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      write(key(cid, 'phone'), true);
                      setPhoneDone(true);
                    }}
                  >
                    Mark done
                  </Button>
                ) : i.to ? (
                  <Button asChild variant="outline" size="sm">
                    <Link to={i.to}>
                      {i.action} <ArrowRight />
                    </Link>
                  </Button>
                ) : null)}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
