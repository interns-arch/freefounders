import { lazy } from 'react';
import type { RouteObject } from 'react-router';
import { RequireTasks } from '../general/parts';

// Loaded when first opened (smaller first download; the shell shows a loader meanwhile).
const FormsPage = lazy(() => import('./page').then((m) => ({ default: m.FormsPage })));
const FormBuilderPage = lazy(() => import('./builder').then((m) => ({ default: m.FormBuilderPage })));
const FormSubmissionsPage = lazy(() => import('./submissions').then((m) => ({ default: m.FormSubmissionsPage })));
const FillFormPage = lazy(() => import('./fill').then((m) => ({ default: m.FillFormPage })));

const gate = (what: string, el: React.ReactNode) => (
  <RequireTasks allow={(a) => a.tasks.module('forms')} what={what}>
    {el}
  </RequireTasks>
);
const build = (el: React.ReactNode) => <RequireTasks allow={(a) => a.tasks.module('forms') && a.tasks.can('tasks.assign')} what="the form builder">{el}</RequireTasks>;

/** /tasks/forms (?view=manage), /tasks/forms/:formId (builder), …/submissions, …/fill. */
export const formsRoutes: RouteObject[] = [
  { path: 'forms', element: gate('Forms (switched off for this company)', <FormsPage />) },
  { path: 'forms/:formId', element: build(<FormBuilderPage />) },
  { path: 'forms/:formId/submissions', element: build(<FormSubmissionsPage />) },
  { path: 'forms/:formId/fill', element: gate('Forms (switched off for this company)', <FillFormPage />) },
];

/** The share-link page, registered outside the session guard (apps/web/src/app/router.tsx). */
export const PublicFormPage = lazy(() => import('./public').then((m) => ({ default: m.PublicFormPage })));
