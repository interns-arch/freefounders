/** My month (read-only): coloured days, a legend, the month's totals; tap a day for its in / out / worked. */
import { ATTENDANCE_STATUS_LABELS, type AttendanceDay, useAttendanceMonth } from '@freefounders/core/hr';
import { errorMessage } from '@freefounders/core';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Card, ErrorState, IconButton, Skeleton, T, toneColour } from '@/components/ui';
import { withAlpha } from '@/lib/colour';
import { fmtDay, fmtMinutes, fmtTime, isoDate, monthCells, monthName } from '@/lib/format';
import { ATTENDANCE_TONE, LEGEND } from '@/lib/status';
import { useTheme } from '@/lib/theme';

const WEEK = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export function MonthCalendar() {
  const { colors, radius } = useTheme();
  const today = new Date();
  const [ym, setYm] = useState({ year: today.getFullYear(), month: today.getMonth() + 1 });
  const [picked, setPicked] = useState<string | null>(null);
  const q = useAttendanceMonth(ym.year, ym.month);
  const todayIso = isoDate(today);
  const isCurrent = ym.year === today.getFullYear() && ym.month === today.getMonth() + 1;

  const move = (delta: number) => {
    setPicked(null);
    setYm(({ year, month }) => {
      const m = month + delta;
      return m < 1 ? { year: year - 1, month: 12 } : m > 12 ? { year: year + 1, month: 1 } : { year, month: m };
    });
  };

  const byDate = new Map<string, AttendanceDay>((q.data?.days ?? []).map((d) => [d.date, d]));
  const colourOf = (d: AttendanceDay | undefined) => (d?.status ? toneColour(colors, ATTENDANCE_TONE[d.status]) : null);
  const selected = picked ? byDate.get(picked) : undefined;
  const t = q.data?.totals ?? {};

  return (
    <Card style={{ gap: 12 }}>
      <View style={styles.head}>
        <IconButton icon="chevron-back" label="Previous month" onPress={() => move(-1)} />
        <T variant="heading" accessibilityRole="header" accessibilityLiveRegion="polite" style={{ flex: 1, textAlign: 'center' }}>
          {`${monthName(ym.month)} ${ym.year}`}
        </T>
        <IconButton icon="chevron-forward" label="Next month" onPress={() => move(1)} disabled={isCurrent} />
      </View>

      {q.error && !q.data ? (
        <ErrorState message={errorMessage(q.error)} onRetry={() => void q.refetch()} />
      ) : !q.data ? (
        <Skeleton height={260} />
      ) : (
        <>
          <View style={styles.grid} accessibilityLabel={`Attendance calendar for ${monthName(ym.month)} ${ym.year}`}>
            {WEEK.map((w, i) => (
              <View key={`h${i}`} style={styles.cell}>
                <T variant="caps" muted importantForAccessibility="no">
                  {w}
                </T>
              </View>
            ))}
            {monthCells(ym.year, ym.month).map((day, i) => {
              if (!day) return <View key={`b${i}`} style={styles.cell} />;
              const d = byDate.get(day);
              const c = colourOf(d);
              const isToday = day === todayIso;
              const isPicked = day === picked;
              const label = `${fmtDay(day)}: ${d?.status ? ATTENDANCE_STATUS_LABELS[d.status] : 'no record'}${d?.holiday ? `, ${d.holiday}` : ''}`;
              return (
                <View key={day} style={styles.cell}>
                  <Pressable
                    onPress={() => setPicked(isPicked ? null : day)}
                    accessibilityRole="button"
                    accessibilityLabel={label}
                    accessibilityState={{ selected: isPicked }}
                    style={[
                      styles.day,
                      {
                        borderRadius: radius - 4,
                        backgroundColor: c ? withAlpha(c, d?.status === 'week_off' ? 0.12 : 0.18) : 'transparent',
                        borderColor: isPicked ? colors.foreground : isToday ? colors.primary : c ? withAlpha(c, 0.4) : colors.border,
                        borderWidth: isPicked || isToday ? 2 : 1,
                      },
                    ]}
                  >
                    <T variant="label" color={c ?? colors.mutedForeground} style={{ fontVariant: ['tabular-nums'] }}>
                      {Number(day.slice(8))}
                    </T>
                  </Pressable>
                </View>
              );
            })}
          </View>

          {selected ? (
            <View style={[styles.detail, { backgroundColor: colors.muted, borderRadius: radius - 2 }]} accessibilityLiveRegion="polite">
              <T variant="label">{`${fmtDay(selected.date)} · ${selected.status ? ATTENDANCE_STATUS_LABELS[selected.status] : 'No record'}`}</T>
              {selected.holiday ? <T variant="small" muted>{selected.holiday}</T> : null}
              {selected.check_in ? (
                <T variant="small" muted>
                  {`In ${fmtTime(selected.check_in)} · Out ${fmtTime(selected.check_out)} · ${fmtMinutes(selected.working_minutes)}`}
                  {selected.is_late ? ' · Late' : ''}
                  {selected.missing_checkout ? ' · No check-out' : ''}
                </T>
              ) : null}
            </View>
          ) : null}

          <View style={styles.legend}>
            {LEGEND.map((l) => (
              <View key={l.status} style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: toneColour(colors, ATTENDANCE_TONE[l.status]) }]} />
                <T variant="small" muted>
                  {`${l.label}${t[l.status] ? ` ${t[l.status]}` : ''}`}
                </T>
              </View>
            ))}
          </View>
          <T variant="small" muted>{`Hours this month: ${q.data.total_hours ?? 0}`}</T>
        </>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  head: { flexDirection: 'row', alignItems: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: { width: `${100 / 7}%`, padding: 2, alignItems: 'center', justifyContent: 'center', minHeight: 30 },
  day: { width: '100%', aspectRatio: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center' },
  detail: { padding: 12, gap: 4 },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
});
