import type { RouteObject } from 'react-router';
import { HrPage } from './hr-page';

/** /tasks/hr (a child of /tasks), with ?tab=today|history|leave|holidays|team|approvals|settings. */
export const hrRoutes: RouteObject[] = [{ path: 'hr', element: <HrPage /> }];
