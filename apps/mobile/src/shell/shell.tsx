/**
 * The FreeFounders phone app = the FreeFounders web app in a native shell (founder, 2026-10-12; PLAN.md §19.17).
 * The WebView shows the web app at the server address; the shell adds what a WebView cannot do on its own:
 *   - GPS and the front camera for the punch (bridge requests `location` / `photo`, see src/lib/protocol.ts),
 *   - saving files (`download` → share sheet) and printing (`print` → Android's print dialog),
 *   - Android back button, pull-to-refresh, links to other apps, splash + "Can't reach FreeFounders" screen.
 * Sign-in is the web's own: its refresh cookie is kept by the WebView's cookie store between launches.
 */
import Constants from 'expo-constants';
import { Camera } from 'expo-camera';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, BackHandler, KeyboardAvoidingView, Linking, Platform, RefreshControl, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';
import { type CameraState, injectedScript } from '@/lib/injected';
import { currentPosition } from '@/lib/location';
import { printHtml, saveAndShare } from '@/lib/native-actions';
import { usePalette } from '@/lib/palette';
import { type AppRequest, linkTarget, parseMessage, replyError, replyOk } from '@/lib/protocol';
import { loadServerUrl, saveServerUrl } from '@/lib/server-url';
import { OfflineScreen } from './offline-screen';
import { SelfieCamera } from './selfie-camera';
import { T } from './ui';

const VERSION = Constants.expoConfig?.version ?? '0.0.0';

const cameraState = (p: { granted: boolean; canAskAgain: boolean } | null): CameraState => (p?.granted ? 'granted' : p && !p.canAskAgain ? 'denied' : 'ask');

type PhotoRequest = Extract<AppRequest, { type: 'photo' }>;

export function Shell() {
  const p = usePalette();
  const insets = useSafeAreaInsets();
  const web = useRef<WebView>(null);
  const canGoBack = useRef(false);
  const [server, setServer] = useState<string | null>(null);
  const [script, setScript] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [atTop, setAtTop] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selfie, setSelfie] = useState<PhotoRequest | null>(null);

  // The address to open and the camera permission state (for file pickers), before the WebView is created.
  useEffect(() => {
    void (async () => {
      const [url, perm] = await Promise.all([loadServerUrl(), Camera.getCameraPermissionsAsync().catch(() => null)]);
      setScript(injectedScript({ platform: Platform.OS === 'ios' ? 'ios' : 'android', version: VERSION, camera: cameraState(perm) }));
      setServer(url);
    })();
  }, []);

  // The native splash stays until the first page is there (or cannot be), at most 10 s; then the shell's own spinner.
  useEffect(() => {
    if (loaded || failure) void SplashScreen.hideAsync();
  }, [loaded, failure]);
  useEffect(() => {
    const t = setTimeout(() => void SplashScreen.hideAsync(), 10_000);
    return () => clearTimeout(t);
  }, []);

  // Android back: back in the web app's history while there is one, else the usual (leave the app).
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (failure || !canGoBack.current) return false;
      web.current?.goBack();
      return true;
    });
    return () => sub.remove();
  }, [failure]);

  const send = useCallback((message: string) => web.current?.postMessage(message), []);

  const reload = useCallback(() => {
    setFailure(null);
    setLoaded(false);
    setRefreshing(false);
    setAttempt((a) => a + 1);
  }, []);

  const handle = useCallback(
    async (r: AppRequest) => {
      try {
        switch (r.type) {
          case 'location': {
            const pos = await currentPosition();
            send(
              pos.ok
                ? replyOk(r.id, { latitude: pos.latitude, longitude: pos.longitude, accuracy: pos.accuracy })
                : replyError(r.id, pos.message, pos.permission ? { code: 'permission', permission: 'location', settings: !!pos.openSettings } : undefined),
            );
            return;
          }
          case 'open-settings':
            await Linking.openSettings();
            send(replyOk(r.id));
            return;
          case 'photo':
            if (selfie) return send(replyError(r.id, 'The camera is already open.'));
            setSelfie(r);
            return;
          case 'download':
            send(replyOk(r.id, await saveAndShare(r.filename, r.mime, r.base64)));
            return;
          case 'print':
            send(replyOk(r.id, await printHtml(r.html)));
            return;
        }
      } catch (e) {
        const msg = e instanceof Error && e.message ? e.message : 'Something went wrong. Try again.';
        send(replyError(r.id, msg));
        if (r.type === 'download') Alert.alert('The file could not be saved', msg);
        if (r.type === 'print') Alert.alert('Could not print', msg);
      }
    },
    [selfie, send],
  );

  const onMessage = useCallback(
    (e: WebViewMessageEvent) => {
      const m = parseMessage(e.nativeEvent.data);
      if (m.kind === 'invalid') {
        if (m.id) send(replyError(m.id, m.error));
        return;
      }
      if (m.kind === 'event') {
        if (m.event.type === 'scroll') setAtTop(m.event.atTop);
        else if (m.event.type === 'camera-for-files') {
          void Camera.requestCameraPermissionsAsync()
            .catch(() => null)
            .then((perm) => web.current?.injectJavaScript(`window.__ffCameraDecided && window.__ffCameraDecided(${JSON.stringify(cameraState(perm))});true;`));
        }
        return;
      }
      void handle(m.request);
    },
    [handle, send],
  );

  const openOutside = (url: string) => {
    void Linking.openURL(url).catch(() => Alert.alert('Cannot open this link', url));
  };

  if (!server || !script) return <Splash />;

  return (
    <View style={{ flex: 1, backgroundColor: p.background, paddingTop: insets.top, paddingBottom: insets.bottom }}>
      <StatusBar style={p.isDark ? 'light' : 'dark'} />
      {failure ? (
        <OfflineScreen
          server={server}
          detail={failure}
          onRetry={reload}
          onChangeServer={async (input) => {
            setServer(await saveServerUrl(input));
            reload();
          }}
        />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior="padding">
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{ flex: 1 }}
            keyboardShouldPersistTaps="handled"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                enabled={loaded && atTop}
                onRefresh={() => {
                  setRefreshing(true);
                  web.current?.reload();
                }}
                colors={[p.primary]}
                progressBackgroundColor={p.card}
                tintColor={p.primary}
              />
            }
          >
            <WebView
              key={`${server}#${attempt}`}
              ref={web}
              source={{ uri: `${server}/` }}
              style={{ flex: 1, backgroundColor: p.background }}
              containerStyle={{ backgroundColor: p.background }}
              injectedJavaScriptBeforeContentLoaded={script}
              onMessage={onMessage}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              domStorageEnabled
              javaScriptEnabled
              cacheEnabled
              allowFileAccess={false}
              geolocationEnabled={false}
              setSupportMultipleWindows
              pullToRefreshEnabled
              allowsBackForwardNavigationGestures
              overScrollMode="never"
              applicationNameForUserAgent={`FreeFoundersApp/${VERSION}`}
              webviewDebuggingEnabled={__DEV__}
              onNavigationStateChange={(nav) => {
                canGoBack.current = nav.canGoBack;
              }}
              onShouldStartLoadWithRequest={(req) => {
                if (linkTarget(req.url, server) === 'inside' || req.isTopFrame === false) return true;
                openOutside(req.url);
                return false;
              }}
              onOpenWindow={(e) => openOutside(e.nativeEvent.targetUrl)}
              onLoad={() => {
                setLoaded(true);
                setRefreshing(false);
              }}
              onLoadEnd={() => setRefreshing(false)}
              onError={(e) => setFailure(e.nativeEvent.description || 'The page could not be loaded.')}
              onHttpError={(e) => {
                if (e.nativeEvent.statusCode >= 500 && !loaded) setFailure(`The server answered ${e.nativeEvent.statusCode}.`);
              }}
              onRenderProcessGone={() => reload()}
            />
          </ScrollView>
        </KeyboardAvoidingView>
      )}
      {!loaded && !failure ? <Splash overlay /> : null}
      <SelfieCamera
        visible={!!selfie}
        title={selfie?.title ?? 'Selfie'}
        optional={!!selfie?.optional}
        onCancel={() => {
          if (selfie) send(replyError(selfie.id, 'cancelled'));
          setSelfie(null);
        }}
        onDone={(photo) => {
          if (selfie) send(replyOk(selfie.id, photo));
          setSelfie(null);
        }}
      />
    </View>
  );
}

/** Logo-less loading screen in the theme colours, until the first page of the web app is there. */
function Splash({ overlay }: { overlay?: boolean }) {
  const p = usePalette();
  return (
    <View
      accessibilityLabel="Opening FreeFounders"
      style={[{ alignItems: 'center', justifyContent: 'center', gap: 14, backgroundColor: p.background }, overlay ? { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 } : { flex: 1 }]}
    >
      <ActivityIndicator size="large" color={p.primary} />
      <T muted>Opening FreeFounders…</T>
    </View>
  );
}
