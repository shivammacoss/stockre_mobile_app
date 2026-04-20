import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert, ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useAuth } from '../../contexts/AuthContext';
import { authAPI } from '../../services/api';
import * as SecureStore from 'expo-secure-store';

interface Props { navigation: any }

const RegisterScreen: React.FC<Props> = ({ navigation }) => {
  const { colors } = useTheme();
  const { refreshUser } = useAuth();

  const [form, setForm] = useState({
    name: '', email: '', countryCode: '+91', phone: '',
    city: '', state: '', password: '', confirmPassword: '',
    emailOtp: '', referralCode: '',
  });
  const [showPw, setShowPw] = useState(false);
  const [showCPw, setShowCPw] = useState(false);
  const [otpRequired, setOtpRequired] = useState(false);
  const [otpSent, setOtpSent] = useState(false);
  const [sendingOtp, setSendingOtp] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);

  useEffect(() => {
    authAPI.getEmailConfig()
      .then(res => { if (res.data?.signupOtpRequired) setOtpRequired(true); })
      .catch(() => {});
  }, []);

  const up = (k: keyof typeof form, v: string) => setForm(f => ({ ...f, [k]: v }));

  const validate = (): string | null => {
    if (!form.name.trim()) return 'Name is required';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) return 'Valid email is required';
    const phone = form.phone.replace(/\D/g, '');
    if (phone.length < 7 || phone.length > 15) return 'Phone must be 7–15 digits';
    if (form.password.length < 6) return 'Password must be at least 6 characters';
    if (form.password !== form.confirmPassword) return 'Passwords do not match';
    if (otpRequired && !form.emailOtp.trim()) return 'Please enter the email OTP';
    if (!acceptTerms) return 'Please accept the terms to continue';
    return null;
  };

  const sendOtp = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form.email)) {
      Alert.alert('Invalid email', 'Enter a valid email first');
      return;
    }
    setSendingOtp(true);
    try {
      await authAPI.sendSignupOtp(form.email);
      setOtpSent(true);
      Alert.alert('OTP sent', 'Check your email for the verification code');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    } finally {
      setSendingOtp(false);
    }
  };

  const submit = async () => {
    const err = validate();
    if (err) { Alert.alert('Please review', err); return; }
    setSubmitting(true);
    try {
      const res = await authAPI.register({
        name: form.name.trim(),
        email: form.email.trim(),
        phone: form.phone.replace(/\D/g, ''),
        countryCode: form.countryCode,
        city: form.city.trim() || undefined,
        state: form.state.trim() || undefined,
        password: form.password,
        confirmPassword: form.confirmPassword,
        emailOtp: otpRequired ? form.emailOtp.trim() : undefined,
        parentAdminId: form.referralCode.trim() || undefined,
      });
      if (res.data?.success && res.data?.token) {
        await SecureStore.setItemAsync('authToken', res.data.token);
        if (res.data.user) await SecureStore.setItemAsync('user', JSON.stringify(res.data.user));
        await refreshUser();
      } else {
        Alert.alert('Register failed', res.data?.error || 'Unknown error');
      }
    } catch (e: any) {
      Alert.alert('Register failed', e?.response?.data?.error || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg0 }]} edges={['top']}>
      {/* Hero header */}
      <View style={[styles.headerBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={colors.t1} />
        </TouchableOpacity>
        <Text style={[styles.wordmark, { color: colors.t1 }]}>stocktre</Text>
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          <Text style={[styles.title, { color: colors.t1 }]}>Create your account</Text>
          <Text style={[styles.subtitle, { color: colors.t3 }]}>Join thousands of traders on Stocktre</Text>

          {/* Personal info */}
          <Section title="Personal Info" colors={colors} icon="person-outline">
            <IconField colors={colors} icon="person-outline" placeholder="Full name *" value={form.name} onChange={v => up('name', v)} />
            <IconField colors={colors} icon="mail-outline" placeholder="Email *" value={form.email} onChange={v => up('email', v)} keyboard="email-address" autoCap="none" />

            {otpRequired && (
              <View style={styles.otpRow}>
                <View style={{ flex: 1 }}>
                  <IconField
                    colors={colors}
                    icon="key-outline"
                    placeholder="Email OTP *"
                    value={form.emailOtp}
                    onChange={v => up('emailOtp', v.replace(/\D/g, '').slice(0, 6))}
                    keyboard="number-pad"
                  />
                </View>
                <TouchableOpacity
                  style={[styles.otpBtn, { backgroundColor: colors.blue, opacity: sendingOtp ? 0.6 : 1 }]}
                  onPress={sendOtp}
                  disabled={sendingOtp}
                >
                  {sendingOtp ? <ActivityIndicator color="#fff" /> : (
                    <Text style={{ color: '#fff', fontWeight: '700', fontSize: 12 }}>
                      {otpSent ? 'Resend' : 'Send OTP'}
                    </Text>
                  )}
                </TouchableOpacity>
              </View>
            )}

            {/* Phone */}
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={[styles.inputBox, { backgroundColor: colors.bg3, borderColor: colors.border, width: 78 }]}>
                <TextInput
                  style={[styles.input, { color: colors.t1, textAlign: 'center', paddingLeft: 0 }]}
                  value={form.countryCode}
                  onChangeText={v => up('countryCode', v)}
                  keyboardType="phone-pad"
                />
              </View>
              <View style={[styles.inputBox, { flex: 1, backgroundColor: colors.bg3, borderColor: colors.border }]}>
                <Ionicons name="call-outline" size={18} color={colors.t3} />
                <TextInput
                  style={[styles.input, { color: colors.t1 }]}
                  value={form.phone}
                  onChangeText={v => up('phone', v.replace(/\D/g, ''))}
                  keyboardType="phone-pad"
                  placeholder="Phone number *"
                  placeholderTextColor={colors.t3}
                />
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 8 }}>
              <View style={{ flex: 1 }}>
                <IconField colors={colors} icon="location-outline" placeholder="City" value={form.city} onChange={v => up('city', v)} />
              </View>
              <View style={{ flex: 1 }}>
                <IconField colors={colors} icon="map-outline" placeholder="State" value={form.state} onChange={v => up('state', v)} />
              </View>
            </View>
          </Section>

          {/* Security */}
          <Section title="Security" colors={colors} icon="lock-closed-outline">
            <View style={[styles.inputBox, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
              <Ionicons name="lock-closed-outline" size={18} color={colors.t3} />
              <TextInput
                style={[styles.input, { color: colors.t1 }]}
                value={form.password}
                onChangeText={v => up('password', v)}
                secureTextEntry={!showPw}
                placeholder="Password (min 6 chars) *"
                placeholderTextColor={colors.t3}
                autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowPw(s => !s)} hitSlop={8}>
                <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.t3} />
              </TouchableOpacity>
            </View>

            <View style={[styles.inputBox, { backgroundColor: colors.bg3, borderColor: colors.border, marginTop: 10 }]}>
              <Ionicons name="shield-checkmark-outline" size={18} color={colors.t3} />
              <TextInput
                style={[styles.input, { color: colors.t1 }]}
                value={form.confirmPassword}
                onChangeText={v => up('confirmPassword', v)}
                secureTextEntry={!showCPw}
                placeholder="Confirm password *"
                placeholderTextColor={colors.t3}
                autoCapitalize="none"
              />
              <TouchableOpacity onPress={() => setShowCPw(s => !s)} hitSlop={8}>
                <Ionicons name={showCPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.t3} />
              </TouchableOpacity>
            </View>
          </Section>

          {/* Referral */}
          <Section title="Referral (optional)" colors={colors} icon="gift-outline">
            <IconField
              colors={colors}
              icon="gift-outline"
              placeholder="Referral code"
              value={form.referralCode}
              onChange={v => up('referralCode', v)}
              autoCap="characters"
            />
          </Section>

          {/* Terms */}
          <TouchableOpacity
            style={styles.termsRow}
            onPress={() => setAcceptTerms(v => !v)}
            activeOpacity={0.7}
          >
            <View style={[styles.checkbox, { borderColor: acceptTerms ? colors.blue : colors.border, backgroundColor: acceptTerms ? colors.blue : 'transparent' }]}>
              {acceptTerms && <Ionicons name="checkmark" size={13} color="#fff" />}
            </View>
            <Text style={{ color: colors.t2, fontSize: 12, flex: 1, lineHeight: 18 }}>
              I accept the <Text style={{ color: colors.blue, fontWeight: '700' }}>Terms of Service</Text> and <Text style={{ color: colors.blue, fontWeight: '700' }}>Privacy Policy</Text>
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.primaryBtn, { backgroundColor: colors.blue, opacity: submitting ? 0.6 : 1 }]}
            onPress={submit}
            disabled={submitting}
            activeOpacity={0.85}
          >
            {submitting ? <ActivityIndicator color="#fff" /> : (
              <>
                <Text style={styles.primaryBtnText}>Create Account</Text>
                <Ionicons name="arrow-forward" size={18} color="#fff" />
              </>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={{ marginTop: 18, alignItems: 'center' }} onPress={() => navigation.goBack()}>
            <Text style={{ color: colors.t3, fontSize: 13 }}>
              Already have an account? <Text style={{ color: colors.blue, fontWeight: '700' }}>Sign In</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const Section: React.FC<{ title: string; icon: any; colors: any; children: React.ReactNode }> = ({ title, icon, colors, children }) => (
  <View style={{ marginBottom: 20 }}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
      <Ionicons name={icon} size={14} color={colors.blue} />
      <Text style={{ color: colors.t2, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>
        {title}
      </Text>
    </View>
    <View style={{ gap: 10 }}>{children}</View>
  </View>
);

const IconField: React.FC<{
  colors: any; icon: any; placeholder: string;
  value: string; onChange: (v: string) => void;
  keyboard?: any; autoCap?: 'none' | 'characters' | 'words' | 'sentences';
}> = ({ colors, icon, placeholder, value, onChange, keyboard, autoCap }) => (
  <View style={[styles.inputBox, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
    <Ionicons name={icon} size={18} color={colors.t3} />
    <TextInput
      style={[styles.input, { color: colors.t1 }]}
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={colors.t3}
      keyboardType={keyboard || 'default'}
      autoCapitalize={autoCap || 'sentences'}
    />
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1,
  },
  wordmark: { fontSize: 28, fontWeight: '800', letterSpacing: 0.5 },

  title: { fontSize: 24, fontWeight: '800', letterSpacing: 0.3 },
  subtitle: { fontSize: 13, marginTop: 4, marginBottom: 24 },

  inputBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, borderWidth: 1,
    paddingHorizontal: 14,
  },
  input: { flex: 1, paddingVertical: 12, fontSize: 14 },

  otpRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  otpBtn: { paddingHorizontal: 14, paddingVertical: 13, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },

  termsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginVertical: 14 },
  checkbox: { width: 20, height: 20, borderRadius: 5, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    paddingVertical: 15, borderRadius: 12, marginTop: 8,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
});

export default RegisterScreen;
