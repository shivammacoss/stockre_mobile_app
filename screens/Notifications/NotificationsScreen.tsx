import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  RefreshControl, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { notificationAPI } from '../../services/api';

const NotificationsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user } = useAuth();
  const { colors } = useTheme();

  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    const uid = user?.id;
    if (!uid) return;
    try {
      const res = await notificationAPI.getNotifications(uid);
      if (res.data?.success) setNotifications(res.data.notifications || []);
    } catch (_) {}
  }, [user?.id]);

  useEffect(() => {
    (async () => { await load(); setLoading(false); })();
  }, [load]);

  const onRefresh = async () => { setRefreshing(true); await load(); setRefreshing(false); };

  const markRead = async (id: string) => {
    if (!user?.id) return;
    try {
      await notificationAPI.markAsRead(id, user.id);
      setNotifications(prev => prev.map(n => n._id === id ? { ...n, isRead: true } : n));
    } catch (_) {}
  };

  const markAllRead = async () => {
    if (!user?.id) return;
    try {
      await notificationAPI.markAllRead(user.id);
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })));
    } catch (_) {}
  };

  const unreadCount = notifications.filter(n => !n.isRead).length;

  const getIcon = (type: string) => {
    if (type === 'deposit' || type === 'withdrawal') return 'wallet-outline';
    if (type === 'trade') return 'trending-up-outline';
    if (type === 'alert') return 'warning-outline';
    if (type === 'kyc') return 'shield-checkmark-outline';
    return 'notifications-outline';
  };

  const getColor = (type: string) => {
    if (type === 'deposit') return '#10b981';
    if (type === 'withdrawal') return '#f59e0b';
    if (type === 'alert') return '#ef4444';
    if (type === 'trade') return colors.blue;
    return colors.t2;
  };

  const renderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      style={[styles.item, { backgroundColor: item.isRead ? 'transparent' : (colors as any).blueDim || 'rgba(59,130,246,0.06)', borderBottomColor: colors.border }]}
      activeOpacity={0.7}
      onPress={() => { if (!item.isRead) markRead(item._id); }}
    >
      <View style={[styles.iconCircle, { backgroundColor: getColor(item.type) + '18' }]}>
        <Ionicons name={getIcon(item.type) as any} size={18} color={getColor(item.type)} />
      </View>
      <View style={{ flex: 1 }}>
        {item.title && <Text style={{ color: colors.t1, fontSize: 13, fontWeight: '600', marginBottom: 2 }}>{item.title}</Text>}
        <Text style={{ color: colors.t2, fontSize: 12, lineHeight: 17 }}>{item.message}</Text>
        {item.image ? (
          <Image
            source={{ uri: item.image }}
            style={styles.notifImage}
            resizeMode="cover"
          />
        ) : null}
        <Text style={{ color: colors.t3, fontSize: 10, marginTop: 4 }}>
          {new Date(item.createdAt).toLocaleDateString()} · {new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>
      {!item.isRead && <View style={[styles.unreadDot, { backgroundColor: colors.blue }]} />}
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg0 }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={{ padding: 4 }}>
          <Ionicons name="arrow-back" size={22} color={colors.t1} />
        </TouchableOpacity>
        <Text style={{ color: colors.t1, fontSize: 17, fontWeight: '700', flex: 1, marginLeft: 12 }}>Notifications</Text>
        {unreadCount > 0 && (
          <TouchableOpacity onPress={markAllRead} style={{ paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6, backgroundColor: (colors as any).blueDim || 'rgba(59,130,246,0.1)' }}>
            <Text style={{ color: colors.blue, fontSize: 11, fontWeight: '600' }}>Mark all read</Text>
          </TouchableOpacity>
        )}
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
          <ActivityIndicator size="large" color={colors.blue} />
        </View>
      ) : notifications.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 40 }}>
          <Ionicons name="notifications-off-outline" size={48} color={colors.t3} />
          <Text style={{ color: colors.t3, fontSize: 14, marginTop: 12 }}>No notifications yet</Text>
        </View>
      ) : (
        <FlatList
          data={notifications}
          keyExtractor={(item) => item._id || String(item.id)}
          renderItem={renderItem}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.t3} />}
          contentContainerStyle={{ paddingBottom: 80 }}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  item: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: 16, paddingVertical: 14, borderBottomWidth: 1, gap: 12 },
  iconCircle: { width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, marginTop: 6 },
  notifImage: { width: '100%', height: 160, borderRadius: 8, marginTop: 8, backgroundColor: '#222' },
});

export default NotificationsScreen;
