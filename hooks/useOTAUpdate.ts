import { useEffect, useState, useCallback } from 'react';
import * as Updates from 'expo-updates';
import { Alert, Platform } from 'react-native';

/**
 * OTA (EAS Update) check. Silent on app launch; shows UX on manual trigger.
 *
 *   const { checkForUpdate, checking, available } = useOTAUpdate();
 */
export function useOTAUpdate(options?: { silentOnStartup?: boolean }) {
  const silent = options?.silentOnStartup ?? true;
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState(false);

  const checkForUpdate = useCallback(async (showAlerts = true) => {
    if (__DEV__ || Platform.OS === 'web') {
      if (showAlerts) Alert.alert('Not available', 'OTA updates only run in production builds.');
      return;
    }
    if (!Updates.isEnabled) {
      if (showAlerts) Alert.alert('Updates disabled', 'This build does not have EAS Updates enabled.');
      return;
    }
    setChecking(true);
    try {
      const result = await Updates.checkForUpdateAsync();
      if (result.isAvailable) {
        setAvailable(true);
        try {
          await Updates.fetchUpdateAsync();
          if (showAlerts) {
            // User-initiated path: ask before disrupting the session.
            Alert.alert(
              'Update Available',
              'A new version of Stocktre is ready. Restart to apply?',
              [
                { text: 'Later', style: 'cancel' },
                { text: 'Restart', onPress: () => Updates.reloadAsync() },
              ]
            );
          } else {
            // Silent startup path: previously the new bundle stayed
            // staged until the next-next cold start, so users reported
            // 'OTA update not showing in preview'. Reload immediately
            // so the just-fetched bundle is the one the app actually
            // runs. We only hit this branch on app launch (silent
            // useEffect call) — never mid-session — so the reload feels
            // like a one-extra-second startup, not a jarring restart.
            try { await Updates.reloadAsync(); } catch { /* no-op */ }
          }
        } catch (fetchErr: any) {
          if (showAlerts) Alert.alert('Download failed', fetchErr?.message || 'Could not download update');
        }
      } else if (showAlerts) {
        Alert.alert('Up to date', 'You are on the latest version.');
      }
    } catch (e: any) {
      // Expo throws when no update manifest exists for this runtimeVersion +
      // channel combination. That's not an error for the user — it just
      // means admin hasn't published anything to this branch yet.
      const msg = String(e?.message || '');
      const isNoUpdatePublished =
        msg.includes('No update found') ||
        msg.includes('Failed to check for update') ||
        msg.includes('manifest') ||
        e?.code === 'ERR_UPDATES_CHECK';
      // Use `showAlerts` (per-call) not `!silent` (hook-level startup flag).
      // This ensures the manual "Check for updates" button always shows
      // feedback, while the silent on-load auto-check stays quiet.
      if (showAlerts) {
        if (isNoUpdatePublished) {
          Alert.alert('Up to date', 'You are on the latest version.');
        } else {
          Alert.alert('Update check failed', msg || 'Unknown error');
        }
      }
    } finally {
      setChecking(false);
    }
  }, [silent]);

  useEffect(() => {
    if (silent) checkForUpdate(false).catch(() => {});
  }, [silent, checkForUpdate]);

  return { checkForUpdate, checking, available };
}
