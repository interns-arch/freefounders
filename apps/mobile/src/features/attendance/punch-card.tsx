/** The mark-attendance card: live clock, today's status, one big Punch in / Punch out button, in / out / worked. */
import { ATTENDANCE_STATUS_LABELS, type AttendanceToday } from '@freefounders/core/hr';
import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Linking, StyleSheet, View } from 'react-native';
import { Button, Card, Notice, Pill, Skeleton, T } from '@/components/ui';
import { clock, fmtMinutes, fmtTime, workedMinutes } from '@/lib/format';
import { ATTENDANCE_TONE } from '@/lib/status';
import { useTheme } from '@/lib/theme';
import { SelfieCamera } from './selfie-camera';
import { usePunch } from './use-punch';

function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

function stateOf(data: AttendanceToday) {
  const rec = data.attendance;
  if (rec?.check_in && rec.check_out) return 'done' as const;
  if (rec?.check_in) return 'in' as const;
  return 'out' as const;
}

export function PunchCard({ punch }: { punch: ReturnType<typeof usePunch> }) {
  const { colors } = useTheme();
  const now = useNow();
  const data = punch.today.data;

  if (!data) {
    return (
      <Card style={{ gap: 14 }}>
        <Skeleton height={18} width="40%" />
        <Skeleton height={40} width="60%" />
        <Skeleton height={60} />
      </Card>
    );
  }

  const rec = data.attendance;
  const state = stateOf(data);
  const status = rec?.status ?? 'not_checked_in';
  const which = state === 'in' ? 'check_out' : 'check_in';
  const canPunch = which === 'check_in' ? data.can_check_in : data.can_check_out;
  const label =
    punch.step === 'locating'
      ? 'Finding your location…'
      : punch.step === 'sending'
        ? 'Sending…'
        : state === 'done'
          ? 'Done for today'
          : which === 'check_in'
            ? 'Punch in'
            : 'Punch out';

  const checks = [
    data.geofence_enabled ? 'Location check' : null,
    data.photo === 'required' ? 'Selfie required' : data.photo === 'optional' ? 'Selfie (optional)' : null,
  ].filter(Boolean) as string[];

  return (
    <Card style={{ gap: 16 }} accessibilityLabel="Mark attendance">
      <View style={styles.top}>
        <View style={{ gap: 2 }}>
          <T variant="caps" muted>
            Today
          </T>
          <T variant="display" accessibilityLabel={`Time now ${clock(now)}`} style={{ fontVariant: ['tabular-nums'] }}>
            {clock(now)}
          </T>
        </View>
        <Pill label={ATTENDANCE_STATUS_LABELS[status] ?? status} tone={ATTENDANCE_TONE[status] ?? 'neutral'} />
      </View>

      <View style={[styles.stats, { borderColor: colors.border }]}>
        <Stat label="In" value={fmtTime(rec?.check_in)} />
        <Stat label="Out" value={fmtTime(rec?.check_out)} />
        <Stat label="Worked" value={rec?.check_in ? fmtMinutes(workedMinutes(rec, now)) : '—'} />
      </View>

      {rec?.is_late || rec?.is_early_checkout ? (
        <View style={styles.flags}>
          {rec.is_late ? <Pill label="Late" tone="warning" icon="time-outline" /> : null}
          {rec.is_early_checkout ? <Pill label="Left early" tone="warning" icon="exit-outline" /> : null}
        </View>
      ) : null}

      <Button
        big
        label={label}
        icon={state === 'done' ? 'checkmark-done' : which === 'check_in' ? 'log-in-outline' : 'log-out-outline'}
        variant={state === 'in' ? 'danger' : 'primary'}
        onPress={() => punch.start(which)}
        loading={punch.step === 'locating' || punch.step === 'sending'}
        disabled={state === 'done' || !canPunch || punch.busy || data.face_enabled}
        accessibilityHint={checks.length ? `Your company uses: ${checks.join(', ')}` : undefined}
      />

      <T variant="small" muted style={{ textAlign: 'center' }}>
        {`Work hours ${data.work_start} – ${data.work_end}`}
        {checks.length ? ` · ${checks.join(' · ')}` : ''}
      </T>

      {data.face_enabled ? (
        <Notice tone="warning" title="Face check is on">
          Face check is on for your company; the app punches with a selfie only — ask your admin to switch face check off in Attendance → HR settings.
        </Notice>
      ) : null}
      {punch.done ? <Notice tone="success">{punch.done}</Notice> : null}
      {punch.problem ? (
        <Notice tone="danger" title="Not marked" action={punch.problem.openSettings ? { label: 'Open settings', onPress: () => void Linking.openSettings() } : undefined}>
          {punch.problem.text}
        </Notice>
      ) : null}

      <SelfieCamera
        visible={punch.camera.visible}
        title={punch.camera.which === 'check_in' ? 'Punch-in selfie' : 'Punch-out selfie'}
        optional={punch.camera.optional}
        onCancel={punch.camera.cancel}
        onDone={punch.camera.done}
      />
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <View style={{ flex: 1, gap: 2 }} accessible accessibilityLabel={`${label}: ${value}`}>
      <T variant="caps" muted>
        {label}
      </T>
      <T variant="heading" style={{ fontVariant: ['tabular-nums'] }}>
        {value}
      </T>
    </View>
  );
}

export function NoAttendance() {
  const { colors } = useTheme();
  return (
    <Card style={{ gap: 10, alignItems: 'flex-start' }}>
      <Ionicons name="finger-print-outline" size={28} color={colors.mutedForeground} />
      <T variant="heading">Attendance is not set up for you</T>
      <T muted>Ask your admin to give you access to Tasks (People & access). Attendance and leave live there.</T>
    </Card>
  );
}

const styles = StyleSheet.create({
  top: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 },
  stats: { flexDirection: 'row', gap: 12, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth, paddingVertical: 12 },
  flags: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
});
