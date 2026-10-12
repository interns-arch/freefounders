/** The few native controls the shell draws itself (offline screen, selfie camera). Everything else is the web app. */
import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps, ReactNode } from 'react';
import { ActivityIndicator, Pressable, type StyleProp, Text, type TextProps, type ViewStyle } from 'react-native';
import { usePalette } from '@/lib/palette';

export function T({ muted, size = 16, weight = '400', style, ...rest }: TextProps & { muted?: boolean; size?: number; weight?: '400' | '600' | '700' | '800' }) {
  const p = usePalette();
  return <Text {...rest} style={[{ color: muted ? p.mutedForeground : p.foreground, fontSize: size, lineHeight: Math.round(size * 1.4), fontWeight: weight }, style]} />;
}

export function Button({
  label,
  icon,
  onPress,
  variant = 'primary',
  loading,
  disabled,
  style,
}: {
  label: string;
  icon?: ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  variant?: 'primary' | 'outline' | 'ghost';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const p = usePalette();
  const fg = variant === 'primary' ? p.primaryForeground : variant === 'outline' ? p.foreground : p.primary;
  const off = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      onPress={onPress}
      disabled={off}
      style={({ pressed }) => [
        {
          minHeight: 52,
          borderRadius: p.radius,
          paddingHorizontal: 18,
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          backgroundColor: variant === 'primary' ? p.primary : 'transparent',
          borderWidth: variant === 'outline' ? 1 : 0,
          borderColor: p.border,
          opacity: off ? 0.55 : pressed ? 0.8 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={20} color={fg} /> : null}
      <Text style={{ color: fg, fontSize: 16, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}

export function Note({ tone = 'warning', children }: { tone?: 'warning' | 'danger'; children: ReactNode }) {
  const p = usePalette();
  const c = tone === 'danger' ? p.destructive : p.warning;
  return (
    <Text accessibilityRole="alert" style={{ color: c, borderColor: c, borderWidth: 1, borderRadius: p.radius, padding: 12, fontSize: 15, lineHeight: 21 }}>
      {children}
    </Text>
  );
}
