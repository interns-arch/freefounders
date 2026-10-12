/** More: who I am, my company, change password (on the web for now), the server address, sign out. */
import { useClaims, usePlatformMe, useSignOut } from '@freefounders/core';
import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import { Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Button, Card, type IconName, SectionTitle, Screen, Skeleton, T } from '@/components/ui';
import { API_URL } from '@/lib/api-url';
import { withAlpha } from '@/lib/colour';
import { useTheme } from '@/lib/theme';

const ROLE: Record<string, string> = { owner: 'Owner', admin: 'Admin', member: 'Member' };

export default function MoreScreen() {
  const { colors } = useTheme();
  const claims = useClaims();
  const me = usePlatformMe();
  const signOut = useSignOut();
  const p = me.data?.person;
  const name = p?.fullName ?? claims?.name ?? '';
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('');

  const askSignOut = () =>
    Alert.alert('Sign out?', 'You will need your password to sign in again on this phone.', [
      { text: 'Stay signed in', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut.mutate() },
    ]);

  return (
    <Screen>
      <T variant="title" accessibilityRole="header">
        More
      </T>
      <Card style={styles.profile}>
        <View style={[styles.avatar, { backgroundColor: withAlpha(colors.primary, 0.15) }]}>
          <T variant="heading" color={colors.primary}>
            {initials || '?'}
          </T>
        </View>
        {me.data ? (
          <View style={{ flex: 1, gap: 2 }}>
            <T variant="heading">{name}</T>
            {p?.email ? (
              <T variant="small" muted>
                {p.email}
              </T>
            ) : null}
            <T variant="small" muted>
              {[ROLE[p?.role ?? ''] ?? p?.role, p?.employeeCode ? `ID ${p.employeeCode}` : null, me.data.company.name].filter(Boolean).join(' · ')}
            </T>
          </View>
        ) : (
          <View style={{ flex: 1, gap: 8 }}>
            <Skeleton height={18} width="60%" />
            <Skeleton height={14} width="80%" />
          </View>
        )}
      </Card>

      <SectionTitle>Account</SectionTitle>
      <Card style={{ padding: 0 }}>
        <Row icon="key-outline" label="Change password" hint="Opens FreeFounders on the web" onPress={() => void Linking.openURL(`${API_URL}/account`)} />
        <Row icon="globe-outline" label="Open FreeFounders on the web" hint="Tasks, Assets and everything else" onPress={() => void Linking.openURL(API_URL)} last />
      </Card>
      <T variant="small" muted>
        Tasks and Assets come to the app next. Until then, open them on the web.
      </T>

      <SectionTitle>About</SectionTitle>
      <Card style={{ gap: 4 }}>
        <T variant="small" muted>{`Server: ${API_URL}`}</T>
        <T variant="small" muted>{`App version ${Constants.expoConfig?.version ?? '—'} · Light or dark follows your phone`}</T>
      </Card>

      <Button label="Sign out" icon="log-out-outline" variant="outline" onPress={askSignOut} loading={signOut.isPending} big />
    </Screen>
  );
}

function Row({ icon, label, hint, onPress, last }: { icon: IconName; label: string; hint?: string; onPress: () => void; last?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="link"
      accessibilityLabel={label}
      accessibilityHint={hint}
      android_ripple={{ color: withAlpha(colors.primary, 0.12) }}
      style={[styles.row, !last && { borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border }]}
    >
      <Ionicons name={icon} size={22} color={colors.primary} />
      <View style={{ flex: 1 }}>
        <T variant="label">{label}</T>
        {hint ? (
          <T variant="small" muted>
            {hint}
          </T>
        ) : null}
      </View>
      <Ionicons name="open-outline" size={18} color={colors.mutedForeground} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  profile: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  avatar: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, minHeight: 64 },
});
