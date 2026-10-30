/** My roster (PLAN.md §28.4): the signed-in person's next 14 days on Attendance › Today (the phone app shows the same). */
import { useMyRoster } from '@kaampilot/core/hr';
import { CalendarClock } from '@/components/icons';
import { cn } from '@/lib/utils';
import { Panel } from '../tasks/general/parts';
import { ShiftCode, shiftHours } from './shift-parts';

export function MyRosterCard() {
  const q = useMyRoster(14);
  // Shown only when a roster or a default shift decides this person's days; plain office hours need no card.
  if (!q.data?.uses_roster) return null;
  return (
    <Panel icon={CalendarClock} tone="info" title="My roster" description="Your shifts for the next 14 days." className="max-w-2xl">
      <ul className="no-scrollbar -mx-1 flex gap-2 overflow-x-auto px-1 pb-1" aria-label="My shifts">
        {q.data.days.map((d, i) => {
          const date = new Date(`${d.date}T12:00:00`);
          const what = d.leave ? `${d.leave.type} leave${d.leave.status === 'pending' ? ' (pending)' : ''}` : d.holiday ? d.holiday : d.off ? 'Off' : `${d.name} ${shiftHours(d.start, d.end, d.overnight)}`;
          return (
            <li
              key={d.date}
              className={cn('flex w-[5.5rem] shrink-0 flex-col items-center gap-1 rounded-md border bg-card px-2 py-2 text-center', i === 0 && 'border-primary/50 bg-primary/5')}
              aria-label={`${d.weekday} ${date.getDate()}: ${what}`}
              title={what}
            >
              <span className={cn('text-xs text-muted-foreground', i === 0 && 'font-semibold text-primary')}>{i === 0 ? 'Today' : d.weekday}</span>
              <span className="font-mono text-sm font-semibold">{date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
              {d.leave ? (
                <ShiftCode code="L" colour="info" />
              ) : d.holiday ? (
                <ShiftCode code="H" colour="primary" />
              ) : d.off ? (
                <ShiftCode code={d.code && d.source === 'roster' ? d.code : 'WO'} colour="muted" />
              ) : (
                <ShiftCode code={d.code || 'O'} colour={d.colour || 'muted'} />
              )}
              <span className="text-xs leading-tight text-muted-foreground">{d.leave || d.holiday || d.off ? (d.off && !d.leave && !d.holiday ? 'Off' : d.leave ? 'Leave' : 'Holiday') : `${d.start}–${d.end}`}</span>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
