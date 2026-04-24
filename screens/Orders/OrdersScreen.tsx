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
import { tradingAPI, walletAPI, reportsAPI } from '../../services/api';
import AppHeader from '../../components/AppHeader';
import MobileStatusFooter from '../../components/MobileStatusFooter';

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

type TabKey = 'open' | 'pending' | 'history' | 'cancelled' | 'weekly';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'open', label: 'Open' },
  { key: 'pending', label: 'Pending' },
  { key: 'history', label: 'History' },
  { key: 'cancelled', label: 'Cancelled' },
  { key: 'weekly', label: 'Weekly' },
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

  // Footer / ledger balance. Read from `wallet` (the trading engine's source of
  // truth). The response also ships a legacy `walletINR` object — don't use it:
  // trading never writes to it, so P&L would never reflect on this screen.
  // Refresh happens inside loadData(), which is triggered by every socket
  // position update — so closing a trade updates the ledger in the same tick.
  const [wallet, setWallet] = useState<{ balance: number }>({ balance: 0 });

  // INR-only P/L formatter. Server stores Indian profits in INR,
  // international in USD — display shows INR for all.
  const formatPnl = useCallback((pnl: number, _pos?: any) => {
    const sign = pnl >= 0 ? '+' : '-';
    const abs = Math.abs(pnl);
    return `${sign}₹${abs.toFixed(2)}`;
  }, []);

  const formatTotalPnl = useCallback((pnl: number) => {
    const sign = pnl >= 0 ? '+' : '-';
    const abs = Math.abs(pnl);
    return `${sign}₹${abs.toFixed(2)}`;
  }, []);

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
      const [posRes, pendRes, histRes, walRes] = await Promise.all([
        tradingAPI.getAllPositions(uid),
        tradingAPI.getPendingOrders(uid),
        tradingAPI.getTradeHistory(uid),
        walletAPI.getUserWallet(uid),
      ]);
      if (posRes.data?.positions) setPositions(posRes.data.positions);
      if (pendRes.data?.orders) setPendingOrders(pendRes.data.orders);
      if (histRes.data?.trades) setHistory(histRes.data.trades);
      if (walRes.data?.wallet) setWallet(walRes.data.wallet);
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
          await tradingAPI.cancelPendingOrder({ userId: uid, orderId: order.oderId || order._id, mode: order.mode || 'netting' });
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

  // calcLivePnl returns each position's P/L in its native currency — INR for
  // Indian symbols, USD for international. All displayed in INR.
  const totalPnlInr = positions.reduce((s, p) => {
    const raw = calcLivePnl(p);
    return s + raw; // already INR (server settles in INR)
  }, 0);
  const totalPnl = totalPnlInr;
  const marginUsed = positions.reduce((s, p) => s + Number(p.marginUsed || p.margin || 0), 0);
  const ledgerBalance = Number(wallet?.balance || 0);
  // Available = deposited funds minus margin locked in open trades, plus live M2M.
  // All three are in INR here.
  const marginAvailable = ledgerBalance - marginUsed + totalPnlInr;

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
          const displayVal = commInr > 0 ? commInr : commUsd * 83;
          const sym = '₹';
          // Swap: same pattern
          const swapUsd = Number(pos.swap) || 0;
          const swapInr = Number(pos.swapInr) || 0;
          const swapVal = swapInr !== 0 ? swapInr : swapUsd * 83;
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

      {/* Account summary — ledger, available, used, M2M (shown on open tab) */}
      {tab === 'open' && (
        <View style={[styles.summaryCard, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          <View style={styles.summaryRow}>
            <View style={styles.summaryCell}>
              <Text style={[styles.summaryLabel, { color: colors.t3 }]}>LEDGER BAL</Text>
              <Text style={[styles.summaryValue, { color: colors.t1 }]}>₹{ledgerBalance.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryCell}>
              <Text style={[styles.summaryLabel, { color: colors.t3 }]}>MARGIN AVAIL</Text>
              <Text style={[styles.summaryValue, { color: colors.blue }]}>₹{marginAvailable.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
            </View>
          </View>
          <View style={[styles.summaryHDivider, { backgroundColor: colors.border }]} />
          <View style={styles.summaryRow}>
            <View style={styles.summaryCell}>
              <Text style={[styles.summaryLabel, { color: colors.t3 }]}>MARGIN USED</Text>
              <Text style={[styles.summaryValue, { color: colors.t1 }]}>₹{marginUsed.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
            </View>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryCell}>
              <Text style={[styles.summaryLabel, { color: colors.t3 }]}>M2M</Text>
              <Text style={[styles.summaryValue, { color: totalPnl >= 0 ? colors.green : colors.red }]}>
                {formatTotalPnl(totalPnl)}
              </Text>
            </View>
          </View>
        </View>
      )}

      {/* Card list / weekly report */}
      {tab === 'weekly' ? (
        <WeeklySettlementMobile userId={user?.oderId} />
      ) : (
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
      )}

      {/* ── Mobile Status Footer (INR only) ── */}
      <MobileStatusFooter
        symbol={positions[0]?.symbol}
        balanceInr={wallet.balance}
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

  summaryCard: { marginHorizontal: 12, marginTop: 4, marginBottom: 10, padding: 12, borderRadius: 12, borderWidth: 1 },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryCell: { flex: 1 },
  summaryLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginBottom: 3 },
  summaryValue: { fontSize: 14, fontWeight: '800' },
  summaryDivider: { width: 1, height: 30, marginHorizontal: 10 },
  summaryHDivider: { height: 1, marginVertical: 10 },

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

/**
 * Weekly Settlement mobile panel — shows the same per-user weekly P/L
 * buckets as the web OrdersPage's Weekly tab. Currency is INR by default
 * (matches the mobile footer convention — mobile is India-first UI).
 */
interface WeekBucket {
  weekKey?: string;
  weekNumber: number;
  year: number;
  weekStart: string;
  weekEnd: string;
  totalProfit: number;
  totalLoss: number;
  netPnL: number;
  tradeCount: number;
}
interface WeekTrade {
  _id?: string;
  tradeId?: string;
  symbol: string;
  side?: string;
  volume?: number;
  entryPrice?: number;
  closePrice?: number;
  profit?: number;
  closedAt?: string;
}

const WeeklySettlementMobile: React.FC<{ userId?: string }> = ({ userId }) => {
  const { colors } = useTheme();
  const [weeks, setWeeks] = useState<WeekBucket[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<WeekBucket | null>(null);
  const [trades, setTrades] = useState<WeekTrade[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);

  const fmt = (n: number) => {
    const v = Number(n) || 0;
    const s = v < 0 ? '-' : '';
    return `${s}₹${Math.abs(v).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };
  const fmtRange = (start: string, end: string) => {
    if (!start || !end) return '—';
    const f = (d: string) => new Date(d).toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
    return `${f(start)} → ${f(end)}`;
  };

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    try {
      const res = await reportsAPI.getWeeklySettlement(userId);
      setWeeks(Array.isArray(res.data?.weeks) ? res.data.weeks : []);
    } catch {
      setWeeks([]);
    } finally {
      setLoading(false);
    }
  }, [userId]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (w: WeekBucket) => {
    setSelected(w);
    setDetailLoading(true);
    setTrades([]);
    try {
      const res = await reportsAPI.getWeeklySettlementDetails(userId || '', w.weekStart);
      setTrades(Array.isArray(res.data?.trades) ? res.data.trades : []);
    } catch {
      setTrades([]);
    } finally {
      setDetailLoading(false);
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={weeks}
        keyExtractor={(w) => w.weekKey || w.weekStart}
        refreshControl={<RefreshControl refreshing={loading} onRefresh={load} tintColor={colors.blue} />}
        contentContainerStyle={{ padding: 12, paddingBottom: 120 }}
        ListHeaderComponent={
          <View style={{ marginBottom: 8 }}>
            <Text style={{ color: colors.t1, fontSize: 16, fontWeight: '700' }}>Weekly Settlement</Text>
            <Text style={{ color: colors.t3, fontSize: 11, marginTop: 2 }}>
              Your closed-trade P/L grouped by week (Mon → Sun)
            </Text>
          </View>
        }
        ListEmptyComponent={
          !loading ? (
            <View style={{ alignItems: 'center', paddingVertical: 48 }}>
              <Text style={{ fontSize: 36, marginBottom: 8 }}>📊</Text>
              <Text style={{ color: colors.t1, fontWeight: '500', fontSize: 15 }}>No closed trades yet</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            onPress={() => openDetail(item)}
            style={{
              backgroundColor: colors.bg1, borderWidth: 1, borderColor: colors.border,
              borderRadius: 10, padding: 12, marginBottom: 10,
            }}
            activeOpacity={0.7}
          >
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
              <View>
                <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '700' }}>
                  Week {item.weekNumber} · {item.year}
                </Text>
                <Text style={{ color: colors.t3, fontSize: 11, marginTop: 2 }}>
                  {fmtRange(item.weekStart, item.weekEnd)}
                </Text>
              </View>
              <Text style={{ color: item.netPnL >= 0 ? colors.green : colors.red, fontSize: 15, fontWeight: '800' }}>
                {fmt(item.netPnL)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
              <Text style={{ color: colors.t3, fontSize: 11 }}>Trades: <Text style={{ color: colors.t1 }}>{item.tradeCount}</Text></Text>
              <Text style={{ color: colors.green, fontSize: 11 }}>+{fmt(item.totalProfit).replace('-', '')}</Text>
              <Text style={{ color: colors.red, fontSize: 11 }}>-{fmt(item.totalLoss).replace('-', '')}</Text>
            </View>
          </TouchableOpacity>
        )}
      />

      {/* Drill-down modal */}
      <Modal visible={!!selected} animationType="slide" transparent onRequestClose={() => setSelected(null)}>
        <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <View style={{ backgroundColor: colors.bg0, borderTopLeftRadius: 18, borderTopRightRadius: 18, maxHeight: '85%', paddingBottom: 20 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 16, borderBottomWidth: 1, borderBottomColor: colors.border }}>
              <View>
                <Text style={{ color: colors.t1, fontSize: 15, fontWeight: '700' }}>
                  Week {selected?.weekNumber} · {selected?.year}
                </Text>
                <Text style={{ color: colors.t3, fontSize: 11, marginTop: 2 }}>
                  {selected && fmtRange(selected.weekStart, selected.weekEnd)}
                </Text>
              </View>
              <TouchableOpacity onPress={() => setSelected(null)} hitSlop={10}>
                <Ionicons name="close" size={22} color={colors.t2} />
              </TouchableOpacity>
            </View>
            {detailLoading ? (
              <View style={{ padding: 32, alignItems: 'center' }}>
                <ActivityIndicator color={colors.blue} />
              </View>
            ) : trades.length === 0 ? (
              <View style={{ padding: 32, alignItems: 'center' }}>
                <Text style={{ color: colors.t3 }}>No trades in this week.</Text>
              </View>
            ) : (
              <ScrollView contentContainerStyle={{ paddingHorizontal: 12, paddingVertical: 10 }}>
                {trades.map((t) => (
                  <View
                    key={t._id || t.tradeId}
                    style={{ backgroundColor: colors.bg1, borderRadius: 10, borderWidth: 1, borderColor: colors.border, padding: 10, marginBottom: 8 }}
                  >
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: colors.t1, fontSize: 13, fontWeight: '700' }}>{t.symbol}</Text>
                      <Text style={{ color: (Number(t.profit) || 0) >= 0 ? colors.green : colors.red, fontSize: 13, fontWeight: '700' }}>
                        {fmt(Number(t.profit) || 0)}
                      </Text>
                    </View>
                    <View style={{ flexDirection: 'row', gap: 14, marginTop: 4, flexWrap: 'wrap' }}>
                      <Text style={{ color: colors.t3, fontSize: 11 }}>
                        {(t.side || '').toUpperCase()} · {t.volume} lots
                      </Text>
                      <Text style={{ color: colors.t3, fontSize: 11 }}>
                        Entry {Number(t.entryPrice || 0).toFixed(2)} → Close {Number(t.closePrice || 0).toFixed(2)}
                      </Text>
                    </View>
                    {t.closedAt && (
                      <Text style={{ color: colors.t3, fontSize: 10, marginTop: 3 }}>
                        {new Date(t.closedAt).toLocaleString()}
                      </Text>
                    )}
                  </View>
                ))}
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
    </View>
  );
};

export default OrdersScreen;
