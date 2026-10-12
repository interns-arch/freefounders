/**
 * "Can't reach FreeFounders": shown when the first page of the server does not load (no Wi-Fi, PC asleep, wrong
 * address). Try again, or change the server address (kept on this phone) — handy when testing on another network.
 */
import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, TextInput, View } from 'react-native';
import { usePalette } from '@/lib/palette';
import { normalizeServerUrl } from '@/lib/protocol';
import { DEFAULT_SERVER_URL } from '@/lib/server-url';
import { Button, Note, T } from './ui';

export function OfflineScreen({
  server,
  detail,
  onRetry,
  onChangeServer,
}: {
  server: string;
  detail?: string;
  onRetry: () => void;
  /** null = back to the default address. */
  onChangeServer: (input: string | null) => Promise<void>;
}) {
  const p = usePalette();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(server);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const save = async (input: string | null) => {
    setError('');
    if (input !== null && !normalizeServerUrl(input)) return setError('That is not a server address. Example: http://192.168.137.1:8080');
    setSaving(true);
    try {
      await onChangeServer(input);
      setEditing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The address could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: p.background }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 24, gap: 16 }} keyboardShouldPersistTaps="handled">
        <View style={{ alignItems: 'center', gap: 12 }}>
          <Ionicons name="cloud-offline-outline" size={56} color={p.mutedForeground} />
          <T size={24} weight="800" accessibilityRole="header" style={{ textAlign: 'center' }}>
            Can’t reach FreeFounders
          </T>
          <T muted style={{ textAlign: 'center' }}>
            The phone could not open
          </T>
          <T weight="700" selectable style={{ textAlign: 'center' }}>
            {server}
          </T>
          <T muted size={14} style={{ textAlign: 'center' }}>
            Check that the phone is on the same Wi-Fi or hotspot as the FreeFounders computer and that FreeFounders is running there, then try again.
          </T>
          {detail ? (
            <T muted size={12} style={{ textAlign: 'center' }}>
              {detail}
            </T>
          ) : null}
        </View>
        <Button label="Try again" icon="refresh" onPress={onRetry} />
        {editing ? (
          <View style={{ gap: 10 }}>
            <T weight="600" nativeID="server-label">
              Server address
            </T>
            <TextInput
              accessibilityLabel="Server address"
              accessibilityLabelledBy="server-label"
              value={value}
              onChangeText={setValue}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              inputMode="url"
              placeholder="http://192.168.137.1:8080"
              placeholderTextColor={p.mutedForeground}
              returnKeyType="go"
              onSubmitEditing={() => void save(value)}
              style={{ minHeight: 52, borderWidth: 1, borderColor: p.input, borderRadius: p.radius, paddingHorizontal: 14, fontSize: 16, color: p.foreground, backgroundColor: p.card }}
            />
            {error ? <Note tone="danger">{error}</Note> : null}
            <Button label="Save and open" icon="checkmark" onPress={() => void save(value)} loading={saving} />
            {server !== DEFAULT_SERVER_URL ? <Button label={`Use the default (${DEFAULT_SERVER_URL})`} variant="ghost" onPress={() => void save(null)} /> : null}
          </View>
        ) : (
          <Button label="Change server address" icon="create-outline" variant="outline" onPress={() => setEditing(true)} />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
