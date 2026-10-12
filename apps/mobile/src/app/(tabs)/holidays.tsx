/** Holidays: upcoming first (with "in N days"), then the ones already past. Pull to refresh. */
import { errorMessage, useClaims } from '@freefounders/core';
import { type Holiday, useHolidays } from '@freefounders/core/hr';
import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { Card, EmptyState, ErrorState, SectionTitle, Screen, Skeleton, T } from '@/components/ui';
import { NoAttendance } from '@/features/attendance/punch-card';
import { withAlpha } from '@/lib/colour';
import { daysUntil, monthName, parseDay, weekdayName } from '@/lib/format';
import { useTheme } from '@/lib/theme';

export default function HolidaysScreen() {
  const claims = useClaims();
  const qc = useQueryClient();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = async () => {
    setRefreshing(true);
    await qc.invalidateQueries({ queryKey: ['hr', 'holidays'] }).catch(() => null);
    setRefreshing(false);
  };
  return (
    <Screen refreshing={refreshing} onRefresh={() => void refresh()}>
      <T variant="title" accessibilityRole="header">
        Holidays
      </T>
      {claims?.apps?.tasks ? <HolidayList /> : <NoAttendance />}
    </Screen>
  );
}

function HolidayList() {
  const q = useHolidays();
  if (q.error && !q.data) return <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />;
  if (!q.data)
    return (
      <View style={{ gap: 10 }}>
        <Skeleton height={72} />
        <Skeleton height={72} />
        <Skeleton height={72} />
      </View>
    );
  const sorted = [...q.data].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = sorted.filter((h) => daysUntil(h.date) >= 0);
  const past = sorted.filter((h) => daysUntil(h.date) < 0).reverse();
  if (!sorted.length)
    return (
      <Card>
        <EmptyState icon="sunny-outline" title="No holidays yet" text="Your company's holidays will show here." />
      </Card>
    );
  return (
    <>
      <SectionTitle>Upcoming</SectionTitle>
      {upcoming.length ? upcoming.map((h) => <HolidayRow key={h.id} h={h} />) : <T muted>No more holidays on the list.</T>}
      {past.length ? <SectionTitle>Past</SectionTitle> : null}
      {past.map((h) => (
        <HolidayRow key={h.id} h={h} past />
      ))}
    </>
  );
}

function HolidayRow({ h, past }: { h: Holiday; past?: boolean }) {
  const { colors, radius } = useTheme();
  const d = parseDay(h.date);
  const n = daysUntil(h.date);
  const when = n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n > 1 ? `In ${n} days` : '';
  return (
    <Card
      style={{ ...styles.row, opacity: past ? 0.7 : 1 }}
      accessibilityLabel={`${h.name}, ${weekdayName(d)} ${d.getDate()} ${monthName(d.getMonth() + 1)} ${d.getFullYear()}${when ? `, ${when}` : ''}`}
    >
      <View style={[styles.badge, { backgroundColor: withAlpha(colors.primary, 0.12), borderRadius: radius - 2 }]}>
        <T variant="caps" color={colors.primary}>
          {monthName(d.getMonth() + 1).slice(0, 3)}
        </T>
        <T variant="title" color={colors.primary}>
          {String(d.getDate())}
        </T>
      </View>
      <View style={{ flex: 1, gap: 2 }}>
        <T variant="label">{h.name}</T>
        <T variant="small" muted>{`${weekdayName(d)} · ${d.getFullYear()}${when ? ` · ${when}` : ''}`}</T>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 12 },
  badge: { width: 58, height: 62, alignItems: 'center', justifyContent: 'center' },
});
