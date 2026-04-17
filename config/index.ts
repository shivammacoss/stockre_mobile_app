// Environment configuration for Stocktre Expo App
// Values are loaded from .env file via app.config.js

import Constants from 'expo-constants';
import { Platform } from 'react-native';

const extra = Constants.expoConfig?.extra || {};

// Resolve API URL:
// 1. Use .env value if set (non-localhost)
// 2. Android emulator: localhost → 10.0.2.2 (emulator's host loopback)
// 3. Physical device: use LAN IP — set API_URL in .env to http://<your-lan-ip>:3001
function resolveApiUrl(): string {
  const envUrl = extra.apiUrl || '';

  // If .env has a real URL (not localhost), use it directly
  if (envUrl && !envUrl.includes('localhost') && !envUrl.includes('127.0.0.1')) {
    return envUrl;
  }

  // For localhost: on Android emulator, remap to 10.0.2.2
  const port = '3001';
  if (Platform.OS === 'android') {
    return `http://10.0.2.2:${port}`;
  }
  // iOS simulator can use localhost
  return `http://localhost:${port}`;
}

// API URL - Backend server
export const API_URL = resolveApiUrl();

// WebSocket URL - Same as API URL (Socket.io runs on same server)
export const WS_URL = extra.wsUrl || API_URL;

// TradingView charting_library/ static files live on the web frontend
// (e.g. https://stocktre.com), which may differ from the REST host
// (e.g. https://api.stocktre.com). Falls back to API_URL when not split.
export const CHART_LIB_URL: string = extra.chartLibUrl || API_URL;

// App Info
export const APP_NAME = extra.appName || 'Stocktre';
export const APP_VERSION = extra.appVersion || '1.0.0';

// Helper to check if using production
export const IS_PRODUCTION = API_URL.includes('https://');

export default {
  API_URL,
  WS_URL,
  APP_NAME,
  APP_VERSION,
  IS_PRODUCTION,
};
