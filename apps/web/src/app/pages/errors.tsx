import { Link, isRouteErrorResponse, useRouteError } from 'react-router';
import { EmptyState } from '@/components/common/page';
import { Button } from '@/components/ui/button';

export function NotFound() {
  return (
    <EmptyState
      title="Page not found"
      description="This page does not exist or was moved."
      action={
        <Button asChild>
          <Link to="/">Go to the start</Link>
        </Button>
      }
    />
  );
}

/** Shown instead of a blank screen when a page crashes or a lazy page fails to load (e.g. after a new deploy). */
export function RouteError() {
  const err = useRouteError();
  const message = isRouteErrorResponse(err) ? `${err.status} ${err.statusText}` : err instanceof Error ? err.message : 'Something went wrong';
  const stale = /dynamically imported module|Failed to fetch|Loading chunk/i.test(message);
  return (
    <div className="flex min-h-dvh items-center justify-center bg-background p-6">
      <div className="max-w-md space-y-3 rounded-xl border bg-card p-8 text-center shadow-card-lg">
        <h1 className="text-xl font-bold tracking-tight">{stale ? 'A new version is available' : 'Something went wrong'}</h1>
        <p className="text-sm text-muted-foreground">{stale ? 'Reload to get the latest Kaampilot.' : message}</p>
        <Button onClick={() => window.location.reload()}>Reload</Button>
      </div>
    </div>
  );
}
