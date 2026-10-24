import { useAccess } from '@freefounders/core';
import { type TaskTemplate, useTaskInboxCounts, useTaskPeople } from '@freefounders/core/tasks';
import { ChevronDown } from '@/components/icons';
import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/common/page';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { cn } from '@/lib/utils';
import { tabActiveClass, tabClass } from '@/components/common/controls';
import { ActivitiesTab } from './activities-tab';
import { DashboardTab } from './dashboard-tab';
import { DeletedTab, RequestsTab, ReviewsTab } from './inbox-tabs';
import { TaskListTab } from './list-tab';
import { PersonProfileSheet } from './person-profile';
import { DisputesTab, ReportsTab, TimeTab } from './reports-tab';
import { ChainsTab } from './task-chain';
import { TaskDetailSheet } from './task-detail';
import { TaskFormSheet } from './task-form';
import { TabCount } from './task-bits';
import { DirectoryTab, TemplatesTab } from './templates-tab';

const BASE = '/tasks/tasks';
/** How many tabs stay in the bar on a phone; the rest go under "More". */
const PHONE_TABS = 3;
type Tab = [value: string, label: string, count?: number];

/**
 * The task workspace at /tasks/tasks (?tab=dashboard|my|all|delegated|subscribed|reviews|requests|templates|directory|
 * activities|employees|time|disputes|chains|deleted). /tasks/tasks/:taskId opens a task over the list (links in emails and
 * notifications; ?review=accept|reject from the completion email). ?user=<id> opens that person's profile.
 */
export function TaskWorkspacePage() {
  const access = useAccess();
  const can = access.tasks.can;
  const isAdmin = can('tasks.view_all');
  const isManager = isAdmin || can('tasks.view_department');
  const { taskId } = useParams();
  const [params, setParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();
  const area = params.get('tab') || 'dashboard';
  const review = params.get('review');
  const profileId = Number(params.get('user')) || null;
  const counts = useTaskInboxCounts();
  // More people than just me → I have a team, so All Tasks is worth showing.
  const people = useTaskPeople().data ?? [];
  const hasTeam = isManager || people.length > 1;
  const [form, setForm] = useState<{ template: TaskTemplate | null } | null>(null);

  // [value, label, red count after the label (my open tasks, work to accept, requests to decide)]
  const tabs: Tab[] = [
    ['dashboard', 'Dashboard'],
    ['my', 'My Tasks', counts.mine],
    ...(hasTeam ? [['all', 'All Tasks'] as Tab] : []),
    ['delegated', 'Delegated'],
    ['subscribed', 'Subscribed'],
    ['reviews', 'To accept', counts.reviews],
    ['requests', 'Requests', counts.requests],
    ['templates', 'Templates'],
    ...(can('directory.view') ? [['directory', 'Template Directory'] as Tab] : []),
    ['activities', 'Activities'],
    // Each one is its own permission (PLAN.md §19.19): Reports, Deleted tasks, Template directory.
    ...(can('tasks.reports')
      ? ([
          ['employees', 'Reports'],
          ['time', 'Time Report'],
          ['disputes', 'Disputes'],
        ] as Tab[])
      : ([['time', 'Time Report']] as Tab[])),
    // Task chains (PLAN.md §19.41): every task split into parts, for admins and the Owner (company-wide view).
    ...(isAdmin ? [['chains', 'Chains'] as Tab] : []),
    ...(can('tasks.bin') ? [['deleted', 'Deleted'] as Tab] : []),
  ];

  // Detail links keep the list's filters, so closing the task lands back on the same view.
  const listSearch = useCallback(() => {
    const p = new URLSearchParams(location.search);
    p.delete('review');
    const s = p.toString();
    return s ? `?${s}` : '';
  }, [location.search]);
  const href = useCallback((id: number) => `${BASE}/${id}${listSearch()}`, [listSearch]);
  const closeTask = () => navigate(`${BASE}${listSearch()}`);
  const openProfile = (id: number) =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.set('user', String(id));
      return next;
    });
  const closeProfile = () =>
    setParams((p) => {
      const next = new URLSearchParams(p);
      next.delete('user');
      return next;
    });
  const tabHref = (v: string) => (v === 'dashboard' ? BASE : `${BASE}?tab=${v}`);
  const openList = (tab: string, filters: Record<string, string>) => navigate(`${BASE}?${new URLSearchParams({ tab, ...filters })}`);

  return (
    <div>
      <PageHeader title="Tasks" className="mb-3" />
      <TabBar tabs={tabs} area={area} href={tabHref} />
      <div className="mt-5">
        {area === 'dashboard' && <DashboardTab onTile={openList} />}
        {(area === 'my' || area === 'all' || area === 'delegated' || area === 'subscribed') && (
          <TaskListTab key={area} scope={area} href={href} onAdd={() => setForm({ template: null })} onProfile={openProfile} />
        )}
        {area === 'reviews' && <ReviewsTab href={href} />}
        {area === 'requests' && <RequestsTab href={href} />}
        {area === 'templates' && (
          <TemplatesTab
            onUse={(t) => {
              navigate(tabHref('my'));
              setForm({ template: t });
            }}
          />
        )}
        {area === 'directory' && can('directory.view') && <DirectoryTab />}
        {area === 'activities' && <ActivitiesTab href={href} />}
        {area === 'employees' && can('tasks.reports') && <ReportsTab onProfile={openProfile} />}
        {area === 'time' && <TimeTab />}
        {area === 'disputes' && can('tasks.reports') && <DisputesTab />}
        {area === 'chains' && isAdmin && <ChainsTab />}
        {area === 'deleted' && can('tasks.bin') && <DeletedTab />}
      </div>
      {form && <TaskFormSheet template={form.template} onClose={() => setForm(null)} />}
      {profileId && <PersonProfileSheet userId={profileId} href={href} onClose={closeProfile} />}
      {taskId && Number(taskId) > 0 && (
        <TaskDetailSheet
          key={taskId}
          taskId={Number(taskId)}
          review={review}
          focusComment={!(location.state as { fromList?: boolean } | null)?.fromList}
          onClose={closeTask}
        />
      )}
    </div>
  );
}

/** Every view as a link (the address keeps the tab). On a phone the first few stay and the rest go under "More". */
function TabBar({ tabs, area, href }: { tabs: Tab[]; area: string; href: (v: string) => string }) {
  const link = (v: string, l: string, count?: number) => (
    <Link
      key={v}
      to={href(v)}
      aria-current={area === v ? 'page' : undefined}
      className={cn(
        tabClass,
        area === v && tabActiveClass,
      )}
    >
      {l}
      <TabCount n={count} className="ml-1" />
    </Link>
  );
  const front = tabs.slice(0, PHONE_TABS);
  const rest = tabs.slice(PHONE_TABS);
  const restActive = rest.find(([v]) => v === area);
  const restCount = rest.reduce((n, [, , c]) => n + (c ?? 0), 0);
  const navigate = useNavigate();
  return (
    <>
      <nav aria-label="Task views" className="hidden flex-wrap gap-x-0.5 border-b md:flex">
        {tabs.map(([v, l, c]) => link(v, l, c))}
      </nav>
      <nav aria-label="Task views" className="no-scrollbar -mx-4 flex gap-0.5 overflow-x-auto border-b px-4 md:hidden">
        {front.map(([v, l, c]) => link(v, l, c))}
        {rest.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                tabClass,
                'ml-auto',
                restActive && tabActiveClass,
              )}
            >
              {restActive ? restActive[1] : 'More'}
              {!restActive && <TabCount n={restCount} className="ml-1" />}
              <ChevronDown className="size-3.5" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {rest.map(([v, l, c]) => (
                <DropdownMenuItem key={v} onSelect={() => navigate(href(v))} className={cn('justify-between', area === v && 'font-semibold text-primary')}>
                  {l}
                  <TabCount n={c} />
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>
    </>
  );
}
