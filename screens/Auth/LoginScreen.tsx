import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert, ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { API_URL } from '../../config';

const logo = require('../../assets/stocktre-logo.png');

const LoginScreen: React.FC = () => {
  const navigation = useNavigation<any>();
  const { login, isLoading } = useAuth();
  const { colors } = useTheme();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);

  const handleLogin = async () => {
    if (!username.trim() || !password.trim()) {
      Alert.alert('Missing info', 'Please enter username and password');
      return;
    }
    const result = await login(username.trim(), password);
    if (!result.success) {
      Alert.alert('Login Failed', result.error || 'Invalid credentials');
    }
  };

  // Diagnostic: show the API URL the APK is using and try a ping.
  // Remove this button once login is confirmed working.
  const handleTestConnection = async () => {
    const urlToHit = `${API_URL}/api/exchange-rate`;
    try {
      const res = await fetch(urlToHit);
      const body = await res.text();
      Alert.alert(
        'Connection Test',
        `URL: ${urlToHit}\n\nStatus: ${res.status}\n\nBody (first 200 chars):\n${body.slice(0, 200)}`
      );
    } catch (e: any) {
      Alert.alert(
        'Connection Test FAILED',
        `URL: ${urlToHit}\n\nError: ${e?.message || String(e)}`
      );
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg0 }]} edges={['top', 'bottom']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          contentContainerStyle={{ flexGrow: 1, paddingHorizontal: 22, paddingTop: 20, paddingBottom: 30 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {/* Hero */}
          <View style={styles.hero}>
            <Image source={logo} style={styles.logo} resizeMode="contain" />
            <Text style={[styles.heroTitle, { color: colors.t1 }]}>Welcome back</Text>
            <Text style={[styles.heroSub, { color: colors.t3 }]}>Sign in to continue trading</Text>
          </View>

          {/* Card */}
          <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border, shadowColor: colors.blue }]}>
            {/* Username */}
            <Text style={[styles.label, { color: colors.t3 }]}>Username / Email / Phone</Text>
            <View style={[styles.inputBox, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
              <Ionicons name="person-outline" size={18} color={colors.t3} />
              <TextInput
                style={[styles.input, { color: colors.t1 }]}
                placeholder="Enter your username"
                placeholderTextColor={colors.t3}
                value={username}
                onChangeText={setUsername}
                autoCapitalize="none"
                autoCorrect={false}
              />
            </View>

            {/* Password */}
            <Text style={[styles.label, { color: colors.t3, marginTop: 16 }]}>Password</Text>
            <View style={[styles.inputBox, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.t3} />
              <TextInput
                style={[styles.input, { color: colors.t1 }]}
                placeholder="Enter your password"
                placeholderTextColor={colors.t3}
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPw}
                autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowPw(s => !s)} hitSlop={8}>
                <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.t3} />
              </TouchableOpacity>
            </View>

            {/* Forgot */}
            <TouchableOpacity style={styles.forgotLink} onPress={() => navigation.navigate('ForgotPassword')} hitSlop={8}>
              <Text style={{ color: colors.blueLight, fontSize: 12, fontWeight: '600' }}>Forgot password?</Text>
            </TouchableOpacity>

            {/* Sign in */}
            <TouchableOpacity
              style={[styles.primaryBtn, { backgroundColor: colors.blue, opacity: isLoading ? 0.6 : 1 }]}
              onPress={handleLogin}
              disabled={isLoading}
              activeOpacity={0.85}
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <>
                  <Text style={styles.primaryBtnText}>Sign In</Text>
                  <Ionicons name="arrow-forward" size={18} color="#fff" />
                </>
              )}
            </TouchableOpacity>
          </View>

          {/* Footer */}
          <View style={styles.footer}>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
            <Text style={{ color: colors.t3, fontSize: 11 }}>NEW TO STOCKTRE</Text>
            <View style={[styles.divider, { backgroundColor: colors.border }]} />
          </View>

          <TouchableOpacity
            style={[styles.secondaryBtn, { borderColor: colors.blueBorder, backgroundColor: colors.blueDim }]}
            onPress={() => navigation.navigate('Register')}
            activeOpacity={0.8}
          >
            <Ionicons name="person-add-outline" size={16} color={colors.blue} />
            <Text style={{ color: colors.blue, fontWeight: '700', fontSize: 14 }}>Create a new account</Text>
          </TouchableOpacity>

          <Text style={{ color: colors.t3, fontSize: 10, textAlign: 'center', marginTop: 20 }}>
            By continuing you agree to our Terms & Privacy Policy
          </Text>

          {/* DIAGNOSTIC — tap to show the API URL this APK is using + ping it */}
          <TouchableOpacity
            onPress={handleTestConnection}
            style={{ marginTop: 16, padding: 10, borderRadius: 8, borderWidth: 1, borderColor: colors.border, alignItems: 'center' }}
          >
            <Text style={{ color: colors.t3, fontSize: 11 }}>🔧 Test API Connection</Text>
            <Text style={{ color: colors.t3, fontSize: 9, marginTop: 2 }}>{API_URL}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  hero: { alignItems: 'center', paddingTop: 20, paddingBottom: 28 },
  logo: { width: 180, height: 48, marginBottom: 18 },
  heroTitle: { fontSize: 22, fontWeight: '800', letterSpacing: 0.3 },
  heroSub: { fontSize: 13, marginTop: 4 },

  card: {
    borderRadius: 18, borderWidth: 1, padding: 20,
    shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.05, shadowRadius: 12, elevation: 2,
  },

  label: { fontSize: 11, fontWeight: '700', marginBottom: 6, letterSpacing: 0.3, textTransform: 'uppercase' },
  inputBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14,
  },
  input: { flex: 1, paddingVertical: 13, fontSize: 15 },

  forgotLink: { alignSelf: 'flex-end', marginTop: 8 },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 16, paddingVertical: 14, borderRadius: 12,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },

  footer: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 22 },
  divider: { flex: 1, height: 1 },

  secondaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 13, borderRadius: 12, borderWidth: 1,
  },
});

export default LoginScreen;
