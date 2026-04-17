import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import AppHeader from '../../components/AppHeader';

const MENU_ITEMS = [
  { key: 'Profile', icon: 'person-outline' as const, label: 'Profile', desc: 'Manage your account & settings' },
  { key: 'Business', icon: 'business-outline' as const, label: 'Business', desc: 'Business & referral details' },
  { key: 'Wallet', icon: 'wallet-outline' as const, label: 'Wallet', desc: 'Deposits, withdrawals & balance' },
];

const MoreScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { colors } = useTheme();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg0 }]} edges={['top']}>
      <AppHeader />
      <View style={{ flex: 1, padding: 16 }}>
        <Text style={{ color: colors.t1, fontSize: 20, fontWeight: '700', marginBottom: 4 }}>More</Text>
        <Text style={{ color: colors.t3, fontSize: 12, marginBottom: 20 }}>Account, business & wallet</Text>

        {MENU_ITEMS.map((item) => (
          <TouchableOpacity
            key={item.key}
            style={[styles.menuItem, { backgroundColor: colors.bg2, borderColor: colors.border }]}
            onPress={() => navigation.navigate(item.key)}
            activeOpacity={0.7}
          >
            <View style={[styles.iconWrap, { backgroundColor: colors.blueDim }]}>  
              <Ionicons name={item.icon} size={22} color={colors.blue} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.t1, fontSize: 15, fontWeight: '600' }}>{item.label}</Text>
              <Text style={{ color: colors.t3, fontSize: 11, marginTop: 2 }}>{item.desc}</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.t3} />
          </TouchableOpacity>
        ))}
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: 10,
    gap: 14,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
});

export default MoreScreen;
