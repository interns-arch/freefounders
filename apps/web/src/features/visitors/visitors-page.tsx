/** The Visitors area (PLAN.md §22): /visitors/<tab>; each tab is its own permission (features/visitors/nav.ts). */
import { useAccess } from '@kaampilot/core';
import { useVisitorConfig } from '@kaampilot/core/visitors';
import { Navigate, useParams } from 'react-router';
import { ErrorState, PageLoader } from '@/components/common/page';
import { NotFound } from '@/app/pages/errors';
import { ContractorsPage } from './contractors';
import { DeliveriesPage } from './deliveries';
import { GatePage } from './gate';
import { IncidentsPage } from './incidents';
import { ActivityPage, InsidePage, MyVisitorsPage, RegisterPage } from './lists';
import { MaterialPage } from './material';
import { VISITOR_SCREENS } from './nav';
import { PatrolPage } from './patrol';
import { ReportsPage } from './reports';
import { VisitorSettingsPage } from './settings';
import { VehiclesPage } from './vehicles';
import { WatchlistPage } from './watchlist';

export function VisitorsPage() {
  const { tab } = useParams();
  const access = useAccess();
  const config = useVisitorConfig(access.tasks.module('visitors'));
  if (!access.tasks.module('visitors')) return <NotFound />;
  if (config.error) return <ErrorState error={config.error} onRetry={() => void config.refetch()} />;
  if (!config.data) return <PageLoader />;
  const c = config.data;
  if (!tab) return <Navigate to={c.can.gate ? '/visitors/today' : c.can.invite ? '/visitors/my' : c.can.view_all ? '/visitors/register' : '/visitors/settings'} replace />;
  switch (tab) {
    case 'today':
      return VISITOR_SCREENS.gate(access) ? <GatePage config={c} /> : <NotFound />;
    case 'vehicles':
      return c.can.gate || c.can.view_all ? <VehiclesPage config={c} /> : <NotFound />;
    case 'inside':
      return c.can.gate || c.can.view_all ? <InsidePage /> : <NotFound />;
    case 'my':
      return c.can.invite ? <MyVisitorsPage config={c} /> : <NotFound />;
    case 'deliveries':
      return c.can.gate || c.can.view_all ? <DeliveriesPage config={c} /> : <NotFound />;
    case 'contractors':
      return c.can.gate || c.can.view_all || c.can.invite ? <ContractorsPage config={c} /> : <NotFound />;
    case 'material':
      return c.can.gate || c.can.view_all || c.can.invite ? <MaterialPage config={c} /> : <NotFound />;
    case 'patrol':
      return c.can.gate || c.can.view_all || c.can.settings ? <PatrolPage config={c} /> : <NotFound />;
    case 'incidents':
      return c.can.gate || c.can.view_all ? <IncidentsPage config={c} /> : <NotFound />;
    case 'reports':
      return c.can.view_all ? <ReportsPage /> : <NotFound />;
    case 'watchlist':
      return c.can.settings || c.can.view_all ? <WatchlistPage config={c} /> : <NotFound />;
    case 'register':
      return c.can.view_all ? <RegisterPage config={c} /> : <NotFound />;
    case 'activity':
      return c.can.view_all ? <ActivityPage /> : <NotFound />;
    case 'settings':
      return c.can.settings ? <VisitorSettingsPage /> : <NotFound />;
    default:
      return <NotFound />;
  }
}
