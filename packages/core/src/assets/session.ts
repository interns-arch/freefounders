import { assetsApi } from '../http';

/**
 * Assets shows photos and files with plain <img>/<a> tags, which cannot send the access token. So once signed in,
 * the web app swaps the token for a short Assets session cookie (PLAN.md §13.12). Mobile does not need it.
 */
export async function ensureAssetsCookie(): Promise<boolean> {
  try {
    await assetsApi.post('/auth/platform-session');
    return true;
  } catch {
    return false;
  }
}

/** Ends that Assets session on sign-out, so the cookie cannot be used for the rest of its 15 minutes. */
export async function endAssetsCookie(): Promise<void> {
  await assetsApi.post('/auth/logout').catch(() => null);
}
