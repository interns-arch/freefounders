/** Sign in with email, username or employee ID (the Platform; `client: 'mobile'` keeps the refresh token on the phone). */
import { errorMessage, useSignIn } from '@freefounders/core';
import { Ionicons } from '@expo/vector-icons';
import { useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, type TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, Field, Notice, T } from '@/components/ui';
import { API_URL } from '@/lib/api-url';
import { withAlpha } from '@/lib/colour';
import { useTheme } from '@/lib/theme';

export default function SignIn() {
  const { colors, radius } = useTheme();
  const signIn = useSignIn();
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [touched, setTouched] = useState(false);
  const passwordRef = useRef<TextInput>(null);

  const submit = () => {
    setTouched(true);
    if (!login.trim() || !password) return;
    signIn.mutate({ login: login.trim(), password });
  };

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.page} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}>
            <View style={[styles.logo, { backgroundColor: colors.primary, borderRadius: radius }]}>
              <Ionicons name="leaf" size={28} color={colors.primaryForeground} />
            </View>
            <T variant="title" accessibilityRole="header">
              Sign in to FreeFounders
            </T>
            <T muted>Attendance, leave and more, on your phone.</T>
          </View>

          <View style={[styles.card, { backgroundColor: colors.card, borderColor: colors.border, borderRadius: radius + 4 }]}>
            <Field
              label="Email, username or employee ID"
              value={login}
              onChangeText={setLogin}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="username"
              textContentType="username"
              returnKeyType="next"
              onSubmitEditing={() => passwordRef.current?.focus()}
              error={touched && !login.trim() ? 'Enter your email, username or employee ID' : undefined}
            />
            <Field
              ref={passwordRef}
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry={!show}
              autoCapitalize="none"
              autoCorrect={false}
              autoComplete="current-password"
              textContentType="password"
              returnKeyType="go"
              onSubmitEditing={submit}
              error={touched && !password ? 'Enter your password' : undefined}
              right={
                <Pressable
                  onPress={() => setShow((s) => !s)}
                  accessibilityRole="button"
                  accessibilityLabel={show ? 'Hide password' : 'Show password'}
                  style={{ minWidth: 64, minHeight: 48, alignItems: 'center', justifyContent: 'center' }}
                >
                  <T variant="label" color={colors.primary}>
                    {show ? 'Hide' : 'Show'}
                  </T>
                </Pressable>
              }
            />
            {signIn.error ? <Notice tone="danger">{errorMessage(signIn.error)}</Notice> : null}
            <Button label="Sign in" onPress={submit} loading={signIn.isPending} big />
          </View>

          <View style={[styles.server, { backgroundColor: withAlpha(colors.mutedForeground, 0.08), borderRadius: radius }]}>
            <Ionicons name="server-outline" size={16} color={colors.mutedForeground} />
            <T variant="small" muted style={{ flex: 1 }}>
              {`Server: ${API_URL}`}
            </T>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { flexGrow: 1, justifyContent: 'center', padding: 20, gap: 20 },
  brand: { gap: 8 },
  logo: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  card: { padding: 18, gap: 16, borderWidth: StyleSheet.hairlineWidth * 2 },
  server: { flexDirection: 'row', alignItems: 'center', gap: 8, padding: 10 },
});
