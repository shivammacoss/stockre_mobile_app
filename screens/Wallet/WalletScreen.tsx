import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity,
  RefreshControl, TextInput, Alert, ScrollView, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import * as ImagePicker from 'expo-image-picker';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../theme/ThemeContext';
import { useSocket } from '../../contexts/SocketContext';
import { walletAPI, tradingAPI } from '../../services/api';

/* ================================================================
   WalletScreen — mirrors web WalletPage
   Hero card → My Wallet grid → Deposit/Withdraw → Transactions
   Live-polls wallet every 5s, real deposit/withdrawal submission
   ================================================================ */

type WalletTab = 'deposit' | 'withdrawal';
type WithdrawMethod = 'bank' | 'upi' | 'crypto';

const WalletScreen: React.FC = () => {
  const navigation = useNavigation();
  const { user, refreshUser } = useAuth();
  const { colors } = useTheme();
  const { prices, onPositionUpdate } = useSocket();

  const [refreshing, setRefreshing] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [wallet, setWallet] = useState<any>(null);
  const [transactions, setTransactions] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<WalletTab>('deposit');
  const currency = 'INR' as const;
  const [amount, setAmount] = useState('');
  const [walletINR, setWalletINR] = useState<{ balance: number; totalDeposits: number; totalWithdrawals: number }>({ balance: 0, totalDeposits: 0, totalWithdrawals: 0 });

  // Deposit state
  const [paymentMethods, setPaymentMethods] = useState<any>({ bankAccounts: [], upiIds: [], cryptoWallets: [] });
  const [selectedPaymentMethod, setSelectedPaymentMethod] = useState('');

  // Withdrawal state
  const [withdrawMethod, setWithdrawMethod] = useState<WithdrawMethod>('bank');
  const [bankDetails, setBankDetails] = useState({ bankName: '', accountNumber: '', ifsc: '', accountHolder: '' });
  const [cryptoDetails, setCryptoDetails] = useState({ network: '', address: '' });
  const [savedBanks, setSavedBanks] = useState<any[]>([]);
  const [positions, setPositions] = useState<any[]>([]);

  // Deposit: proof image + transaction ID + bonus
  const [proofImage, setProofImage] = useState<string | null>(null);
  const [transactionId, setTransactionId] = useState('');
  const [eligibleBonus, setEligibleBonus] = useState<{
    amount: number; templateName: string | null; isFirstDeposit: boolean | null;
    belowMinimum: boolean; minimumRequired: number | null; minimumTemplateName: string | null;
  }>({ amount: 0, templateName: null, isFirstDeposit: null, belowMinimum: false, minimumRequired: null, minimumTemplateName: null });

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const bonusTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastGoodMarginRef = useRef(0);

  // ── Data loading ──
  const loadWallet = useCallback(async () => {
    const uid = user?.oderId || user?.id;
    if (!uid) return;
    try {
      const [walRes, txRes] = await Promise.all([
        walletAPI.getUserWallet(uid),
        walletAPI.getTransactions(uid),
      ]);
      if (walRes.data?.wallet) setWallet(walRes.data.wallet);
      if (walRes.data?.walletINR) setWalletINR(walRes.data.walletINR);
      if (txRes.data?.transactions) setTransactions(txRes.data.transactions);
    } catch (_) {}
  }, [user?.id, user?.oderId]);

  const loadPositions = useCallback(async () => {
    const uid = user?.oderId || user?.id;
    if (!uid) return;
    try {
      const res = await tradingAPI.getAllPositions(uid);
      if (res.data?.positions) {
        setPositions(res.data.positions.filter((p: any) => p.status === 'open' || p.status === 'active' || !p.status));
      }
    } catch (_) {}
  }, [user?.id, user?.oderId]);

  const loadPaymentMethods = useCallback(async () => {
    const uid = user?.oderId || user?.id;
    if (!uid) return;
    try {
      const [pmRes, bankRes] = await Promise.all([
        walletAPI.getPaymentMethods(uid),
        walletAPI.getSavedBankAccounts(uid),
      ]);
      if (pmRes.data?.success) {
        setPaymentMethods({
          bankAccounts: pmRes.data.bankAccounts || [],
          upiIds: pmRes.data.upiIds || [],
          cryptoWallets: pmRes.data.cryptoWallets || [],
        });
      }
      if (bankRes.data?.success && bankRes.data?.bankAccounts) {
        setSavedBanks(bankRes.data.bankAccounts);
      }
    } catch (_) {}
  }, [user?.id, user?.oderId]);

  useEffect(() => {
    loadWallet();
    loadPositions();
    loadPaymentMethods();
    // Poll wallet + positions every 5s (matches web)
    pollRef.current = setInterval(() => { loadWallet(); loadPositions(); }, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadWallet, loadPositions, loadPaymentMethods]);

  // Re-fetch positions on position update from socket
  useEffect(() => {
    const unsub = onPositionUpdate(() => { loadPositions(); });
    return unsub;
  }, [onPositionUpdate, loadPositions]);

  // Debounced eligible bonus fetch (matches web Fix 21c)
  useEffect(() => {
    const reset = { amount: 0, templateName: null, isFirstDeposit: null, belowMinimum: false, minimumRequired: null, minimumTemplateName: null };
    if (activeTab !== 'deposit') { setEligibleBonus(reset); return; }
    const numAmt = parseFloat(amount);
    if (!(numAmt > 0)) { setEligibleBonus(reset); return; }
    const uid = user?.oderId || user?.id;
    if (!uid) return;
    const inrAmount = numAmt;
    if (bonusTimerRef.current) clearTimeout(bonusTimerRef.current);
    bonusTimerRef.current = setTimeout(async () => {
      try {
        const res = await walletAPI.getEligibleBonus(uid, inrAmount);
        if (res.data?.success) {
          setEligibleBonus({
            amount: Number(res.data.bonus) || 0,
            templateName: res.data.templateName || null,
            isFirstDeposit: res.data.isFirstDeposit ?? null,
            belowMinimum: !!res.data.belowMinimum,
            minimumRequired: res.data.minimumRequired != null ? Number(res.data.minimumRequired) : null,
            minimumTemplateName: res.data.minimumTemplateName || null,
          });
        }
      } catch (_) { setEligibleBonus(reset); }
    }, 300);
    return () => { if (bonusTimerRef.current) clearTimeout(bonusTimerRef.current); };
  }, [amount, activeTab, user?.id, user?.oderId]);

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([loadWallet(), loadPaymentMethods(), refreshUser()]);
    setRefreshing(false);
  };

  // ── Live PnL + equity calculation (mirrors web UserLayout) ──
  const n = (v: any) => Number(v || 0);
  const bal = n(wallet?.balance ?? user?.wallet?.balance);
  const cr = n(wallet?.credit);

  // Compute floating PnL from positions + live prices
  let totalPnL = 0;
  let totalMargin = 0;
  positions.forEach((pos: any) => {
    if (pos.status === 'closed') return;
    totalMargin += n(pos.marginUsed || pos.margin);
    const sym = pos.symbol || '';
    const lp = prices[sym];
    if (!lp || (!lp.bid && !lp.ask)) return;
    const curPrice = n(pos.side === 'buy' ? lp.bid : lp.ask);
    const entryPrice = n(pos.entryPrice || pos.avgPrice);
    const priceDiff = pos.side === 'buy' ? curPrice - entryPrice : entryPrice - curPrice;
    // Detect Indian instruments
    const ex = (pos.exchange || '').toUpperCase();
    const isIndian = ex === 'NSE' || ex === 'BSE' || ex === 'NFO' || ex === 'BFO' || ex === 'MCX' ||
      sym.includes('NIFTY') || sym.includes('BANKNIFTY') || sym.includes('SENSEX');
    let pnl: number;
    if (isIndian) {
      const qty = n(pos.quantity || (pos.volume * (pos.lotSize || 1)));
      pnl = priceDiff * qty;
    } else {
      const vol = n(pos.volume);
      let cs = 100000; // Forex default
      if (sym.includes('BTC') || sym.includes('ETH')) cs = 1;
      else if (sym === 'XAUUSD' || sym === 'XPTUSD') cs = 100;
      else if (sym === 'XAGUSD') cs = 5000;
      else if (sym.includes('US100') || sym.includes('US30') || sym.includes('US2000')) cs = 1;
      pnl = sym.includes('JPY') ? (priceDiff * 100000 * vol) / 100 : priceDiff * cs * vol;
    }
    if (!isNaN(pnl) && isFinite(pnl)) totalPnL += pnl;
  });

  // Anti-flicker: keep last good margin if we have positions but margin calculated as 0
  if (totalMargin > 0) lastGoodMarginRef.current = totalMargin;
  const effectiveMargin = (totalMargin === 0 && positions.length > 0 && lastGoodMarginRef.current > 0)
    ? lastGoodMarginRef.current : totalMargin;

  const mg = positions.length > 0 ? effectiveMargin : n(wallet?.margin);
  const eq = bal + cr + totalPnL;
  const fm = Math.max(0, eq - mg);

  // INR-only formatter
  const fmtINR = (v: number) => `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // ── Submit deposit/withdrawal ──
  const handleSubmit = async () => {
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) { Alert.alert('Error', 'Enter a valid amount'); return; }

    if (activeTab === 'deposit' && !selectedPaymentMethod) {
      Alert.alert('Error', 'Please select a payment method');
      return;
    }
    if (activeTab === 'deposit' && !proofImage) {
      Alert.alert('Error', 'Please upload payment proof screenshot');
      return;
    }
    if (activeTab === 'withdrawal') {
      if (numAmount > fm) {
        Alert.alert('Error', `Amount exceeds free margin (${fmtINR(fm)})`);
        return;
      }
      if ((withdrawMethod === 'bank' || withdrawMethod === 'upi') &&
        (!bankDetails.bankName || !bankDetails.accountNumber || !bankDetails.ifsc || !bankDetails.accountHolder)) {
        Alert.alert('Error', 'Fill all bank details');
        return;
      }
      if (withdrawMethod === 'crypto' && (!cryptoDetails.network || !cryptoDetails.address)) {
        Alert.alert('Error', 'Fill crypto wallet details');
        return;
      }
    }

    setSubmitting(true);
    try {
      let withdrawalInfo: any = null;
      if (activeTab === 'withdrawal') {
        withdrawalInfo = {
          method: withdrawMethod,
          ...((withdrawMethod === 'bank' || withdrawMethod === 'upi') && { bankDetails }),
          ...(withdrawMethod === 'crypto' && { cryptoDetails }),
        };
      }

      await walletAPI.submitTransaction({
        oderId: user?.oderId,
        userId: user?.id,
        userName: user?.name || 'User',
        type: activeTab,
        amount: numAmount,
        currency,
        method: activeTab === 'deposit' ? selectedPaymentMethod : withdrawMethod,
        proofImage: activeTab === 'deposit' ? proofImage : null,
        transactionId: activeTab === 'deposit' ? transactionId : null,
        withdrawalInfo,
      });

      Alert.alert('Success', `${activeTab === 'deposit' ? 'Deposit' : 'Withdrawal'} request submitted!`);
      setAmount('');
      setSelectedPaymentMethod('');
      setProofImage(null);
      setTransactionId('');
      setBankDetails({ bankName: '', accountNumber: '', ifsc: '', accountHolder: '' });
      setCryptoDetails({ network: '', address: '' });
      loadWallet();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Payment method display helper ──
  const allMethods = [
    ...paymentMethods.bankAccounts.map((b: any) => ({ id: b._id, label: `${b.bankName} - ****${b.accountNumber?.slice(-4)}`, type: 'bank', data: b })),
    ...paymentMethods.upiIds.map((u: any) => ({ id: u._id, label: `UPI: ${u.upiId}`, type: 'upi', data: u })),
    ...paymentMethods.cryptoWallets.map((c: any) => ({ id: c._id, label: `${c.network} - ${c.address?.slice(0, 12)}...`, type: 'crypto', data: c })),
  ];
  const selectedMethodObj = allMethods.find(m => m.id === selectedPaymentMethod);

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg0 }]} edges={['top']}>
      {/* Back header */}
      <View style={[styles.backHeader, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="arrow-back" size={24} color={colors.t1} />
        </TouchableOpacity>
        <Text style={{ color: colors.t1, fontSize: 18, fontWeight: '700', flex: 1, textAlign: 'center' }}>Wallet</Text>
        <View style={{ width: 24 }} />
      </View>

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 130 }}
      >
        {/* ── HERO BALANCE CARD (INR only) ── */}
        <View style={[styles.heroCard, { backgroundColor: colors.blue }]}>
          <View style={{ marginBottom: 12 }}>
            <Text style={{ color: '#fff', fontSize: 16, fontWeight: '700' }}>Balance (₹)</Text>
          </View>
          <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#fff', fontSize: 28, fontWeight: '800', marginBottom: 14 }}>
            {fmtINR(bal)}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
            {[
              { label: 'Equity',      val: fmtINR(eq) },
              { label: 'Margin',      val: fmtINR(mg) },
              { label: 'Free Margin', val: fmtINR(fm) },
              { label: 'Credit',      val: fmtINR(cr) },
            ].map((s, i) => (
              <View key={i} style={{ width: '47%' as any }}>
                <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>{s.label}</Text>
                <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: '#fff', fontSize: 14, fontWeight: '700' }}>{s.val}</Text>
              </View>
            ))}
          </View>
          {totalPnL !== 0 && (
            <View style={{ borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.15)', paddingTop: 10 }}>
              <Text style={{ color: 'rgba(255,255,255,0.6)', fontSize: 10 }}>Floating P/L</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={{ color: totalPnL >= 0 ? '#4ade80' : '#f87171', fontSize: 14, fontWeight: '700' }}>
                {totalPnL >= 0 ? '+' : ''}{fmtINR(totalPnL)}
              </Text>
            </View>
          )}
        </View>

        {/* ── DEPOSIT / WITHDRAWAL FORM ── */}
        <View style={[styles.section, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          {/* Tab toggle */}
          <View style={[styles.formTabs, { backgroundColor: colors.bg3 }]}>
            <TouchableOpacity style={[styles.formTab, activeTab === 'deposit' && { backgroundColor: colors.blue }]} onPress={() => setActiveTab('deposit')}>
              <Text style={{ color: activeTab === 'deposit' ? '#fff' : colors.t3, fontSize: 13, fontWeight: '600' }}>Deposit</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.formTab, activeTab === 'withdrawal' && { backgroundColor: colors.blue }]} onPress={() => setActiveTab('withdrawal')}>
              <Text style={{ color: activeTab === 'withdrawal' ? '#fff' : colors.t3, fontSize: 13, fontWeight: '600' }}>Withdrawal</Text>
            </TouchableOpacity>
          </View>

          {/* Withdrawal info bar */}
          {activeTab === 'withdrawal' && (
            <View style={[styles.infoBar, { backgroundColor: mg > 0 ? 'rgba(245,158,11,0.12)' : 'rgba(16,185,129,0.12)', borderColor: mg > 0 ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)' }]}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}>
                <Text style={{ color: colors.t3, fontSize: 12 }}>Available for Withdrawal</Text>
                <Text style={{ color: mg > 0 ? '#f59e0b' : '#10b981', fontSize: 14, fontWeight: '700' }}>
                  {fmtINR(fm)}
                </Text>
              </View>
              {mg > 0 && (
                <Text style={{ color: '#f59e0b', fontSize: 10 }}>You have active trades. Only free margin can be withdrawn.</Text>
              )}
            </View>
          )}

          {/* Amount input */}
          <Text style={[styles.fieldLabel, { color: colors.t3 }]}>Amount (₹)</Text>
          <TextInput
            style={[styles.amountInput, { backgroundColor: colors.bg3, borderColor: colors.border, color: colors.t1 }]}
            placeholder={activeTab === 'withdrawal'
              ? `Max: ${fmtINR(fm)}`
              : 'Enter amount in ₹'}
            placeholderTextColor={colors.t3}
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={setAmount}
          />

          {/* Eligible bonus hint (matches web Fix 21c) */}
          {activeTab === 'deposit' && amount && parseFloat(amount) > 0 && eligibleBonus.amount > 0 && (
            <View style={[styles.bonusCard, { backgroundColor: 'rgba(251,191,36,0.1)', borderColor: 'rgba(251,191,36,0.4)' }]}>
              <Ionicons name="gift-outline" size={18} color="#fbbf24" />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 4 }}>
                  <Text style={{ color: '#fbbf24', fontSize: 13, fontWeight: '700' }}>Eligible bonus: ₹{eligibleBonus.amount.toFixed(2)}</Text>
                  {eligibleBonus.templateName && (
                    <Text style={{ color: '#fbbf24', fontSize: 11, opacity: 0.85 }}>({eligibleBonus.templateName})</Text>
                  )}
                  {eligibleBonus.isFirstDeposit && (
                    <View style={{ backgroundColor: 'rgba(251,191,36,0.25)', paddingHorizontal: 6, paddingVertical: 1, borderRadius: 4 }}>
                      <Text style={{ color: '#fbbf24', fontSize: 9, fontWeight: '700' }}>FIRST DEPOSIT</Text>
                    </View>
                  )}
                </View>
                <Text style={{ color: '#9ca3af', fontSize: 10, marginTop: 4, lineHeight: 14 }}>
                  Auto-credited to bonus credit when admin approves. Credit boosts Free Margin; not directly withdrawable.
                </Text>
              </View>
            </View>
          )}
          {activeTab === 'deposit' && amount && parseFloat(amount) > 0 && eligibleBonus.amount === 0 && eligibleBonus.belowMinimum && eligibleBonus.minimumRequired != null && (
            <View style={[styles.bonusCard, { backgroundColor: 'rgba(100,116,139,0.12)', borderColor: 'rgba(100,116,139,0.35)' }]}>
              <Ionicons name="information-circle-outline" size={18} color="#94a3b8" />
              <View style={{ flex: 1, marginLeft: 8 }}>
                <Text style={{ color: '#94a3b8', fontSize: 12, fontWeight: '600' }}>
                  Deposit at least ₹{eligibleBonus.minimumRequired.toLocaleString('en-IN')} to qualify for a bonus
                </Text>
                {eligibleBonus.minimumTemplateName && (
                  <Text style={{ color: '#94a3b8', fontSize: 11, opacity: 0.85 }}>({eligibleBonus.minimumTemplateName})</Text>
                )}
              </View>
            </View>
          )}

          {/* ── Deposit: Payment Method ── */}
          {activeTab === 'deposit' && (
            <>
              <Text style={[styles.fieldLabel, { color: colors.t3 }]}>Payment Method</Text>
              {allMethods.length === 0 ? (
                <Text style={{ color: colors.t3, fontSize: 12, fontStyle: 'italic' }}>No payment methods available</Text>
              ) : (
                <View style={{ gap: 6 }}>
                  {allMethods.map(m => (
                    <TouchableOpacity
                      key={m.id}
                      style={[styles.methodBtn, { borderColor: selectedPaymentMethod === m.id ? colors.blue : colors.border, backgroundColor: selectedPaymentMethod === m.id ? colors.blueDim : 'transparent' }]}
                      onPress={() => setSelectedPaymentMethod(m.id)}
                    >
                      <Ionicons name={m.type === 'bank' ? 'business-outline' : m.type === 'upi' ? 'phone-portrait-outline' : 'logo-bitcoin'} size={16} color={selectedPaymentMethod === m.id ? colors.blue : colors.t3} />
                      <Text style={{ color: selectedPaymentMethod === m.id ? colors.blue : colors.t1, fontSize: 12, flex: 1, marginLeft: 8 }}>{m.label}</Text>
                      {selectedPaymentMethod === m.id && <Ionicons name="checkmark-circle" size={16} color={colors.blue} />}
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Show selected method details */}
              {selectedMethodObj && (
                <View style={[styles.detailBox, { borderColor: colors.border, backgroundColor: colors.bg3 }]}>
                  <Text style={{ color: colors.t1, fontSize: 12, fontWeight: '600', marginBottom: 6 }}>Payment Details</Text>
                  {selectedMethodObj.type === 'bank' && (
                    <>
                      <Text style={{ color: colors.t3, fontSize: 11 }}>Bank: {selectedMethodObj.data.bankName}</Text>
                      <Text style={{ color: colors.t3, fontSize: 11 }}>A/C: {selectedMethodObj.data.accountNumber}</Text>
                      <Text style={{ color: colors.t3, fontSize: 11 }}>IFSC: {selectedMethodObj.data.ifsc}</Text>
                      <Text style={{ color: colors.t3, fontSize: 11 }}>Name: {selectedMethodObj.data.accountHolder}</Text>
                    </>
                  )}
                  {selectedMethodObj.type === 'upi' && (
                    <>
                      <Text style={{ color: colors.t3, fontSize: 11 }}>UPI: {selectedMethodObj.data.upiId}</Text>
                      <Text style={{ color: colors.t3, fontSize: 11 }}>Name: {selectedMethodObj.data.name}</Text>
                    </>
                  )}
                  {selectedMethodObj.type === 'crypto' && (
                    <>
                      <Text style={{ color: colors.t3, fontSize: 11 }}>Network: {selectedMethodObj.data.network}</Text>
                      <Text style={{ color: colors.t3, fontSize: 10 }}>Address: {selectedMethodObj.data.address}</Text>
                    </>
                  )}
                </View>
              )}

              {/* Transaction ID / UTR */}
              <Text style={[styles.fieldLabel, { color: colors.t3 }]}>Transaction ID / UTR Number</Text>
              <TextInput
                style={[styles.amountInput, { backgroundColor: colors.bg3, borderColor: colors.border, color: colors.t1, fontSize: 13 }]}
                placeholder="Enter transaction ID or UTR number"
                placeholderTextColor={colors.t3}
                value={transactionId}
                onChangeText={setTransactionId}
              />
              <Text style={{ color: colors.t3, fontSize: 10, marginTop: 2 }}>Optional: for faster verification</Text>

              {/* Upload Payment Proof */}
              <Text style={[styles.fieldLabel, { color: colors.t3 }]}>Upload Payment Proof *</Text>
              <TouchableOpacity
                style={[styles.uploadArea, { borderColor: proofImage ? colors.blue : colors.border, backgroundColor: proofImage ? colors.blueDim : colors.bg3 }]}
                activeOpacity={0.7}
                onPress={async () => {
                  const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
                  if (status !== 'granted') {
                    Alert.alert('Permission needed', 'Please allow photo library access to upload proof.');
                    return;
                  }
                  const result = await ImagePicker.launchImageLibraryAsync({
                    mediaTypes: ['images'],
                    quality: 0.7,
                    base64: true,
                    allowsEditing: false,
                  });
                  if (!result.canceled && result.assets?.[0]) {
                    const asset = result.assets[0];
                    const base64 = asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
                    setProofImage(base64);
                  }
                }}
              >
                {proofImage ? (
                  <Image source={{ uri: proofImage }} style={styles.proofPreview} resizeMode="contain" />
                ) : (
                  <View style={{ alignItems: 'center', gap: 6, paddingVertical: 16 }}>
                    <Ionicons name="camera-outline" size={28} color={colors.t3} />
                    <Text style={{ color: colors.t3, fontSize: 12 }}>Tap to upload screenshot</Text>
                  </View>
                )}
              </TouchableOpacity>
              {proofImage && (
                <TouchableOpacity onPress={() => setProofImage(null)} style={{ marginTop: 4 }}>
                  <Text style={{ color: colors.red, fontSize: 11, fontWeight: '600' }}>Remove image</Text>
                </TouchableOpacity>
              )}
            </>
          )}

          {/* ── Withdrawal: Method + Details ── */}
          {activeTab === 'withdrawal' && (
            <>
              <Text style={[styles.fieldLabel, { color: colors.t3 }]}>Withdrawal Method</Text>
              <View style={{ flexDirection: 'row', gap: 6, marginBottom: 10 }}>
                {([
                  { key: 'bank' as WithdrawMethod, icon: 'business-outline' as const, label: 'Bank' },
                  { key: 'upi' as WithdrawMethod, icon: 'phone-portrait-outline' as const, label: 'UPI' },
                  { key: 'crypto' as WithdrawMethod, icon: 'logo-bitcoin' as const, label: 'Crypto' },
                ]).map(m => (
                  <TouchableOpacity
                    key={m.key}
                    style={[styles.wMethodBtn, { borderColor: withdrawMethod === m.key ? colors.blue : colors.border, backgroundColor: withdrawMethod === m.key ? colors.blueDim : 'transparent' }]}
                    onPress={() => setWithdrawMethod(m.key)}
                  >
                    <Ionicons name={m.icon} size={14} color={withdrawMethod === m.key ? colors.blue : colors.t3} />
                    <Text style={{ color: withdrawMethod === m.key ? colors.blue : colors.t3, fontSize: 11, fontWeight: '600', marginLeft: 4 }}>{m.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              {/* Saved bank accounts */}
              {(withdrawMethod === 'bank' || withdrawMethod === 'upi') && savedBanks.length > 0 && (
                <View style={{ marginBottom: 8 }}>
                  <Text style={{ color: colors.t3, fontSize: 10, marginBottom: 4 }}>Saved Accounts</Text>
                  {savedBanks.map((b: any) => (
                    <TouchableOpacity
                      key={b._id}
                      style={[styles.methodBtn, { borderColor: colors.border, marginBottom: 4 }]}
                      onPress={() => setBankDetails({ bankName: b.bankName, accountNumber: b.accountNumber, ifsc: b.ifsc, accountHolder: b.accountHolder })}
                    >
                      <Ionicons name="card-outline" size={14} color={colors.t3} />
                      <Text style={{ color: colors.t1, fontSize: 11, flex: 1, marginLeft: 8 }}>{b.bankName} - ****{b.accountNumber?.slice(-4)}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}

              {/* Bank / UPI details form */}
              {(withdrawMethod === 'bank' || withdrawMethod === 'upi') && (
                <View style={{ gap: 8 }}>
                  {[
                    { key: 'bankName', label: 'Bank Name *', ph: 'Bank name' },
                    { key: 'accountHolder', label: 'Account Holder *', ph: 'Account holder name' },
                    { key: 'accountNumber', label: 'Account Number *', ph: 'Account number' },
                    { key: 'ifsc', label: 'IFSC Code *', ph: 'IFSC code' },
                  ].map(f => (
                    <View key={f.key}>
                      <Text style={{ color: colors.t3, fontSize: 10, fontWeight: '600', marginBottom: 2 }}>{f.label}</Text>
                      <TextInput
                        style={[styles.amountInput, { backgroundColor: colors.bg3, borderColor: colors.border, color: colors.t1, fontSize: 13 }]}
                        placeholder={f.ph}
                        placeholderTextColor={colors.t3}
                        value={(bankDetails as any)[f.key]}
                        onChangeText={v => setBankDetails(prev => ({ ...prev, [f.key]: f.key === 'ifsc' ? v.toUpperCase() : v }))}
                      />
                    </View>
                  ))}
                </View>
              )}

              {/* Crypto details form */}
              {withdrawMethod === 'crypto' && (
                <View style={{ gap: 8 }}>
                  <View>
                    <Text style={{ color: colors.t3, fontSize: 10, fontWeight: '600', marginBottom: 2 }}>Network *</Text>
                    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                      {['BTC', 'ETH', 'USDT-TRC20', 'USDT-ERC20', 'SOL'].map(net => (
                        <TouchableOpacity
                          key={net}
                          style={[styles.wMethodBtn, { borderColor: cryptoDetails.network === net ? colors.blue : colors.border, backgroundColor: cryptoDetails.network === net ? colors.blueDim : 'transparent' }]}
                          onPress={() => setCryptoDetails(p => ({ ...p, network: net }))}
                        >
                          <Text style={{ color: cryptoDetails.network === net ? colors.blue : colors.t3, fontSize: 10, fontWeight: '600' }}>{net}</Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  </View>
                  <View>
                    <Text style={{ color: colors.t3, fontSize: 10, fontWeight: '600', marginBottom: 2 }}>Wallet Address *</Text>
                    <TextInput
                      style={[styles.amountInput, { backgroundColor: colors.bg3, borderColor: colors.border, color: colors.t1, fontSize: 13 }]}
                      placeholder="Enter wallet address"
                      placeholderTextColor={colors.t3}
                      value={cryptoDetails.address}
                      onChangeText={v => setCryptoDetails(p => ({ ...p, address: v }))}
                    />
                  </View>
                </View>
              )}
            </>
          )}

          {/* Submit */}
          <TouchableOpacity
            style={[styles.submitBtn, { backgroundColor: activeTab === 'deposit' ? colors.green : colors.red, opacity: submitting ? 0.6 : 1 }]}
            activeOpacity={0.8}
            onPress={handleSubmit}
            disabled={submitting}
          >
            {submitting
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={{ color: '#fff', fontWeight: '700', fontSize: 14 }}>
                  Submit {activeTab === 'deposit' ? 'Deposit' : 'Withdrawal'} Request
                </Text>
            }
          </TouchableOpacity>
        </View>

        {/* ── TRANSACTION HISTORY ── */}
        <View style={[styles.section, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '700', marginBottom: 12 }}>Transaction History</Text>
          {transactions.length === 0 ? (
            <Text style={{ color: colors.t3, textAlign: 'center', paddingVertical: 24, fontSize: 13 }}>No transactions yet</Text>
          ) : (
            transactions.map((tx: any, i: number) => {
              const isDep = tx.type === 'deposit';
              const stColor = tx.status === 'approved' ? colors.green : tx.status === 'pending' ? colors.amber : colors.red;
              const bonusAmt = Number(tx.bonusAmount) || 0;
              return (
                <View key={tx._id || i} style={[styles.txRow, { borderBottomColor: i < transactions.length - 1 ? colors.border : 'transparent' }]}>
                  <View style={[styles.txIcon, { backgroundColor: isDep ? colors.greenDim : colors.redDim }]}>
                    <Text style={{ color: isDep ? colors.green : colors.red, fontSize: 14, fontWeight: '700' }}>{isDep ? '↓' : '↑'}</Text>
                  </View>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      <Text style={{ color: colors.t1, fontSize: 13, fontWeight: '600' }}>{isDep ? 'Deposit' : 'Withdrawal'}</Text>
                      {bonusAmt > 0 && <Text style={{ color: '#fbbf24', fontSize: 9, fontWeight: '700' }}>+₹{bonusAmt.toFixed(2)} BONUS</Text>}
                    </View>
                    <Text style={{ color: colors.t3, fontSize: 10 }}>{new Date(tx.createdAt).toLocaleDateString()}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end' }}>
                    <Text style={{ color: isDep ? colors.green : colors.red, fontSize: 14, fontWeight: '700' }}>
                      {isDep ? '+' : '-'}{tx.currency === 'INR' ? '₹' : '$'}{(tx.amount || 0).toFixed(2)}
                    </Text>
                    <View style={[styles.statusBadge, { backgroundColor: `${stColor}18` }]}>
                      <Text style={{ color: stColor, fontSize: 9, fontWeight: '600' }}>{tx.status}</Text>
                    </View>
                  </View>
                </View>
              );
            })
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  backHeader: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1 },
  section: { margin: 12, marginBottom: 0, borderRadius: 12, padding: 16, borderWidth: 1 },

  // Hero
  heroCard: { margin: 12, marginBottom: 0, borderRadius: 14, padding: 18 },
  heroCurrBtn: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 6, borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)' },
  heroCurrActive: { backgroundColor: 'rgba(255,255,255,0.2)', borderColor: '#fff' },


  // Form
  formTabs: { flexDirection: 'row' as const, borderRadius: 10, padding: 3 },
  formTab: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center' as const },
  fieldLabel: { fontSize: 11, fontWeight: '600', textTransform: 'uppercase' as const, marginTop: 14, marginBottom: 6 },
  currBtn: { flex: 1, paddingVertical: 12, borderRadius: 8, borderWidth: 1, alignItems: 'center' as const },
  amountInput: { borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15, borderWidth: 1 },
  submitBtn: { marginTop: 16, paddingVertical: 14, borderRadius: 10, alignItems: 'center' as const },
  infoBar: { borderRadius: 10, padding: 12, borderWidth: 1, marginTop: 12 },
  methodBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: 10, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1 },
  wMethodBtn: { flexDirection: 'row' as const, alignItems: 'center' as const, paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1 },
  detailBox: { borderRadius: 10, padding: 12, borderWidth: 1, marginTop: 8, gap: 3 },
  bonusCard: { flexDirection: 'row' as const, borderRadius: 8, padding: 12, borderWidth: 1, marginTop: 8, alignItems: 'flex-start' as const },
  uploadArea: { borderRadius: 10, borderWidth: 1, borderStyle: 'dashed' as const, alignItems: 'center' as const, justifyContent: 'center' as const, minHeight: 100, overflow: 'hidden' as const },
  proofPreview: { width: '100%' as any, height: 180, borderRadius: 8 },

  // Transactions
  txRow: { flexDirection: 'row' as const, alignItems: 'center' as const, gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  txIcon: { width: 36, height: 36, borderRadius: 10, alignItems: 'center' as const, justifyContent: 'center' as const },
  statusBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4, marginTop: 3 },
});

export default WalletScreen;
