import 'dotenv/config';

export default {
  expo: {
    name: "Stocktre",
    // Wired to the `shivam92388` Expo account (project: stocktre-app,
    // id 57a176af-0c49-478c-940f-e703909a3ac7). Bumping or rotating the
    // project requires updating slug + projectId + updates.url + owner
    // together — they all reference the same Expo project.
    slug: "stocktre-app",
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
    updates: {
      enabled: true,
      checkAutomatically: "ON_LOAD",
      fallbackToCacheTimeout: 0,
      url: "https://u.expo.dev/57a176af-0c49-478c-940f-e703909a3ac7",
      requestHeaders: {
        "expo-channel-name": process.env.EXPO_UPDATES_CHANNEL || "preview",
      },
    },
    splash: {
      image: "./assets/app-icon.png",
      resizeMode: "contain",
      backgroundColor: "#ffffff",
    },
    ios: {
      supportsTablet: true,
      bundleIdentifier: "com.stocktre.app",
      icon: "./assets/app-icon.png",
    },
    android: {
      icon: "./assets/app-icon.png",
      adaptiveIcon: {
        foregroundImage: "./assets/adaptive-icon.png",
        backgroundColor: "#ffffff",
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
      eas: {
        projectId: "57a176af-0c49-478c-940f-e703909a3ac7",
      },
    },
    owner: "shivam92388",
  },
};
