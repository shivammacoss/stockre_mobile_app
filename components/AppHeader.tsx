import React, { useState, useEffect } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, Image,
  Modal, Pressable,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../contexts/AuthContext';
import { useSocket } from '../contexts/SocketContext';
import { useTheme } from '../theme/ThemeContext';
import { notificationAPI } from '../services/api';

const logo = require('../assets/stocktre-logo.png');

interface AppHeaderProps {
  onDeposit?: () => void;
  onNotifications?: () => void;
  onProfile?: () => void;
}

const AppHeader: React.FC<AppHeaderProps> = ({ onDeposit, onNotifications, onProfile }) => {
  const navigation = useNavigation<any>();
  const { user, logout } = useAuth();
  const { isConnected } = useSocket();
  const { colors, isDark, toggleTheme } = useTheme();
  const [unreadCount, setUnreadCount] = useState(0);
  const [showDropdown, setShowDropdown] = useState(false);

  // Fetch unread notification count
  useEffect(() => {
    const fetchCount = async () => {
      const uid = user?.id;
      if (!uid) return;
      try {
        const res = await notificationAPI.getUnreadCount(uid);
        if (res.data?.success) setUnreadCount(res.data.count || 0);
      } catch (_) {}
    };
    fetchCount();
    const interval = setInterval(fetchCount, 30000);
    return () => clearInterval(interval);
  }, [user?.id]);

  const handleDeposit = () => {
    if (onDeposit) { onDeposit(); return; }
    navigation.navigate('Wallet');
  };

  const handleNotifications = () => {
    if (onNotifications) { onNotifications(); return; }
    // Navigate to root-level Notifications (not inside MoreStack)
    navigation.navigate('Notifications');
  };

  const handleAccountSettings = () => {
    setShowDropdown(false);
    navigation.navigate('Profile');
  };

  const handleLogout = async () => {
    setShowDropdown(false);
    await logout();
  };

  const userName = user?.name || 'User';
  const userId = user?.oderId || user?.id || '';
  const initials = userName.split(/\s+/).map((s: string) => s[0]).join('').slice(0, 2).toUpperCase();

  return (
    <>
      <View style={[styles.header, { backgroundColor: colors.bg0, borderBottomColor: colors.border }]}>
        {/* Left — Logo */}
        <View style={styles.left}>
          <Image source={logo} style={styles.logoImage} resizeMode="contain" />
        </View>

        {/* Right — Action buttons */}
        <View style={styles.right}>
          {/* + Deposit */}
          <TouchableOpacity
            style={[styles.depositBtn, { backgroundColor: colors.blue }]}
            onPress={handleDeposit}
            activeOpacity={0.8}
          >
            <Text style={styles.depositBtnText}>+</Text>
          </TouchableOpacity>

          {/* Notification Bell */}
          <TouchableOpacity style={styles.iconBtn} onPress={handleNotifications}>
            <Ionicons name="notifications-outline" size={22} color={colors.t2} />
            {unreadCount > 0 && (
              <View style={[styles.notifBadge, { backgroundColor: '#ef4444' }]}>
                <Text style={styles.notifBadgeText}>{unreadCount > 9 ? '9+' : unreadCount}</Text>
              </View>
            )}
          </TouchableOpacity>

          {/* Theme Toggle */}
          <TouchableOpacity style={styles.iconBtn} onPress={toggleTheme}>
            <Ionicons name={isDark ? 'sunny-outline' : 'moon-outline'} size={20} color={colors.t2} />
          </TouchableOpacity>

          {/* Profile */}
          <TouchableOpacity style={styles.iconBtn} onPress={() => setShowDropdown(true)}>
            <View style={[styles.profileCircle, { borderColor: colors.border }]}>
              <Ionicons name="person-outline" size={16} color={colors.t2} />
            </View>
          </TouchableOpacity>
        </View>
      </View>

      {/* ── Profile Dropdown (like web screenshot) ── */}
      <Modal visible={showDropdown} transparent animationType="fade" onRequestClose={() => setShowDropdown(false)}>
        <Pressable style={styles.dropdownOverlay} onPress={() => setShowDropdown(false)}>
          <Pressable style={[styles.dropdownCard, { backgroundColor: colors.bg1, borderColor: colors.border }]} onPress={() => {}}>
            {/* User Info */}
            <View style={styles.dropdownUser}>
              <View style={[styles.dropdownAvatar, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
                <Text style={{ color: colors.t2, fontSize: 16, fontWeight: '700' }}>{initials}</Text>
              </View>
              <View>
                <Text style={{ color: colors.t1, fontSize: 15, fontWeight: '600' }}>{userName}</Text>
                <Text style={{ color: colors.t3, fontSize: 12 }}>{userId}</Text>
                {(user as any)?.isDemo && (
                  <View style={{ backgroundColor: '#f59e0b20', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginTop: 3, alignSelf: 'flex-start' }}>
                    <Text style={{ color: '#f59e0b', fontSize: 10, fontWeight: '700' }}>DEMO</Text>
                  </View>
                )}
              </View>
            </View>

            <View style={[styles.dropdownDivider, { backgroundColor: colors.border }]} />

            {/* Account Settings */}
            <TouchableOpacity style={styles.dropdownItem} onPress={handleAccountSettings} activeOpacity={0.7}>
              <Ionicons name="settings-outline" size={18} color={colors.t2} />
              <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '500' }}>Account Settings</Text>
            </TouchableOpacity>

            {/* Logout */}
            <TouchableOpacity style={styles.dropdownItem} onPress={handleLogout} activeOpacity={0.7}>
              <Ionicons name="log-out-outline" size={18} color="#ef4444" />
              <Text style={{ color: '#ef4444', fontSize: 14, fontWeight: '500' }}>Logout</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderBottomWidth: 1,
  },
  left: {},
  logoImage: { width: 130, height: 36 },

  right: { flexDirection: 'row', alignItems: 'center', gap: 8 },

  depositBtn: {
    width: 32, height: 32, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center',
  },
  depositBtnText: { color: '#fff', fontSize: 20, fontWeight: '600', lineHeight: 22 },

  iconBtn: { padding: 4 },

  profileCircle: {
    width: 30, height: 30, borderRadius: 15, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  notifBadge: {
    position: 'absolute', top: -2, right: -4,
    minWidth: 16, height: 16, borderRadius: 8,
    alignItems: 'center', justifyContent: 'center', paddingHorizontal: 3,
  },
  notifBadgeText: { color: '#fff', fontSize: 9, fontWeight: '700' },

  // Dropdown
  dropdownOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-start',
    alignItems: 'flex-end',
    paddingTop: 70,
    paddingRight: 14,
  },
  dropdownCard: {
    width: 240,
    borderRadius: 14,
    borderWidth: 1,
    paddingVertical: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 20,
    elevation: 12,
  },
  dropdownUser: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingBottom: 12,
  },
  dropdownAvatar: {
    width: 42, height: 42, borderRadius: 21, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center',
  },
  dropdownDivider: { height: 1, marginVertical: 4 },
  dropdownItem: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingHorizontal: 16, paddingVertical: 12,
  },
});

export default AppHeader;
