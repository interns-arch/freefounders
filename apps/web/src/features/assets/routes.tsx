import { useAccess } from '@kaampilot/core';
import { lazy } from 'react';
import { Navigate, type RouteObject } from 'react-router';
import { PageLoader } from '@/components/common/page';
import { AssetsFrame } from './frame';
import { ASSETS_NAV } from './nav';

const DashboardPage = lazy(() => import('./dashboard/dashboard-page'));
const AssetsPage = lazy(() => import('./inventory/assets-page'));
const AssetDetailPage = lazy(() => import('./inventory/asset-detail-page'));
const LabelsPage = lazy(() => import('./inventory/labels-page'));
const ScanPage = lazy(() => import('./inventory/scan-page'));
const EmployeesPage = lazy(() => import('./employees/employees-page'));
const EmployeeDetailPage = lazy(() => import('./employees/employee-detail-page'));
const IdCardsPage = lazy(() => import('./employees/id-cards-page'));
const ExitsPage = lazy(() => import('./exits/exits-page'));
const ExitDetailPage = lazy(() => import('./exits/exit-detail-page'));
const RequestsPage = lazy(() => import('./service/requests-page'));
const TicketsPage = lazy(() => import('./service/tickets-page'));
const QueuePage = lazy(() => import('./queue/queue-page'));
const LeadershipPage = lazy(() => import('./leadership/leadership-page'));
const OnboardingPage = lazy(() => import('./onboarding/onboarding-page'));
const OnboardingDetailPage = lazy(() => import('./onboarding/onboarding-detail-page'));
const MaintenancePage = lazy(() => import('./service/maintenance-page'));
const ActivityPage = lazy(() => import('./activity/activity-page'));
const CatalogPage = lazy(() => import('./catalog/catalog-page'));
const OrgPage = lazy(() => import('./org/org-page'));
const UsersPage = lazy(() => import('./admin/users-page'));
const SimsPage = lazy(() => import('./sims/sims-page'));
const ReconciliationPage = lazy(() => import('./reconciliation/reconciliation-page'));
const ReconRunPage = lazy(() => import('./reconciliation/run-page'));

/** /assets: the dashboard, or the first menu item this person can open (like the old Assets HomeRoute). */
function HomeRoute() {
  const access = useAccess();
  const items = ASSETS_NAV.filter((n) => !n.show || n.show(access));
  if (items[0]?.to === '/assets') return <DashboardPage />;
  return <Navigate to={items[0]?.to ?? '/assets/employees'} replace />;
}

/** "My QR & profile": a plain employee's own page. */
function MyProfileRoute() {
  const access = useAccess();
  const id = access.assets.me?.employee?.id;
  if (!access.ready) return <PageLoader />;
  return <Navigate to={id ? `/assets/employees/${id}` : '/assets'} replace />;
}

/**
 * Children of /assets: the same sub-paths as the old Assets web app, so QR codes, ID cards and notification links
 * keep working (/assets/scan/:code, /assets/id/:code, /assets/requests?open=…, /assets/reconciliation/:id).
 */
export const assetsRoutes: RouteObject[] = [
  {
    index: true,
    element: (
      <AssetsFrame>
        <HomeRoute />
      </AssetsFrame>
    ),
  },
  {
    element: <AssetsFrame />,
    children: [
      { path: 'me', element: <MyProfileRoute /> },
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
      { path: 'leadership', element: <LeadershipPage /> },
      { path: 'onboarding', element: <OnboardingPage /> },
      { path: 'onboarding/:id', element: <OnboardingDetailPage /> },
      { path: 'maintenance', element: <MaintenancePage /> },
      { path: 'activity', element: <ActivityPage /> },
      { path: 'sims', element: <SimsPage /> },
      { path: 'reconciliation', element: <ReconciliationPage /> },
      { path: 'reconciliation/:id', element: <ReconRunPage /> },
      { path: 'settings/catalog', element: <CatalogPage /> },
      { path: 'settings/departments', element: <OrgPage kind="department" /> },
      { path: 'settings/vendors', element: <OrgPage kind="vendor" /> },
      { path: 'settings/users', element: <UsersPage /> },
      // Roles live in Admin → Roles (one role builder, PLAN.md §15 / §19.28).
      { path: 'settings/roles', element: <Navigate to="/roles" replace /> },
    ],
  },
];
