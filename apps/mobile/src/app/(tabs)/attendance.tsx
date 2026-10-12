/** Attendance (the first screen, PLAN.md §19.14/§19.16): greeting, punch card, my month calendar. Pull to refresh. */
import { errorMessage, useClaims, usePlatformMe } from '@freefounders/core';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Linking, View } from 'react-native';
import { ErrorState, Notice, Screen, T } from '@/components/ui';
import { MonthCalendar } from '@/features/attendance/month-calendar';
import { NoAttendance, PunchCard } from '@/features/attendance/punch-card';
import { usePunch } from '@/features/attendance/use-punch';
import { API_URL } from '@/lib/api-url';
import { greeting, monthName, weekdayName } from '@/lib/format';

export default function AttendanceScreen() {
  const claims = useClaims();
  const me = usePlatformMe();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const hasHr = !!claims?.apps?.tasks;
  const first = (me.data?.person.fullName ?? claims?.name ?? '').split(' ')[0];
  const now = new Date();

  const refresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ['hr'] }).catch(() => null);
    await qc.invalidateQueries({ queryKey: ['platform'] }).catch(() => null);
    setRefreshing(false);
  };

  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
      <View style={{ gap: 2 }}>
        <T variant="small" muted>
          {`${weekdayName(now)}, ${now.getDate()} ${monthName(now.getMonth() + 1).slice(0, 3)} · ${me.data?.company.shortName || me.data?.company.name || ''}`}
        </T>
        <T variant="title" accessibilityRole="header">
          {first ? `${greeting(now)}, ${first}` : greeting(now)}
        </T>
      </View>

      {me.data?.mustChangePassword ? (
        <Notice tone="warning" title="Set a new password" action={{ label: 'Change password on the web', onPress: () => void Linking.openURL(`${API_URL}/account`) }}>
          Your admin gave you a temporary password. Please choose your own.
        </Notice>
      ) : null}

      {!hasHr ? (
        <NoAttendance />
      ) : (
        <MyAttendance />
      )}
    </Screen>
  );
}

/** Only for people with Tasks (attendance lives there): without it the Tasks API would refuse and sign them out. */
function MyAttendance() {
  const punch = usePunch();
  if (punch.today.error && !punch.today.data) return <ErrorState message={errorMessage(punch.today.error)} onRetry={() => void punch.today.refetch()} />;
  return (
    <>
      <PunchCard punch={punch} />
      <MonthCalendar />
    </>
  );
}
