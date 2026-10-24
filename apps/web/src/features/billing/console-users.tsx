/**
 * Kaampilot console → Users (PLAN.md §21.9): every account and admin-made login across companies, emails and mobiles
 * partly hidden; a click opens the person (their companies and recent sign-ins; the view is in the staff audit log).
 */
import { type ConsoleUser, consoleExports, useConsoleUser, useConsoleUsers } from '@freefounders/core/billing';
import { fileSlug, todayStamp } from '@freefounders/core/export';
import { useEffect, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import { ChevronLeft, ChevronRight } from '@/components/icons';
import { type Column, DataTable } from '@/components/common/data-table';
import { DownloadMenu } from '@/components/common/download-menu';
import { BACK_LINK, DetailList, DETAIL_TITLE, ErrorState, PageLoader } from '@/components/common/page';
import { SearchField } from '@/components/common/search-field';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/primitives';
import { formatDate, formatDateTime } from '@/lib/utils';
import { ago, Section, useStaff } from './console-parts';

export function ConsoleUsersTab({ enabled }: { enabled: boolean }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  // Searches on the server 300 ms after typing stops.
  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);
  const users = useConsoleUsers(q, page, enabled);
  const data = users.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const columns: Column<ConsoleUser>[] = [
    {
      key: 'name',
      header: 'Name',
      cell: (u) => (
        <div className="min-w-32">
          <p className="truncate font-semibold">{u.name}</p>
          {u.username && <p className="font-mono text-xs text-muted-foreground">{u.username}</p>}
        </div>
      ),
    },
    { key: 'contact', header: 'Email / mobile', cell: (u) => <span className="break-all font-mono text-xs">{[u.email, u.mobile].filter(Boolean).join(' · ') || '—'}</span> },
    { key: 'companies', header: 'Companies', cell: (u) => <span className="text-sm">{u.companies.join(', ') || '—'}</span> },
    { key: 'last', header: 'Last sign-in', cell: (u) => <span className="whitespace-nowrap">{ago(u.lastSignIn)}</span> },
    { key: 'created', header: 'Created', hideOnMobile: true, cell: (u) => formatDate(u.createdAt) },
    {
      key: 'kind',
      header: 'Kind',
      hideOnMobile: true,
      cell: (u) => (
        <div className="flex flex-wrap gap-1">
          <Badge tone={u.verified ? 'green' : 'gray'}>{u.kind === 'account' ? 'Verified account' : 'Admin-made login'}</Badge>
          {u.staff && <Badge tone="indigo">Staff</Badge>}
        </div>
      ),
    },
  ];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <SearchField value={search} onChange={setSearch} label="Search users" placeholder="Name, email, mobile, username or company" className="w-full max-w-md" />
        <DownloadMenu className="ml-auto" filename={fileSlug('console-users', q, todayStamp())} target={consoleExports.users(q)} empty={data?.total === 0} loading={!data} />
      </div>
      <p className="text-sm text-muted-foreground" aria-live="polite">
        {data ? `${data.total} users` : ' '}
      </p>
      <DataTable
        columns={columns}
        rows={data?.rows}
        rowKey={(u) => `${u.kind}:${u.id}`}
        loading={users.isLoading}
        fetching={users.isFetching}
        error={users.error}
        onRetry={() => void users.refetch()}
        onRowClick={(u) => navigate(`/console/users/${u.kind}/${u.id}`)}
        empty="No users match."
      />
      {data && data.total > data.pageSize && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <span className="text-muted-foreground">
            Page {page} of {pages}
          </span>
          <Button variant="outline" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            <ChevronLeft />
          </Button>
          <Button variant="outline" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => setPage((p) => Math.min(pages, p + 1))}>
            <ChevronRight />
          </Button>
        </div>
      )}
    </div>
  );
}

/** /console/users/:kind/:id: one account or admin-made login. */
export function ConsoleUserPage() {
  const { ready, staff } = useStaff();
  const { kind, id } = useParams();
  const k = kind === 'account' || kind === 'login' ? kind : undefined;
  const detail = useConsoleUser(k, id, staff);
  if (ready && !staff) return <Navigate to="/" replace />;
  if (!k) return <Navigate to="/console/users" replace />;
  if (detail.isLoading || !ready) return <PageLoader />;
  if (detail.error || !detail.data) return <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />;
  const { user, memberships, sessions } = detail.data;
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <Link to="/console/users" className={BACK_LINK}>
        <ChevronLeft /> Users
      </Link>
      <div>
        <h1 className={DETAIL_TITLE}>{user.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{user.kind === 'account' ? 'Kaampilot account (signed up with a code)' : 'Login made by a company admin'}</p>
      </div>
      <div className="rounded-xl border bg-card p-5 shadow-card">
        <DetailList
          columns={3}
          items={[
            { label: 'Email', value: user.email },
            { label: 'Mobile', value: user.mobile },
            { label: 'Username', value: user.username },
            { label: 'Last sign-in', value: user.lastSignIn ? formatDateTime(user.lastSignIn) : null },
            { label: 'Created', value: formatDate(user.createdAt) },
            { label: 'Verified', value: user.verified ? 'Yes' : 'No' },
          ]}
        />
      </div>
      <Section id="user-companies" title="Companies">
        <DataTable
          columns={[
            {
              key: 'company',
              header: 'Company',
              cell: (m) => (
                <Link to={`/console/companies/${m.companyId}`} className="font-semibold text-primary hover:underline">
                  {m.companyName} <span className="font-mono text-xs text-muted-foreground">{m.companyCode}</span>
                </Link>
              ),
            },
            { key: 'role', header: 'Role', cell: (m) => <span className="capitalize">{m.role}</span> },
            { key: 'active', header: 'Active', cell: (m) => <Badge tone={m.active ? 'green' : 'gray'}>{m.active ? 'Active' : 'Switched off'}</Badge> },
            { key: 'apps', header: 'Apps', cell: (m) => m.apps.join(', ') || '—' },
            { key: 'last', header: 'Last session', cell: (m) => ago(m.lastSession) },
          ]}
          rows={memberships}
          rowKey={(m) => m.personId}
          empty="Not in any company."
        />
      </Section>
      <Section id="user-sessions" title="Recent sign-ins">
        <DataTable
          columns={[
            { key: 'at', header: 'When', cell: (s) => <span className="whitespace-nowrap">{formatDateTime(s.at)}</span> },
            { key: 'company', header: 'Company', cell: (s) => <span className="font-mono text-xs">{s.companyCode}</span> },
            { key: 'client', header: 'Client', cell: (s) => s.client },
            { key: 'ip', header: 'IP', hideOnMobile: true, cell: (s) => <span className="font-mono text-xs">{s.ip ?? '—'}</span> },
            { key: 'device', header: 'Device', hideOnMobile: true, cell: (s) => <span className="line-clamp-1 text-xs text-muted-foreground">{s.device || '—'}</span> },
            { key: 'state', header: 'State', cell: (s) => (s.revoked ? <Badge tone="gray">Signed out</Badge> : <Badge tone="green">Open</Badge>) },
          ]}
          rows={sessions}
          rowKey={(s) => `${s.at}-${s.companyCode}`}
          empty="No sign-ins yet."
        />
      </Section>
    </div>
  );
}
