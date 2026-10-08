/** Signing in and out, and changing one's own password. */
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { platformApi } from './http';
import { session } from './session';

export function useSignIn() {
  return useMutation({ mutationFn: ({ login, password }: { login: string; password: string }) => session.login(login, password) });
}

export function useSignOut() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => session.logout(),
    onSuccess: () => qc.clear(),
  });
}

export function useChangePassword() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: { currentPassword: string; newPassword: string }) => platformApi.post<{ ok: boolean }>('/auth/change-password', body),
    onSuccess: async () => {
      // Changing the password signs other devices out; renew this one and reload who we are.
      await session.refresh();
      await qc.invalidateQueries({ queryKey: ['platform', 'me'] });
    },
  });
}
