/**
 * The phone app's building blocks, all coloured from the theme (lib/theme.tsx), never fixed colours. Touch targets
 * are at least 48 dp; every pressable has a role and a label for TalkBack.
 */
import { Ionicons } from '@expo/vector-icons';
import { type ComponentProps, type ReactNode, type Ref, useEffect, useRef } from 'react';
import {
  ActivityIndicator,
  Animated,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  type TextProps,
  TextInput,
  type TextInputProps,
  type TextStyle,
  View,
  type ViewStyle,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { readableOn, withAlpha } from '@/lib/colour';
import { type Colors, FONTS, useTheme } from '@/lib/theme';

export type IconName = ComponentProps<typeof Ionicons>['name'];
export type Tone = 'success' | 'warning' | 'danger' | 'info' | 'primary' | 'neutral';

export function toneColour(c: Colors, tone: Tone): string {
  switch (tone) {
    case 'success':
      return c.success;
    case 'warning':
      return c.warning;
    case 'danger':
      return c.destructive;
    case 'info':
      return c.info;
    case 'primary':
      return c.primary;
    default:
      return c.mutedForeground;
  }
}

// ─── text ────────────────────────────────────────────────────────────────

type Variant = 'display' | 'title' | 'heading' | 'body' | 'label' | 'small' | 'caps';
const VARIANTS: Record<Variant, TextStyle> = {
  display: { fontFamily: FONTS.extrabold, fontSize: 34, lineHeight: 40, letterSpacing: -0.5 },
  title: { fontFamily: FONTS.bold, fontSize: 24, lineHeight: 30, letterSpacing: -0.3 },
  heading: { fontFamily: FONTS.bold, fontSize: 18, lineHeight: 24 },
  body: { fontFamily: FONTS.regular, fontSize: 16, lineHeight: 23 },
  label: { fontFamily: FONTS.semibold, fontSize: 15, lineHeight: 20 },
  small: { fontFamily: FONTS.medium, fontSize: 13.5, lineHeight: 19 },
  caps: { fontFamily: FONTS.bold, fontSize: 12, lineHeight: 16, letterSpacing: 0.9, textTransform: 'uppercase' },
};

export function T({ variant = 'body', muted, color, style, ...rest }: TextProps & { variant?: Variant; muted?: boolean; color?: string }) {
  const { colors } = useTheme();
  return <Text {...rest} maxFontSizeMultiplier={1.6} style={[VARIANTS[variant], { color: color ?? (muted ? colors.mutedForeground : colors.foreground) }, style]} />;
}

// ─── layout ──────────────────────────────────────────────────────────────

/** A scrolling page with pull-to-refresh, inside the safe area (the tab bar handles the bottom). */
export function Screen({ children, refreshing, onRefresh, padded = true }: { children: ReactNode; refreshing?: boolean; onRefresh?: () => void; padded?: boolean }) {
  const { colors } = useTheme();
  return (
    <SafeAreaView edges={['top', 'left', 'right']} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={padded ? styles.page : undefined}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} colors={[colors.primary]} tintColor={colors.primary} progressBackgroundColor={colors.card} /> : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

export function Card({ children, style, accessibilityLabel }: { children: ReactNode; style?: ViewStyle; accessibilityLabel?: string }) {
  const { colors, radius } = useTheme();
  return (
    <View accessibilityLabel={accessibilityLabel} style={[{ backgroundColor: colors.card, borderColor: colors.border, borderWidth: StyleSheet.hairlineWidth * 2, borderRadius: radius + 4, padding: 16 }, style]}>
      {children}
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={styles.sectionTitle}>
      <T variant="caps" muted accessibilityRole="header">
        {children}
      </T>
      {right}
    </View>
  );
}

// ─── buttons ─────────────────────────────────────────────────────────────

type ButtonVariant = 'primary' | 'outline' | 'ghost' | 'danger';

export function Button({
  label,
  onPress,
  variant = 'primary',
  icon,
  loading,
  disabled,
  big,
  accessibilityLabel,
  accessibilityHint,
  style,
}: {
  label: string;
  onPress: () => void;
  variant?: ButtonVariant;
  icon?: IconName;
  loading?: boolean;
  disabled?: boolean;
  big?: boolean;
  accessibilityLabel?: string;
  accessibilityHint?: string;
  style?: ViewStyle;
}) {
  const { colors, radius } = useTheme();
  const off = disabled || loading;
  const bg = variant === 'primary' ? colors.primary : variant === 'danger' ? colors.destructive : 'transparent';
  const fg = variant === 'primary' ? colors.primaryForeground : variant === 'danger' ? readableOn(colors.destructive) : variant === 'outline' ? colors.foreground : colors.primary;
  return (
    <Pressable
      onPress={onPress}
      disabled={off}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: !!off, busy: !!loading }}
      android_ripple={{ color: withAlpha(variant === 'primary' || variant === 'danger' ? colors.primaryForeground : colors.primary, 0.18) }}
      style={({ pressed }) => [
        styles.button,
        {
          minHeight: big ? 60 : 50,
          borderRadius: radius,
          backgroundColor: bg,
          borderColor: variant === 'outline' ? colors.input : 'transparent',
          borderWidth: variant === 'outline' ? 1.5 : 0,
          opacity: off ? 0.55 : pressed ? 0.9 : 1,
        },
        style,
      ]}
    >
      {loading ? <ActivityIndicator color={fg} /> : icon ? <Ionicons name={icon} size={big ? 24 : 20} color={fg} /> : null}
      <Text maxFontSizeMultiplier={1.4} style={{ color: fg, fontFamily: FONTS.bold, fontSize: big ? 18 : 16 }}>
        {label}
      </Text>
    </Pressable>
  );
}

/** A round icon-only button (48 dp) — always give it a label for TalkBack. */
export function IconButton({ icon, label, onPress, disabled }: { icon: IconName; label: string; onPress: () => void; disabled?: boolean }) {
  const { colors } = useTheme();
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      hitSlop={4}
      android_ripple={{ color: withAlpha(colors.primary, 0.2), borderless: true, radius: 26 }}
      style={{ width: 48, height: 48, alignItems: 'center', justifyContent: 'center', opacity: disabled ? 0.4 : 1 }}
    >
      <Ionicons name={icon} size={24} color={colors.foreground} />
    </Pressable>
  );
}

// ─── status ──────────────────────────────────────────────────────────────

export function Pill({ label, tone = 'neutral', icon }: { label: string; tone?: Tone; icon?: IconName }) {
  const { colors } = useTheme();
  const c = toneColour(colors, tone);
  return (
    <View style={[styles.pill, { backgroundColor: withAlpha(c, 0.14), borderColor: withAlpha(c, 0.35) }]}>
      {icon ? <Ionicons name={icon} size={14} color={c} /> : <View style={[styles.dot, { backgroundColor: c }]} />}
      <Text maxFontSizeMultiplier={1.4} style={{ color: c, fontFamily: FONTS.bold, fontSize: 13 }}>
        {label}
      </Text>
    </View>
  );
}

/** A coloured message box (success / problem / hint), optionally with one action. */
export function Notice({ tone, title, children, action }: { tone: Tone; title?: string; children: ReactNode; action?: { label: string; onPress: () => void } }) {
  const { colors, radius } = useTheme();
  const c = toneColour(colors, tone);
  const icon: IconName = tone === 'success' ? 'checkmark-circle' : tone === 'danger' ? 'alert-circle' : tone === 'warning' ? 'warning' : 'information-circle';
  return (
    <View accessibilityRole={tone === 'danger' ? 'alert' : undefined} style={[styles.notice, { backgroundColor: withAlpha(c, 0.1), borderColor: withAlpha(c, 0.35), borderRadius: radius }]}>
      <Ionicons name={icon} size={22} color={c} style={{ marginTop: 1 }} />
      <View style={{ flex: 1, gap: 6 }}>
        {title ? <T variant="label">{title}</T> : null}
        {typeof children === 'string' ? <T variant="small">{children}</T> : children}
        {action ? (
          <Pressable onPress={action.onPress} accessibilityRole="button" style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
            <T variant="label" color={c} style={{ textDecorationLine: 'underline' }}>
              {action.label}
            </T>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

/** Loading placeholder that gently pulses. */
export function Skeleton({ height = 20, width = '100%', style }: { height?: number; width?: ViewStyle['width']; style?: ViewStyle }) {
  const { colors, radius } = useTheme();
  const pulse = useRef(new Animated.Value(0.5)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 700, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0.5, duration: 700, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return <Animated.View accessibilityLabel="Loading" style={[{ height, width, borderRadius: radius - 4, backgroundColor: colors.muted, opacity: pulse }, style]} />;
}

/** "Could not load" with the reason and a Retry button. */
export function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card style={{ gap: 12, alignItems: 'flex-start' }}>
      <Notice tone="danger" title="Could not load">
        {message}
      </Notice>
      <Button label="Retry" icon="refresh" variant="outline" onPress={onRetry} />
    </Card>
  );
}

export function EmptyState({ icon, title, text }: { icon: IconName; title: string; text?: string }) {
  const { colors } = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 28, gap: 8 }}>
      <Ionicons name={icon} size={36} color={colors.mutedForeground} />
      <T variant="label">{title}</T>
      {text ? (
        <T variant="small" muted style={{ textAlign: 'center' }}>
          {text}
        </T>
      ) : null}
    </View>
  );
}

// ─── forms ───────────────────────────────────────────────────────────────

export function Field({ label, error, right, ref, ...input }: TextInputProps & { label: string; error?: string; right?: ReactNode; ref?: Ref<TextInput> }) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <T variant="label">{label}</T>
      <View style={[styles.input, { borderColor: error ? colors.destructive : colors.input, backgroundColor: colors.card, borderRadius: radius - 2 }]}>
        <TextInput
          ref={ref}
          accessibilityLabel={label}
          placeholderTextColor={colors.mutedForeground}
          selectionColor={colors.primary}
          {...input}
          style={[{ flex: 1, minHeight: 50, color: colors.foreground, fontFamily: FONTS.regular, fontSize: 16, paddingHorizontal: 14 }, input.style]}
        />
        {right}
      </View>
      {error ? (
        <T variant="small" color={colors.destructive}>
          {error}
        </T>
      ) : null}
    </View>
  );
}

/** A row that looks like a field and opens something (a date picker, a link). */
export function PressRow({ label, value, icon, onPress, hint }: { label: string; value: string; icon?: IconName; onPress: () => void; hint?: string }) {
  const { colors, radius } = useTheme();
  return (
    <View style={{ gap: 6, flex: 1 }}>
      <T variant="label">{label}</T>
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        accessibilityLabel={`${label}: ${value}`}
        accessibilityHint={hint}
        style={[styles.input, { borderColor: colors.input, backgroundColor: colors.card, borderRadius: radius - 2, minHeight: 50, paddingHorizontal: 14, gap: 8 }]}
      >
        {icon ? <Ionicons name={icon} size={18} color={colors.mutedForeground} /> : null}
        <T style={{ flex: 1 }}>{value}</T>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { padding: 16, paddingBottom: 32, gap: 16 },
  sectionTitle: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 18 },
  pill: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, alignSelf: 'flex-start' },
  dot: { width: 7, height: 7, borderRadius: 4 },
  notice: { flexDirection: 'row', gap: 10, padding: 12, borderWidth: 1 },
  input: { flexDirection: 'row', alignItems: 'center', borderWidth: 1.5 },
});
