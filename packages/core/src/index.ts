// @freefounders/core: what every screen (web and mobile) uses. Area hooks: @freefounders/core/{admin,tasks,hr,assets}.
export { configureCore, type RefreshStore } from './config';
export { ApiError, errorMessage, resultsOf, type DrfPage, type Page, type Query } from './http';
export { session, type AppKey, type Claims } from './session';
export { createQueryClient, LOOKUP } from './query';
export {
  useAccess,
  useAssetsConfig,
  useAssetsMe,
  useClaims,
  usePlatformMe,
  useTasksMe,
  type Access,
  type AssetsConfig,
  type AssetsMe,
  type PlatformMe,
  type TasksMe,
} from './access';
export { useNotifications, useMarkNotificationsRead, type UnifiedNotification } from './notifications';
export { useChangePassword, useSignIn, useSignOut } from './auth';
