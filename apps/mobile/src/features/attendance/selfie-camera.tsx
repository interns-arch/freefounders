/**
 * The punch selfie (PLAN.md §19.16): front camera, JPEG, longer side at most 720 px, quality 0.6, sent as a data URL
 * in the punch's `photo` field. Preview with Retake / Use photo. No face matching on the phone.
 */
import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useRef, useState } from 'react';
import { Image, Linking, Modal, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button, IconButton, Notice, T } from '@/components/ui';
import { fitWithin } from '@/lib/punch';
import { useTheme } from '@/lib/theme';

export interface Selfie {
  uri: string;
  base64: string;
}

/** Shrinks and re-encodes a camera photo: JPEG 0.6, longer side ≤ 720 px, as base64. */
async function shrink(uri: string, width: number, height: number): Promise<Selfie> {
  const size = fitWithin(width, height, 720);
  let ctx = ImageManipulator.manipulate(uri);
  if (size.width !== width || size.height !== height) ctx = ctx.resize({ width: size.width, height: size.height });
  const image = await ctx.renderAsync();
  const out = await image.saveAsync({ compress: 0.6, format: SaveFormat.JPEG, base64: true });
  if (!out.base64) throw new Error('The photo could not be read. Try again.');
  return { uri: out.uri, base64: out.base64 };
}

export function SelfieCamera({
  visible,
  title,
  optional,
  onCancel,
  onDone,
}: {
  visible: boolean;
  title: string;
  /** The company keeps a photo when there is one, but does not require it. */
  optional: boolean;
  onCancel: () => void;
  /** null = punch without a photo (only when optional). */
  onDone: (selfie: Selfie | null) => void;
}) {
  const { colors, radius } = useTheme();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<Selfie | null>(null);
  const [error, setError] = useState('');

  const close = () => {
    setShot(null);
    setError('');
    setReady(false);
    onCancel();
  };

  const take = async () => {
    if (!camera.current || busy) return;
    setBusy(true);
    setError('');
    try {
      const pic = await camera.current.takePictureAsync({ quality: 0.6, skipProcessing: false, shutterSound: false });
      setShot(await shrink(pic.uri, pic.width, pic.height));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The photo could not be taken. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const use = () => {
    const s = shot;
    setShot(null);
    setReady(false);
    onDone(s);
  };

  let body;
  if (!permission) {
    body = <View style={{ flex: 1 }} />;
  } else if (!permission.granted) {
    body = (
      <View style={styles.center}>
        <Ionicons name="camera-outline" size={48} color={colors.mutedForeground} />
        <T variant="heading" style={{ textAlign: 'center' }}>
          Allow the camera for your punch selfie
        </T>
        <T muted style={{ textAlign: 'center' }}>
          Your company keeps a photo of every punch. The photo is sent only with your punch.
        </T>
        {permission.canAskAgain ? (
          <Button label="Allow camera" icon="camera" onPress={() => void requestPermission()} big style={{ alignSelf: 'stretch' }} />
        ) : (
          <>
            <Notice tone="warning">Camera access is blocked for this app. Open Settings → Permissions → Camera → Allow, then come back.</Notice>
            <Button label="Open settings" icon="settings-outline" onPress={() => void Linking.openSettings()} big style={{ alignSelf: 'stretch' }} />
          </>
        )}
        {optional ? <Button label="Punch without a photo" variant="ghost" onPress={() => onDone(null)} /> : null}
      </View>
    );
  } else if (shot) {
    body = (
      <View style={{ flex: 1, gap: 16, padding: 16 }}>
        <Image source={{ uri: shot.uri }} style={[styles.preview, { borderRadius: radius + 4 }]} resizeMode="cover" accessibilityLabel="Your selfie" />
        <View style={styles.row}>
          <Button label="Retake" icon="refresh" variant="outline" onPress={() => setShot(null)} style={{ flex: 1 }} />
          <Button label="Use photo" icon="checkmark" onPress={use} style={{ flex: 1 }} big />
        </View>
      </View>
    );
  } else {
    body = (
      <View style={{ flex: 1, gap: 16, padding: 16 }}>
        <View style={[styles.preview, { borderRadius: radius + 4, overflow: 'hidden', backgroundColor: colors.sidebar }]}>
          <CameraView
            ref={camera}
            style={StyleSheet.absoluteFill}
            facing="front"
            animateShutter={false}
            onCameraReady={() => setReady(true)}
            onMountError={(e) => setError(e.message || 'The camera could not start.')}
            accessibilityLabel="Front camera preview"
          />
        </View>
        {error ? <Notice tone="danger">{error}</Notice> : null}
        <T muted style={{ textAlign: 'center' }}>
          Hold the phone at eye level, in good light.
        </T>
        <Button label={busy ? 'Taking photo…' : 'Take photo'} icon="camera" onPress={() => void take()} loading={busy} disabled={!ready} big />
        {optional ? <Button label="Punch without a photo" variant="ghost" onPress={() => onDone(null)} /> : null}
      </View>
    );
  }

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={close} statusBarTranslucent>
      <SafeAreaView style={{ flex: 1, backgroundColor: colors.background }}>
        <View style={[styles.header, { borderBottomColor: colors.border }]}>
          <IconButton icon="close" label="Cancel" onPress={close} />
          <T variant="heading" accessibilityRole="header" style={{ flex: 1 }}>
            {title}
          </T>
        </View>
        {body}
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 4, paddingVertical: 4, borderBottomWidth: StyleSheet.hairlineWidth },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 14, padding: 24 },
  preview: { flex: 1, width: '100%', maxHeight: 520, alignSelf: 'center', aspectRatio: 3 / 4 },
  row: { flexDirection: 'row', gap: 12 },
});
