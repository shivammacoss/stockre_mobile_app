import React, { useEffect, useRef } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Modal, Pressable,
  Animated, PanResponder, Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

const { height: SCREEN_H } = Dimensions.get('window');
const SHEET_HEIGHT = 300;

interface MoreBottomSheetProps {
  visible: boolean;
  onClose: () => void;
  onSelect: (screen: 'Profile' | 'Business' | 'Wallet') => void;
}

const MENU_ITEMS: Array<{
  key: 'Profile' | 'Business' | 'Wallet';
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
}> = [
  { key: 'Profile', icon: 'person-outline', label: 'Profile' },
  { key: 'Business', icon: 'briefcase-outline', label: 'Business' },
  { key: 'Wallet', icon: 'wallet-outline', label: 'Wallet' },
];

const MoreBottomSheet: React.FC<MoreBottomSheetProps> = ({ visible, onClose, onSelect }) => {
  const { colors } = useTheme();
  const translateY = useRef(new Animated.Value(SHEET_HEIGHT)).current;

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

  const handleSelect = (key: 'Profile' | 'Business' | 'Wallet') => {
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
