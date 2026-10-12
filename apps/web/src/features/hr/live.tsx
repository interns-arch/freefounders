/** /attendance/team, "Live team" (PLAN.md §19.15): today for everyone I manage, refreshed every minute. */
import { TeamDayView } from './daily';

export function LiveTab() {
  return <TeamDayView live />;
}
