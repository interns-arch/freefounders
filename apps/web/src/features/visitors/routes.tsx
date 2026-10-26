import { lazy } from 'react';
import { Navigate, type RouteObject, useLocation } from 'react-router';

const VisitorsPage = lazy(() => import('./visitors-page').then((m) => ({ default: m.VisitorsPage })));

/** /visitors, /visitors/today|vehicles|inside|my|register|activity|settings (PLAN.md §22). */
export const visitorsRoutes: RouteObject[] = [
  { index: true, element: <VisitorsPage /> },
  { path: ':tab', element: <VisitorsPage /> },
];

/** Tasks notifications link Tasks-relative (/tasks/visitors/my?visit=7): open /visitors/my?visit=7. */
function ToVisitors() {
  const loc = useLocation();
  return <Navigate to={`${loc.pathname.replace(/^\/tasks/, '')}${loc.search}`} replace />;
}
export const oldVisitorRoutes: RouteObject[] = [{ path: 'visitors/*', element: <ToVisitors /> }];
