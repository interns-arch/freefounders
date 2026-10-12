/**
 * Apply for leave: type, from, to, reason. The server has no half-day leave (LeaveRequest counts whole days), so
 * there is no half-day switch. Leave types that need a supporting document are applied for on the web for now.
 */
import { errorMessage } from '@freefounders/core';
import { useApplyLeave, useLeaveTypes } from '@freefounders/core/hr';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { router } from 'expo-router';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Button, ErrorState, Field, Notice, PressRow, Skeleton, T } from '@/components/ui';
import { API_URL } from '@/lib/api-url';
import { withAlpha } from '@/lib/colour';
import { fmtDay, isoDate, parseDay } from '@/lib/format';
import { useTheme } from '@/lib/theme';

type Which = 'start_date' | 'end_date';

export default function ApplyLeave() {
  const { colors, radius } = useTheme();
  const types = useLeaveTypes();
  const apply = useApplyLeave();
  const today = isoDate(new Date());
  const [f, setF] = useState({ leave_type: '', start_date: today, end_date: today, reason: '' });
  const [iosPicker, setIosPicker] = useState<Which | null>(null);
  const [touched, setTouched] = useState(false);

  const active = (types.data ?? []).filter((t) => t.active);
  const typeId = f.leave_type || String(active[0]?.id ?? '');
  const selected = active.find((t) => String(t.id) === typeId);

  const setDate = (which: Which, day: string) =>
    setF((cur) => {
      const next = { ...cur, [which]: day };
      if (which === 'start_date' && next.end_date < day) next.end_date = day;
      return next;
    });

  const pick = (which: Which) => {
    const value = parseDay(f[which]);
    const minimumDate = which === 'end_date' ? parseDay(f.start_date) : undefined;
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode: 'date',
        minimumDate,
        onChange: (e: DateTimePickerEvent, d?: Date) => {
          if (e.type === 'set' && d) setDate(which, isoDate(d));
        },
      });
    } else setIosPicker(which);
  };

  const days = Math.round((parseDay(f.end_date).getTime() - parseDay(f.start_date).getTime()) / 86_400_000) + 1;
  const reasonMissing = !f.reason.trim();

  const submit = () => {
    setTouched(true);
    if (!selected || reasonMissing || selected.requires_document) return;
    apply.mutate(
      { leave_type: selected.id, start_date: f.start_date, end_date: f.end_date, reason: f.reason.trim() },
      {
        onSuccess: () => {
          Alert.alert('Request sent', 'Your approver has been told. You will see the answer under My requests.');
          router.back();
        },
      },
    );
  };

  if (types.error && !types.data) return <ErrorState message={errorMessage(types.error)} onRetry={() => void types.refetch()} />;

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: colors.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
        <T variant="label" accessibilityRole="header">
          Leave type
        </T>
        {!types.data ? (
          <Skeleton height={110} />
        ) : active.length === 0 ? (
          <Notice tone="info">No leave types yet — an admin can add them in HR settings.</Notice>
        ) : (
          <View accessibilityRole="radiogroup" style={{ gap: 8 }}>
            {active.map((t) => {
              const on = String(t.id) === typeId;
              return (
                <Pressable
                  key={t.id}
                  onPress={() => setF({ ...f, leave_type: String(t.id) })}
                  accessibilityRole="radio"
                  accessibilityState={{ checked: on }}
                  accessibilityLabel={`${t.name}, ${t.annual_quota} days a year${t.paid ? '' : ', unpaid'}`}
                  style={[
                    styles.option,
                    { borderRadius: radius - 2, borderColor: on ? colors.primary : colors.input, backgroundColor: on ? withAlpha(colors.primary, 0.08) : colors.card },
                  ]}
                >
                  <Ionicons name={on ? 'radio-button-on' : 'radio-button-off'} size={22} color={on ? colors.primary : colors.mutedForeground} />
                  <View style={{ flex: 1 }}>
                    <T variant="label">{t.name}</T>
                    <T variant="small" muted>{`${t.annual_quota} days a year · ${t.paid ? 'paid' : 'unpaid'}${t.requires_document ? ' · needs a document' : ''}`}</T>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}

        <View style={styles.row}>
          <PressRow label="From" value={fmtDay(f.start_date)} icon="calendar-outline" onPress={() => pick('start_date')} hint="Opens a calendar" />
          <PressRow label="To" value={fmtDay(f.end_date)} icon="calendar-outline" onPress={() => pick('end_date')} hint="Opens a calendar" />
        </View>
        <T variant="small" muted>{`${days} calendar day${days === 1 ? '' : 's'} (holidays and week-offs are worked out by the server)`}</T>
        {iosPicker ? (
          <DateTimePicker
            value={parseDay(f[iosPicker])}
            mode="date"
            display="inline"
            minimumDate={iosPicker === 'end_date' ? parseDay(f.start_date) : undefined}
            onChange={(_e, d) => {
              if (d) setDate(iosPicker, isoDate(d));
              setIosPicker(null);
            }}
          />
        ) : null}

        <Field
          label="Reason"
          value={f.reason}
          onChangeText={(reason) => setF({ ...f, reason })}
          multiline
          numberOfLines={3}
          maxLength={1000}
          placeholder="e.g. Family function"
          textAlignVertical="top"
          style={{ minHeight: 96, paddingTop: 12 }}
          error={touched && reasonMissing ? 'Enter a reason' : undefined}
        />

        {selected?.requires_document ? (
          <Notice tone="warning" title="This leave type needs a document" action={{ label: 'Apply on the web', onPress: () => void Linking.openURL(`${API_URL}/attendance/leave`) }}>
            Uploading documents from the app comes later. Apply for this type on the web for now.
          </Notice>
        ) : null}
        {apply.error ? <Notice tone="danger">{errorMessage(apply.error)}</Notice> : null}

        <Button label="Send request" icon="send" onPress={submit} loading={apply.isPending} disabled={!selected || !!selected.requires_document} big />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, gap: 14, paddingBottom: 40 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, minHeight: 56, borderWidth: 1.5 },
  row: { flexDirection: 'row', gap: 12 },
});
