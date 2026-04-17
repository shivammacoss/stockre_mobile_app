import React, { useState, useEffect } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Share,
  RefreshControl, Modal, TextInput, ActivityIndicator, Alert, Clipboard,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { ibAPI } from '../../services/api';

type IBStatus = 'not_applied' | 'pending' | 'active' | 'rejected' | 'suspended';
type DashTab = 'overview' | 'referrals' | 'commissions' | 'withdraw';

const REG_BASE = 'https://stocktre.com/register';

const fmtInr = (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const BusinessScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user } = useAuth();
  const { colors } = useTheme();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [ibProfile, setIbProfile] = useState<any>(null);
  const [stats, setStats] = useState<any>(null);
  const [referrals, setReferrals] = useState<any[]>([]);
  const [commissions, setCommissions] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<DashTab>('overview');

  // Apply modal
  const [showApply, setShowApply] = useState(false);
  const [applyForm, setApplyForm] = useState({
    businessName: '', website: '', marketingPlan: '', expectedMonthlyReferrals: '', experience: '',
  });
  const [applyBusy, setApplyBusy] = useState(false);

  // Withdraw
  const [withdrawAmt, setWithdrawAmt] = useState('');
  const [withdrawBusy, setWithdrawBusy] = useState(false);

  useEffect(() => { fetchProfile(); }, [user?.id]);

  const fetchProfile = async () => {
    setLoading(true);
    try {
      const res = await ibAPI.getProfile();
      if (res.data?.success && res.data?.data) {
        setIbProfile(res.data.data);
        if (res.data.data.status === 'active') {
          await fetchDashboard();
        }
      } else {
        setIbProfile(null);
      }
    } catch {
      setIbProfile(null);
    } finally {
      setLoading(false);
    }
  };

  const fetchDashboard = async () => {
    try {
      const [dash, refs, comms] = await Promise.all([
        ibAPI.getDashboard().catch(() => null),
        ibAPI.getReferrals(20).catch(() => null),
        ibAPI.getCommissions(20).catch(() => null),
      ]);
      if (dash?.data?.success) setStats(dash.data.data?.referralStats || null);
      if (refs?.data?.success) setReferrals(refs.data.data?.referrals || []);
      if (comms?.data?.success) setCommissions(comms.data.data?.commissions || []);
    } catch (_) {}
  };

  const onRefresh = async () => { setRefreshing(true); await fetchProfile(); setRefreshing(false); };

  const status: IBStatus = (ibProfile?.status || 'not_applied') as IBStatus;

  const submitApply = async () => {
    if (!applyForm.businessName || !applyForm.marketingPlan) {
      Alert.alert('Missing fields', 'Business name and marketing plan are required');
      return;
    }
    setApplyBusy(true);
    try {
      const res = await ibAPI.apply({
        businessName: applyForm.businessName,
        website: applyForm.website,
        marketingPlan: applyForm.marketingPlan,
        expectedMonthlyReferrals: applyForm.expectedMonthlyReferrals
          ? Number(applyForm.expectedMonthlyReferrals) : undefined,
        experience: applyForm.experience,
      });
      if (res.data?.success) {
        setIbProfile(res.data.data);
        setShowApply(false);
        Alert.alert('Submitted', 'Your IB application is under review.');
      } else {
        Alert.alert('Error', res.data?.error || 'Failed to submit application');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    } finally {
      setApplyBusy(false);
    }
  };

  const submitWithdraw = async () => {
    const amt = Number(withdrawAmt);
    if (!amt || amt < 50) {
      Alert.alert('Invalid amount', 'Minimum withdrawal is ₹50');
      return;
    }
    const bal = Number(ibProfile?.wallet?.balance || 0);
    if (amt > bal) {
      Alert.alert('Insufficient balance', `Available: ${fmtInr(bal)}`);
      return;
    }
    setWithdrawBusy(true);
    try {
      const res = await ibAPI.withdraw(amt);
      if (res.data?.success) {
        setWithdrawAmt('');
        await fetchProfile();
        Alert.alert('Submitted', 'Your withdrawal request is pending admin approval.');
      } else {
        Alert.alert('Error', res.data?.error || 'Failed to request withdrawal');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    } finally {
      setWithdrawBusy(false);
    }
  };

  const copy = (text: string, label: string) => {
    try {
      (Clipboard as any).setString(text);
      Alert.alert('Copied', label);
    } catch { Alert.alert('Copy failed', text); }
  };

  const referralCode = ibProfile?.referralCode || '';
  const referralLink = referralCode ? `${REG_BASE}?ref=${referralCode}` : '';

  const shareLink = async () => {
    if (!referralLink) return;
    try {
      await Share.share({
        message: `Join Stocktre using my referral: ${referralLink}`,
      });
    } catch (_) {}
  };

  /* ────────── Render ────────── */
  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg0 }]} edges={['top']}>
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={colors.t1} />
        </TouchableOpacity>
        <Text style={{ color: colors.t1, fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' }}>Business (IB)</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} />}
        contentContainerStyle={{ padding: 14, paddingBottom: 130 }}
      >
        {loading ? (
          <View style={{ alignItems: 'center', paddingVertical: 60 }}>
            <ActivityIndicator color={colors.blue} />
          </View>
        ) : status === 'not_applied' ? (
          <NotAppliedView colors={colors} onApply={() => setShowApply(true)} />
        ) : status === 'pending' ? (
          <PendingView colors={colors} appliedAt={ibProfile?.appliedAt} />
        ) : status === 'rejected' ? (
          <RejectedView colors={colors} reason={ibProfile?.rejectedReason} onReapply={() => setShowApply(true)} />
        ) : status === 'suspended' ? (
          <SuspendedView colors={colors} reason={ibProfile?.suspendedReason || ibProfile?.adminNotes} onReapply={() => setShowApply(true)} />
        ) : (
          /* ACTIVE — dashboard */
          <>
            {/* Referral card */}
            <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
              <Text style={{ color: colors.t1, fontSize: 15, fontWeight: '700', marginBottom: 10 }}>Your Referral</Text>
              <View style={[styles.codeBox, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.t3, fontSize: 10, fontWeight: '600', textTransform: 'uppercase' }}>Code</Text>
                  <Text style={{ color: colors.blue, fontSize: 18, fontWeight: '800', letterSpacing: 2 }}>{referralCode || '—'}</Text>
                </View>
                <TouchableOpacity onPress={() => copy(referralCode, 'Referral code copied')} hitSlop={8}>
                  <Ionicons name="copy-outline" size={18} color={colors.t2} />
                </TouchableOpacity>
              </View>
              <View style={[styles.codeBox, { backgroundColor: colors.bg3, borderColor: colors.border, marginTop: 8 }]}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: colors.t3, fontSize: 10, fontWeight: '600', textTransform: 'uppercase' }}>Link</Text>
                  <Text style={{ color: colors.t1, fontSize: 11 }} numberOfLines={1}>{referralLink}</Text>
                </View>
                <TouchableOpacity onPress={() => copy(referralLink, 'Link copied')} hitSlop={8}>
                  <Ionicons name="copy-outline" size={18} color={colors.t2} />
                </TouchableOpacity>
              </View>
              <TouchableOpacity style={[styles.shareBtn, { backgroundColor: colors.blue }]} onPress={shareLink} activeOpacity={0.8}>
                <Ionicons name="share-social-outline" size={18} color="#fff" />
                <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14, marginLeft: 8 }}>Share Link</Text>
              </TouchableOpacity>
            </View>

            {/* Tabs */}
            <View style={[styles.tabBar, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
              {([
                { k: 'overview', l: 'Overview' },
                { k: 'referrals', l: 'Referrals' },
                { k: 'commissions', l: 'Commissions' },
                { k: 'withdraw', l: 'Withdraw' },
              ] as { k: DashTab; l: string }[]).map(t => (
                <TouchableOpacity
                  key={t.k}
                  style={[styles.tabPill, activeTab === t.k && { backgroundColor: colors.bg0 }]}
                  onPress={() => setActiveTab(t.k)}
                >
                  <Text style={{ color: activeTab === t.k ? colors.t1 : colors.t3, fontSize: 11, fontWeight: '700' }}>
                    {t.l}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>

            {/* Overview */}
            {activeTab === 'overview' && (
              <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
                <View style={styles.statsGrid}>
                  <StatCell colors={colors} icon="wallet-outline" iconColor={colors.green} label="Available Balance" val={fmtInr(ibProfile?.wallet?.balance)} />
                  <StatCell colors={colors} icon="cash-outline" iconColor={colors.blue} label="Total Earned" val={fmtInr(stats?.totalCommissionEarned)} />
                  <StatCell colors={colors} icon="people-outline" iconColor={colors.t1} label="Total Referrals" val={String(stats?.totalReferrals ?? 0)} />
                  <StatCell colors={colors} icon="person-add-outline" iconColor={colors.green} label="Active Referrals" val={String(stats?.activeReferrals ?? 0)} />
                  <StatCell colors={colors} icon="stats-chart-outline" iconColor={colors.amber} label="Total Lots Traded" val={String(stats?.totalLotsTraded ?? 0)} />
                  <StatCell colors={colors} icon="calendar-outline" iconColor="#a855f7" label="This Month" val={fmtInr(stats?.thisMonthCommission)} />
                </View>

                {/* Commission settings */}
                {ibProfile?.commissionSettings && (
                  <View style={{ marginTop: 14, padding: 12, borderRadius: 10, backgroundColor: colors.bg3, borderWidth: 1, borderColor: colors.border }}>
                    <Text style={{ color: colors.t3, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', marginBottom: 6 }}>
                      Commission
                    </Text>
                    <Row colors={colors} label="Type" value={ibProfile.commissionSettings.type === 'per_lot' ? 'Per Lot' : 'Revenue %'} />
                    {ibProfile.commissionSettings.type === 'per_lot' ? (
                      <Row colors={colors} label="Per Lot" value={fmtInr(ibProfile.commissionSettings.perLotAmount)} />
                    ) : (
                      <Row colors={colors} label="Revenue %" value={`${ibProfile.commissionSettings.revenuePercent || 0}%`} />
                    )}
                    <Row colors={colors} label="Level" value={String(ibProfile.level || 1)} />
                  </View>
                )}
              </View>
            )}

            {/* Referrals */}
            {activeTab === 'referrals' && (
              <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
                <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '700', marginBottom: 8 }}>Your Referrals</Text>
                {referrals.length === 0 ? (
                  <Text style={{ color: colors.t3, fontSize: 12, textAlign: 'center', paddingVertical: 30 }}>No referrals yet.</Text>
                ) : referrals.map((r: any, i: number) => (
                  <View key={r._id || i} style={[styles.listRow, { borderBottomColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.t1, fontSize: 13, fontWeight: '600' }}>{r.name || r.email || '—'}</Text>
                      <Text style={{ color: colors.t3, fontSize: 10, marginTop: 1 }}>
                        Joined {r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: r.isActive ? colors.green : colors.t3, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }}>
                        {r.isActive ? 'Active' : 'Inactive'}
                      </Text>
                      <Text style={{ color: colors.t2, fontSize: 10, marginTop: 1 }}>
                        {r.stats?.totalTrades || 0} trades
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Commissions */}
            {activeTab === 'commissions' && (
              <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
                <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '700', marginBottom: 8 }}>Commission History</Text>
                {commissions.length === 0 ? (
                  <Text style={{ color: colors.t3, fontSize: 12, textAlign: 'center', paddingVertical: 30 }}>No commissions yet.</Text>
                ) : commissions.map((c: any, i: number) => (
                  <View key={c._id || i} style={[styles.listRow, { borderBottomColor: colors.border }]}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ color: colors.t1, fontSize: 13, fontWeight: '600' }}>
                        {c.tradeDetails?.symbol || 'Commission'}
                      </Text>
                      <Text style={{ color: colors.t3, fontSize: 10, marginTop: 1 }}>
                        {c.createdAt ? new Date(c.createdAt).toLocaleString() : ''}
                        {c.referredUserId?.name ? ` · ${c.referredUserId.name}` : ''}
                      </Text>
                    </View>
                    <View style={{ alignItems: 'flex-end' }}>
                      <Text style={{ color: colors.green, fontSize: 13, fontWeight: '700' }}>{fmtInr(c.amount)}</Text>
                      <Text style={{ color: colors.t3, fontSize: 9, textTransform: 'uppercase' }}>
                        {c.status || 'pending'}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            )}

            {/* Withdraw */}
            {activeTab === 'withdraw' && (
              <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
                <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '700', marginBottom: 4 }}>Withdraw Commission</Text>
                <Text style={{ color: colors.t3, fontSize: 11, marginBottom: 14 }}>Minimum ₹50 — requires admin approval.</Text>

                <View style={{ padding: 14, borderRadius: 10, backgroundColor: colors.bg3, borderWidth: 1, borderColor: colors.border, marginBottom: 14 }}>
                  <Text style={{ color: colors.t3, fontSize: 10, fontWeight: '700', textTransform: 'uppercase' }}>Available</Text>
                  <Text style={{ color: colors.green, fontSize: 22, fontWeight: '800', marginTop: 2 }}>
                    {fmtInr(ibProfile?.wallet?.balance)}
                  </Text>
                </View>

                <Text style={{ color: colors.t2, fontSize: 11, fontWeight: '600', marginBottom: 4 }}>Amount (INR)</Text>
                <TextInput
                  style={[styles.input, { backgroundColor: colors.bg3, borderColor: colors.border, color: colors.t1 }]}
                  value={withdrawAmt}
                  onChangeText={setWithdrawAmt}
                  keyboardType="decimal-pad"
                  placeholder="0.00"
                  placeholderTextColor={colors.t3}
                />
                <TouchableOpacity
                  style={[styles.primaryBtn, { backgroundColor: colors.blue }]}
                  onPress={submitWithdraw}
                  disabled={withdrawBusy}
                  activeOpacity={0.8}
                >
                  {withdrawBusy ? <ActivityIndicator color="#fff" /> : (
                    <Text style={{ color: '#fff', fontWeight: '700' }}>Request Withdrawal</Text>
                  )}
                </TouchableOpacity>
              </View>
            )}
          </>
        )}
      </ScrollView>

      {/* ── Apply Modal ── */}
      <Modal visible={showApply} animationType="slide" transparent onRequestClose={() => setShowApply(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setShowApply(false)} />
          <View style={{ backgroundColor: colors.bg1, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '92%' }}>
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.t1, fontSize: 16, fontWeight: '700' }}>Apply to become an IB</Text>
              <TouchableOpacity onPress={() => setShowApply(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.t2} />
              </TouchableOpacity>
            </View>
            <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 30 }}>
              <ApplyInput label="Business / Brand Name *" value={applyForm.businessName} onChange={v => setApplyForm(f => ({ ...f, businessName: v }))} colors={colors} />
              <ApplyInput label="Website (optional)" value={applyForm.website} onChange={v => setApplyForm(f => ({ ...f, website: v }))} colors={colors} keyboard="url" />
              <ApplyInput label="Expected Monthly Referrals" value={applyForm.expectedMonthlyReferrals} onChange={v => setApplyForm(f => ({ ...f, expectedMonthlyReferrals: v }))} colors={colors} keyboard="number-pad" />
              <ApplyInput label="Experience" value={applyForm.experience} onChange={v => setApplyForm(f => ({ ...f, experience: v }))} colors={colors} multiline />
              <ApplyInput label="Marketing Plan *" value={applyForm.marketingPlan} onChange={v => setApplyForm(f => ({ ...f, marketingPlan: v }))} colors={colors} multiline />
              <TouchableOpacity
                style={[styles.primaryBtn, { backgroundColor: colors.blue, marginTop: 10 }]}
                onPress={submitApply}
                disabled={applyBusy}
                activeOpacity={0.8}
              >
                {applyBusy ? <ActivityIndicator color="#fff" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Submit Application</Text>}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
};

/* ── Small helpers ────────────────────────────────────────────── */
const NotAppliedView: React.FC<{ colors: any; onApply: () => void }> = ({ colors, onApply }) => (
  <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
    <Text style={{ color: colors.t1, fontSize: 18, fontWeight: '700', marginBottom: 6 }}>Introducing Broker Program</Text>
    <Text style={{ color: colors.t3, fontSize: 13, marginBottom: 16 }}>
      Earn commission for every trade your referred users make.
    </Text>
    {['Earn per-lot or revenue-share commissions', 'Multi-level referral system', 'Real-time dashboard & stats', 'Withdraw to your wallet anytime'].map((b, i) => (
      <View key={i} style={{ flexDirection: 'row', gap: 10, marginBottom: 8 }}>
        <Ionicons name="checkmark-circle" size={18} color={colors.green} />
        <Text style={{ color: colors.t2, fontSize: 13, flex: 1 }}>{b}</Text>
      </View>
    ))}
    <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.blue, marginTop: 16 }]} onPress={onApply} activeOpacity={0.8}>
      <Text style={{ color: '#fff', fontWeight: '700' }}>Apply to become an IB</Text>
    </TouchableOpacity>
  </View>
);

const PendingView: React.FC<{ colors: any; appliedAt?: string }> = ({ colors, appliedAt }) => (
  <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.amber, alignItems: 'center' }]}>
    <Ionicons name="hourglass-outline" size={48} color={colors.amber} />
    <Text style={{ color: colors.t1, fontSize: 16, fontWeight: '700', marginTop: 10 }}>Application Pending</Text>
    <Text style={{ color: colors.t3, fontSize: 12, textAlign: 'center', marginTop: 6 }}>
      Your IB application is under review.{appliedAt ? `\nApplied on ${new Date(appliedAt).toLocaleDateString()}` : ''}
    </Text>
  </View>
);

const RejectedView: React.FC<{ colors: any; reason?: string; onReapply: () => void }> = ({ colors, reason, onReapply }) => (
  <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.red }]}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <Ionicons name="close-circle" size={22} color={colors.red} />
      <Text style={{ color: colors.t1, fontSize: 16, fontWeight: '700' }}>Application Rejected</Text>
    </View>
    {reason && (
      <View style={{ backgroundColor: `${colors.red}15`, borderRadius: 8, padding: 10, marginBottom: 12 }}>
        <Text style={{ color: colors.t3, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>Reason</Text>
        <Text style={{ color: colors.t2, fontSize: 12 }}>{reason}</Text>
      </View>
    )}
    <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.blue }]} onPress={onReapply} activeOpacity={0.8}>
      <Text style={{ color: '#fff', fontWeight: '700' }}>Apply Again</Text>
    </TouchableOpacity>
  </View>
);

const SuspendedView: React.FC<{ colors: any; reason?: string; onReapply: () => void }> = ({ colors, reason, onReapply }) => (
  <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.red }]}>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 10 }}>
      <Ionicons name="warning-outline" size={22} color={colors.red} />
      <Text style={{ color: colors.t1, fontSize: 16, fontWeight: '700' }}>IB Account Suspended</Text>
    </View>
    {reason && (
      <View style={{ backgroundColor: `${colors.red}15`, borderRadius: 8, padding: 10, marginBottom: 12 }}>
        <Text style={{ color: colors.t3, fontSize: 11, fontWeight: '700', marginBottom: 2 }}>Reason / Admin notes</Text>
        <Text style={{ color: colors.t2, fontSize: 12 }}>{reason}</Text>
      </View>
    )}
    <TouchableOpacity style={[styles.primaryBtn, { backgroundColor: colors.blue }]} onPress={onReapply} activeOpacity={0.8}>
      <Text style={{ color: '#fff', fontWeight: '700' }}>Reapply to IB Program</Text>
    </TouchableOpacity>
  </View>
);

const StatCell: React.FC<{ colors: any; icon: any; iconColor: string; label: string; val: string }> = ({ colors, icon, iconColor, label, val }) => (
  <View style={[styles.statItem, { borderColor: colors.border, backgroundColor: colors.bg3 }]}>
    <Ionicons name={icon} size={20} color={iconColor} />
    <Text style={{ color: colors.t3, fontSize: 9, textTransform: 'uppercase', marginTop: 6, textAlign: 'center' }}>{label}</Text>
    <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '700', marginTop: 2 }} numberOfLines={1}>{val}</Text>
  </View>
);

const Row: React.FC<{ colors: any; label: string; value: string }> = ({ colors, label, value }) => (
  <View style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 }}>
    <Text style={{ color: colors.t3, fontSize: 12 }}>{label}</Text>
    <Text style={{ color: colors.t1, fontSize: 12, fontWeight: '600' }}>{value}</Text>
  </View>
);

const ApplyInput: React.FC<{ label: string; value: string; onChange: (v: string) => void; colors: any; keyboard?: any; multiline?: boolean }> = ({ label, value, onChange, colors, keyboard, multiline }) => (
  <View style={{ marginBottom: 12 }}>
    <Text style={{ color: colors.t3, fontSize: 11, fontWeight: '600', marginBottom: 4 }}>{label}</Text>
    <TextInput
      style={[styles.input, { backgroundColor: colors.bg3, borderColor: colors.border, color: colors.t1 }, multiline && { minHeight: 80, textAlignVertical: 'top' }]}
      value={value}
      onChangeText={onChange}
      keyboardType={keyboard || 'default'}
      multiline={!!multiline}
      placeholderTextColor={colors.t3}
    />
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  card: { borderRadius: 14, padding: 16, borderWidth: 1, marginBottom: 12 },
  codeBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    borderRadius: 10, padding: 12, borderWidth: 1,
  },
  shareBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 12, borderRadius: 10, marginTop: 12 },

  tabBar: {
    flexDirection: 'row', padding: 3, borderRadius: 10, borderWidth: 1, marginBottom: 12,
  },
  tabPill: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 8 },

  statsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: 8,
  },
  statItem: {
    width: '47%' as any,
    padding: 12, borderRadius: 10, borderWidth: 1, alignItems: 'center',
  },

  listRow: {
    flexDirection: 'row', alignItems: 'center',
    paddingVertical: 10, borderBottomWidth: 1,
  },

  primaryBtn: { paddingVertical: 14, borderRadius: 10, alignItems: 'center' },
  input: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1 },
});

export default BusinessScreen;
