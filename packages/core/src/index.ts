// @freefounders/core: what every screen (web and mobile) uses. Area hooks: @freefounders/core/{admin,tasks,hr,assets,account,billing}.
export { configureCore, type RefreshStore } from './config';
export { ApiError, errorMessage, onPaymentRequired, resultsOf, retryAfterSeconds, type DrfPage, type Page, type Query } from './http';
export { session, type AppKey, type ChooseCompany, type Claims, type CompanyChoice, type SignInTokens } from './session';
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
  type MeAccount,
  type MeBilling,
  type SubscriptionState,
  type PlatformMe,
  type TasksMe,
} from './access';
export {
  NOTIFICATION_TABS,
  notificationHref,
  useMarkNotificationRead,
  useMarkNotificationsRead,
  useNotificationCounts,
  useNotifications,
  type NotificationArea,
  type NotificationTab,
  type UnifiedNotification,
} from './notifications';
export { useChangePassword, useSignIn, useSignOut } from './auth';
export { useBadges, BADGES_KEY } from './badges';
export { countLabel, toBadges, NO_BADGES, type Badges } from './badge-count';
export { isOlderVersion, useAppVersionInfo, type AppVersionInfo } from './app-update';
