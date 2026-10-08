/**
 * Face recognition helper (old src/face.js). The library and its ~6.8 MB of model weights load lazily — only when
 * someone opens the camera with the face check on. What leaves this file is a 128-number descriptor, never an image.
 * The models are static files of this web app (public/models), loaded by the library itself.
 */
type FaceApi = typeof import('@vladmandic/face-api');

let faceapi: FaceApi | null = null;
let loading: Promise<FaceApi> | null = null;
const MODEL_URL = '/models';

export async function loadFace(onProgress?: (msg: string) => void): Promise<FaceApi> {
  if (faceapi) return faceapi;
  if (loading) return loading;
  loading = (async () => {
    onProgress?.('Loading face engine…');
    const api = await import('@vladmandic/face-api');
    onProgress?.('Loading face models…');
    await Promise.all([
      api.nets.tinyFaceDetector.loadFromUri(MODEL_URL),
      api.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      api.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    faceapi = api;
    return api;
  })();
  try {
    return await loading;
  } catch {
    loading = null;
    throw new Error('Face models could not be loaded. Check your connection and try again.');
  }
}

/**
 * A plain array of 128 numbers, or throws a message meant for the person. Three samples ~150 ms apart are averaged
 * (one frame is noisy); with more than one face in view, the largest one (the person at the camera) is used.
 */
export async function describeFace(video: HTMLVideoElement): Promise<number[]> {
  const api = await loadFace();
  const options = new api.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.5 });
  const samples: Float32Array[] = [];
  for (let attempt = 0; attempt < 3; attempt++) {
    const results = await api.detectAllFaces(video, options).withFaceLandmarks().withFaceDescriptors();
    if (results.length > 0) {
      const largest = results.reduce((a, b) => (a.detection.box.area > b.detection.box.area ? a : b));
      samples.push(largest.descriptor);
    }
    if (attempt < 2) await new Promise((r) => setTimeout(r, 150));
  }
  if (samples.length === 0) throw new Error('No face detected. Look straight at the camera in good light.');
  const avg = new Array<number>(samples[0].length).fill(0);
  for (const d of samples) for (let i = 0; i < avg.length; i++) avg[i] += d[i] / samples.length;
  return avg;
}

export function cameraSupported(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
}

/** A still from the camera as a JPEG data URL, at most 640 px wide (PLAN.md §16.4). */
export function grabPhoto(video: HTMLVideoElement): string {
  const scale = Math.min(1, 640 / (video.videoWidth || 640));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round((video.videoWidth || 640) * scale);
  canvas.height = Math.round((video.videoHeight || 480) * scale);
  canvas.getContext('2d')?.drawImage(video, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.7);
}

/** The phone's position, or {} when it is denied/unavailable (the server then decides). */
export function currentPosition(): Promise<{ latitude?: number; longitude?: number }> {
  return new Promise((resolve) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return resolve({});
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude }),
      () => resolve({}),
      { timeout: 8000, enableHighAccuracy: true },
    );
  });
}
