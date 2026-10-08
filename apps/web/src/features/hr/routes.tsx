import { lazy } from 'react';
import type { RouteObject } from 'react-router';

// Loaded when first opened (it brings the camera and face-check code with it).
const HrPage = lazy(() => import('./hr-page').then((m) => ({ default: m.HrPage })));

/** /tasks/hr (a child of /tasks), with ?tab=today|history|leave|holidays|team|approvals|settings. */
export const hrRoutes: RouteObject[] = [{ path: 'hr', element: <HrPage /> }];
