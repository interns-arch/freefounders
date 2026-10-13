import { ASSET_STATUS_LABELS, type AssetStatus, humanize } from '@eam/shared';
import {
  ArrowLeftRight,
  Archive,
  CheckCircle2,
  CircleDot,
  CirclePlus,
  ClipboardCheck,
  LogOut,
  MapPin,
  PackageCheck,
  Pencil,
  SearchX,
  Trash2,
  Undo2,
  UserPlus,
  Wrench,
  XCircle,
} from 'lucide-react';
import { Link } from 'react-router';
import { Skeleton } from '@/components/ui/primitives';
import type { HistoryEvent } from '@freefounders/core/assets';
import { cn, formatDateTime, relativeTime } from '@/lib/utils';
import { EmptyState } from '@/components/common/page';

const ACTION_STYLE: { match: RegExp; icon: React.ComponentType<{ className?: string }>; tone: string }[] = [
  { match: /^CREATED|ITEM_ADDED/, icon: CirclePlus, tone: 'bg-success/12 text-success' },
  { match: /ASSIGNED|FULFILLED/, icon: UserPlus, tone: 'bg-info/12 text-info' },
  { match: /TRANSFER/, icon: ArrowLeftRight, tone: 'bg-primary/8 text-primary' },
  { match: /RETURNED/, icon: Undo2, tone: 'bg-warning/12 text-warning' },
  { match: /MAINTENANCE|REPAIR/, icon: Wrench, tone: 'bg-warning/12 text-warning' },
  { match: /LOST|MISSING|UNITS_LOST/, icon: SearchX, tone: 'bg-destructive/12 text-destructive' },
  { match: /DISPOSED|DELETED/, icon: Trash2, tone: 'bg-border text-foreground' },
  { match: /RETIRED|ARCHIVED|CANCELLED|REJECTED/, icon: Archive, tone: 'bg-border text-foreground' },
  { match: /INVENTORY|LOCATION/, icon: MapPin, tone: 'bg-app-attendance/12 text-app-attendance' },
  { match: /COMPLETED|RESOLVED|APPROVED|MADE_AVAILABLE|FOUND|RECEIVED|REINSTATED/, icon: CheckCircle2, tone: 'bg-success/12 text-success' },
  { match: /EXIT|OVERRIDDEN/, icon: LogOut, tone: 'bg-warning/12 text-warning' },
  { match: /ITEM_/, icon: ClipboardCheck, tone: 'bg-info/12 text-info' },
  { match: /UPDATED|STATUS_CHANGED/, icon: Pencil, tone: 'bg-muted text-muted-foreground' },
  { match: /TICKET/, icon: XCircle, tone: 'bg-destructive/12 text-destructive' },
  { match: /./, icon: PackageCheck, tone: 'bg-muted text-muted-foreground' },
];

function styleFor(action: string) {
  return ACTION_STYLE.find((s) => s.match.test(action)) ?? ACTION_STYLE[ACTION_STYLE.length - 1];
}

function show(v: unknown, field: string): string {
  if (v === null || v === undefined || v === '') return '—';
  if (field === 'status' && typeof v === 'string' && v in ASSET_STATUS_LABELS) return ASSET_STATUS_LABELS[v as AssetStatus];
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'string' && /^[A-Z_]+$/.test(v)) return humanize(v);
  if (typeof v === 'string' && /^[0-9a-f-]{36}$/.test(v)) return 'changed';
  return String(v);
}

const ENTITY_LINK: Record<string, (e: HistoryEvent) => string | null> = {
  ASSET: (e) => `/assets/assets/${e.entityId}`,
  EMPLOYEE: (e) => `/assets/employees/${e.entityId}`,
  EXIT_CASE: (e) => `/assets/exits/${e.entityId}`,
  REQUEST: (e) => `/assets/requests?open=${e.entityId}`,
  TICKET: (e) => `/assets/tickets?open=${e.entityId}`,
  MAINTENANCE: () => '/assets/maintenance',
};

/** Immutable history rendered as a vertical timeline. */
export function Timeline({ events, loading, showEntity = false, emptyText = 'No history yet' }: { events: HistoryEvent[] | undefined; loading?: boolean; showEntity?: boolean; emptyText?: string }) {
  if (loading) {
    return (
      <div className="space-y-4">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="flex gap-3">
            <Skeleton className="size-7 rounded-full" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    );
  }
  if (!events?.length) return <EmptyState icon={CircleDot} title={emptyText} />;
  return (
    <ol className="relative">
      {events.map((e, i) => {
        const s = styleFor(e.action);
        const Icon = s.icon;
        const link = showEntity ? ENTITY_LINK[e.entityType]?.(e) : null;
        return (
          <li key={e.id} className="relative flex gap-3 pb-5 last:pb-0">
            {i < events.length - 1 && <span className="absolute top-8 bottom-0 left-3.5 w-px bg-border" aria-hidden />}
            <span className={cn('relative z-[1] flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-card', s.tone)}>
              <Icon className="size-3.5" />
            </span>
            <div className="min-w-0 flex-1 pt-0.5">
              <p className="text-sm leading-snug">
                {showEntity && e.entityLabel && (
                  <>
                    {link ? (
                      <Link to={link} className="font-medium hover:text-primary hover:underline">
                        {e.entityLabel}
                      </Link>
                    ) : (
                      <span className="font-medium">{e.entityLabel}</span>
                    )}
                    <span className="text-muted-foreground"> · </span>
                  </>
                )}
                {e.summary}
              </p>
              {e.changes && e.changes.length > 0 && (
                <ul className="mt-1.5 space-y-0.5 rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
                  {e.changes.slice(0, 8).map((c) => (
                    <li key={c.field} className="flex flex-wrap gap-x-1.5">
                      <span className="text-muted-foreground">{c.label ?? humanize(c.field)}:</span>
                      <span className="text-muted-foreground line-through decoration-muted-foreground/50">{show(c.from, c.field)}</span>
                      <span>→</span>
                      <span className="font-medium">{show(c.to, c.field)}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-xs text-muted-foreground" title={formatDateTime(e.occurredAt)}>
                {e.actorName} · {relativeTime(e.occurredAt)}
              </p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
