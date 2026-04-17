import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList,
  RefreshControl, Alert, TextInput, Modal, ScrollView, ActivityIndicator,
  KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { useTheme } from '../../theme/ThemeContext';
import { tradingAPI, walletAPI } from '../../services/api';
import AppHeader from '../../components/AppHeader';
import MobileStatusFooter from '../../components/MobileStatusFooter';
import { useUsdInr } from '../../hooks/useUsdInr';

// Indian instrument detector (Zerodha categories or exchange)
const INDIAN_EXCHANGES = new Set(['NSE', 'BSE', 'NFO', 'BFO', 'MCX']);
function isIndianPos(pos: any): boolean {
  const ex = (pos?.exchange || '').toUpperCase();
  if (INDIAN_EXCHANGES.has(ex)) return true;
  const seg = (pos?.segment || '').toLowerCase();
  if (seg.startsWith('nse') || seg.startsWith('bse') || seg.startsWith('mcx') || seg.startsWith('nfo') || seg.startsWith('bfo')) return true;
  return false;
}

// Mode badge: N=Netting, H=Hedging, B=Binary
const MODE_META: Record<string, { letter: string; color: string; bg: string }> = {
  netting: { letter: 'N', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
  hedging: { letter: 'H', color: '#a855f7', bg: 'rgba(168,85,247,0.15)' },
  binary:  { letter: 'B', color: '#f59e0b', bg: 'rgba(245,158,11,0.15)' },
};

/* ================================================================
   OrdersScreen — matches web mobile orders page
   Header → Date filters → 4-tab pill bar → Card list
   ================================================================ */

type TabKey = 'open' | 'pending' | 'history' | 'cancelled';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'pending', label: 'Pending' },
  { key: 'history', label: 'History' },
  { key: 'cancelled', label: 'Cancelled' },
];

const OrdersScreen: React.FC = () => {
  const { user } = useAuth();
  const { prices, isConnected, onPositionUpdate } = useSocket();
  const { colors } = useTheme();
  const insets = useSafeAreaInsets();
  // Guarantees at least 16px clearance above Android's 3-button / gesture nav.
  const bottomPad = Math.max(insets.bottom, 16);
  const [tab, setTab] = useState<TabKey>('open');
  const [positions, setPositions] = useState<any[]>([]);
  const [pendingOrders, setPendingOrders] = useState<any[]>([]);
  const [history, setHistory] = useState<any[]>([]);
  const [cancelled, setCancelled] = useState<any[]>([]);
  const [refreshing, setRefreshing] = useState(false);

  // Edit SL/TP modal
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [editingPos, setEditingPos] = useState<any>(null);
  const [editSL, setEditSL] = useState('');
  const [editTP, setEditTP] = useState('');
  const [editLoading, setEditLoading] = useState(false);

  // Close position modal
  const [closeModalOpen, setCloseModalOpen] = useState(false);
  const [closingPos, setClosingPos] = useState<any>(null);
  const [closeVolume, setCloseVolume] = useState('');
  const [closeLoading, setCloseLoading] = useState(false);

  // Netting entries modal
  const [legsModalOpen, setLegsModalOpen] = useState(false);
  const [legsPosition, setLegsPosition] = useState<any>(null);
  const [legsData, setLegsData] = useState<any[]>([]);
  const [legsLoading, setLegsLoading] = useState(false);

  // Per-leg SL/TP edit modal
  const [legEditOpen, setLegEditOpen] = useState(false);
  const [legBeingEdited, setLegBeingEdited] = useState<any>(null);
  const [legEditSL, setLegEditSL] = useState('');
  const [legEditTP, setLegEditTP] = useState('');
  const [legEditLoading, setLegEditLoading] = useState(false);

  // Footer / currency toggle
  const [displayCurrency, setDisplayCurrency] = useState<'USD' | 'INR'>('INR');
  // Native per-currency balances (same source as Market + Wallet pages) so
  // the Orders footer shows the exact ₹ the user deposited — no FX drift.
  const [walletINR, setWalletINR] = useState<{ balance: number }>({ balance: 0 });
  const [walletUSD, setWalletUSD] = useState<{ balance: number }>({ balance: 0 });
  const { rate: effectiveRate } = useUsdInr();

  useEffect(() => {
    const uid = user?.oderId || user?.id;
    if (!uid) return;
    walletAPI.getUserWallet(uid)
      .then(res => {
        if (res.data?.walletINR) setWalletINR(res.data.walletINR);
        if (res.data?.walletUSD) setWalletUSD(res.data.walletUSD);
      })
      .catch(() => {});
  }, [user?.id, user?.oderId]);

  // Web-parity P/L formatter — converts USD↔INR based on displayCurrency.
  // Server stores Indian profits in INR, international in USD.
  const formatPnl = useCallback((pnl: number, pos: any) => {
    const sign = pnl >= 0 ? '+' : '-';
    const abs = Math.abs(pnl);
    const indian = isIndianPos(pos);
    if (indian) {
      return displayCurrency === 'USD'
        ? `${sign}$${(abs / effectiveRate).toFixed(2)}`
        : `${sign}₹${abs.toFixed(2)}`;
    }
    return displayCurrency === 'INR'
      ? `${sign}₹${(abs * effectiveRate).toFixed(2)}`
      : `${sign}$${abs.toFixed(2)}`;
  }, [displayCurrency, effectiveRate]);

  const formatTotalPnl = useCallback((totalUsd: number) => {
    const sign = totalUsd >= 0 ? '+' : '-';
    const abs = Math.abs(totalUsd);
    return displayCurrency === 'INR'
      ? `${sign}₹${(abs * effectiveRate).toFixed(2)}`
      : `${sign}$${abs.toFixed(2)}`;
  }, [displayCurrency, effectiveRate]);

  useEffect(() => { loadData(); }, [user?.id]);

  // Re-fetch on socket position updates
  useEffect(() => {
    const unsub = onPositionUpdate(() => { loadData(); });
    return unsub;
  }, [onPositionUpdate]);

  const loadData = async () => {
    if (!user?.id && !user?.oderId) return;
    const uid = user?.oderId || user?.id;
    try {
      const [posRes, pendRes, histRes] = await Promise.all([
        tradingAPI.getAllPositions(uid),
        tradingAPI.getPendingOrders(uid),
        tradingAPI.getTradeHistory(uid),
      ]);
      if (posRes.data?.positions) setPositions(posRes.data.positions);
      if (pendRes.data?.orders) setPendingOrders(pendRes.data.orders);
      if (histRes.data?.trades) setHistory(histRes.data.trades);
    } catch (_) {}
  };

  const onRefresh = async () => { setRefreshing(true); await loadData(); setRefreshing(false); };

  const openEditModal = (pos: any) => {
    setEditingPos(pos);
    setEditSL(pos.stopLoss ? String(pos.stopLoss) : '');
    setEditTP(pos.takeProfit ? String(pos.takeProfit) : '');
    setEditModalOpen(true);
  };

  const handleModify = async () => {
    if (!editingPos) return;
    setEditLoading(true);
    try {
      const uid = user?.oderId || user?.id || '';
      await tradingAPI.modifyPosition({
        userId: uid,
        positionId: editingPos.oderId || editingPos._id,
        symbol: editingPos.symbol,
        stopLoss: editSL ? parseFloat(editSL) : undefined,
        takeProfit: editTP ? parseFloat(editTP) : undefined,
      });
      setEditModalOpen(false);
      loadData();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    } finally {
      setEditLoading(false);
    }
  };

  const openCloseModal = (pos: any) => {
    setClosingPos(pos);
    setCloseVolume(String(pos.volume || 0));
    setCloseModalOpen(true);
  };

  const handleClose = async () => {
    if (!closingPos) return;
    setCloseLoading(true);
    try {
      const uid = user?.oderId || user?.id || '';
      const lp = prices[closingPos.symbol];
      const closePrice = closingPos.side === 'buy' ? (lp?.bid || 0) : (lp?.ask || 0);
      await tradingAPI.closePosition({
        userId: uid,
        symbol: closingPos.symbol,
        volume: parseFloat(closeVolume) || closingPos.volume,
        mode: closingPos.mode || 'netting',
        positionId: closingPos.oderId || closingPos._id,
        currentPrice: closePrice || undefined,
      });
      setCloseModalOpen(false);
      loadData();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    } finally {
      setCloseLoading(false);
    }
  };

  // Open Netting Entries modal — fetch legs/group children
  const openLegsModal = async (pos: any) => {
    if (pos.mode !== 'netting') return;
    const enriched = {
      ...pos,
      entryPrice: pos.entryPrice || pos.avgPrice || 0,
      currentPrice: pos.closePrice || (prices[pos.symbol]?.bid) || pos.entryPrice || 0,
      isClosed: pos.status === 'closed' || !!pos.closePrice || pos.type === 'close',
    };
    setLegsPosition(enriched);
    setLegsModalOpen(true);
    setLegsLoading(true);
    try {
      const uid = user?.oderId || user?.id || 'guest';
      if (pos.groupId) {
        const res = await tradingAPI.getTradeGroup(uid, pos.groupId);
        setLegsData(res.data?.children || []);
      } else {
        const orderId = pos.oderId || pos.tradeId || pos._id;
        const res = await tradingAPI.getTradeLegs(uid, orderId);
        setLegsData(res.data?.legs || []);
      }
    } catch (e) {
      setLegsData([]);
    } finally {
      setLegsLoading(false);
    }
  };

  const refetchLegs = async () => {
    if (!legsPosition) return;
    const uid = user?.oderId || user?.id || 'guest';
    const orderId = legsPosition.oderId || legsPosition.tradeId || legsPosition._id;
    try {
      const res = await tradingAPI.getTradeLegs(uid, orderId);
      setLegsData(res.data?.legs || []);
    } catch (_) {}
  };

  const openLegEditModal = (leg: any) => {
    setLegBeingEdited(leg);
    setLegEditSL(leg?.stopLoss != null ? String(leg.stopLoss) : '');
    setLegEditTP(leg?.takeProfit != null ? String(leg.takeProfit) : '');
    setLegEditOpen(true);
  };

  const confirmCloseLeg = (leg: any) => {
    const px = Number(legsPosition?.currentPrice || legsPosition?.entryPrice || 0);
    if (!(px > 0)) {
      Alert.alert('Error', 'No live price available to close this entry');
      return;
    }
    Alert.alert(
      'Close Entry',
      `Close ${parseFloat(Number(leg.volume || 0).toFixed(4))} lots of ${leg.symbol} at $${px.toFixed(4)}?`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Close',
          style: 'destructive',
          onPress: async () => {
            try {
              const uid = user?.oderId || user?.id || '';
              await tradingAPI.closePositionLeg({
                userId: uid,
                tradeId: leg.tradeId || leg._id,
                currentPrice: px,
                closeReason: 'user',
              });
              await refetchLegs();
              loadData();
            } catch (e: any) {
              Alert.alert('Error', e?.response?.data?.error || e.message);
            }
          },
        },
      ]
    );
  };

  const saveLegSLTP = async () => {
    if (!legBeingEdited) return;
    const uid = user?.oderId || user?.id || '';
    setLegEditLoading(true);
    try {
      await tradingAPI.updateTradeLeg(legBeingEdited.tradeId || legBeingEdited._id, {
        userId: uid,
        stopLoss: legEditSL === '' ? null : Number(legEditSL),
        takeProfit: legEditTP === '' ? null : Number(legEditTP),
      });
      setLegEditOpen(false);
      await refetchLegs();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    } finally {
      setLegEditLoading(false);
    }
  };

  const handleCancelPending = async (order: any) => {
    Alert.alert('Cancel Order', `Cancel pending ${order.symbol} order?`, [
      { text: 'No', style: 'cancel' },
      { text: 'Yes, Cancel', style: 'destructive', onPress: async () => {
        try {
          const uid = user?.oderId || user?.id || '';
          await tradingAPI.cancelPendingOrder({ userId: uid, orderId: order.oderId || order._id });
          loadData();
        } catch (e: any) { Alert.alert('Error', e?.response?.data?.error || e.message); }
      }},
    ]);
  };

  const getData = () => tab === 'open' ? positions : tab === 'pending' ? pendingOrders : tab === 'history' ? history : cancelled;

  // Live P/L from socket prices (same formula as web MarketPage calculateProfit)
  const calcLivePnl = (pos: any) => {
    const lp = prices[pos.symbol];
    if (!lp) return pos.profit || 0;
    const current = pos.side === 'buy' ? (lp.bid || 0) : (lp.ask || 0);
    const entry = pos.avgPrice || pos.entryPrice || 0;
    if (!current || !entry) return pos.profit || 0;
    const diff = pos.side === 'buy' ? current - entry : entry - current;
    const vol = pos.volume || 0;
    const sym = (pos.symbol || '').toUpperCase();
    const isIndian = ['NSE','BSE','NFO','BFO','MCX'].includes((pos.exchange||'').toUpperCase());
    if (isIndian) return diff * (pos.quantity || vol * (pos.lotSize || 1));
    let cs = 100000;
    if (sym.includes('BTC')||sym.includes('ETH')) cs = 1;
    else if (sym.includes('XAU')||sym.includes('XPTUSD')) cs = 100;
    else if (sym.includes('XAG')) cs = 5000;
    else if (sym.includes('US100')||sym.includes('US30')||sym.includes('US500')||sym.includes('NAS')) cs = 1;
    if (sym.includes('JPY')) return (diff * 100000 * vol) / 100;
    return diff * cs * vol;
  };

  const totalPnl = positions.reduce((s, p) => s + calcLivePnl(p), 0);

  const remarkColor = (r: string) => {
    if (!r) return colors.t3;
    const rl = r.toLowerCase();
    if (rl.includes('sl')) return colors.red;
    if (rl.includes('tp')) return colors.green;
    if (rl.includes('stop out')) return '#dc2626';
    if (rl.includes('auto square')) return colors.amber;
    return colors.t3;
  };

  const renderCard = ({ item: pos, index }: { item: any; index: number }) => {
    const livePnl = tab === 'open' ? calcLivePnl(pos) : (pos.profit || 0);
    const lp = prices[pos.symbol];
    const liveCurrentPrice = lp ? (pos.side === 'buy' ? (lp.bid || 0) : (lp.ask || 0)) : (pos.currentPrice || 0);
    const mode = (pos.mode || 'netting').toLowerCase();
    const modeMeta = MODE_META[mode] || MODE_META.netting;
    const isNetting = mode === 'netting';
    const showEntriesBtn = isNetting && (tab === 'open' || tab === 'history');

    return (
    <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
      <View style={styles.cardHead}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
          <View style={[styles.modeBadge, { backgroundColor: modeMeta.bg, borderColor: modeMeta.color }]}>
            <Text style={{ color: modeMeta.color, fontSize: 10, fontWeight: '800' }}>{modeMeta.letter}</Text>
          </View>
          <View style={[styles.sideBadge, { backgroundColor: pos.side === 'buy' ? colors.greenDim : colors.redDim }]}>
            <Text style={{ color: pos.side === 'buy' ? colors.green : colors.red, fontSize: 10, fontWeight: '700' }}>
              {(pos.side || 'BUY').toUpperCase()}
            </Text>
          </View>
          <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{pos.symbol}</Text>
          <Text style={{ color: colors.t3, fontSize: 11 }}>{pos.volume || 0} lots</Text>
        </View>
        {(tab === 'open' || tab === 'history') && (
          <Text style={{ color: livePnl >= 0 ? colors.green : colors.red, fontSize: 14, fontWeight: '700' }}>
            {formatPnl(livePnl, pos)}
          </Text>
        )}
      </View>

      {/* Body rows */}
      <View style={styles.cardBody}>
        <Row label="Entry" value={`${(pos.avgPrice || pos.entryPrice || 0).toFixed(2)}`} colors={colors} />
        {tab === 'open' && <Row label="Current" value={`${liveCurrentPrice.toFixed(2)}`} colors={colors} />}
        {tab === 'open' && (() => {
          // Commission: prefer native openCommissionInr, fallback to USD × live rate.
          // Server stores `openCommission` (USD) and `openCommissionInr` (native ₹)
          // at position creation. For running total (partial closes etc.), `commission`
          // holds cumulative USD. Matches web's formatCommission / getOpenPositionCommission.
          const openUsd = Number(pos.openCommission) || 0;
          const totalUsd = Number(pos.commission) || 0;
          const commUsd = openUsd > 0 ? openUsd : totalUsd;
          const commInr = Number(pos.openCommissionInr) || Number(pos.commissionInr) || 0;
          const effRate = effectiveRate || 83.5;
          const showInr = displayCurrency === 'INR';
          const indian = isIndianPos(pos);
          const displayVal = showInr
            ? (commInr > 0 ? commInr : commUsd * effRate)
            : (commInr > 0 ? commInr / effRate : commUsd);
          const sym = showInr ? '₹' : '$';
          // Swap: same pattern
          const swapUsd = Number(pos.swap) || 0;
          const swapInr = Number(pos.swapInr) || 0;
          const swapVal = showInr
            ? (swapInr !== 0 ? swapInr : swapUsd * effRate)
            : (swapInr !== 0 ? swapInr / effRate : swapUsd);
          return (
            <>
              <Row label="Commission" value={`${sym}${displayVal.toFixed(2)}`} colors={colors} />
              <Row label="Swap" value={`${sym}${swapVal.toFixed(2)}`} colors={colors} />
            </>
          );
        })()}
        {tab === 'history' && pos.closePrice != null && <Row label="Close" value={`${pos.closePrice.toFixed(2)}`} colors={colors} />}
        {tab === 'history' && pos.remark && (
          <View style={styles.infoRow}>
            <Text style={{ color: colors.t3, fontSize: 12 }}>Remark</Text>
            <Text style={{ color: remarkColor(pos.remark), fontSize: 12, fontWeight: '600' }}>{pos.remark}</Text>
          </View>
        )}
      </View>

      {/* Actions (open positions only) */}
      {tab === 'open' && (
        <View style={styles.cardActions}>
          <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.border }]} onPress={() => openEditModal(pos)}>
            <Text style={{ color: colors.t2, fontSize: 12, fontWeight: '600' }}>Edit S/L T/P</Text>
          </TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, { backgroundColor: colors.redDim, borderColor: colors.red }]} onPress={() => openCloseModal(pos)}>
            <Text style={{ color: colors.red, fontSize: 12, fontWeight: '600' }}>Close</Text>
          </TouchableOpacity>
        </View>
      )}
      {showEntriesBtn && (
        <TouchableOpacity
          style={[styles.entriesBtn, { borderColor: colors.border, backgroundColor: colors.bg3 }]}
          onPress={() => openLegsModal(pos)}
          activeOpacity={0.7}
        >
          <Ionicons name="list-outline" size={14} color={colors.blue} />
          <Text style={{ color: colors.blue, fontSize: 12, fontWeight: '600' }}>View entries</Text>
        </TouchableOpacity>
      )}
      {tab === 'pending' && (
        <TouchableOpacity style={[styles.actionBtn, { borderColor: colors.red, backgroundColor: colors.redDim, marginTop: 8 }]} onPress={() => handleCancelPending(pos)}>
          <Text style={{ color: colors.red, fontSize: 12, fontWeight: '600' }}>Cancel Order</Text>
        </TouchableOpacity>
      )}
    </View>
  );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg0 }]} edges={['top']}>
      <AppHeader />

      {/* Page header */}
      <View style={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 4 }}>
        <Text style={{ color: colors.t1, fontSize: 18, fontWeight: '700' }}>Orders</Text>
        <Text style={{ color: colors.t3, fontSize: 11 }}>Manage your positions & history</Text>
      </View>

      {/* Tab bar (matches web .orders-tabs pill segmented control) */}
      <View style={[styles.tabBar, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
        {TABS.map(t => {
          const active = tab === t.key;
          const count = t.key === 'open' ? positions.length : t.key === 'pending' ? pendingOrders.length : t.key === 'history' ? history.length : cancelled.length;
          return (
            <TouchableOpacity key={t.key} style={[styles.tabPill, active && { backgroundColor: colors.bg0 }]} onPress={() => setTab(t.key)}>
              <Text style={{ color: active ? colors.t1 : colors.t3, fontSize: 11, fontWeight: active ? '700' : '500' }}>
                {t.label} ({count})
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {/* Total P/L (open tab) */}
      {tab === 'open' && positions.length > 0 && (
        <View style={{ paddingHorizontal: 12, paddingVertical: 4, alignItems: 'flex-end' }}>
          <Text style={{ color: totalPnl >= 0 ? colors.green : colors.red, fontSize: 13, fontWeight: '700' }}>
            Total P/L: {formatTotalPnl(totalPnl)}
          </Text>
        </View>
      )}

      {/* Card list */}
      <FlatList
        data={getData()}
        renderItem={renderCard}
        keyExtractor={(item, idx) => `${item.oderId || item._id || 'row'}-${item.groupId || item.tradeId || ''}-${idx}`}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} />}
        contentContainerStyle={{ padding: 12, paddingBottom: 120 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 48 }}>
            <Text style={{ fontSize: 36, marginBottom: 8 }}>📋</Text>
            <Text style={{ color: colors.t1, fontWeight: '500', fontSize: 15 }}>
              No {tab === 'open' ? 'open positions' : tab === 'pending' ? 'pending orders' : tab === 'history' ? 'trade history' : 'cancelled orders'}
            </Text>
          </View>
        }
      />

      {/* ── Mobile Status Footer (symbol / balance / USD-INR toggle) ── */}
      <MobileStatusFooter
        symbol={positions[0]?.symbol}
        balanceUsd={walletUSD.balance}
        balanceInr={walletINR.balance}
        displayCurrency={displayCurrency}
        onCurrencyChange={setDisplayCurrency}
        rate={effectiveRate}
      />

      {/* ── Edit SL/TP Modal ── */}
      <Modal visible={editModalOpen} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setEditModalOpen(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end' }}
          behavior="padding"
          keyboardVerticalOffset={0}
        >
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setEditModalOpen(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} />
          </TouchableOpacity>
          <View style={{ backgroundColor: colors.bg1, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: bottomPad + 8 }}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 40, height: 4, borderRadius: 4, backgroundColor: colors.t3 }} />
            </View>
            <Text style={{ color: colors.t1, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>
              Edit {editingPos?.symbol}
            </Text>
            <Text style={{ color: colors.t3, fontSize: 12, marginBottom: 16 }}>
              {editingPos?.side?.toUpperCase()} · {editingPos?.volume} lots
            </Text>
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: colors.t2, fontSize: 11, fontWeight: '600', marginBottom: 4 }}>Stop Loss</Text>
              <TextInput
                style={{ backgroundColor: colors.bg3, borderRadius: 8, padding: 12, color: colors.t1, fontSize: 14, borderWidth: 1, borderColor: colors.border }}
                value={editSL} onChangeText={setEditSL} keyboardType="decimal-pad" placeholder="None" placeholderTextColor={colors.t3}
              />
            </View>
            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: colors.t2, fontSize: 11, fontWeight: '600', marginBottom: 4 }}>Take Profit</Text>
              <TextInput
                style={{ backgroundColor: colors.bg3, borderRadius: 8, padding: 12, color: colors.t1, fontSize: 14, borderWidth: 1, borderColor: colors.border }}
                value={editTP} onChangeText={setEditTP} keyboardType="decimal-pad" placeholder="None" placeholderTextColor={colors.t3}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.bg3, alignItems: 'center' }} onPress={() => setEditModalOpen(false)}>
                <Text style={{ color: colors.t2, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.blue, alignItems: 'center' }} onPress={handleModify} disabled={editLoading}>
                {editLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Save Changes</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Netting Entries Modal (trade info / per-leg history) ── */}
      <Modal visible={legsModalOpen} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setLegsModalOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.5)' }}>
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setLegsModalOpen(false)} activeOpacity={1} />
          <View style={{ backgroundColor: colors.bg1, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '88%', paddingBottom: bottomPad }}>
            {/* Header */}
            <View style={{ padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <Text style={{ color: colors.t1, fontSize: 15, fontWeight: '700' }}>
                📊 Netting Entries — {legsPosition?.symbol}
              </Text>
              <TouchableOpacity onPress={() => setLegsModalOpen(false)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.t2} />
              </TouchableOpacity>
            </View>

            <ScrollView>
              {(() => {
                // Indian instruments (NSE/BSE/MCX) quote in ₹; everything else in $.
                const legsIsIndian = isIndianPos(legsPosition || {});
                const cs = legsIsIndian ? '₹' : '$';
                const pxDp = legsIsIndian ? 2 : 4;
                const fmtPx = (v: number) => `${cs}${Number(v || 0).toLocaleString(legsIsIndian ? 'en-IN' : 'en-US', { minimumFractionDigits: pxDp, maximumFractionDigits: pxDp })}`;
                const pnl = Number(legsPosition?.profit || 0);
                const fmtPnl = `${pnl >= 0 ? '+' : '-'}${cs}${Math.abs(pnl).toLocaleString(legsIsIndian ? 'en-IN' : 'en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                return (
                  <View style={{ padding: 14, backgroundColor: colors.bg2, flexDirection: 'row', flexWrap: 'wrap', gap: 14 }}>
                    <SummaryCell label="Side" value={(legsPosition?.side || '').toUpperCase()} valueColor={legsPosition?.side === 'buy' ? colors.green : colors.red} colors={colors} />
                    <SummaryCell label="Total Volume" value={String(parseFloat(Number(legsPosition?.volume || 0).toFixed(4)))} colors={colors} />
                    <SummaryCell label="Avg Entry" value={fmtPx(Number(legsPosition?.entryPrice || 0))} colors={colors} />
                    <SummaryCell label={legsPosition?.isClosed ? 'Close Price' : 'Current'} value={fmtPx(Number(legsPosition?.currentPrice || 0))} colors={colors} />
                    <SummaryCell
                      label="Total P/L"
                      value={fmtPnl}
                      valueColor={pnl >= 0 ? colors.green : colors.red}
                      colors={colors}
                    />
                  </View>
                );
              })()}

              {/* Legs list */}
              {legsLoading ? (
                <View style={{ padding: 30, alignItems: 'center' }}>
                  <ActivityIndicator color={colors.blue} />
                </View>
              ) : legsData.length === 0 ? (
                <View style={{ padding: 30, alignItems: 'center' }}>
                  <Text style={{ color: colors.t3, fontSize: 12 }}>No individual entry legs (single entry position)</Text>
                </View>
              ) : (
                <View style={{ paddingVertical: 4 }}>
                  {/* Column headers */}
                  <View style={[styles.legHeaderRow, { borderBottomColor: colors.border }]}>
                    <Text style={[styles.legCellHash, { color: colors.t3 }]}>#</Text>
                    <Text style={[styles.legCellType, { color: colors.t3 }]}>Type</Text>
                    <Text style={[styles.legCellSide, { color: colors.t3 }]}>Side</Text>
                    <Text style={[styles.legCellTime, { color: colors.t3 }]}>Time</Text>
                    <Text style={[styles.legCellPrice, { color: colors.t3, textAlign: 'right' }]}>Price</Text>
                  </View>
                  {legsData.map((leg, idx) => {
                    const isPartial = leg.type === 'partial_close';
                    const isClose = leg.type === 'close';
                    const isConsumed = leg.type === 'consumed';
                    const isOpen = leg.type === 'open';
                    const isCloseAction = isPartial || isClose || isConsumed;
                    const legSide = isCloseAction
                      ? (legsPosition?.side === 'buy' ? 'sell' : 'buy')
                      : (leg.side || legsPosition?.side);
                    const ep = isPartial || isClose ? (leg.closePrice || leg.entryPrice || 0) : (leg.entryPrice || 0);
                    const typeLabel = isClose ? 'Close' : isPartial ? 'Partial' : isConsumed ? 'Consumed' : 'Entry';
                    const typeColor = isClose ? colors.red : isPartial ? colors.amber : isConsumed ? colors.t3 : colors.green;
                    const ts = leg.executedAt || leg.closedAt || leg.createdAt;
                    const tLabel = ts ? new Date(ts).toLocaleString() : '—';
                    return (
                      <View key={`${leg._id || leg.tradeId || 'leg'}-${idx}`}>
                        <View style={[styles.legRow, { borderBottomColor: colors.border, opacity: isCloseAction ? 0.85 : 1 }]}>
                          <Text style={[styles.legCellHash, { color: colors.t2 }]}>{idx + 1}</Text>
                          <Text style={[styles.legCellType, { color: typeColor, fontWeight: '600' }]}>{typeLabel}</Text>
                          <Text style={[styles.legCellSide, { color: legSide === 'buy' ? colors.green : colors.red, fontWeight: '700' }]}>
                            {legSide.toUpperCase()}
                          </Text>
                          <Text style={[styles.legCellTime, { color: colors.t2 }]} numberOfLines={1}>{tLabel}</Text>
                          <Text style={[styles.legCellPrice, { color: colors.t1, textAlign: 'right' }]}>
                            {isIndianPos(legsPosition || {}) ? '₹' : '$'}{Number(ep).toFixed(isIndianPos(legsPosition || {}) ? 2 : 4)}
                          </Text>
                        </View>
                        {/* Detail sub-row */}
                        <View style={[styles.legSubRow, { backgroundColor: colors.bg0 }]}>
                          <View style={{ flexDirection: 'row', gap: 16, flex: 1 }}>
                            <Text style={{ color: colors.t3, fontSize: 11 }}>
                              Vol: <Text style={{ color: colors.t2, fontWeight: '600' }}>{parseFloat(Number(leg.volume || 0).toFixed(4))}</Text>
                            </Text>
                            <Text style={{ color: colors.t3, fontSize: 11 }}>
                              SL: <Text style={{ color: colors.t2 }}>{leg.stopLoss ? Number(leg.stopLoss).toFixed(4) : '—'}</Text>
                            </Text>
                            <Text style={{ color: colors.t3, fontSize: 11 }}>
                              TP: <Text style={{ color: colors.t2 }}>{leg.takeProfit ? Number(leg.takeProfit).toFixed(4) : '—'}</Text>
                            </Text>
                          </View>
                          {isOpen && !legsPosition?.isClosed && (
                            <View style={{ flexDirection: 'row', gap: 12 }}>
                              <TouchableOpacity
                                onPress={() => openLegEditModal(leg)}
                                hitSlop={8}
                                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                              >
                                <Ionicons name="create-outline" size={14} color={colors.blue} />
                                <Text style={{ color: colors.blue, fontSize: 11, fontWeight: '600' }}>Edit</Text>
                              </TouchableOpacity>
                              <TouchableOpacity
                                onPress={() => confirmCloseLeg(leg)}
                                hitSlop={8}
                                style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
                              >
                                <Ionicons name="close-circle-outline" size={15} color={colors.red} />
                                <Text style={{ color: colors.red, fontSize: 11, fontWeight: '600' }}>Close</Text>
                              </TouchableOpacity>
                            </View>
                          )}
                        </View>
                      </View>
                    );
                  })}
                </View>
              )}

              {/* Avg Price explanation */}
              {legsData.filter(l => l.type === 'open').length > 1 && (() => {
                const legsIsIndian = isIndianPos(legsPosition || {});
                const cs = legsIsIndian ? '₹' : '$';
                const dp = legsIsIndian ? 2 : 4;
                const openLegs = legsData.filter(l => l.type === 'open');
                const totalVol = openLegs.reduce((s, l) => s + (l.volume || 0), 0);
                return (
                  <View style={{ padding: 14, backgroundColor: colors.bg2, borderTopWidth: 1, borderTopColor: colors.border }}>
                    <Text style={{ color: colors.amber, fontSize: 11, fontWeight: '700', marginBottom: 4 }}>Avg Price Calculation</Text>
                    <Text style={{ color: colors.t2, fontSize: 11, lineHeight: 16 }}>
                      {`(${openLegs.map(l => `${parseFloat(Number(l.volume || 0).toFixed(4))}×${cs}${Number(l.entryPrice || 0).toFixed(dp)}`).join(' + ')}) ÷ ${parseFloat(totalVol.toFixed(4))} = ${cs}${Number(legsPosition?.entryPrice || 0).toFixed(dp)}`}
                    </Text>
                  </View>
                );
              })()}
            </ScrollView>
          </View>
        </View>
      </Modal>

      {/* ── Per-leg SL/TP Edit Modal ── */}
      <Modal visible={legEditOpen} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setLegEditOpen(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end' }}
          behavior="padding"
          keyboardVerticalOffset={0}
        >
          <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => setLegEditOpen(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} />
          </TouchableOpacity>
          <View style={{ backgroundColor: colors.bg1, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: bottomPad + 8 }}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 40, height: 4, borderRadius: 4, backgroundColor: colors.t3 }} />
            </View>
            <Text style={{ color: colors.t1, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>
              Edit Entry SL/TP
            </Text>
            <Text style={{ color: colors.t3, fontSize: 12, marginBottom: 16 }}>
              {(legBeingEdited?.side || '').toUpperCase()} · Entry {isIndianPos(legsPosition || legBeingEdited || {}) ? '₹' : '$'}{Number(legBeingEdited?.entryPrice || 0).toFixed(isIndianPos(legsPosition || legBeingEdited || {}) ? 2 : 4)} · {parseFloat(Number(legBeingEdited?.volume || 0).toFixed(4))} lots
            </Text>
            <View style={{ marginBottom: 12 }}>
              <Text style={{ color: colors.t2, fontSize: 11, fontWeight: '600', marginBottom: 4 }}>Stop Loss</Text>
              <TextInput
                style={{ backgroundColor: colors.bg3, borderRadius: 8, padding: 12, color: colors.t1, fontSize: 14, borderWidth: 1, borderColor: colors.border }}
                value={legEditSL} onChangeText={setLegEditSL} keyboardType="decimal-pad" placeholder="None" placeholderTextColor={colors.t3}
              />
            </View>
            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: colors.t2, fontSize: 11, fontWeight: '600', marginBottom: 4 }}>Take Profit</Text>
              <TextInput
                style={{ backgroundColor: colors.bg3, borderRadius: 8, padding: 12, color: colors.t1, fontSize: 14, borderWidth: 1, borderColor: colors.border }}
                value={legEditTP} onChangeText={setLegEditTP} keyboardType="decimal-pad" placeholder="None" placeholderTextColor={colors.t3}
              />
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.bg3, alignItems: 'center' }} onPress={() => setLegEditOpen(false)}>
                <Text style={{ color: colors.t2, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.blue, alignItems: 'center' }} onPress={saveLegSLTP} disabled={legEditLoading}>
                {legEditLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Save</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* ── Close Position Modal ── */}
      <Modal visible={closeModalOpen} animationType="slide" transparent statusBarTranslucent onRequestClose={() => setCloseModalOpen(false)}>
        <KeyboardAvoidingView
          style={{ flex: 1, justifyContent: 'flex-end' }}
          behavior="padding"
          keyboardVerticalOffset={0}
        >
          <TouchableOpacity style={StyleSheet.absoluteFill} onPress={() => setCloseModalOpen(false)}>
            <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.5)' }} />
          </TouchableOpacity>
          <View style={{ backgroundColor: colors.bg1, borderTopLeftRadius: 20, borderTopRightRadius: 20, padding: 20, paddingBottom: bottomPad + 8 }}>
            <View style={{ alignItems: 'center', marginBottom: 16 }}>
              <View style={{ width: 40, height: 4, borderRadius: 4, backgroundColor: colors.t3 }} />
            </View>
            <Text style={{ color: colors.t1, fontSize: 16, fontWeight: '700', marginBottom: 4 }}>
              Close {closingPos?.symbol}
            </Text>
            <Text style={{ color: colors.t3, fontSize: 12, marginBottom: 16 }}>
              {closingPos?.side?.toUpperCase()} · Entry: {(closingPos?.avgPrice || closingPos?.entryPrice || 0).toFixed(2)}
            </Text>
            <View style={{ marginBottom: 16 }}>
              <Text style={{ color: colors.t2, fontSize: 11, fontWeight: '600', marginBottom: 4 }}>Volume to Close</Text>
              <TextInput
                style={{ backgroundColor: colors.bg3, borderRadius: 8, padding: 12, color: colors.t1, fontSize: 14, borderWidth: 1, borderColor: colors.border }}
                value={closeVolume} onChangeText={setCloseVolume} keyboardType="decimal-pad"
                placeholderTextColor={colors.t3}
              />
              <Text style={{ color: colors.t3, fontSize: 10, marginTop: 4 }}>Max: {closingPos?.volume || 0} lots</Text>
            </View>
            <View style={{ flexDirection: 'row', gap: 10 }}>
              <TouchableOpacity style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.bg3, alignItems: 'center' }} onPress={() => setCloseModalOpen(false)}>
                <Text style={{ color: colors.t2, fontWeight: '600' }}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity style={{ flex: 1, paddingVertical: 12, borderRadius: 10, backgroundColor: colors.red, alignItems: 'center' }} onPress={handleClose} disabled={closeLoading}>
                {closeLoading ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontWeight: '700' }}>Close Position</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </SafeAreaView>
  );
};

// Reusable info row
const Row: React.FC<{ label: string; value: string; colors: any }> = ({ label, value, colors }) => (
  <View style={styles.infoRow}>
    <Text style={{ color: colors.t3, fontSize: 12 }}>{label}</Text>
    <Text style={{ color: colors.t2, fontSize: 12, fontWeight: '600' }}>{value}</Text>
  </View>
);

const SummaryCell: React.FC<{ label: string; value: string; valueColor?: string; colors: any }> = ({ label, value, valueColor, colors }) => (
  <View style={{ minWidth: 90 }}>
    <Text style={{ color: colors.t3, fontSize: 10 }}>{label}</Text>
    <Text style={{ color: valueColor || colors.t1, fontSize: 13, fontWeight: '700', marginTop: 2 }}>{value}</Text>
  </View>
);

const styles = StyleSheet.create({
  safe: { flex: 1 },
  tabBar: { flexDirection: 'row', marginHorizontal: 12, marginVertical: 8, padding: 3, borderRadius: 12, borderWidth: 1 },
  tabPill: { flex: 1, paddingVertical: 8, borderRadius: 9, alignItems: 'center' },

  card: { borderRadius: 12, padding: 14, marginBottom: 8, borderWidth: 1 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  sideBadge: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
  modeBadge: {
    width: 22, height: 22, borderRadius: 6,
    alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },
  cardBody: { gap: 4, marginBottom: 8 },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between' },
  cardActions: { flexDirection: 'row', gap: 10 },
  actionBtn: { flex: 1, paddingVertical: 10, borderRadius: 8, alignItems: 'center', borderWidth: 1 },
  entriesBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: 6, paddingVertical: 8, borderRadius: 8, borderWidth: 1, marginTop: 8,
  },
  // Legs table
  legHeaderRow: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8,
    borderBottomWidth: 1,
  },
  legRow: {
    flexDirection: 'row', paddingHorizontal: 12, paddingVertical: 8, alignItems: 'center',
    borderBottomWidth: 1,
  },
  legSubRow: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 6,
  },
  legCellHash: { width: 20, fontSize: 11 },
  legCellType: { width: 58, fontSize: 11 },
  legCellSide: { width: 42, fontSize: 11 },
  legCellTime: { flex: 1, fontSize: 11 },
  legCellPrice: { width: 80, fontSize: 11, fontWeight: '600' },
});

export default OrdersScreen;
