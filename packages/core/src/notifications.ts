/**
 * One bell for every app (PLAN.md §19.37): the latest notifications of Tasks and Assets, newest first, grouped by area
 * (All · Attendance · Tasks · Assets · Approvals · Company) with an unread count per area. Every row carries the link
 * of the item it is about; opening it marks it read.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClaims } from './access';
import { assetsApi, type DrfPage, resultsOf, tasksApi } from './http';
import type { AppKey } from './session';

export type NotificationArea = 'attendance' | 'tasks' | 'assets' | 'approvals' | 'company';
export type NotificationTab = 'all' | NotificationArea;

/** The tabs of the bell and the Notifications screen, in this order. */
export const NOTIFICATION_TABS: ReadonlyArray<{ key: NotificationTab; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'attendance', label: 'Attendance' },
  { key: 'tasks', label: 'Tasks' },
  { key: 'assets', label: 'Assets' },
  { key: 'approvals', label: 'Approvals' },
  { key: 'company', label: 'Company' },
];

export interface UnifiedNotification {
  /** Unique across apps: "t12" (Tasks) or "a<uuid>" (Assets). */
  id: string;
  app: AppKey;
  /** The id in its own app. */
  rawId: string;
  category: NotificationArea;
  type: string;
  title: string;
  body: string | null;
  /** Where it opens in the web app (both apps' links are relative to their own base). */
  href: string | null;
  read: boolean;
  createdAt: string;
  /** Tasks only: what the email / WhatsApp copies did. */
  channels?: Array<{ channel: string; status: string; detail?: string }>;
}

interface TasksNotification {
  id: number;
  type: string;
  category?: string;
  title: string;
  body: string;
  link: string;
  channels?: Array<{ channel: string; status: string; detail?: string }>;
  read_at: string | null;
  created_at: string;
}
interface AssetsNotification {
  id: string;
  type: string;
  category?: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}
interface AssetsList {
  items: AssetsNotification[];
  unread: number;
  unreadByCategory?: { assets: number; approvals: number };
}

const TASKS_AREAS: readonly NotificationArea[] = ['attendance', 'tasks', 'approvals', 'company'];
const ASSETS_AREAS: readonly NotificationArea[] = ['assets', 'approvals'];
const ZERO: Record<NotificationArea, number> = { attendance: 0, tasks: 0, assets: 0, approvals: 0, company: 0 };

/** "/tasks/42" (Tasks) → "/tasks/tasks/42"; "/requests?open=x" (Assets) → "/assets/requests?open=x"; full URLs stay. */
export const notificationHref = (app: AppKey, link: string | null | undefined) =>
  link ? (/^https?:\/\//.test(link) ? link : `/${app}${link.startsWith('/') ? '' : '/'}${link}`) : null;

const area = (app: AppKey, category: string | undefined): NotificationArea => {
  if (app === 'assets') return category === 'approvals' ? 'approvals' : 'assets';
  return (TASKS_AREAS as readonly string[]).includes(category ?? '') ? (category as NotificationArea) : 'tasks';
};

const fromTasks = (n: TasksNotification): UnifiedNotification => ({
  id: `t${n.id}`,
  app: 'tasks',
  rawId: String(n.id),
  category: area('tasks', n.category),
  type: n.type,
  title: n.title,
  body: n.body || null,
  href: notificationHref('tasks', n.link),
  read: !!n.read_at,
  createdAt: n.created_at,
  channels: n.channels,
});
const fromAssets = (n: AssetsNotification): UnifiedNotification => ({
  id: `a${n.id}`,
  app: 'assets',
  rawId: n.id,
  category: area('assets', n.category),
  type: n.type,
  title: n.title,
  body: n.body,
  href: notificationHref('assets', n.link),
  read: !!n.readAt,
  createdAt: n.createdAt,
});

function useApps() {
  const claims = useClaims();
  return { claims, tasksOn: !!claims?.apps?.tasks, assetsOn: !!claims?.apps?.assets };
}

/** The notifications of one tab (newest first; `limit` per app). */
export function useNotifications(tab: NotificationTab = 'all', limit = 30) {
  const { claims, tasksOn, assetsOn } = useApps();
  const wantTasks = tasksOn && (tab === 'all' || TASKS_AREAS.includes(tab));
  const wantAssets = assetsOn && (tab === 'all' || ASSETS_AREAS.includes(tab));
  return useQuery({
    queryKey: ['notifications', 'list', claims?.sub, tab, limit, wantTasks, wantAssets],
    enabled: !!claims,
    refetchInterval: 30_000,
    queryFn: async () => {
      const category = tab === 'all' ? undefined : tab;
      const [t, a] = await Promise.all([
        wantTasks
          ? tasksApi.get<DrfPage<TasksNotification> | TasksNotification[]>('/notifications/', { page_size: limit, ...(category ? { category } : {}) }).catch(() => [])
          : [],
        wantAssets ? assetsApi.get<AssetsList>('/notifications', category ? { category } : undefined).catch(() => ({ items: [] as AssetsNotification[] })) : { items: [] as AssetsNotification[] },
      ]);
      return [...resultsOf(t).map(fromTasks), ...a.items.map(fromAssets)].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
    },
  });
}

/** Unread per area and in total (for the bell's badge and the tab counts). */
export function useNotificationCounts() {
  const { claims, tasksOn, assetsOn } = useApps();
  return useQuery({
    queryKey: ['notifications', 'counts', claims?.sub, tasksOn, assetsOn],
    enabled: !!claims,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [t, a] = await Promise.all([
        tasksOn ? tasksApi.get<{ count: number; by_category?: Partial<Record<NotificationArea, number>> }>('/notifications/unread_count/').catch(() => null) : null,
        assetsOn ? assetsApi.get<AssetsList>('/notifications').catch(() => null) : null,
      ]);
      const by = { ...ZERO };
      if (t) {
        if (t.by_category) for (const k of TASKS_AREAS) by[k] += t.by_category[k] ?? 0;
        else by.tasks += t.count; // an older Tasks API: everything under Tasks
      }
      if (a) {
        if (a.unreadByCategory) {
          by.assets += a.unreadByCategory.assets;
          by.approvals += a.unreadByCategory.approvals;
        } else by.assets += a.unread;
      }
      const all = Object.values(by).reduce((s, n) => s + n, 0);
      return { all, ...by } as Record<NotificationTab, number>;
    },
  });
}

function useDone() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['notifications'] });
}

/** Marks one notification read (opening it does this too). */
export function useMarkNotificationRead() {
  const done = useDone();
  return useMutation({
    mutationFn: (n: Pick<UnifiedNotification, 'app' | 'rawId'>) =>
      n.app === 'tasks' ? tasksApi.post(`/notifications/${n.rawId}/read/`) : assetsApi.post('/notifications/read', { ids: [n.rawId] }),
    onSuccess: done,
  });
}

/** "Mark all read" for one tab (all = everything in every app). */
export function useMarkNotificationsRead() {
  const { tasksOn, assetsOn } = useApps();
  const done = useDone();
  return useMutation({
    mutationFn: async (tab: NotificationTab = 'all') => {
      const category = tab === 'all' ? undefined : tab;
      await Promise.all([
        tasksOn && (tab === 'all' || TASKS_AREAS.includes(tab)) ? tasksApi.post(`/notifications/read_all/${category ? `?category=${category}` : ''}`) : null,
        assetsOn && (tab === 'all' || ASSETS_AREAS.includes(tab)) ? assetsApi.post('/notifications/read', category ? { category } : {}) : null,
      ]);
    },
    onSuccess: done,
  });
}
