import { Alert } from 'react-native';
import { themedAlert } from './ThemedAlert';

/**
 * Replaces React Native's native Alert.alert with our theme-aware modal, so
 * every `Alert.alert(...)` call across the app picks up dark/light theme
 * automatically — no per-screen edits needed.
 */
const originalAlert = Alert.alert;
(Alert as any).alert = (title: string, message?: string, buttons?: any[]) => {
  try {
    themedAlert(title, message, buttons);
  } catch {
    originalAlert(title, message, buttons);
  }
};
