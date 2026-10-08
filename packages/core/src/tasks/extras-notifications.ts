/** The Tasks notifications page (old pages/Notifications.jsx). The bell for both apps is in core/notifications.ts. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type DrfPage, resultsOf, tasksApi } from '../http';

export interface TaskNotification {
  id: number;
  type: string;
  title: string;
  body: string;
  /** Relative to the Tasks app, e.g. "/tasks/42". */
  link: string;
  channels?: Array<{ channel: string; status: string; detail?: string }>;
  read_at: string | null;
  created_at: string;
  /** Where it opens in the web app (Tasks links are relative to /tasks), or null. */
  href: string | null;
}

/** "/tasks/42" → "/tasks/tasks/42"; full URLs stay as they are. */
export function taskLinkHref(link: string | null | undefined): string | null {
  if (!link) return null;
  if (/^https?:\/\//.test(link)) return link;
  return `/tasks${link.startsWith('/') ? '' : '/'}${link}`;
}

/** GET /notifications/?page_size=50 */
export function useTaskNotifications() {
  return useQuery({
    queryKey: ['notifications', 'tasks-page'],
    queryFn: () =>
      tasksApi
        .get<DrfPage<Omit<TaskNotification, 'href'>> | Omit<TaskNotification, 'href'>[]>('/notifications/', { page_size: 50 })
        .then(resultsOf)
        .then((rows) => rows.map((n) => ({ ...n, href: taskLinkHref(n.link) }))),
  });
}

function useInvalidateNotifications() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['notifications'] });
}

export function useMarkTaskNotificationRead() {
  const done = useInvalidateNotifications();
  return useMutation({ mutationFn: (id: number) => tasksApi.post(`/notifications/${id}/read/`), onSuccess: done });
}

export function useMarkAllTaskNotificationsRead() {
  const done = useInvalidateNotifications();
  return useMutation({ mutationFn: () => tasksApi.post('/notifications/read_all/'), onSuccess: done });
}

/** POST /notifications/clear/(?only=read) — deletes for good. */
export function useClearTaskNotifications() {
  const done = useInvalidateNotifications();
  return useMutation({ mutationFn: (onlyRead: boolean) => tasksApi.post(`/notifications/clear/${onlyRead ? '?only=read' : ''}`), onSuccess: done });
}

export function useDeleteTaskNotification() {
  const done = useInvalidateNotifications();
  return useMutation({ mutationFn: (id: number) => tasksApi.del(`/notifications/${id}/`), onSuccess: done });
}
