/** Deleting Tasks notifications for good (the Notifications screen). Reading, grouping and marking read: core/notifications.ts. */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../http';

function useInvalidateNotifications() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['notifications'] });
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
