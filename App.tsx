import React from 'react';
import { StatusBar, View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { AuthProvider } from './contexts/AuthContext';
import { SocketProvider } from './contexts/SocketContext';
import { ThemeProvider, useTheme } from './theme/ThemeContext';
import { ThemedAlertProvider } from './components/ThemedAlert';
import './components/installAlertShim';
import AppNavigator from './navigation/AppNavigator';
import { useOTAUpdate } from './hooks/useOTAUpdate';

/** Inner shell that reads theme colors for StatusBar + root bg */
const AppShell: React.FC = () => {
  const { colors } = useTheme();
  // Silent OTA check on every cold start. Prompts user only when a newer JS
  // bundle is fetched, letting them restart to apply. Compiled-out in dev.
  useOTAUpdate({ silentOnStartup: true });
  return (
    <View style={{ flex: 1, backgroundColor: colors.bg0 }}>
      <SafeAreaProvider>
        <StatusBar barStyle={colors.barStyle} backgroundColor={colors.statusBar} />
        <ThemedAlertProvider>
          <AuthProvider>
            <SocketProvider>
              <AppNavigator />
            </SocketProvider>
          </AuthProvider>
        </ThemedAlertProvider>
      </SafeAreaProvider>
    </View>
  );
};

const App: React.FC = () => (
  <ThemeProvider>
    <AppShell />
  </ThemeProvider>
);

export default App;
