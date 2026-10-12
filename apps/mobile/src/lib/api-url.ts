/**
 * The FreeFounders address the phone talks to (the gateway of `npm run dev` on this PC's Wi-Fi address for now).
 * Set EXPO_PUBLIC_API_URL in apps/mobile/.env (see .env.example); otherwise app.json "extra.apiUrl" is used.
 */
import Constants from 'expo-constants';

const fromConfig = (Constants.expoConfig?.extra as { apiUrl?: string } | undefined)?.apiUrl;

export const API_URL = (process.env.EXPO_PUBLIC_API_URL || fromConfig || 'http://192.168.2.72:8080').replace(/\/+$/, '');
