import { useAccess } from '@freefounders/core';
import { type TaskTemplate, useTaskInboxCounts, useTaskPeople } from '@freefounders/core/tasks';
import { ChevronDown } from 'lucide-react';
import { useCallback, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router';
import { PageHeader } from '@/components/common/page';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/overlays';
import { cn } from '@/lib/utils';
import { ActivitiesTab } from './activities-tab';
import { DashboardTab } from './dashboard-tab';
import { DeletedTab, RequestsTab, ReviewsTab } from './inbox-tabs';
import { TaskListTab } from './list-tab';
import { PersonProfileSheet } from './person-profile';
import { DisputesTab, ReportsTab, TimeTab } from './reports-tab';
import { TaskDetailSheet } from './task-detail';
import { TaskFormSheet } from './task-form';
import { DirectoryTab, TemplatesTab } from './templates-tab';

const BASE = '/tasks/tasks';
/** How many tabs stay in the bar on a phone; the rest go under "More". */
const PHONE_TABS = 4;

/**
 * The task workspace at /tasks/tasks (?tab=dashboard|my|all|delegated|subscribed|reviews|requests|templates|directory|
 * activities|employees|time|disputes|deleted). /tasks/tasks/:taskId opens a task over the list (links in emails and
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

  const tabs: Array<[string, string]> = [
    ['dashboard', 'Dashboard'],
    ['my', 'My Tasks'],
    ...(hasTeam ? [['all', 'All Tasks'] as [string, string]] : []),
    ['delegated', 'Delegated'],
    ['subscribed', 'Subscribed'],
    ['reviews', counts.reviews > 0 ? `To accept (${counts.reviews})` : 'To accept'],
    ['requests', counts.requests > 0 ? `Requests (${counts.requests})` : 'Requests'],
    ['templates', 'Templates'],
    ['directory', 'Template Directory'],
    ['activities', 'Activities'],
    ...(isManager
      ? ([
          ['employees', 'Reports'],
          ['time', 'Time Report'],
          ['disputes', 'Disputes'],
        ] as Array<[string, string]>)
      : ([['time', 'Time Report']] as Array<[string, string]>)),
    ...(isAdmin ? [['deleted', 'Deleted'] as [string, string]] : []),
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
      <PageHeader title="Tasks" />
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
        {area === 'directory' && <DirectoryTab />}
        {area === 'activities' && <ActivitiesTab href={href} />}
        {area === 'employees' && isManager && <ReportsTab onProfile={openProfile} />}
        {area === 'time' && <TimeTab />}
        {area === 'disputes' && isManager && <DisputesTab />}
        {area === 'deleted' && isAdmin && <DeletedTab />}
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
function TabBar({ tabs, area, href }: { tabs: Array<[string, string]>; area: string; href: (v: string) => string }) {
  const link = (v: string, l: string, extra?: string) => (
    <Link
      key={v}
      to={href(v)}
      aria-current={area === v ? 'page' : undefined}
      className={cn(
        '-mb-px inline-flex h-10 shrink-0 items-center border-b-2 border-transparent px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground transition hover:text-foreground',
        area === v && 'border-primary text-foreground',
        extra,
      )}
    >
      {l}
    </Link>
  );
  const front = tabs.slice(0, PHONE_TABS);
  const rest = tabs.slice(PHONE_TABS);
  const restActive = rest.find(([v]) => v === area);
  const navigate = useNavigate();
  return (
    <>
      <nav aria-label="Task views" className="no-scrollbar hidden gap-1 overflow-x-auto border-b md:flex">
        {tabs.map(([v, l]) => link(v, l))}
      </nav>
      <nav aria-label="Task views" className="flex gap-1 border-b md:hidden">
        {front.map(([v, l]) => link(v, l))}
        {rest.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger
              className={cn(
                '-mb-px inline-flex h-10 shrink-0 cursor-pointer items-center gap-1 border-b-2 border-transparent px-2.5 text-sm font-medium whitespace-nowrap text-muted-foreground outline-none',
                restActive && 'border-primary text-foreground',
              )}
            >
              {restActive ? restActive[1] : 'More'} <ChevronDown className="size-3.5" aria-hidden />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {rest.map(([v, l]) => (
                <DropdownMenuItem key={v} onSelect={() => navigate(href(v))} className={cn(area === v && 'font-medium text-primary')}>
                  {l}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </nav>
    </>
  );
}
