/**
 * Wires @freefounders/core for the phone (PLAN.md §13.4, packages/core/src/config.ts): the API address, and the
 * refresh token in secure storage (which also makes sign-in ask for `client: 'mobile'`). Imported once, first, by
 * the root layout.
 */
import { configureCore, createQueryClient } from '@freefounders/core';
import { focusManager } from '@tanstack/react-query';
import * as SecureStore from 'expo-secure-store';
import { AppState, Platform } from 'react-native';
import { API_URL } from './api-url';
import { createRefreshStore } from './refresh-store';

export const refreshStore = createRefreshStore(SecureStore);

configureCore({ origin: API_URL, refreshStore });

export const queryClient = createQueryClient();

// "Window focus" on a phone = the app comes back to the foreground: refresh what is stale.
AppState.addEventListener('change', (state) => {
  if (Platform.OS !== 'web') focusManager.setFocused(state === 'active');
});
