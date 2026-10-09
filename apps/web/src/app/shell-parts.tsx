import { type Access, useMarkNotificationsRead, useNotifications, useSignOut } from '@freefounders/core';
import { Bell, CheckCheck, ChevronsUpDown, KeyRound, LogOut, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/overlays';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { Avatar } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';

/** FreeFounders mark, or the company's logo and short name (Settings Center). */
export function Logo({ company, inverted = false, compact = false, subtitle, onDark = false }: { company?: Access['brand']; inverted?: boolean; compact?: boolean; subtitle?: string; onDark?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {company?.logoUrl ? (
        <img src={company.logoUrl} alt="" className="h-8 max-w-20 shrink-0 rounded-md bg-white object-contain p-0.5" />
      ) : (
        <span
          aria-hidden
          className={cn(
            'grid size-8 shrink-0 place-items-center rounded-[9px] text-[13px] font-extrabold shadow-sm shadow-black/20',
            inverted ? 'bg-primary-foreground text-primary' : 'bg-gradient-to-br from-brand-2 to-primary text-white',
          )}
        >
          {company ? company.shortName.slice(0, 1).toUpperCase() : 'FF'}
        </span>
      )}
      {!compact && (
        <span className="min-w-0 leading-tight">
          <span className={cn('block truncate text-[15.5px] font-extrabold tracking-tight', onDark && 'text-white')}>{company?.shortName ?? 'FreeFounders'}</span>
          {subtitle && <span className={cn('block truncate font-mono text-[10px] tracking-wider uppercase', onDark ? 'text-sidebar-foreground/60' : 'text-muted-foreground')}>{subtitle}</span>}
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
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full text-muted-foreground hover:text-primary"
      onClick={theme.toggle}
      aria-label={theme.dark ? 'Light mode' : 'Dark mode'}
      title={theme.dark ? 'Light mode' : 'Dark mode'}
    >
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
        <Button
          variant="ghost"
          size="icon"
          aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}
          className="relative rounded-full text-muted-foreground hover:text-primary"
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute top-0.5 right-0.5 grid min-w-[18px] place-items-center rounded-full border-2 border-card bg-destructive px-1 font-mono text-[10px] leading-[14px] font-bold text-white">
              {unread > 99 ? '99+' : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[22rem] overflow-hidden p-0">
        <div className="flex items-center justify-between border-b bg-muted/30 px-4 py-2.5">
          <span className="text-sm font-bold">
            Notifications
            {unread > 0 && <span className="ml-2 rounded-full bg-brand-2/20 px-1.5 font-mono text-[11px] font-semibold text-primary">{unread}</span>}
          </span>
          <Button variant="ghost" size="xs" onClick={() => markRead.mutate()} disabled={!unread || markRead.isPending}>
            <CheckCheck className="size-3.5" /> Mark all read
          </Button>
        </div>
        <ul className="max-h-[26rem] divide-y overflow-y-auto scrollbar-thin" aria-label="Latest notifications">
          {(q.data?.items ?? []).slice(0, 30).map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={cn('flex w-full gap-3 px-4 py-3 text-left transition-colors hover:bg-accent/60', !n.read && 'bg-primary/5 shadow-[inset_3px_0_0_0_var(--brand-2)]')}
                onClick={() => {
                  setOpen(false);
                  if (n.href) navigate(n.href);
                }}
              >
                <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.app === 'tasks' ? 'bg-app-tasks' : 'bg-app-assets', n.read && 'opacity-30')} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-sm', n.read ? 'font-medium' : 'font-semibold')}>{n.title}</span>
                  {n.body && <span className="line-clamp-2 block text-xs text-muted-foreground">{n.body}</span>}
                  <span className="mt-0.5 block font-mono text-[10.5px] text-muted-foreground">
                    {n.app === 'tasks' ? 'Tasks' : 'Assets'} · {timeAgo(n.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {q.data && q.data.items.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">You’re all caught up.</li>}
        </ul>
        <div className="border-t bg-muted/30 px-4 py-2 text-right">
          <Link to="/tasks/notifications" className="text-xs font-semibold text-primary hover:underline" onClick={() => setOpen(false)}>
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
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-xl border border-sidebar-border/70 bg-white/[0.04] p-2 text-left transition outline-none hover:bg-white/8 focus-visible:ring-2 focus-visible:ring-brand-2/60 data-[state=open]:bg-white/8"
          aria-label="Your account"
        >
          <Avatar name={name} className="size-9 bg-gradient-to-br from-brand-2 to-primary text-white ring-2 ring-brand-2/30 [&_[data-slot=avatar-fallback]]:bg-transparent" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-bold text-white">{name}</span>
            <span className="block truncate text-xs text-sidebar-foreground/60">{role}</span>
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-sidebar-foreground/50" aria-hidden />
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
