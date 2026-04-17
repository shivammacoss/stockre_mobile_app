import React, { createContext, useCallback, useContext, useRef, useState } from 'react';
import { View, Text, Modal, TouchableOpacity, StyleSheet, Pressable, Animated, Easing } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

/**
 * Drop-in replacement for React Native's Alert.alert that respects the app
 * theme (dark/light) and renders a polished modal.
 *
 *   const alert = useThemedAlert();
 *   alert.alert('Title', 'Message');
 *   alert.alert('Confirm', 'Are you sure?', [
 *     { text: 'Cancel', style: 'cancel' },
 *     { text: 'Delete', style: 'destructive', onPress: doIt },
 *   ]);
 *
 * Also exports a module-level `themedAlert()` for use outside React components.
 */

export type AlertButton = {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
};

type AlertPayload = {
  title: string;
  message?: string;
  buttons?: AlertButton[];
  kind?: 'info' | 'success' | 'warning' | 'error';
};

type AlertCtx = {
  alert: (title: string, message?: string, buttons?: AlertButton[], kind?: AlertPayload['kind']) => void;
};

const AlertContext = createContext<AlertCtx | null>(null);

let externalShow: ((p: AlertPayload) => void) | null = null;

/** Use from non-React code (e.g. module-level catch handlers). */
export function themedAlert(title: string, message?: string, buttons?: AlertButton[], kind?: AlertPayload['kind']) {
  if (externalShow) externalShow({ title, message, buttons, kind });
  else console.warn('[themedAlert] Not mounted yet:', title, message);
}

export const ThemedAlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { colors } = useTheme();
  const [visible, setVisible] = useState(false);
  const [payload, setPayload] = useState<AlertPayload>({ title: '' });
  const scale = useRef(new Animated.Value(0.9)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  const show = useCallback((p: AlertPayload) => {
    setPayload(p);
    setVisible(true);
    scale.setValue(0.9);
    opacity.setValue(0);
    Animated.parallel([
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, damping: 15, stiffness: 240, useNativeDriver: true }),
    ]).start();
  }, [opacity, scale]);

  const hide = useCallback(() => {
    Animated.parallel([
      Animated.timing(opacity, { toValue: 0, duration: 140, useNativeDriver: true }),
      Animated.timing(scale, { toValue: 0.92, duration: 140, easing: Easing.out(Easing.ease), useNativeDriver: true }),
    ]).start(() => setVisible(false));
  }, [opacity, scale]);

  const ctx: AlertCtx = {
    alert: (title, message, buttons, kind) => show({ title, message, buttons, kind }),
  };
  externalShow = show;

  const buttons = payload.buttons && payload.buttons.length > 0
    ? payload.buttons
    : [{ text: 'OK', style: 'default' as const }];

  const kind = payload.kind || (
    payload.title.toLowerCase().includes('error') ? 'error'
    : payload.title.toLowerCase().includes('success') ? 'success'
    : payload.title.toLowerCase().includes('missing') || payload.title.toLowerCase().includes('warning') || payload.title.toLowerCase().includes('invalid') ? 'warning'
    : 'info'
  );

  const iconName: any = {
    info: 'information-circle',
    success: 'checkmark-circle',
    warning: 'warning',
    error: 'alert-circle',
  }[kind];
  const iconColor = {
    info: colors.blue,
    success: colors.green,
    warning: colors.amber,
    error: colors.red,
  }[kind];
  const iconBg = {
    info: colors.blueDim,
    success: colors.greenDim,
    warning: `${colors.amber}20`,
    error: colors.redDim,
  }[kind];

  return (
    <AlertContext.Provider value={ctx}>
      {children}
      <Modal visible={visible} transparent animationType="none" statusBarTranslucent onRequestClose={hide}>
        <Animated.View style={[StyleSheet.absoluteFill, styles.backdrop, { opacity }]}>
          <Pressable style={StyleSheet.absoluteFill} onPress={hide} />
        </Animated.View>

        <View pointerEvents="box-none" style={styles.center}>
          <Animated.View
            style={[
              styles.card,
              { backgroundColor: colors.bg1, borderColor: colors.border, opacity, transform: [{ scale }] },
            ]}
          >
            <View style={[styles.iconWrap, { backgroundColor: iconBg, borderColor: iconColor + '40' }]}>
              <Ionicons name={iconName} size={30} color={iconColor} />
            </View>
            <Text style={[styles.title, { color: colors.t1 }]}>{payload.title}</Text>
            {payload.message ? (
              <Text style={[styles.message, { color: colors.t2 }]}>{payload.message}</Text>
            ) : null}

            <View style={[styles.btnRow, buttons.length > 2 && { flexDirection: 'column' }]}>
              {buttons.map((b, i) => {
                const isDestructive = b.style === 'destructive';
                const isCancel = b.style === 'cancel';
                const isPrimary = !isDestructive && !isCancel;
                const bg = isDestructive ? colors.red : isPrimary ? colors.blue : colors.bg3;
                const fg = isDestructive || isPrimary ? '#fff' : colors.t2;
                return (
                  <TouchableOpacity
                    key={i}
                    style={[
                      styles.btn,
                      { backgroundColor: bg, borderColor: isCancel ? colors.border : 'transparent' },
                      buttons.length > 2 && { marginBottom: 8 },
                    ]}
                    onPress={() => { hide(); b.onPress?.(); }}
                    activeOpacity={0.85}
                  >
                    <Text style={{ color: fg, fontSize: 14, fontWeight: '700' }}>{b.text}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Animated.View>
        </View>
      </Modal>
    </AlertContext.Provider>
  );
};

export function useThemedAlert(): AlertCtx {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error('useThemedAlert must be used within ThemedAlertProvider');
  return ctx;
}

const styles = StyleSheet.create({
  backdrop: { backgroundColor: 'rgba(0,0,0,0.55)' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingHorizontal: 28 },
  card: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 20,
    borderWidth: 1,
    paddingTop: 28,
    paddingBottom: 18,
    paddingHorizontal: 22,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 12,
  },
  iconWrap: {
    width: 60, height: 60, borderRadius: 30, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  title: { fontSize: 18, fontWeight: '800', textAlign: 'center', marginBottom: 6 },
  message: { fontSize: 14, textAlign: 'center', lineHeight: 20, marginBottom: 18 },
  btnRow: { flexDirection: 'row', gap: 10, width: '100%', marginTop: 4 },
  btn: { flex: 1, paddingVertical: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center' },
});
