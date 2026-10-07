import { useMutation, useQuery } from '@tanstack/react-query';
import { Bell, CheckCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { EmptyState } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { api } from '@/lib/api';
import { queryClient } from '@/lib/queries';
import type { Notification } from '@/lib/types';
import { cn, relativeTime } from '@/lib/utils';

/** In-app notifications: polled every 20s; new ones also pop up as toasts. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const seen = useRef<Set<string> | null>(null);
  const q = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<{ items: Notification[]; unread: number }>('/notifications'),
    refetchInterval: 20_000,
    refetchIntervalInBackground: false,
    placeholderData: undefined,
  });
  const markRead = useMutation({
    mutationFn: (ids?: string[]) => api.post('/notifications/read', { ids }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });

  useEffect(() => {
    const items = q.data?.items;
    if (!items) return;
    if (seen.current === null) {
      seen.current = new Set(items.map((n) => n.id));
      return;
    }
    const fresh = items.filter((n) => !n.readAt && !seen.current!.has(n.id));
    for (const n of fresh.slice(0, 3)) {
      toast(n.title, {
        description: n.body ?? undefined,
        action: n.link ? { label: 'View', onClick: () => navigate(n.link!) } : undefined,
      });
    }
    items.forEach((n) => seen.current!.add(n.id));
  }, [q.data, navigate]);

  const unread = q.data?.unread ?? 0;
  const open_ = (n: Notification) => {
    if (!n.readAt) markRead.mutate([n.id]);
    setOpen(false);
    if (n.link) navigate(n.link);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon-sm" aria-label={`Notifications${unread ? ` (${unread} unread)` : ''}`} className="relative">
          <Bell />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[min(92vw,380px)] p-0">
        <div className="flex items-center justify-between border-b px-3 py-2.5">
          <span className="text-sm font-semibold">Notifications</span>
          {unread > 0 && (
            <Button variant="ghost" size="xs" onClick={() => markRead.mutate(undefined)}>
              <CheckCheck /> Mark all read
            </Button>
          )}
        </div>
        <div className="max-h-[60vh] overflow-y-auto scrollbar-thin">
          {!q.data?.items.length ? (
            <EmptyState icon={Bell} title="You’re all caught up" className="py-10" />
          ) : (
            q.data.items.map((n) => (
              <button
                key={n.id}
                type="button"
                onClick={() => open_(n)}
                className={cn('flex w-full cursor-pointer gap-3 border-b px-3 py-2.5 text-left transition last:border-0 hover:bg-muted/60', !n.readAt && 'bg-primary/[0.04]')}
              >
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-primary')} />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium leading-snug">{n.title}</span>
                  {n.body && <span className="mt-0.5 line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>}
                  <span className="mt-1 block text-[11px] text-muted-foreground">{relativeTime(n.createdAt)}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
