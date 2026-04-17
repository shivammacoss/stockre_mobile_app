import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  Alert, Switch, TextInput, RefreshControl, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { useTheme } from '../../theme/ThemeContext';
import { walletAPI, authAPI, bankAPI, kycAPI, tradingAPI } from '../../services/api';
import { useNavigation } from '@react-navigation/native';
import { useOTAUpdate } from '../../hooks/useOTAUpdate';

type Section = 'profile' | 'bank' | 'security' | 'kyc' | 'stats';
const SECTION_ICONS: Record<Section, string> = {
  profile: 'person-outline',
  bank: 'card-outline',
  security: 'shield-checkmark-outline',
  kyc: 'document-text-outline',
  stats: 'stats-chart-outline',
};
const SECTIONS: { key: Section; icon: string; label: string }[] = [
  { key: 'profile', icon: 'person-outline', label: 'Profile' },
  { key: 'bank',    icon: 'card-outline', label: 'Bank Details' },
  { key: 'security',icon: 'shield-checkmark-outline', label: 'Security' },
  { key: 'kyc',     icon: 'document-text-outline', label: 'KYC' },
  { key: 'stats',   icon: 'stats-chart-outline', label: 'Stats' },
];

const KYC_STATUS_COLOR: Record<string, string> = {
  approved: '#10b981', pending: '#f59e0b', rejected: '#ef4444', resubmit: '#ef4444', not_submitted: '#94a3b8',
};

const SettingsScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user, logout, refreshUser } = useAuth();
  const { prices, onPositionUpdate } = useSocket();
  const { colors, isDark, toggleTheme } = useTheme();
  const { checkForUpdate, checking: checkingUpdate } = useOTAUpdate({ silentOnStartup: true });

  const [section, setSection] = useState<Section>('profile');
  const [wallet, setWallet] = useState<any>(null);
  const [positions, setPositions] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Profile edit
  const [profileEditing, setProfileEditing] = useState(false);
  const [profileForm, setProfileForm] = useState({ email: '', phone: '', city: '', state: '' });
  const [profileSaving, setProfileSaving] = useState(false);

  // Bank
  const [banks, setBanks] = useState<any[]>([]);
  const [bankAdding, setBankAdding] = useState(false);
  const [bankForm, setBankForm] = useState({ bankName: '', accountNumber: '', ifsc: '', accountHolder: '', upiId: '' });
  const [bankSaving, setBankSaving] = useState(false);

  // Password
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);

  // KYC
  const [kycStatus, setKycStatus] = useState<string>('not_submitted');
  const [kycReason, setKycReason] = useState<string>('');
  const [kycForm, setKycForm] = useState({
    documentType: 'pan' as 'pan'|'aadhaar'|'passport',
    documentNumber: '', fullName: '', dateOfBirth: '', address: '',
    frontImage: '', backImage: '', selfieImage: '',
  });
  const [kycSaving, setKycSaving] = useState(false);
  const [kycImageLoading, setKycImageLoading] = useState<null | 'front' | 'back' | 'selfie'>(null);

  const uid = user?.oderId || user?.id || '';

  useEffect(() => {
    if (user) {
      setProfileForm({
        email: user?.email || '',
        phone: user?.phone || '',
        city: (user as any)?.profile?.city || (user as any)?.city || '',
        state: (user as any)?.profile?.state || (user as any)?.state || '',
      });
    }
  }, [user?.id, user?.email, user?.phone]);

  useEffect(() => { loadAll(); }, [user?.id]);

  // Live position updates → recompute stats
  useEffect(() => {
    const unsub = onPositionUpdate(() => { fetchWalletAndPositions(); });
    return unsub;
  }, [onPositionUpdate]);

  // Poll wallet every 15s (mirrors web's pull-based wallet updates)
  useEffect(() => {
    if (!uid) return;
    const id = setInterval(fetchWalletAndPositions, 15000);
    return () => clearInterval(id);
  }, [uid]);

  const fetchWalletAndPositions = useCallback(async () => {
    if (!uid) return;
    try {
      const [wRes, pRes] = await Promise.all([
        walletAPI.getUserWallet(uid).catch(() => null),
        tradingAPI.getAllPositions(uid).catch(() => null),
      ]);
      if (wRes?.data?.wallet) setWallet(wRes.data.wallet);
      if (pRes?.data?.positions) setPositions(pRes.data.positions);
    } catch (_) {}
  }, [uid]);

  const loadAll = async () => {
    if (!uid) return;
    await Promise.all([
      fetchWalletAndPositions(),
      bankAPI.list(uid).then(r => setBanks(r.data?.bankAccounts || [])).catch(() => {}),
      kycAPI.getStatus(uid).then(r => {
        setKycStatus(r.data?.status || 'not_submitted');
        setKycReason(r.data?.kyc?.rejectionReason || '');
      }).catch(() => {}),
    ]);
  };

  const onRefresh = async () => { setRefreshing(true); await Promise.all([loadAll(), refreshUser()]); setRefreshing(false); };

  const n = (v: any) => Number(v || 0);
  const fmtUSD = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Live P/L (sum of all open positions using current prices)
  const livePnl = positions.reduce((sum, pos) => {
    const lp = prices[pos.symbol];
    if (!lp) return sum + (pos.profit || 0);
    const cur = pos.side === 'buy' ? (lp.bid || 0) : (lp.ask || 0);
    const entry = pos.avgPrice || pos.entryPrice || 0;
    if (!cur || !entry) return sum + (pos.profit || 0);
    const diff = pos.side === 'buy' ? cur - entry : entry - cur;
    const vol = pos.volume || 0;
    const sym = (pos.symbol || '').toUpperCase();
    const isIndian = ['NSE','BSE','NFO','BFO','MCX'].includes((pos.exchange||'').toUpperCase());
    if (isIndian) return sum + diff * (pos.quantity || vol * (pos.lotSize || 1));
    let cs = 100000;
    if (sym.includes('BTC')||sym.includes('ETH')) cs = 1;
    else if (sym.includes('XAU')) cs = 100;
    else if (sym.includes('XAG')) cs = 5000;
    else if (sym.includes('US100')||sym.includes('US30')||sym.includes('US500')) cs = 1;
    if (sym.includes('JPY')) return sum + (diff * 100000 * vol) / 100;
    return sum + diff * cs * vol;
  }, 0);

  // Live stats (mirrors web): equity = balance + livePnl, freeMargin = equity - margin
  const balance = n(wallet?.balance);
  const margin = n(wallet?.margin);
  const equity = balance + livePnl;
  const freeMargin = equity - margin;

  /* ── Handlers ──────────────────────────────────────────── */
  const handleLogout = () => {
    Alert.alert('Logout', 'Are you sure?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Logout', style: 'destructive', onPress: logout },
    ]);
  };

  const saveProfile = async () => {
    setProfileSaving(true);
    try {
      await authAPI.updateProfile(profileForm);
      await refreshUser();
      setProfileEditing(false);
      Alert.alert('Success', 'Profile updated');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    } finally {
      setProfileSaving(false);
    }
  };

  const addBank = async () => {
    if (!bankForm.bankName || !bankForm.accountNumber || !bankForm.ifsc || !bankForm.accountHolder) {
      Alert.alert('Missing fields', 'Bank name, account number, IFSC and holder are required');
      return;
    }
    setBankSaving(true);
    try {
      const res = await bankAPI.add(uid, bankForm);
      if (res.data?.success) {
        setBanks(res.data.bankAccounts || []);
        setBankForm({ bankName: '', accountNumber: '', ifsc: '', accountHolder: '', upiId: '' });
        setBankAdding(false);
      } else {
        Alert.alert('Error', res.data?.error || 'Failed to add bank');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    } finally {
      setBankSaving(false);
    }
  };

  const removeBank = (bankId: string) => {
    Alert.alert('Remove Bank', 'Delete this bank account?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: async () => {
        try {
          const res = await bankAPI.remove(uid, bankId);
          if (res.data?.success) setBanks(res.data.bankAccounts || []);
        } catch (e: any) { Alert.alert('Error', e?.response?.data?.error || e.message); }
      }},
    ]);
  };

  const changePassword = async () => {
    if (!pwForm.current || !pwForm.newPw || !pwForm.confirm) {
      Alert.alert('Missing fields', 'Fill all password fields');
      return;
    }
    if (pwForm.newPw !== pwForm.confirm) {
      Alert.alert('Mismatch', 'New password and confirm do not match');
      return;
    }
    setPwSaving(true);
    try {
      await authAPI.changePassword({
        currentPassword: pwForm.current,
        newPassword: pwForm.newPw,
        confirmPassword: pwForm.confirm,
      });
      setPwForm({ current: '', newPw: '', confirm: '' });
      Alert.alert('Success', 'Password changed');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    } finally {
      setPwSaving(false);
    }
  };

  const pickKycImage = async (field: 'frontImage' | 'backImage' | 'selfieImage') => {
    const tag = field === 'frontImage' ? 'front' : field === 'backImage' ? 'back' : 'selfie';
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert('Permission needed', 'Allow photo access to upload KYC images.');
        return;
      }
      setKycImageLoading(tag);
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        quality: 0.6,
        base64: true,
        allowsEditing: false,
      });
      if (!result.canceled && result.assets?.[0]) {
        const asset = result.assets[0];
        // ~5MB base64 limit (roughly 3.75MB binary)
        if (asset.base64 && asset.base64.length > 7_000_000) {
          Alert.alert('Too large', 'Image must be under 5MB. Try a smaller photo.');
          setKycImageLoading(null);
          return;
        }
        const dataUrl = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
        setKycForm(f => ({ ...f, [field]: dataUrl }));
      }
    } catch (e: any) {
      Alert.alert('Error', e.message);
    } finally {
      setKycImageLoading(null);
    }
  };

  const submitKyc = async () => {
    if (!kycForm.documentNumber || !kycForm.fullName) {
      Alert.alert('Missing fields', 'Document number and full name are required');
      return;
    }
    if (!kycForm.frontImage) {
      Alert.alert('Missing image', 'Please upload the front image of your document');
      return;
    }
    setKycSaving(true);
    try {
      await kycAPI.submit({
        userId: uid,
        oderId: user?.oderId,
        documentType: kycForm.documentType,
        documentNumber: kycForm.documentNumber,
        fullName: kycForm.fullName,
        dateOfBirth: kycForm.dateOfBirth || undefined,
        address: kycForm.address || undefined,
        frontImage: kycForm.frontImage,
        backImage: kycForm.backImage || undefined,
        selfieImage: kycForm.selfieImage || undefined,
      });
      setKycStatus('pending');
      Alert.alert('Submitted', 'Your KYC is under review');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    } finally {
      setKycSaving(false);
    }
  };

  /* ── Render ────────────────────────────────────────────── */
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg0 }]} edges={['top']}>
      <View style={[styles.backHeader, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={colors.t1} />
        </TouchableOpacity>
        <Text style={{ color: colors.t1, fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' }}>Profile</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 130 }}
      >
        <View style={{ padding: 12, alignItems: 'center' }}>
          <Text style={{ color: colors.t1, fontSize: 20, fontWeight: '700' }}>Settings</Text>
          <Text style={{ color: colors.t3, fontSize: 12, marginTop: 2 }}>Manage your account & preferences</Text>
        </View>

        {/* Section selector */}
        <View style={{ paddingHorizontal: 12, marginBottom: 12 }}>
          <View style={[styles.dropdown, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
            {SECTIONS.map((s, i) => (
              <TouchableOpacity
                key={s.key}
                style={[styles.dropdownItem, section === s.key && { backgroundColor: colors.blueDim },
                  i < SECTIONS.length - 1 && { borderBottomWidth: 1, borderBottomColor: colors.border }]}
                onPress={() => setSection(s.key)}
              >
                <Ionicons name={s.icon as any} size={18} color={section === s.key ? colors.blue : colors.t2} style={{ marginRight: 8 }} />
                <Text style={{ color: section === s.key ? colors.blue : colors.t1, fontSize: 14, fontWeight: section === s.key ? '600' : '400', flex: 1 }}>{s.label}</Text>
                {section === s.key && <Ionicons name="checkmark" size={16} color={colors.blue} />}
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* ── PROFILE ── */}
        {section === 'profile' && (
          <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={[styles.avatar, { backgroundColor: colors.blue }]}>
                <Text style={styles.avatarLetter}>{user?.name?.charAt(0) || 'U'}</Text>
              </View>
              <Text style={{ color: colors.t1, fontSize: 18, fontWeight: '700', marginTop: 8 }}>{user?.name || 'User'}</Text>
              <Text style={{ color: colors.t3, fontSize: 12 }}>ID: {user?.oderId || '------'}</Text>
            </View>

            {profileEditing ? (
              <>
                <ProfileInput label="Email" value={profileForm.email} onChange={(v) => setProfileForm(f => ({ ...f, email: v }))} colors={colors} keyboard="email-address" />
                <ProfileInput label="Phone" value={profileForm.phone} onChange={(v) => setProfileForm(f => ({ ...f, phone: v }))} colors={colors} keyboard="phone-pad" />
                <ProfileInput label="City" value={profileForm.city} onChange={(v) => setProfileForm(f => ({ ...f, city: v }))} colors={colors} />
                <ProfileInput label="State" value={profileForm.state} onChange={(v) => setProfileForm(f => ({ ...f, state: v }))} colors={colors} />
                <View style={{ flexDirection: 'row', gap: 10, marginTop: 4 }}>
                  <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.bg3, flex: 1, marginTop: 0 }]} onPress={() => setProfileEditing(false)}>
                    <Text style={{ color: colors.t2, fontWeight: '700' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.blue, flex: 1, marginTop: 0 }]} onPress={saveProfile} disabled={profileSaving}>
                    {profileSaving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                {[
                  { icon: 'mail-outline', label: 'Email', val: user?.email || '-' },
                  { icon: 'call-outline', label: 'Phone', val: user?.phone || '-' },
                  { icon: 'finger-print-outline', label: 'User ID', val: user?.oderId || '-' },
                  { icon: 'location-outline', label: 'City', val: profileForm.city || '-' },
                  { icon: 'map-outline', label: 'State', val: profileForm.state || '-' },
                ].map((r, i) => (
                  <View key={i} style={[styles.infoRow, { borderBottomColor: colors.border }]}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons name={r.icon as any} size={14} color={colors.t3} />
                      <Text style={{ color: colors.t3, fontSize: 12 }}>{r.label}</Text>
                    </View>
                    <Text style={{ color: colors.t1, fontSize: 13, fontWeight: '500' }}>{r.val}</Text>
                  </View>
                ))}
                <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.blue }]} activeOpacity={0.8} onPress={() => setProfileEditing(true)}>
                  <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>Edit Profile</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* ── BANK ── */}
        {section === 'bank' && (
          <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
            <Text style={[styles.secTitle, { color: colors.t1 }]}>Bank Details</Text>

            {banks.length === 0 && !bankAdding && (
              <Text style={{ color: colors.t3, fontSize: 13, textAlign: 'center', paddingVertical: 24 }}>
                No bank accounts saved yet.{'\n'}Add your bank details to enable withdrawals.
              </Text>
            )}

            {banks.map((b: any, i: number) => (
              <View key={b._id || i} style={[styles.bankCard, { borderColor: colors.border, backgroundColor: colors.bg3 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '700' }}>{b.bankName}</Text>
                  <Text style={{ color: colors.t3, fontSize: 11 }}>{b.accountHolder} • ****{String(b.accountNumber || '').slice(-4)}</Text>
                  <Text style={{ color: colors.t3, fontSize: 11 }}>IFSC: {b.ifsc}</Text>
                  {b.upiId && <Text style={{ color: colors.t3, fontSize: 11 }}>UPI: {b.upiId}</Text>}
                </View>
                <TouchableOpacity onPress={() => removeBank(b._id)} hitSlop={8}>
                  <Ionicons name="trash-outline" size={18} color={colors.red} />
                </TouchableOpacity>
              </View>
            ))}

            {bankAdding ? (
              <>
                <ProfileInput label="Bank Name" value={bankForm.bankName} onChange={(v) => setBankForm(f => ({ ...f, bankName: v }))} colors={colors} />
                <ProfileInput label="Account Holder" value={bankForm.accountHolder} onChange={(v) => setBankForm(f => ({ ...f, accountHolder: v }))} colors={colors} />
                <ProfileInput label="Account Number" value={bankForm.accountNumber} onChange={(v) => setBankForm(f => ({ ...f, accountNumber: v }))} colors={colors} keyboard="number-pad" />
                <ProfileInput label="IFSC" value={bankForm.ifsc} onChange={(v) => setBankForm(f => ({ ...f, ifsc: v.toUpperCase() }))} colors={colors} />
                <ProfileInput label="UPI (optional)" value={bankForm.upiId} onChange={(v) => setBankForm(f => ({ ...f, upiId: v }))} colors={colors} />
                <View style={{ flexDirection: 'row', gap: 10 }}>
                  <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.bg3, flex: 1, marginTop: 4 }]} onPress={() => setBankAdding(false)}>
                    <Text style={{ color: colors.t2, fontWeight: '700' }}>Cancel</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.blue, flex: 1, marginTop: 4 }]} onPress={addBank} disabled={bankSaving}>
                    {bankSaving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Save</Text>}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.blue }]} onPress={() => setBankAdding(true)}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Add Bank Account</Text>
              </TouchableOpacity>
            )}
          </View>
        )}

        {/* ── SECURITY ── */}
        {section === 'security' && (
          <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
            <Text style={[styles.secTitle, { color: colors.t1 }]}>Security Settings</Text>
            <PwInput label="Current Password" value={pwForm.current} onChange={(v) => setPwForm(f => ({ ...f, current: v }))} colors={colors} />
            <PwInput label="New Password" value={pwForm.newPw} onChange={(v) => setPwForm(f => ({ ...f, newPw: v }))} colors={colors} />
            <PwInput label="Confirm Password" value={pwForm.confirm} onChange={(v) => setPwForm(f => ({ ...f, confirm: v }))} colors={colors} />
            <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.blue }]} onPress={changePassword} disabled={pwSaving}>
              {pwSaving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Change Password</Text>}
            </TouchableOpacity>
          </View>
        )}

        {/* ── KYC ── */}
        {section === 'kyc' && (
          <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <Text style={{ color: colors.t1, fontSize: 16, fontWeight: '700' }}>KYC Verification</Text>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, backgroundColor: `${KYC_STATUS_COLOR[kycStatus] || '#94a3b8'}20` }}>
                <Text style={{ color: KYC_STATUS_COLOR[kycStatus] || '#94a3b8', fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }}>
                  {kycStatus.replace('_', ' ')}
                </Text>
              </View>
            </View>

            {kycReason && kycStatus === 'rejected' && (
              <View style={{ backgroundColor: `${colors.red}20`, borderColor: colors.red, borderWidth: 1, borderRadius: 8, padding: 10, marginBottom: 12 }}>
                <Text style={{ color: colors.red, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>Rejection reason</Text>
                <Text style={{ color: colors.t2, fontSize: 12 }}>{kycReason}</Text>
              </View>
            )}

            {(kycStatus === 'approved' || kycStatus === 'pending') ? (
              <Text style={{ color: colors.t3, fontSize: 13, textAlign: 'center', paddingVertical: 20 }}>
                {kycStatus === 'approved' ? 'Your KYC is approved.' : 'Your KYC is under review.'}
              </Text>
            ) : (
              <>
                <Text style={{ color: colors.t3, fontSize: 11, marginBottom: 4 }}>Document Type</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 12 }}>
                  {(['pan', 'aadhaar', 'passport'] as const).map(t => (
                    <TouchableOpacity
                      key={t}
                      style={[styles.docPill, { borderColor: colors.border, backgroundColor: kycForm.documentType === t ? colors.blue : colors.bg3 }]}
                      onPress={() => setKycForm(f => ({ ...f, documentType: t }))}
                    >
                      <Text style={{ color: kycForm.documentType === t ? '#fff' : colors.t2, fontSize: 12, fontWeight: '600' }}>{t.toUpperCase()}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <ProfileInput label="Document Number" value={kycForm.documentNumber} onChange={(v) => setKycForm(f => ({ ...f, documentNumber: v.toUpperCase() }))} colors={colors} />
                <ProfileInput label="Full Name" value={kycForm.fullName} onChange={(v) => setKycForm(f => ({ ...f, fullName: v }))} colors={colors} />
                <ProfileInput label="Date of Birth (YYYY-MM-DD)" value={kycForm.dateOfBirth} onChange={(v) => setKycForm(f => ({ ...f, dateOfBirth: v }))} colors={colors} />
                <ProfileInput label="Address" value={kycForm.address} onChange={(v) => setKycForm(f => ({ ...f, address: v }))} colors={colors} />

                {/* Document images */}
                <Text style={{ color: colors.t3, fontSize: 11, fontWeight: '600', marginTop: 8, marginBottom: 6 }}>Document Images</Text>
                <View style={{ flexDirection: 'row', gap: 8, marginBottom: 10 }}>
                  <KycImagePicker
                    label="Front *"
                    image={kycForm.frontImage}
                    loading={kycImageLoading === 'front'}
                    onPick={() => pickKycImage('frontImage')}
                    onRemove={() => setKycForm(f => ({ ...f, frontImage: '' }))}
                    colors={colors}
                  />
                  <KycImagePicker
                    label="Back"
                    image={kycForm.backImage}
                    loading={kycImageLoading === 'back'}
                    onPick={() => pickKycImage('backImage')}
                    onRemove={() => setKycForm(f => ({ ...f, backImage: '' }))}
                    colors={colors}
                  />
                </View>
                <View style={{ marginBottom: 10 }}>
                  <KycImagePicker
                    label="Selfie with document"
                    image={kycForm.selfieImage}
                    loading={kycImageLoading === 'selfie'}
                    onPick={() => pickKycImage('selfieImage')}
                    onRemove={() => setKycForm(f => ({ ...f, selfieImage: '' }))}
                    colors={colors}
                    full
                  />
                </View>

                <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.blue }]} onPress={submitKyc} disabled={kycSaving}>
                  {kycSaving ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Submit KYC</Text>}
                </TouchableOpacity>
              </>
            )}
          </View>
        )}

        {/* ── STATS (live) ── */}
        {section === 'stats' && (
          <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
            <Text style={[styles.secTitle, { color: colors.t1 }]}>Trading Statistics</Text>
            <View style={styles.statsGrid}>
              {[
                { icon: 'wallet-outline', label: 'Balance',     val: fmtUSD(balance), clr: '#10b981' },
                { icon: 'trending-up-outline', label: 'Equity', val: fmtUSD(equity),  clr: '#3b82f6' },
                { icon: 'lock-closed-outline', label: 'Used Margin', val: fmtUSD(margin),  clr: '#f59e0b' },
                { icon: 'cash-outline', label: 'Free Margin', val: fmtUSD(freeMargin), clr: '#8b5cf6' },
                { icon: 'pulse-outline', label: 'Live P/L',    val: `${livePnl >= 0 ? '+' : '-'}${fmtUSD(Math.abs(livePnl))}`, clr: livePnl >= 0 ? '#10b981' : '#ef4444' },
                { icon: 'layers-outline', label: 'Open Trades', val: String(positions.length), clr: colors.t1 },
              ].map((s, i) => (
                <View key={i} style={[styles.statCard, { borderColor: colors.border }]}>
                  <Ionicons name={s.icon as any} size={22} color={s.clr} style={{ marginBottom: 4 }} />
                  <Text style={{ color: colors.t3, fontSize: 10, textTransform: 'uppercase', marginBottom: 2 }}>{s.label}</Text>
                  <Text style={{ color: s.clr, fontSize: 15, fontWeight: '700' }}>{s.val}</Text>
                </View>
              ))}
            </View>
            <Text style={{ color: colors.t3, fontSize: 10, textAlign: 'center', marginTop: 12 }}>Updates live with every price tick</Text>
          </View>
        )}

        {/* Dark mode */}
        <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="moon-outline" size={18} color={colors.t2} />
            <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '500' }}>Dark Mode</Text>
          </View>
          <Switch
            value={isDark}
            onValueChange={toggleTheme}
            trackColor={{ false: colors.bg3, true: colors.blueDim }}
            thumbColor={isDark ? colors.blue : '#ccc'}
          />
        </View>

        {/* Check for updates (OTA) */}
        <TouchableOpacity
          style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}
          onPress={() => checkForUpdate(true)}
          disabled={checkingUpdate}
          activeOpacity={0.7}
        >
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
            <Ionicons name="cloud-download-outline" size={18} color={colors.blue} />
            <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '500' }}>
              {checkingUpdate ? 'Checking for updates…' : 'Check for updates'}
            </Text>
          </View>
          <Ionicons name="chevron-forward" size={16} color={colors.t3} />
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.logoutBtn, { backgroundColor: colors.redDim, borderColor: colors.red }]}
          onPress={handleLogout}
          activeOpacity={0.8}
        >
          <Text style={{ color: colors.red, fontWeight: '700', fontSize: 15 }}>Logout</Text>
        </TouchableOpacity>

        <Text style={{ color: colors.t3, textAlign: 'center', fontSize: 11, marginTop: 16 }}>Stocktre v1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
};

/* ── Small helpers ───────────────────────────────────── */
const ProfileInput: React.FC<{ label: string; value: string; onChange: (v: string) => void; colors: any; keyboard?: any }> = ({ label, value, onChange, colors, keyboard }) => (
  <View style={{ marginBottom: 10 }}>
    <Text style={{ color: colors.t3, fontSize: 11, fontWeight: '600', marginBottom: 4 }}>{label}</Text>
    <TextInput
      style={[styles.input, { backgroundColor: colors.bg3, borderColor: colors.border, color: colors.t1 }]}
      value={value}
      onChangeText={onChange}
      keyboardType={keyboard || 'default'}
      placeholderTextColor={colors.t3}
    />
  </View>
);

const KycImagePicker: React.FC<{
  label: string;
  image: string;
  loading: boolean;
  onPick: () => void;
  onRemove: () => void;
  colors: any;
  full?: boolean;
}> = ({ label, image, loading, onPick, onRemove, colors, full }) => {
  const hasImage = !!image;
  return (
    <TouchableOpacity
      onPress={hasImage ? undefined : onPick}
      activeOpacity={0.8}
      style={[
        styles.kycImgBox,
        full ? { width: '100%' } : { flex: 1 },
        { borderColor: hasImage ? colors.green : colors.border, backgroundColor: hasImage ? `${colors.green}15` : colors.bg3 },
      ]}
    >
      {hasImage ? (
        <>
          <Image source={{ uri: image }} style={styles.kycImgThumb} resizeMode="cover" />
          <TouchableOpacity
            onPress={onRemove}
            hitSlop={8}
            style={[styles.kycImgRemove, { backgroundColor: colors.bg0 }]}
          >
            <Ionicons name="close" size={14} color={colors.t1} />
          </TouchableOpacity>
          <Text style={{ color: colors.green, fontSize: 11, fontWeight: '600', marginTop: 6 }}>{label}: ✓</Text>
        </>
      ) : loading ? (
        <>
          <ActivityIndicator color={colors.blue} />
          <Text style={{ color: colors.t3, fontSize: 11, marginTop: 6 }}>{label}</Text>
        </>
      ) : (
        <>
          <Ionicons name="cloud-upload-outline" size={22} color={colors.t3} />
          <Text style={{ color: colors.t2, fontSize: 11, marginTop: 6, fontWeight: '600' }}>{label}</Text>
          <Text style={{ color: colors.t3, fontSize: 9, marginTop: 2 }}>Tap to upload</Text>
        </>
      )}
    </TouchableOpacity>
  );
};

const PwInput: React.FC<{ label: string; value: string; onChange: (v: string) => void; colors: any }> = ({ label, value, onChange, colors }) => (
  <View style={{ marginBottom: 10 }}>
    <Text style={{ color: colors.t3, fontSize: 11, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase' }}>{label}</Text>
    <TextInput
      style={[styles.input, { backgroundColor: colors.bg3, borderColor: colors.border, color: colors.t1 }]}
      secureTextEntry
      value={value}
      onChangeText={onChange}
      placeholderTextColor={colors.t3}
    />
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1 },
  backHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  card: { marginHorizontal: 12, marginBottom: 12, borderRadius: 12, padding: 16, borderWidth: 1 },
  secTitle: { fontSize: 16, fontWeight: '700', marginBottom: 14 },

  dropdown: { borderRadius: 12, borderWidth: 1, overflow: 'hidden' },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 13 },

  avatar: { width: 64, height: 64, borderRadius: 32, alignItems: 'center', justifyContent: 'center' },
  avatarLetter: { color: '#fff', fontSize: 24, fontWeight: '700' },

  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 12, borderBottomWidth: 1 },

  primaryBtn: { paddingVertical: 14, borderRadius: 10, alignItems: 'center', marginTop: 12 },
  logoutBtn: { marginHorizontal: 12, marginTop: 8, paddingVertical: 14, borderRadius: 12, alignItems: 'center', borderWidth: 1 },

  input: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 10, fontSize: 14, borderWidth: 1 },

  statsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  statCard: { width: '47%' as any, padding: 14, borderRadius: 10, borderWidth: 1, alignItems: 'center' },

  bankCard: {
    flexDirection: 'row', alignItems: 'center',
    padding: 12, borderRadius: 10, borderWidth: 1, marginBottom: 10, gap: 10,
  },
  docPill: {
    flex: 1, paddingVertical: 8, borderRadius: 8, borderWidth: 1, alignItems: 'center',
  },
  kycImgBox: {
    borderWidth: 2, borderStyle: 'dashed',
    borderRadius: 10, padding: 14,
    alignItems: 'center', justifyContent: 'center',
    minHeight: 110,
  },
  kycImgThumb: {
    width: 80, height: 80, borderRadius: 8,
  },
  kycImgRemove: {
    position: 'absolute', top: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
  },
});

export default SettingsScreen;
