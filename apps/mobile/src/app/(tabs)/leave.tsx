/** Leave: balances, apply, my requests + cancel. Pull to refresh. */
import { useClaims } from '@freefounders/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Screen, T } from '@/components/ui';
import { NoAttendance } from '@/features/attendance/punch-card';
import { LeaveList } from '@/features/leave/leave-list';

export default function LeaveScreen() {
  const claims = useClaims();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ['hr'] }).catch(() => null);
    setRefreshing(false);
  };
  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
      <T variant="title" accessibilityRole="header">
        Leave
      </T>
      {claims?.apps?.tasks ? <LeaveList /> : <NoAttendance />}
    </Screen>
  );
}
