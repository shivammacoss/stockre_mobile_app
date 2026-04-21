import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Pressable,
  Animated, PanResponder, Dimensions, Linking, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';
import axios from 'axios';
import { API_URL } from '../config';

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_HEIGHT = 300;

type MenuKey = 'Profile' | 'Business' | 'Wallet' | 'Reports';

interface MoreBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (screen: MenuKey) => void;
}

const MENU_ITEMS: Array<{
  key: MenuKey;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}> = [
  { key: 'Profile', icon: 'person-outline', label: 'Profile' },
  { key: 'Business', icon: 'briefcase-outline', label: 'Business' },
  { key: 'Wallet', icon: 'wallet-outline', label: 'Wallet' },
  { key: 'Reports', icon: 'document-text-outline', label: 'Reports' },
];

const MoreBottomSheet: React.FC<MoreBottomSheetProps> = ({ visible, onClose, onSelect }) => {
  const { colors } = useTheme();
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;
  const [waNumber, setWaNumber] = useState<string>('');

  // Fetch the admin-configured WhatsApp support number once when the sheet
  // becomes visible. Admin edits it via /api/admin/settings in the panel.
  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    axios
      .get(`${API_URL}/api/site-settings`, { timeout: 5000 })
      .then((res) => {
        if (cancelled) return;
        const n = res.data?.settings?.supportWhatsapp;
        if (typeof n === 'string') setWaNumber(n.trim());
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [visible]);

  const openWhatsApp = () => {
    const cleaned = waNumber.replace(/[^\d+]/g, '').replace(/^\+/, '');
    if (!cleaned) {
      Alert.alert('WhatsApp support unavailable', 'The support number has not been configured yet. Please try again later.');
      return;
    }
    const url = `https://wa.me/${cleaned}`;
    Animated.timing(translateY, {
      toValue: SHEET_HEIGHT,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      onClose();
      Linking.openURL(url).catch(() => {
        Alert.alert('Unable to open WhatsApp', 'Make sure WhatsApp is installed on this device.');
      });
    });
  };

  useEffect(() => {
    if (visible) {
      Animated.spring(translateY, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 180,
      }).start();
    } else {
      translateY.setValue(SHEET_HEIGHT);
    }
  }, [visible, translateY]);

  const dismiss = () => {
    Animated.timing(translateY, {
      toValue: SHEET_HEIGHT,
      duration: 200,
      useNativeDriver: true,
    }).start(() => onClose());
  };

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) => Math.abs(g.dy) > 5,
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) translateY.setValue(g.dy);
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) {
          dismiss();
        } else {
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 180,
          }).start();
        }
      },
    })
  ).current;

  const handleSelect = (key: MenuKey) => {
    Animated.timing(translateY, {
      toValue: SHEET_HEIGHT,
      duration: 180,
      useNativeDriver: true,
    }).start(() => {
      onClose();
      onSelect(key);
    });
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={dismiss}>
      <Pressable style={styles.overlay} onPress={dismiss}>
        <Animated.View
          style={[
            styles.sheet,
            { backgroundColor: colors.bg1, borderColor: colors.border, transform: [{ translateY }] },
          ]}
          onStartShouldSetResponder={() => true}
        >
          <View {...panResponder.panHandlers} style={styles.handleArea}>
            <View style={[styles.handle, { backgroundColor: colors.t3 }]} />
          </View>

          <TouchableOpacity style={[styles.closeBtn, { backgroundColor: colors.bg3 }]} onPress={dismiss}>
            <Ionicons name="close" size={18} color={colors.t2} />
          </TouchableOpacity>

          <View style={{ paddingHorizontal: 16, paddingTop: 4, paddingBottom: 24 }}>
            {MENU_ITEMS.map((item) => (
              <TouchableOpacity
                key={item.key}
                style={styles.row}
                onPress={() => handleSelect(item.key)}
                activeOpacity={0.7}
              >
                <View style={[styles.iconWrap, { backgroundColor: colors.blueDim }]}>
                  <Ionicons name={item.icon} size={22} color={colors.blue} />
                </View>
                <Text style={{ color: colors.t1, fontSize: 17, fontWeight: '500' }}>{item.label}</Text>
              </TouchableOpacity>
            ))}

            {/* WhatsApp Support — number is admin-configurable via /api/admin/settings */}
            <TouchableOpacity
              style={styles.row}
              onPress={openWhatsApp}
              activeOpacity={0.7}
            >
              <View style={[styles.iconWrap, { backgroundColor: 'rgba(37, 211, 102, 0.12)' }]}>
                <Ionicons name="logo-whatsapp" size={22} color="#25D366" />
              </View>
              <Text style={{ color: colors.t1, fontSize: 17, fontWeight: '500' }}>WhatsApp Support</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Pressable>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  sheet: {
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    borderWidth: 1,
    paddingBottom: 20,
    minHeight: SHEET_HEIGHT,
  },
  handleArea: {
    alignItems: 'center',
    paddingVertical: 10,
  },
  handle: {
    width: 44,
    height: 4,
    borderRadius: 2,
    opacity: 0.5,
  },
  closeBtn: {
    position: 'absolute',
    top: 12,
    right: 14,
    width: 30,
    height: 30,
    borderRadius: 15,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 2,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 16,
    paddingVertical: 14,
  },
  iconWrap: {
    width: 42,
    height: 42,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default MoreBottomSheet;
