import { type Access, useMarkNotificationsRead, useNotifications, useSignOut } from '@freefounders/core';
import { Bell, CheckCheck, ChevronDown, Feather, Keyboard, KeyRound, LogOut, Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { Avatar } from '@/components/ui/primitives';
import { type LiteChoice, useLite } from '@/lib/lite';
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

function useTheme() {
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
      className="rounded-full text-muted-foreground hover:text-primary max-lg:size-11"
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
          className="relative rounded-full text-muted-foreground hover:text-primary max-lg:size-11"
        >
          <Bell className="size-5" />
          {unread > 0 && (
            <span className="absolute top-0.5 right-0.5 grid min-w-[18px] place-items-center rounded-full border-2 border-card bg-destructive px-1 font-mono text-[10px] leading-[14px] font-bold text-white dark:text-background">
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
                  <span className="mt-0.5 block font-mono text-xs text-muted-foreground">
                    {n.app === 'tasks' ? 'Tasks' : 'Assets'} · {timeAgo(n.createdAt)}
                  </span>
                </span>
              </button>
            </li>
          ))}
          {q.isLoading && (
            <li role="status" className="px-4 py-10 text-center text-sm text-muted-foreground">
              Loading notifications…
            </li>
          )}
          {q.isError && !q.data && (
            <li role="alert" className="px-4 py-8 text-center text-sm text-muted-foreground">
              Couldn’t load notifications.{' '}
              <button type="button" className="cursor-pointer font-semibold text-primary underline-offset-2 hover:underline" onClick={() => void q.refetch()}>
                Try again
              </button>
            </li>
          )}
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

/** The account menu in the header (one place on every screen): light/dark, lite mode, shortcuts, change password, sign out. */
export function UserMenu({ access, onShortcuts }: { access: Access; onShortcuts?: () => void }) {
  const navigate = useNavigate();
  const signOut = useSignOut();
  const theme = useTheme();
  const lite = useLite();
  const name = access.platform?.person.fullName ?? access.claims?.name ?? '';
  const role = access.tasks.me?.role_display ?? access.assets.me?.role.name ?? (access.isAdmin ? 'Admin' : 'Member');
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 max-w-[220px] cursor-pointer items-center gap-2 rounded-full border border-transparent py-1 pr-1 pl-1 text-left transition outline-none hover:border-border hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=open]:border-border data-[state=open]:bg-accent lg:pr-2"
          aria-label="Your account"
        >
          <Avatar name={name} className="size-8 bg-primary [&_[data-slot=avatar-fallback]]:bg-transparent [&_[data-slot=avatar-fallback]]:text-primary-foreground" />
          <span className="hidden min-w-0 leading-tight lg:block">
            <span className="block max-w-[150px] truncate text-[13px] font-semibold">{name}</span>
            <span className="block max-w-[150px] truncate text-xs text-muted-foreground">{role}</span>
          </span>
          <ChevronDown className="hidden size-4 shrink-0 text-muted-foreground lg:block" aria-hidden />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuLabel className="leading-tight">
          <span className="block truncate font-semibold">{name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {role}
            {access.platform?.company.name ? ` · ${access.platform.company.name}` : ''}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => theme.toggle()}>
          {theme.dark ? <Sun className="size-4" /> : <Moon className="size-4" />} {theme.dark ? 'Light mode' : 'Dark mode'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel id="lite-label" className="flex items-center gap-1.5">
          <Feather className="size-3.5" aria-hidden /> Lite mode{lite.choice === 'auto' ? (lite.active ? ' · on' : ' · off') : ''}
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup aria-labelledby="lite-label" value={lite.choice} onValueChange={(v) => lite.setChoice(v as LiteChoice)}>
          <DropdownMenuRadioItem value="auto" onSelect={(e) => e.preventDefault()}>
            Auto <span className="ml-auto text-xs text-muted-foreground">for weak phones</span>
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="on" onSelect={(e) => e.preventDefault()}>
            On
          </DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="off" onSelect={(e) => e.preventDefault()}>
            Off
          </DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
        <DropdownMenuSeparator />
        {onShortcuts && (
          <DropdownMenuItem onSelect={onShortcuts}>
            <Keyboard className="size-4" /> Keyboard shortcuts
          </DropdownMenuItem>
        )}
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
