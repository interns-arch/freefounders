import { lazy } from 'react';
import { Navigate, type RouteObject, useParams, useSearchParams } from 'react-router';

// Loaded when first opened (it brings the camera code with it).
const HrPage = lazy(() => import('./hr-page').then((m) => ({ default: m.HrPage })));
const ReminderPage = lazy(() => import('./reminder').then((m) => ({ default: m.ReminderPage })));

/** Old links (emails, notifications): /tasks/hr?tab=x → /attendance/x. */
function OldHrLink() {
  const [params] = useSearchParams();
  const tab = params.get('tab');
  return <Navigate to={tab && tab !== 'today' ? `/attendance/${tab}` : '/attendance'} replace />;
}

/** /attendance?tab=x (the old query style) → /attendance/x. */
function AttendanceHome() {
  const [params] = useSearchParams();
  const { tab } = useParams();
  const asked = params.get('tab');
  if (!tab && asked && asked !== 'today') return <Navigate to={`/attendance/${asked}`} replace />;
  return <HrPage />;
}

/** The Attendance workspace (PLAN.md §19.4, §19.15): /attendance, /attendance/history|leave|salary|holidays|team|daily|dashboard|reports|approvals|payroll|settings. */
export const attendanceRoutes: RouteObject[] = [
  { index: true, element: <AttendanceHome /> },
  // The punch-in reminder of the phone app (PLAN.md §19.32; account menu → Punch-in reminder).
  { path: 'reminder', element: <ReminderPage /> },
  { path: ':tab', element: <HrPage /> },
];

/** Under /tasks: the old address. */
export const hrRoutes: RouteObject[] = [{ path: 'hr', element: <OldHrLink /> }];
