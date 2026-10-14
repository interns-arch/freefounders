// @freefounders/core: what every screen (web and mobile) uses. Area hooks: @freefounders/core/{admin,tasks,hr,assets,account,billing}.
export { configureCore, type RefreshStore } from './config';
export { ApiError, errorMessage, onPaymentRequired, resultsOf, type DrfPage, type Page, type Query } from './http';
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
export { useNotifications, useMarkNotificationsRead, type UnifiedNotification } from './notifications';
export { useChangePassword, useSignIn, useSignOut } from './auth';
