import { type Access, useMarkNotificationsRead, useNotifications, useSignOut } from '@freefounders/core';
import { Bell, CheckCheck, KeyRound, LogOut, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { Avatar } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/** FreeFounders mark, or the company's logo and short name (Settings Center). */
export function Logo({ company, inverted = false, compact = false, subtitle }: { company?: Access['brand']; inverted?: boolean; compact?: boolean; subtitle?: string }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {company?.logoUrl ? (
        <img src={company.logoUrl} alt="" className="h-8 max-w-20 shrink-0 rounded-md bg-white object-contain p-0.5" />
      ) : (
        <span
          aria-hidden
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-lg text-[13px] font-extrabold',
            inverted ? 'bg-primary-foreground text-primary' : 'bg-primary text-primary-foreground',
          )}
        >
          {company ? company.shortName.slice(0, 1).toUpperCase() : 'FF'}
        </span>
      )}
      {!compact && (
        <span className="min-w-0 leading-tight">
          <span className="block truncate text-[15px] font-semibold tracking-tight">{company?.shortName ?? 'FreeFounders'}</span>
          {subtitle && <span className="block truncate font-mono text-[10px] tracking-wider text-muted-foreground uppercase">{subtitle}</span>}
        </span>
      )}
    </span>
  );
}

export function useTheme() {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  const toggle = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle('dark', next);
    try {
      localStorage.setItem('ff-theme', next ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
  };
  return { dark, toggle };
}

/** Light / dark switch for the header. */
export function ThemeToggle() {
  const theme = useTheme();
  return (
    <Button variant="ghost" size="icon" onClick={theme.toggle} aria-label={theme.dark ? 'Light mode' : 'Dark mode'} title={theme.dark ? 'Light mode' : 'Dark mode'}>
      {theme.dark ? <Sun className="size-[18px]" /> : <Moon className="size-[18px]" />}
    </Button>
  );
}

const timeAgo = (iso: string) => {
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

/** One bell for Tasks and Assets. */
export function NotificationsBell() {
  const q = useNotifications();
  const markRead = useMarkNotificationsRead();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const unread = q.data?.unread ?? 0;
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} className="relative">
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute top-1 right-1 grid min-w-4 place-items-center rounded-full bg-destructive px-1 text-[10px] leading-4 font-semibold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-semibold">Notifications</span>
          <Button variant="ghost" size="xs" onClick={() => markRead.mutate()} disabled={!unread || markRead.isPending}>
            <CheckCheck className="size-3.5" /> Mark all read
          </Button>
        </div>
        <ul className="max-h-[26rem] overflow-y-auto" aria-label="Latest notifications">
          {(q.data?.items ?? []).slice(0, 30).map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={cn('flex w-full gap-3 px-4 py-3 text-left hover:bg-accent', !n.read && 'bg-primary/5')}
                onClick={() => {
                  setOpen(false);
                  if (n.href) navigate(n.href);
                }}
              >
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.app === 'tasks' ? 'bg-app-tasks' : 'bg-app-assets', n.read && 'opacity-30')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{n.title}</span>
                  {n.body && <span className="line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>}
                  <span className="block text-[11px] text-muted-foreground">
                    {n.app === 'tasks' ? 'Tasks' : 'Assets'} · {timeAgo(n.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {q.data && q.data.items.length === 0 && <li className="px-4 py-8 text-center text-sm text-muted-foreground">You’re all caught up.</li>}
        </ul>
        <div className="border-t px-4 py-2 text-right">
          <Link to="/tasks/notifications" className="text-xs text-primary hover:underline" onClick={() => setOpen(false)}>
            All Tasks notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function UserMenu({ access }: { access: Access }) {
  const navigate = useNavigate();
  const signOut = useSignOut();
  const theme = useTheme();
  const name = access.platform?.person.fullName ?? access.claims?.name ?? '';
  const role = access.tasks.me?.role_display ?? access.assets.me?.role.name ?? (access.isAdmin ? 'Admin' : 'Member');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex w-full items-center gap-2.5 rounded-lg p-2 text-left hover:bg-sidebar-accent" aria-label="Your account">
          <Avatar name={name} className="size-8" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{name}</span>
            <span className="block truncate text-xs text-muted-foreground">{role}</span>
          </span>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" side="top" className="w-56">
        <DropdownMenuLabel className="truncate">{access.platform?.company.name}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => theme.toggle()}>
          {theme.dark ? <Sun className="size-4" /> : <Moon className="size-4" />} {theme.dark ? 'Light mode' : 'Dark mode'}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate('/account')}>
          <KeyRound className="size-4" /> Change password
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => signOut.mutate(undefined, { onSuccess: () => navigate('/login') })}>
          <LogOut className="size-4" /> Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
