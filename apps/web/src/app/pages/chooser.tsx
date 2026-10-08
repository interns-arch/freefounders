import { type AppKey, useAccess, useSignOut } from '@freefounders/core';
import { ArrowRight, CheckSquare, Package, Settings2, ShieldCheck, Users } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router';
import { PageLoader } from '@/components/common/page';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/primitives';
import { cn } from '@/lib/utils';
import { Logo } from '../shell-parts';
import { safeNext } from '../session-guard';

const REMEMBER = 'ff-workspace';
const APPS: Record<AppKey, { name: string; blurb: string; to: string; icon: typeof CheckSquare; tone: string }> = {
  tasks: { name: 'Tasks', blurb: 'Tasks, checklists, attendance and leave', to: '/tasks', icon: CheckSquare, tone: 'bg-app-tasks' },
  assets: { name: 'Assets', blurb: 'Assets, joiners, exits, requests and tickets', to: '/assets', icon: Package, tone: 'bg-app-assets' },
};
const ADMIN = [
  { name: 'People & access', blurb: 'Add people, give them roles, reset passwords', to: '/people', icon: Users },
  { name: 'Roles', blurb: 'What each role can do, and its duties', to: '/roles', icon: ShieldCheck },
  { name: 'Settings', blurb: 'Company, modules and departments', to: '/settings', icon: Settings2 },
];

function remembered(): AppKey | null {
  try {
    const v = localStorage.getItem(REMEMBER);
    return v === 'tasks' || v === 'assets' ? v : null;
  } catch {
    return null;
  }
}

/** "Choose your workspace" (founder, PLAN.md §3): shown after sign-in when the person has more than one place to go. */
export function ChooserPage() {
  const access = useAccess();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const signOut = useSignOut();
  const [keep, setKeep] = useState(() => !!remembered());
  const next = safeNext(params.get('next'));
  const choosing = params.has('choose');

  useEffect(() => {
    if (access.platform && next) navigate(next, { replace: true });
  }, [access.platform, next, navigate]);

  if (!access.platform) return <PageLoader />;
  const apps = access.apps;
  if (!choosing && !next) {
    const saved = remembered();
    if (saved && apps.includes(saved)) return <Navigate to={APPS[saved].to} replace />;
    if (apps.length === 1 && !access.isAdmin) return <Navigate to={APPS[apps[0]].to} replace />;
  }

  const open = (app: AppKey) => {
    try {
      if (keep) localStorage.setItem(REMEMBER, app);
      else localStorage.removeItem(REMEMBER);
    } catch {
      /* private mode: fine */
    }
    navigate(APPS[app].to);
  };
  const first = access.platform.person.fullName.split(' ')[0];

  return (
    <div className="min-h-dvh bg-background">
      <header className="flex items-center justify-between border-b px-6 py-3">
        <Logo company={access.brand} />
        <div className="flex items-center gap-2 text-sm">
          <span className="hidden text-muted-foreground sm:inline">{access.platform.person.fullName}</span>
          <Button variant="ghost" size="sm" onClick={() => navigate('/account')}>
            Change password
          </Button>
          <Button variant="ghost" size="sm" onClick={() => signOut.mutate(undefined, { onSuccess: () => navigate('/login') })}>
            Sign out
          </Button>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-6 py-12">
        <h1 className="text-3xl font-semibold tracking-tight">Choose your workspace</h1>
        <p className="mt-1 text-muted-foreground">Hi {first}. Where would you like to go?</p>
        {apps.length === 0 && (
          <p className="mt-6 rounded-lg border bg-card p-4 text-sm">
            You don’t have access to any app yet. {access.isAdmin ? 'Give yourself a role under People & access.' : 'Ask your company admin for access.'}
          </p>
        )}
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {apps.map((app) => {
            const a = APPS[app];
            return (
              <button
                key={app}
                type="button"
                onClick={() => open(app)}
                className="group flex items-start gap-4 rounded-xl border bg-card p-5 text-left shadow-xs transition hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
              >
                <span className={cn('grid size-11 shrink-0 place-items-center rounded-lg text-white', a.tone)} aria-hidden>
                  <a.icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1 text-lg font-semibold">
                    {a.name}
                    <ArrowRight className="size-4 opacity-0 transition group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden />
                  </span>
                  <span className="block text-sm text-muted-foreground">{a.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
        {apps.length > 1 && (
          <label className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
            <Checkbox checked={keep} onCheckedChange={(v) => setKeep(v === true)} aria-label="Remember my choice on this device" />
            Remember my choice on this device
          </label>
        )}
        {access.isAdmin && (
          <section className="mt-10" aria-labelledby="admin-title">
            <h2 id="admin-title" className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">
              Admin
            </h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              {ADMIN.map((x) => (
                <button
                  key={x.to}
                  type="button"
                  onClick={() => navigate(x.to)}
                  className="rounded-xl border bg-card p-4 text-left transition hover:border-app-admin/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <x.icon className="size-5 text-app-admin" aria-hidden />
                  <span className="mt-2 block font-medium">{x.name}</span>
                  <span className="block text-xs text-muted-foreground">{x.blurb}</span>
                </button>
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
