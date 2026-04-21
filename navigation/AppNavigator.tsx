import React, { useState } from 'react';
import { NavigationContainer, useNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { View, Text, StyleSheet, ActivityIndicator, Platform } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';

import { useAuth } from '../contexts/AuthContext';
import { useTheme } from '../theme/ThemeContext';
import MoreBottomSheet from '../components/MoreBottomSheet';

// Screens
import LoginScreen from '../screens/Auth/LoginScreen';
import RegisterScreen from '../screens/Auth/RegisterScreen';
import ForgotPasswordScreen from '../screens/Auth/ForgotPasswordScreen';
import HomeScreen from '../screens/Home/HomeScreen';
import MarketScreen from '../screens/Market/MarketScreen';
import ChartScreen from '../screens/Chart/ChartScreen';
import OrdersScreen from '../screens/Orders/OrdersScreen';
import SettingsScreen from '../screens/Settings/SettingsScreen';
import BusinessScreen from '../screens/More/BusinessScreen';
import ReportsScreen from '../screens/More/ReportsScreen';
import OptionChainScreen from '../screens/Option/OptionChainScreen';
import WalletScreen from '../screens/Wallet/WalletScreen';
import NotificationsScreen from '../screens/Notifications/NotificationsScreen';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

// ─── Tab icon map ───
const TAB_ICONS: Record<string, { outline: string; filled: string }> = {
  Home:   { outline: 'home-outline',        filled: 'home' },
  Market: { outline: 'grid-outline',         filled: 'grid' },
  Chart:  { outline: 'bar-chart-outline',    filled: 'bar-chart' },
  Orders: { outline: 'document-text-outline',filled: 'document-text' },
  More:   { outline: 'ellipsis-horizontal',  filled: 'ellipsis-horizontal' },
};

// ─── Tab Bar Icon ───
const TabIcon: React.FC<{ name: string; focused: boolean; color: string }> = ({ name, focused, color }) => {
  const { colors } = useTheme();
  const ic = TAB_ICONS[name] || { outline: 'ellipse-outline', filled: 'ellipse' };
  const iconName = focused ? ic.filled : ic.outline;

  // FAB center button (Chart)
  if (name === 'Chart') {
    return (
      <View style={[styles.fabOuter, {
        backgroundColor: colors.fabGradStart,
        shadowColor: colors.fabShadow,
      }, focused && { backgroundColor: colors.fabGradEnd }]}>
        <Ionicons name={iconName as any} size={24} color="#ffffff" />
      </View>
    );
  }

  return (
    <View style={styles.tabIconWrap}>
      {focused && <View style={[styles.activeDot, { backgroundColor: colors.t1 }]} />}
      <Ionicons name={iconName as any} size={22} color={focused ? colors.t1 : colors.t3} />
    </View>
  );
};

// Placeholder for More tab (never actually rendered — tabPress is intercepted)
const MoreTabPlaceholder: React.FC = () => null;

// ─── Main Tabs ───
const MainTabs: React.FC<{ onMorePress: () => void }> = ({ onMorePress }) => {
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomInset = Math.max(insets.bottom, Platform.OS === 'android' ? 8 : 0);

  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        tabBarIcon: ({ focused, color }) => (
          <TabIcon name={route.name} focused={focused} color={color} />
        ),
        tabBarActiveTintColor: colors.t1,
        tabBarInactiveTintColor: colors.t3,
        tabBarStyle: {
          backgroundColor: colors.bnavBg,
          borderTopColor: colors.border,
          borderTopWidth: 1,
          height: 60 + bottomInset,
          paddingBottom: bottomInset,
          paddingTop: 6,
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontSize: 9,
          fontWeight: '700',
          textTransform: 'uppercase',
          letterSpacing: 0.4,
        },
        headerShown: false,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} options={{ title: 'HOME' }} />
      <Tab.Screen name="Market" component={MarketScreen} options={{ title: 'MARKET' }} />
      <Tab.Screen
        name="Chart"
        component={ChartScreen}
        options={{
          title: 'CHART',
          tabBarLabelStyle: {
            fontSize: 9,
            fontWeight: '700',
            textTransform: 'uppercase',
            letterSpacing: 0.4,
            color: colors.blue,
          },
        }}
      />
      <Tab.Screen name="Orders" component={OrdersScreen} options={{ title: 'ORDERS' }} />
      <Tab.Screen
        name="More"
        component={MoreTabPlaceholder}
        options={{ title: 'MORE' }}
        listeners={{
          tabPress: (e) => {
            e.preventDefault();
            onMorePress();
          },
        }}
      />
    </Tab.Navigator>
  );
};

// ─── Auth Stack ───
const AuthStack: React.FC = () => {
  const { colors } = useTheme();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg0 } }}>
      <Stack.Screen name="Login" component={LoginScreen} />
      <Stack.Screen name="Register" component={RegisterScreen} options={{ animation: 'slide_from_right' }} />
      <Stack.Screen name="ForgotPassword" component={ForgotPasswordScreen} options={{ animation: 'slide_from_right' }} />
    </Stack.Navigator>
  );
};

// ─── Root Stack (wraps tabs + pushed screens) ───
const RootStack = createNativeStackNavigator();
const RootNavigator: React.FC<{ onMorePress: () => void }> = ({ onMorePress }) => {
  const { colors } = useTheme();

  return (
    <RootStack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg0 } }}>
      <RootStack.Screen name="MainTabs">
        {() => <MainTabs onMorePress={onMorePress} />}
      </RootStack.Screen>
      <RootStack.Screen
        name="Profile"
        component={SettingsScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <RootStack.Screen
        name="Business"
        component={BusinessScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <RootStack.Screen
        name="Wallet"
        component={WalletScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <RootStack.Screen
        name="Reports"
        component={ReportsScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <RootStack.Screen
        name="OptionChain"
        component={OptionChainScreen}
        options={{ animation: 'slide_from_right' }}
      />
      <RootStack.Screen
        name="Notifications"
        component={NotificationsScreen}
        options={{ animation: 'slide_from_right' }}
      />
    </RootStack.Navigator>
  );
};

// ─── Root Navigator ───
const AppNavigator: React.FC = () => {
  const { isAuthenticated, isLoading } = useAuth();
  const { colors, isDark } = useTheme();
  const navRef = useNavigationContainerRef();
  const [sheetVisible, setSheetVisible] = useState(false);

  if (isLoading) {
    return (
      <View style={[styles.splash, { backgroundColor: colors.bg0 }]}>
        <Text style={[styles.splashLogo, { color: colors.t1 }]}>STOCKTRE</Text>
        <Text style={[styles.splashTagline, { color: colors.blue }]}>TRADE · INVEST · GROW</Text>
        <ActivityIndicator size="large" color={colors.blue} style={{ marginTop: 24 }} />
      </View>
    );
  }

  const handleSheetSelect = (screen: 'Profile' | 'Business' | 'Wallet' | 'Reports') => {
    navRef.navigate(screen as never);
  };

  return (
    <NavigationContainer
      ref={navRef}
      theme={{
        dark: isDark,
        colors: {
          primary: colors.blue,
          background: colors.bg0,
          card: colors.bg1,
          text: colors.t1,
          border: colors.border,
          notification: colors.blue,
        },
        fonts: {
          regular: { fontFamily: 'System', fontWeight: '400' },
          medium: { fontFamily: 'System', fontWeight: '500' },
          bold: { fontFamily: 'System', fontWeight: '700' },
          heavy: { fontFamily: 'System', fontWeight: '900' },
        },
      }}
    >
      {isAuthenticated ? (
        <>
          <RootNavigator onMorePress={() => setSheetVisible(true)} />
          <MoreBottomSheet
            visible={sheetVisible}
            onClose={() => setSheetVisible(false)}
            onSelect={handleSheetSelect}
          />
        </>
      ) : (
        <AuthStack />
      )}
    </NavigationContainer>
  );
};

// ─── Styles ───
const styles = StyleSheet.create({
  splash: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  splashLogo: {
    fontSize: 30,
    fontWeight: '800',
    letterSpacing: 3,
  },
  splashTagline: {
    fontSize: 11,
    letterSpacing: 3,
    marginTop: 8,
    fontWeight: '600',
  },

  // Tab icons
  tabIconWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 28,
  },
  activeDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    marginBottom: 3,
  },
  tabIconText: {
    fontSize: 20,
  },

  // FAB center button
  fabOuter: {
    width: 52,
    height: 52,
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  fabIcon: {
    fontSize: 24,
    color: '#ffffff',
  },
});

export default AppNavigator;
