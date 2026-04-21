import React, { useState } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ActivityIndicator, KeyboardAvoidingView, Platform, Alert, ScrollView, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { authAPI } from '../../services/api';

interface Props { navigation: any }

type Step = 'email' | 'reset';

const logoDark = require('../../assets/stocktre-logo-dark.png');
const logoLight = require('../../assets/stocktre-logo-light.png');

const ForgotPasswordScreen: React.FC<Props> = ({ navigation }) => {
  const { colors, isDark } = useTheme();

  const [step, setStep] = useState<Step>('email');
  const [email, setEmail] = useState('');
  const [otp, setOtp] = useState('');
  const [newPw, setNewPw] = useState('');
  const [confirmPw, setConfirmPw] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);

  const sendCode = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      Alert.alert('Invalid email', 'Enter a valid email');
      return;
    }
    setBusy(true);
    try {
      await authAPI.forgotPassword(email.trim());
      setStep('reset');
      Alert.alert('Code sent', 'If an account exists for this email, a reset code has been sent.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    } finally { setBusy(false); }
  };

  const resendCode = async () => {
    setBusy(true);
    try {
      await authAPI.forgotPassword(email.trim());
      Alert.alert('Code resent', 'Check your email.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    } finally { setBusy(false); }
  };

  const submitReset = async () => {
    if (otp.trim().length !== 6) { Alert.alert('Invalid OTP', 'OTP must be 6 digits'); return; }
    if (newPw.length < 6) { Alert.alert('Weak password', 'Min 6 characters'); return; }
    if (newPw !== confirmPw) { Alert.alert('Mismatch', 'Passwords do not match'); return; }
    setBusy(true);
    try {
      await authAPI.resetPassword({
        email: email.trim(), otp: otp.trim(),
        newPassword: newPw, confirmPassword: confirmPw,
      });
      Alert.alert('Password updated', 'You can log in now.', [
        { text: 'Back to Login', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg0 }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.headerBar, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={colors.t1} />
        </TouchableOpacity>
        <Image source={isDark ? logoDark : logoLight} style={styles.wordmarkImg} resizeMode="contain" />
        <View style={{ width: 24 }} />
      </View>

      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={{ padding: 22, paddingBottom: 60 }} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {/* Step indicator */}
          <View style={styles.stepRow}>
            <StepDot active={step === 'email'} done={step !== 'email'} label="1" colors={colors} />
            <View style={[styles.stepLine, { backgroundColor: step !== 'email' ? colors.blue : colors.border }]} />
            <StepDot active={step === 'reset'} done={false} label="2" colors={colors} />
          </View>
          <View style={styles.stepLabelsRow}>
            <Text style={[styles.stepLabel, { color: step === 'email' ? colors.blue : colors.t3 }]}>Email</Text>
            <Text style={[styles.stepLabel, { color: step === 'reset' ? colors.blue : colors.t3 }]}>Reset</Text>
          </View>

          {/* Hero icon */}
          <View style={[styles.heroIcon, { backgroundColor: colors.blueDim, borderColor: colors.blueBorder }]}>
            <Ionicons
              name={step === 'email' ? 'lock-closed-outline' : 'key-outline'}
              size={32}
              color={colors.blue}
            />
          </View>

          {step === 'email' && (
            <>
              <Text style={[styles.title, { color: colors.t1 }]}>Forgot your password?</Text>
              <Text style={[styles.subtitle, { color: colors.t3 }]}>
                No worries. Enter your email and we'll send you a 6-digit verification code.
              </Text>

              <Text style={[styles.label, { color: colors.t3 }]}>Email</Text>
              <View style={[styles.inputBox, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
                <Ionicons name="mail-outline" size={18} color={colors.t3} />
                <TextInput
                  style={[styles.input, { color: colors.t1 }]}
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  placeholder="you@example.com"
                  placeholderTextColor={colors.t3}
                />
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.blue, opacity: busy ? 0.6 : 1 }]}
                onPress={sendCode}
                disabled={busy}
                activeOpacity={0.85}
              >
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Text style={styles.primaryBtnText}>Send Reset Code</Text>
                    <Ionicons name="arrow-forward" size={18} color="#fff" />
                  </>
                )}
              </TouchableOpacity>
            </>
          )}

          {step === 'reset' && (
            <>
              <Text style={[styles.title, { color: colors.t1 }]}>Enter verification code</Text>
              <Text style={[styles.subtitle, { color: colors.t3 }]}>
                We sent a 6-digit code to <Text style={{ color: colors.t2, fontWeight: '700' }}>{email}</Text>
              </Text>

              {/* OTP input */}
              <TextInput
                style={[styles.otpInput, { backgroundColor: colors.bg3, borderColor: otp.length === 6 ? colors.blue : colors.border, color: colors.t1 }]}
                value={otp}
                onChangeText={v => setOtp(v.replace(/\D/g, '').slice(0, 6))}
                keyboardType="number-pad"
                placeholder="• • • • • •"
                placeholderTextColor={colors.t3}
                maxLength={6}
              />

              <Text style={[styles.label, { color: colors.t3, marginTop: 18 }]}>New Password</Text>
              <View style={[styles.inputBox, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
                <Ionicons name="lock-closed-outline" size={18} color={colors.t3} />
                <TextInput
                  style={[styles.input, { color: colors.t1 }]}
                  value={newPw}
                  onChangeText={setNewPw}
                  secureTextEntry={!showPw}
                  placeholder="Min 6 characters"
                  placeholderTextColor={colors.t3}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowPw(s => !s)} hitSlop={8}>
                  <Ionicons name={showPw ? 'eye-off-outline' : 'eye-outline'} size={18} color={colors.t3} />
                </TouchableOpacity>
              </View>

              <Text style={[styles.label, { color: colors.t3, marginTop: 12 }]}>Confirm Password</Text>
              <View style={[styles.inputBox, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
                <Ionicons name="shield-checkmark-outline" size={18} color={colors.t3} />
                <TextInput
                  style={[styles.input, { color: colors.t1 }]}
                  value={confirmPw}
                  onChangeText={setConfirmPw}
                  secureTextEntry={!showPw}
                  placeholderTextColor={colors.t3}
                  autoCapitalize="none"
                />
              </View>

              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.blue, opacity: busy ? 0.6 : 1 }]}
                onPress={submitReset}
                disabled={busy}
                activeOpacity={0.85}
              >
                {busy ? <ActivityIndicator color="#fff" /> : (
                  <>
                    <Text style={styles.primaryBtnText}>Update Password</Text>
                    <Ionicons name="checkmark" size={18} color="#fff" />
                  </>
                )}
              </TouchableOpacity>

              <View style={{ flexDirection: 'row', justifyContent: 'center', gap: 20, marginTop: 18 }}>
                <TouchableOpacity onPress={resendCode} disabled={busy}>
                  <Text style={{ color: colors.blue, fontSize: 13, fontWeight: '600' }}>Resend code</Text>
                </TouchableOpacity>
                <Text style={{ color: colors.t3 }}>·</Text>
                <TouchableOpacity onPress={() => setStep('email')}>
                  <Text style={{ color: colors.t3, fontSize: 13 }}>Change email</Text>
                </TouchableOpacity>
              </View>
            </>
          )}

          <TouchableOpacity style={{ marginTop: 28, alignItems: 'center' }} onPress={() => navigation.goBack()}>
            <Text style={{ color: colors.t3, fontSize: 13 }}>
              Remembered it? <Text style={{ color: colors.blue, fontWeight: '700' }}>Back to login</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const StepDot: React.FC<{ active: boolean; done: boolean; label: string; colors: any }> = ({ active, done, label, colors }) => (
  <View style={[
    styles.stepDot,
    {
      borderColor: active || done ? colors.blue : colors.border,
      backgroundColor: done ? colors.blue : active ? colors.blueDim : 'transparent',
    },
  ]}>
    {done ? <Ionicons name="checkmark" size={14} color="#fff" /> : (
      <Text style={{ color: active ? colors.blue : colors.t3, fontSize: 12, fontWeight: '800' }}>{label}</Text>
    )}
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1 },
  headerBar: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 10, borderBottomWidth: 1,
  },
  wordmarkImg: { width: 130, height: 30 },

  stepRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 60, marginBottom: 6 },
  stepLine: { flex: 1, height: 2, marginHorizontal: 6 },
  stepDot: { width: 28, height: 28, borderRadius: 14, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  stepLabelsRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 50, marginBottom: 24 },
  stepLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },

  heroIcon: {
    alignSelf: 'center',
    width: 72, height: 72, borderRadius: 36, borderWidth: 1,
    alignItems: 'center', justifyContent: 'center', marginBottom: 18,
  },

  title: { fontSize: 22, fontWeight: '800', textAlign: 'center', letterSpacing: 0.2 },
  subtitle: { fontSize: 13, lineHeight: 18, marginTop: 6, marginBottom: 24, textAlign: 'center' },

  label: { fontSize: 11, fontWeight: '700', marginBottom: 6, letterSpacing: 0.3, textTransform: 'uppercase' },
  inputBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 12, borderWidth: 1, paddingHorizontal: 14,
  },
  input: { flex: 1, paddingVertical: 13, fontSize: 15 },

  otpInput: {
    fontSize: 26, fontWeight: '700', letterSpacing: 12,
    textAlign: 'center', paddingVertical: 16,
    borderRadius: 12, borderWidth: 2,
  },

  primaryBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    marginTop: 20, paddingVertical: 14, borderRadius: 12,
  },
  primaryBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', letterSpacing: 0.3 },
});

export default ForgotPasswordScreen;
