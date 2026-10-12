/** Leave: balances, "Apply for leave", my requests with Cancel. */
import { errorMessage } from '@freefounders/core';
import { type LeaveRequest, useCancelLeave, useLeaveBalances, useMyLeaves } from '@freefounders/core/hr';
import { router } from 'expo-router';
import { Alert, StyleSheet, View } from 'react-native';
import { Button, Card, EmptyState, ErrorState, Notice, Pill, SectionTitle, Skeleton, T } from '@/components/ui';
import { withAlpha } from '@/lib/colour';
import { fmtDay } from '@/lib/format';
import { LEAVE_TONE } from '@/lib/status';
import { useTheme } from '@/lib/theme';

export function LeaveList() {
  const { colors, radius } = useTheme();
  const balances = useLeaveBalances();
  const leaves = useMyLeaves();
  const cancel = useCancelLeave();

  const askCancel = (l: LeaveRequest) =>
    Alert.alert('Cancel this leave?', `${l.leave_type_name}, ${fmtDay(l.start_date)} – ${fmtDay(l.end_date)}`, [
      { text: 'Keep it', style: 'cancel' },
      { text: 'Cancel leave', style: 'destructive', onPress: () => cancel.mutate(l.id) },
    ]);

  return (
    <>
      <Button label="Apply for leave" icon="add-circle-outline" onPress={() => router.push('/leave-apply')} big />

      <SectionTitle>Balances</SectionTitle>
      {balances.error && !balances.data ? (
        <ErrorState message={errorMessage(balances.error)} onRetry={() => void balances.refetch()} />
      ) : !balances.data ? (
        <View style={styles.grid}>
          <Skeleton height={92} style={styles.half} />
          <Skeleton height={92} style={styles.half} />
        </View>
      ) : balances.data.length === 0 ? (
        <Card>
          <T muted>No leave types yet — an admin can add them in HR settings.</T>
        </Card>
      ) : (
        <View style={styles.grid}>
          {balances.data.map((b) => {
            const pct = b.quota > 0 ? Math.max(0, Math.min(1, b.balance / b.quota)) : 0;
            const low = b.quota > 0 && pct <= 0.25;
            const bar = low ? colors.warning : colors.primary;
            return (
              <Card key={b.leave_type} style={{ ...styles.half, gap: 6 }} accessibilityLabel={`${b.name}: ${b.balance} of ${b.quota} left${b.pending ? `, ${b.pending} pending` : ''}`}>
                <T variant="caps" muted numberOfLines={1}>
                  {b.name}
                </T>
                <T variant="title" style={{ fontVariant: ['tabular-nums'] }}>
                  {b.balance}
                  <T variant="small" muted>{` / ${b.quota}`}</T>
                </T>
                <View style={{ height: 6, borderRadius: 3, backgroundColor: colors.muted, overflow: 'hidden' }}>
                  <View style={{ height: 6, width: `${pct * 100}%`, backgroundColor: bar, borderRadius: 3 }} />
                </View>
                <T variant="small" muted>
                  {`${b.paid ? 'Paid' : 'Unpaid'}${b.pending ? ` · ${b.pending} pending` : ''}`}
                </T>
              </Card>
            );
          })}
        </View>
      )}

      <SectionTitle>My requests</SectionTitle>
      {cancel.error ? <Notice tone="danger">{errorMessage(cancel.error)}</Notice> : null}
      {leaves.error && !leaves.data ? (
        <ErrorState message={errorMessage(leaves.error)} onRetry={() => void leaves.refetch()} />
      ) : !leaves.data ? (
        <Skeleton height={120} />
      ) : leaves.data.length === 0 ? (
        <Card>
          <EmptyState icon="calendar-outline" title="No leave requests yet" text="Tap Apply for leave; your requests show here." />
        </Card>
      ) : (
        leaves.data.map((l) => (
          <Card key={l.id} style={{ gap: 8 }}>
            <View style={styles.row}>
              <T variant="label" style={{ flex: 1 }}>
                {l.leave_type_name}
              </T>
              <Pill label={l.status_display} tone={LEAVE_TONE[l.status] ?? 'neutral'} />
            </View>
            <T>{`${fmtDay(l.start_date)} – ${fmtDay(l.end_date)} · ${l.days} day${l.days === 1 ? '' : 's'}`}</T>
            {l.reason ? (
              <T variant="small" muted>
                {l.reason}
              </T>
            ) : null}
            {l.remarks || l.reviewed_by_detail ? (
              <View style={{ padding: 10, borderRadius: radius - 4, backgroundColor: withAlpha(colors.mutedForeground, 0.08) }}>
                <T variant="small" muted>
                  {`${l.remarks || 'No remarks'}${l.reviewed_by_detail ? ` — ${l.reviewed_by_detail.name}` : ''}`}
                </T>
              </View>
            ) : null}
            {l.status === 'pending' || l.status === 'approved' ? (
              <Button
                label="Cancel"
                variant="outline"
                onPress={() => askCancel(l)}
                loading={cancel.isPending && cancel.variables === l.id}
                accessibilityLabel={`Cancel ${l.leave_type_name} from ${fmtDay(l.start_date)}`}
                style={{ alignSelf: 'flex-start' }}
              />
            ) : null}
          </Card>
        ))
      )}
    </>
  );
}

const styles = StyleSheet.create({
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  half: { flexBasis: '47%', flexGrow: 1 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
});
