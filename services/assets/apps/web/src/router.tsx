import { Loader2 } from 'lucide-react';
import { lazy, Suspense } from 'react';
import { createBrowserRouter, isRouteErrorResponse, Link, Navigate, Outlet, useLocation, useRouteError } from 'react-router';
import { ConfirmProvider } from '@/components/common/confirm';
import { AppShell } from '@/components/layout/app-shell';
import { MAIN_NAV, navVisible } from '@/components/layout/nav';
import { Button } from '@/components/ui/button';
import { QuickAddProvider } from '@/features/quick-add/quick-add';
import { useAuth } from '@/lib/auth';

const LoginPage = lazy(() => import('@/features/auth/login-page'));
const DashboardPage = lazy(() => import('@/features/dashboard/dashboard-page'));

function HomeRoute() {
  const { can } = useAuth();
  if (navVisible(MAIN_NAV[0], can)) return <DashboardPage />;
  const first = MAIN_NAV.find((n) => navVisible(n, can));
  return <Navigate to={first?.to ?? '/employees'} replace />;
}
const AssetsPage = lazy(() => import('@/features/assets/assets-page'));
const AssetDetailPage = lazy(() => import('@/features/assets/asset-detail-page'));
const LabelsPage = lazy(() => import('@/features/assets/labels-page'));
const ScanPage = lazy(() => import('@/features/assets/scan-page'));
const EmployeesPage = lazy(() => import('@/features/employees/employees-page'));
const EmployeeDetailPage = lazy(() => import('@/features/employees/employee-detail-page'));
const IdCardsPage = lazy(() => import('@/features/employees/id-cards-page'));
const ExitsPage = lazy(() => import('@/features/exits/exits-page'));
const ExitDetailPage = lazy(() => import('@/features/exits/exit-detail-page'));
const RequestsPage = lazy(() => import('@/features/service/requests-page'));
const TicketsPage = lazy(() => import('@/features/service/tickets-page'));
const QueuePage = lazy(() => import('@/features/queue/queue-page'));
const SimsPage = lazy(() => import('@/features/assets/sims-page'));
const LeadershipPage = lazy(() => import('@/features/leadership/leadership-page'));
const OnboardingPage = lazy(() => import('@/features/onboarding/onboarding-page'));
const OnboardingDetailPage = lazy(() => import('@/features/onboarding/onboarding-detail-page'));
const ReconciliationPage = lazy(() => import('@/features/reconciliation/reconciliation-page'));
const ReconRunPage = lazy(() => import('@/features/reconciliation/run-page'));
const MaintenancePage = lazy(() => import('@/features/service/maintenance-page'));
const ActivityPage = lazy(() => import('@/features/activity/activity-page'));
const CatalogPage = lazy(() => import('@/features/catalog/catalog-page'));
const OrgPage = lazy(() => import('@/features/org/org-page'));
const UsersPage = lazy(() => import('@/features/admin/users-page'));
const RolesPage = lazy(() => import('@/features/admin/roles-page'));

function Splash() {
  return (
    <div className="flex min-h-dvh items-center justify-center">
      <Loader2 className="size-6 animate-spin text-primary" />
    </div>
  );
}

function Root() {
  return (
    <ConfirmProvider>
      <QuickAddProvider>
        <Suspense fallback={<Splash />}>
          <Outlet />
        </Suspense>
      </QuickAddProvider>
    </ConfirmProvider>
  );
}

function RequireAuth() {
  const { me, loading } = useAuth();
  const location = useLocation();
  if (loading) return <Splash />;
  if (!me) return <Navigate to={`/login?next=${encodeURIComponent(location.pathname + location.search)}`} replace />;
  return <AppShell />;
}

function RouteError() {
  const error = useRouteError();
  const notFound = isRouteErrorResponse(error) && error.status === 404;
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="text-5xl font-semibold tracking-tight text-muted-foreground/40">{notFound ? '404' : 'Oops'}</p>
      <p className="text-lg font-medium">{notFound ? 'This page doesn’t exist' : 'Something went wrong'}</p>
      {!notFound && <p className="max-w-md text-sm text-muted-foreground">{error instanceof Error ? error.message : 'An unexpected error occurred.'}</p>}
      <div className="flex gap-2">
        <Button variant="outline" onClick={() => window.location.reload()}>
          Reload
        </Button>
        <Button asChild>
          <Link to="/">Go to dashboard</Link>
        </Button>
      </div>
    </div>
  );
}

export const router = createBrowserRouter([
  {
    element: <Root />,
    errorElement: <RouteError />,
    children: [
      { path: '/login', element: <LoginPage /> },
      {
        element: <RequireAuth />,
        errorElement: <RouteError />,
        children: [
          { index: true, element: <HomeRoute /> },
          { path: 'assets', element: <AssetsPage /> },
          { path: 'assets/:id', element: <AssetDetailPage /> },
          { path: 'labels', element: <LabelsPage /> },
          { path: 'scan', element: <ScanPage /> },
          { path: 'scan/:code', element: <ScanPage /> },
          { path: 'id/:code', element: <ScanPage /> },
          { path: 'id-cards', element: <IdCardsPage /> },
          { path: 'employees', element: <EmployeesPage /> },
          { path: 'employees/:id', element: <EmployeeDetailPage /> },
          { path: 'exits', element: <ExitsPage /> },
          { path: 'exits/:id', element: <ExitDetailPage /> },
          { path: 'requests', element: <RequestsPage /> },
          { path: 'tickets', element: <TicketsPage /> },
          { path: 'queue', element: <QueuePage /> },
          { path: 'sims', element: <SimsPage /> },
          { path: 'leadership', element: <LeadershipPage /> },
          { path: 'onboarding', element: <OnboardingPage /> },
          { path: 'onboarding/:id', element: <OnboardingDetailPage /> },
          { path: 'reconciliation', element: <ReconciliationPage /> },
          { path: 'reconciliation/:id', element: <ReconRunPage /> },
          { path: 'maintenance', element: <MaintenancePage /> },
          { path: 'activity', element: <ActivityPage /> },
          { path: 'settings/catalog', element: <CatalogPage /> },
          { path: 'settings/departments', element: <OrgPage kind="department" /> },
          { path: 'settings/vendors', element: <OrgPage kind="vendor" /> },
          { path: 'settings/users', element: <UsersPage /> },
          { path: 'settings/roles', element: <RolesPage /> },
          { path: '*', element: <RouteError /> },
        ],
      },
    ],
  },
]);
