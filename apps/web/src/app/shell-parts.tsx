import {
  type Access,
  type NotificationTab,
  useMarkNotificationRead,
  useMarkNotificationsRead,
  useNotificationCounts,
  useNotifications,
  useSignOut,
} from '@freefounders/core';
import { NotificationTabs, NotificationText, notificationRowClass } from '@/components/common/notifications';
import { AlarmClock, Bell, CheckCheck, ChevronDown, Gauge, Keyboard, KeyRound, LogOut, Moon, Sun } from '@/components/icons';
import { CompanyMenuItems } from '@/features/account/switcher';
import { isInApp } from '@/lib/native-bridge';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/overlays';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/overlays';
import { Avatar } from '@/components/ui/primitives';
import { BrandMark, BrandWordmark } from '@/components/brand';
import { cn } from '@/lib/utils';

/**
 * The company's logo and short name (Settings Center), or the Kaampilot logo (mark + wordmark, PLAN.md §19.35) when the
 * company has none set / before sign-in.
 */
export function Logo({ company, compact = false, subtitle }: { company?: Access['brand']; compact?: boolean; subtitle?: string }) {
  if (!company && compact) return <BrandMark size={32} title="Kaampilot" />;
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      {company?.logoUrl ? (
        <img src={company.logoUrl} alt="" className="h-8 max-w-20 shrink-0 rounded-md bg-white object-contain p-0.5 ring-1 ring-border" />
      ) : company ? (
        <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-md bg-primary text-[13px] font-extrabold text-primary-foreground">
          {company.shortName.slice(0, 1).toUpperCase()}
        </span>
      ) : (
        <BrandMark size={32} />
      )}
      {!compact && (
        <span className="min-w-0 leading-tight">
          {company ? (
            <span className="block truncate text-[15.5px] font-extrabold tracking-tight">{company.shortName}</span>
          ) : (
            <span className="block">
              <span className="sr-only">Kaampilot</span>
              <BrandWordmark height={22} className="translate-y-px" />
            </span>
          )}
          {subtitle && <span className="block truncate font-mono text-[11px] tracking-wider text-muted-foreground uppercase">{subtitle}</span>}
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

/** Light / dark switch for the desktop header (phones use the account menu's item: one switch per screen). */
export function ThemeToggle() {
  const theme = useTheme();
  return (
    <Button
      variant="ghost"
      size="icon"
      className="rounded-full text-muted-foreground hover:text-primary max-lg:hidden"
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

/**
 * One bell for every app, grouped by area (PLAN.md §19.37): All · Attendance · Tasks · Assets · Approvals · Company, each
 * with its unread count; "Mark all read" marks the open tab. A tap marks the notification read and opens its page.
 */
export function NotificationsBell() {
  const [tab, setTab] = useState<NotificationTab>('all');
  const [open, setOpen] = useState(false);
  const q = useNotifications(tab);
  const counts = useNotificationCounts();
  const markAll = useMarkNotificationsRead();
  const markOne = useMarkNotificationRead();
  const navigate = useNavigate();
  const unread = counts.data?.all ?? 0;
  const tabUnread = counts.data?.[tab] ?? 0;
  const items = q.data ?? [];
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
      <PopoverContent align="end" className="w-[min(25rem,calc(100vw-1rem))] overflow-hidden p-0">
        <div className="flex items-center justify-between border-b px-4 py-2.5">
          <span className="text-sm font-bold">Notifications</span>
          <Button variant="ghost" size="xs" onClick={() => markAll.mutate(tab)} disabled={!tabUnread || markAll.isPending}>
            <CheckCheck className="size-3.5" /> Mark all read
          </Button>
        </div>
        <div className="border-b">
          <NotificationTabs tab={tab} onTab={setTab} counts={counts.data} compact controls="bell-list" />
        </div>
        <ul id="bell-list" role="tabpanel" className="max-h-[26rem] divide-y overflow-y-auto scrollbar-thin" aria-label="Latest notifications">
          {items.slice(0, 30).map((n) => (
            <li key={n.id}>
              <button
                type="button"
                className={cn('flex w-full cursor-pointer gap-3 px-4 py-3 text-left', notificationRowClass(n))}
                onClick={() => {
                  if (!n.read) markOne.mutate(n);
                  setOpen(false);
                  if (n.href) {
                    if (/^https?:\/\//.test(n.href)) window.location.assign(n.href);
                    else navigate(n.href);
                  }
                }}
              >
                <NotificationText n={n} when={timeAgo(n.createdAt)} clamp />
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
          {q.data && items.length === 0 && <li className="px-4 py-10 text-center text-sm text-muted-foreground">You’re all caught up.</li>}
        </ul>
        <div className="border-t bg-muted/30 px-4 py-2 text-right">
          <Link to={tab === 'all' ? '/notifications' : `/notifications?tab=${tab}`} className="text-xs font-semibold text-primary hover:underline" onClick={() => setOpen(false)}>
            All notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The account menu in the header (one place on every screen): light/dark, shortcuts, change password, sign out. */
export function UserMenu({ access, onShortcuts }: { access: Access; onShortcuts?: () => void }) {
  const navigate = useNavigate();
  const signOut = useSignOut();
  const theme = useTheme();
  const name = access.platform?.person.fullName ?? access.claims?.name ?? '';
  // The owner is a mark, not a role in the list (PLAN.md §19.28): say Owner rather than the Admin role they also hold.
  const role = access.platform?.person.role === 'owner' ? 'Owner' : (access.tasks.me?.role_display ?? access.assets.me?.role.name ?? (access.isAdmin ? 'Admin' : 'Member'));
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className="flex min-h-11 max-w-[220px] cursor-pointer items-center gap-2 rounded-md border border-transparent py-1 pr-1 pl-1 text-left transition outline-none hover:border-border hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=open]:border-border data-[state=open]:bg-accent lg:pr-2"
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
      <DropdownMenuContent align="end" className="max-h-[80dvh] w-64 overflow-y-auto">
        <DropdownMenuLabel className="leading-tight">
          <span className="block truncate font-semibold">{name}</span>
          <span className="block truncate text-xs font-normal text-muted-foreground">
            {role}
            {access.platform?.company.name ? ` · ${access.platform.company.name}` : ''}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <CompanyMenuItems access={access} />
        <DropdownMenuItem onSelect={() => theme.toggle()}>
          {theme.dark ? <Sun className="size-4" /> : <Moon className="size-4" />} {theme.dark ? 'Light mode' : 'Dark mode'}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        {onShortcuts && (
          <DropdownMenuItem onSelect={onShortcuts} className="max-lg:hidden">
            <Keyboard className="size-4" /> Keyboard shortcuts
          </DropdownMenuItem>
        )}
        {access.platform?.account?.isStaff && (
          <DropdownMenuItem onSelect={() => navigate('/console')}>
            <Gauge className="size-4" /> Owner console
          </DropdownMenuItem>
        )}
        {/* Phone app only (PLAN.md §19.32): the punch-in reminder lives on the phone. */}
        {isInApp() && access.tasks.can('attendance.punch') && (
          <DropdownMenuItem onSelect={() => navigate('/attendance/reminder')}>
            <AlarmClock className="size-4" /> Punch-in reminder
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
