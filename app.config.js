import 'dotenv/config';

export default {
  expo: {
    name: "Stocktre",
    // Slug is an internal Expo identifier tied to the existing projectId
    // (created pre-whitelabel as Stock4xExpo). Cannot be changed without
    // issuing a new projectId + breaking OTA updates. User-facing name,
    // bundleId, and package all show `Stocktre`.
    slug: "Stock4xExpo",
    version: "1.0.0",
    orientation: "portrait",
    icon: "./assets/app-icon.png",
    userInterfaceStyle: "dark",
    // New Architecture disabled for now — it causes Gradle build failures
    // with several community native modules (socket.io-client, webview) on
    // SDK 54. Re-enable once all deps are Fabric-ready.
    newArchEnabled: false,
    // OTA updates are tied to the native version — bump `version` above
    // whenever package.json changes require a new APK.
    runtimeVersion: { policy: "appVersion" },
    // EAS Update temporarily disabled — will re-enable with new account's URL
    // after `eas init` + `eas update:configure` under owner "stockre".
    updates: {
      enabled: false,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
    },
    splash: {
      image: "./assets/app-icon.png",
      resizeMode: "contain",
      backgroundColor: "#0d0e10",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.stocktre.app",
      icon: "./assets/app-icon.png",
    },
    android: {
      icon: "./assets/app-icon.png",
      adaptiveIcon: {
        foregroundImage: "./assets/app-icon.png",
        backgroundColor: "#0d0e10",
      },
      edgeToEdgeEnabled: true,
      package: "com.stocktre.app",
      // Allow cleartext HTTP only for local dev (API_URL=http://...).
      // Production builds use HTTPS and should NOT allow cleartext.
      usesCleartextTraffic: (process.env.API_URL || '').startsWith('http://'),
    },
    web: {
      favicon: "./assets/app-icon.png",
    },
    plugins: [
      "expo-secure-store",
      "expo-updates",
    ],
    extra: {
      // Environment variables from .env file
      apiUrl: process.env.API_URL,
      wsUrl: process.env.WS_URL,
      chartLibUrl: process.env.CHART_LIB_URL,
      appName: process.env.APP_NAME || "Stocktre",
      appVersion: process.env.APP_VERSION || "1.0.0",
      // projectId will be filled by `eas init` on first run under the new owner
      eas: {
        projectId: "",
      },
    },
    owner: "stockre",
  },
};
