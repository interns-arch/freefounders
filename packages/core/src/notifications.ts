/** One bell for both apps: the latest notifications of Tasks and Assets, newest first. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useClaims } from './access';
import { assetsApi, type DrfPage, resultsOf, tasksApi } from './http';
import type { AppKey } from './session';

export interface UnifiedNotification {
  id: string;
  app: AppKey;
  title: string;
  body: string | null;
  /** Where it opens in the web app (both apps' links are relative to their own base today). */
  href: string | null;
  read: boolean;
  createdAt: string;
}

interface TasksNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  link: string;
  read_at: string | null;
  created_at: string;
}
interface AssetsNotification {
  id: string;
  title: string;
  body: string | null;
  link: string | null;
  readAt: string | null;
  createdAt: string;
}

const href = (app: AppKey, link: string | null | undefined) => (link ? (link.startsWith('http') ? link : `/${app}${link.startsWith('/') ? '' : '/'}${link}`) : null);

export function useNotifications() {
  const claims = useClaims();
  const tasksOn = !!claims?.apps?.tasks;
  const assetsOn = !!claims?.apps?.assets;
  return useQuery({
    queryKey: ['notifications', claims?.sub, tasksOn, assetsOn],
    enabled: !!claims,
    refetchInterval: 30_000,
    queryFn: async () => {
      const [t, a] = await Promise.all([
        tasksOn ? tasksApi.get<DrfPage<TasksNotification> | TasksNotification[]>('/notifications/', { page_size: 30 }).catch(() => []) : [],
        assetsOn ? assetsApi.get<{ items: AssetsNotification[]; unread: number }>('/notifications').catch(() => ({ items: [], unread: 0 })) : { items: [], unread: 0 },
      ]);
      const items: UnifiedNotification[] = [
        ...resultsOf(t).map((n) => ({ id: `t${n.id}`, app: 'tasks' as const, title: n.title, body: n.body || null, href: href('tasks', n.link), read: !!n.read_at, createdAt: n.created_at })),
        ...a.items.map((n) => ({ id: `a${n.id}`, app: 'assets' as const, title: n.title, body: n.body, href: href('assets', n.link), read: !!n.readAt, createdAt: n.createdAt })),
      ].sort((x, y) => y.createdAt.localeCompare(x.createdAt));
      return { items, unread: items.filter((n) => !n.read).length };
    },
  });
}

/** Marks everything read in both apps. */
export function useMarkNotificationsRead() {
  const qc = useQueryClient();
  const claims = useClaims();
  return useMutation({
    mutationFn: async () => {
      await Promise.all([
        claims?.apps?.tasks ? tasksApi.post('/notifications/read_all/') : null,
        claims?.apps?.assets ? assetsApi.post('/notifications/read', {}) : null,
      ]);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  });
}
