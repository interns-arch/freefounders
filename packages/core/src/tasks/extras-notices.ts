/** Notices (old pages/Notices.jsx): the board, admin management and the WhatsApp broadcast. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tasksApi } from '../http';
import type { UserBrief } from './types';

export type NoticePriority = 'normal' | 'important' | 'urgent';
export type NoticeAudience = 'everyone' | 'role' | 'department' | 'group' | 'users';
export const NOTICE_PRIORITY_LABELS: Record<NoticePriority, string> = { normal: 'Normal', important: 'Important', urgent: 'Urgent' };
export const NOTICE_AUDIENCE_LABELS: Record<NoticeAudience, string> = {
  everyone: 'Everyone',
  role: 'Specific role',
  department: 'Specific department',
  group: 'Specific group',
  users: 'Specific users',
};

export interface Notice {
  id: number;
  title: string;
  content: string;
  category: string;
  priority: NoticePriority;
  priority_display: string;
  status: 'draft' | 'published' | 'archived';
  status_display: string;
  publish_at: string | null;
  expire_at: string | null;
  attachment_url: string | null;
  audience_type: NoticeAudience;
  audience_value: { role?: string; department?: string; group?: number; users?: number[] } | null;
  audience_display: string;
  author_detail: UserBrief | null;
  is_expired: boolean;
  /** null when the list was loaded for managing. */
  read: boolean | null;
  created_at: string;
  updated_at: string;
}

export interface NoticeInput {
  title: string;
  content: string;
  category: string;
  priority: NoticePriority;
  audience_type: NoticeAudience;
  audience_value: Notice['audience_value'];
  publish_at: string | null;
  expire_at: string | null;
}

/** GET /notices/?read=&search= — the live board for me. */
export function useNotices(params: { read?: '' | 'true' | 'false'; search?: string } = {}) {
  const q = { read: params.read || undefined, search: params.search?.trim() || undefined };
  return useQuery({ queryKey: ['notices', 'feed', q], queryFn: () => tasksApi.get<Notice[]>('/notices/', q) });
}

/** GET /notices/?manage=true — every notice, for settings.manage. */
export function useManagedNotices(enabled = true) {
  return useQuery({ queryKey: ['notices', 'manage'], queryFn: () => tasksApi.get<Notice[]>('/notices/', { manage: 'true' }), enabled });
}

function useInvalidateNotices() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['notices'] });
}

export function useMarkNoticeRead() {
  const done = useInvalidateNotices();
  return useMutation({ mutationFn: (id: number) => tasksApi.post(`/notices/${id}/read/`), onSuccess: done });
}

/** POST /notices/ (a draft) or PATCH /notices/:id/ */
export function useSaveNotice() {
  const done = useInvalidateNotices();
  return useMutation({
    mutationFn: ({ id, ...body }: NoticeInput & { id?: number }) => (id ? tasksApi.patch<Notice>(`/notices/${id}/`, body) : tasksApi.post<Notice>('/notices/', body)),
    onSuccess: done,
  });
}

/** publish / archive (POST /notices/:id/<action>/) or delete. */
export function useNoticeAction() {
  const done = useInvalidateNotices();
  return useMutation({
    mutationFn: ({ id, action }: { id: number; action: 'publish' | 'archive' | 'delete' }) =>
      action === 'delete' ? tasksApi.del(`/notices/${id}/`) : tasksApi.post(`/notices/${id}/${action}/`),
    onSuccess: done,
  });
}

export interface NoticeWhatsappPreview {
  audience: number;
  with_whatsapp: number;
  without_whatsapp: string[];
  /** People it can reach who have not had it yet (joined, reactivated or skipped since the last send). */
  missing: string[];
}

/** GET then POST /notices/:id/send_whatsapp/ — preview who it reaches, then send (to everyone, or only the people who missed it). */
export function useNoticeWhatsapp() {
  return {
    preview: useMutation({ mutationFn: (id: number) => tasksApi.get<NoticeWhatsappPreview>(`/notices/${id}/send_whatsapp/`) }),
    send: useMutation({
      mutationFn: ({ id, onlyMissing = false }: { id: number; onlyMissing?: boolean }) =>
        tasksApi.post<{ queued: number }>(`/notices/${id}/send_whatsapp/`, onlyMissing ? { only_missing: true } : {}),
    }),
  };
}
