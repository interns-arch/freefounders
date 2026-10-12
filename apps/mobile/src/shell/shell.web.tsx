/**
 * Browser preview of the phone app (`expo start` → http://localhost:8081). The phone app is the FreeFounders web app in
 * a native WebView (PLAN.md §19.17), and a WebView only exists on phones, so in a browser we simply open the web app
 * itself. On this computer that is the dev gateway on localhost; elsewhere, the address the app is set to open.
 */
import { useEffect } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { DEFAULT_SERVER_URL } from '@/lib/server-url';

function webAppUrl(): string {
  if (typeof window === 'undefined') return DEFAULT_SERVER_URL;
  const local = /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
  return local ? 'http://localhost:8080' : DEFAULT_SERVER_URL;
}

export function Shell() {
  useEffect(() => {
    window.location.replace(webAppUrl());
  }, []);
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 }}>
      <ActivityIndicator />
      <Text>Opening FreeFounders…</Text>
    </View>
  );
}
