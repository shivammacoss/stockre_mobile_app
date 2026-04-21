import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, FlatList, ActivityIndicator,
  Modal, Pressable, RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../../theme/ThemeContext';
import { useSocket } from '../../contexts/SocketContext';
import { instrumentsAPI } from '../../services/api';

// Preset underlyings per segment. Chosen to match the web OptionsChain.jsx
// defaults so admin ops staff don't have to learn two lists.
const UNDERLYINGS: Record<string, string[]> = {
  NSE: ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY'],
  BSE: ['SENSEX', 'BANKEX'],
  MCX: ['GOLD', 'GOLDM', 'SILVER', 'CRUDEOIL', 'NATURALGAS'],
  CRYPTO: ['BTC', 'ETH', 'SOL'],
};

const SEGMENTS = Object.keys(UNDERLYINGS) as Array<keyof typeof UNDERLYINGS>;

type Leg = {
  symbol: string;
  token?: number;
  ltp: number;
  bid: number;
  ask: number;
  oi: number;
  volume: number;
} | null;

type Strike = { strike: number; ce: Leg; pe: Leg };

// Compact OI formatter — 1.2M, 890K, 45.3K, etc.
const fmtOI = (n: any) => {
  const v = Number(n || 0);
  if (!v) return '—';
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`;
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}K`;
  return String(v);
};
const fmtPrice = (v: any) => {
  const n = Number(v || 0);
  return n ? n.toFixed(2) : '—';
};

const OptionChainScreen: React.FC<{ navigation: any; route: any }> = ({ navigation, route }) => {
  const { colors } = useTheme();
  const { prices } = useSocket();

  // Allow other screens (e.g. MarketScreen's order sheet) to pre-select an
  // underlying: navigation.navigate('OptionChain', { segment, underlying }).
  const initialSegment: string = route?.params?.segment && UNDERLYINGS[route.params.segment as keyof typeof UNDERLYINGS] ? route.params.segment : 'NSE';
  const initialUnderlying: string = route?.params?.underlying || UNDERLYINGS[initialSegment as keyof typeof UNDERLYINGS][0];

  const [segment, setSegment] = useState<string>(initialSegment);
  const [underlying, setUnderlying] = useState<string>(initialUnderlying);
  const [expiry, setExpiry] = useState<string>('');
  const [expiries, setExpiries] = useState<string[]>([]);
  const [strikes, setStrikes] = useState<Strike[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const [showUnderlyingPicker, setShowUnderlyingPicker] = useState(false);
  const [showExpiryPicker, setShowExpiryPicker] = useState(false);

  const listRef = useRef<FlatList<Strike>>(null);
  const didAutoScrollRef = useRef(false);

  // Reset underlying when segment changes so the picker default is valid.
  const onSegmentChange = (s: string) => {
    setSegment(s);
    setUnderlying(UNDERLYINGS[s][0]);
    setExpiry('');
    setStrikes([]);
    didAutoScrollRef.current = false;
  };

  const load = useCallback(async () => {
    try {
      const res = await instrumentsAPI.getOptionsChain({ segment, underlying, expiry: expiry || undefined });
      if (res.data?.success) {
        setExpiries(res.data.expiries || []);
        setExpiry((prev) => prev || res.data.expiry || '');
        setStrikes(res.data.strikes || []);
      }
    } catch {
      setStrikes([]);
    }
  }, [segment, underlying, expiry]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  // Underlying spot — Indian indexes tick under their plain symbol on Zerodha
  // ticks (NIFTY 50 -> NIFTY). For crypto we look up BTCUSD etc. Fall back to
  // the tradingsymbol the user picked.
  const spotSymbol = useMemo(() => {
    if (segment === 'CRYPTO') return `${underlying}USD`;
    return underlying;
  }, [segment, underlying]);
  const spot = prices[spotSymbol];

  // Which strike is closest to spot — used for the ATM highlight row.
  const atmIndex = useMemo(() => {
    const s = Number(spot?.lastPrice || spot?.bid || spot?.ask || 0);
    if (!s || !strikes.length) return -1;
    let bestIdx = 0;
    let bestDiff = Math.abs(strikes[0].strike - s);
    for (let i = 1; i < strikes.length; i++) {
      const d = Math.abs(strikes[i].strike - s);
      if (d < bestDiff) { bestDiff = d; bestIdx = i; }
    }
    return bestIdx;
  }, [spot, strikes]);

  // Auto-scroll once after first load so ATM lands near the middle.
  useEffect(() => {
    if (didAutoScrollRef.current) return;
    if (atmIndex < 0 || !strikes.length) return;
    didAutoScrollRef.current = true;
    // Slight delay for FlatList to measure.
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index: atmIndex, animated: false, viewPosition: 0.5 });
      } catch {}
    }, 120);
    return () => clearTimeout(t);
  }, [atmIndex, strikes.length]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  // Tap-to-reveal SELL/chart/BUY pills (mobile equivalent of the web's
  // hover). Tap a leg's LTP cell -> that cell replaces itself with the
  // three pills. Tap another row/side or the same cell again -> collapse.
  const [activeLeg, setActiveLeg] = useState<{ strike: number; side: 'ce' | 'pe' } | null>(null);

  const toggleActiveLeg = (strike: number, side: 'ce' | 'pe', sym?: string) => {
    if (!sym) return;
    setActiveLeg((prev) =>
      prev && prev.strike === strike && prev.side === side ? null : { strike, side }
    );
  };

  const openOrderSheet = (
    sym?: string,
    side?: 'buy' | 'sell',
    leg?: { bid?: number; ask?: number; ltp?: number } | null
  ) => {
    if (!sym) return;
    // Pass the chain's REST-quote prices along so MarketScreen's order
    // sheet has a real bid/ask to show — option symbols aren't on the
    // mobile WS feed so prices[symbol] from useSocket is empty.
    navigation.navigate('MainTabs', {
      screen: 'Market',
      params: {
        openOrderFor: sym,
        preferredSide: side,
        seedBid: leg?.bid ?? undefined,
        seedAsk: leg?.ask ?? undefined,
        seedLtp: leg?.ltp ?? undefined,
      },
    });
  };

  const openOptionChartForSymbol = (sym?: string) => {
    if (!sym) return;
    // Chart lives inside MainTabs (bottom-tab navigator), not the RootStack.
    // navigate('Chart', ...) directly from here fails with
    // "not handled by any navigator" — nest it under MainTabs.
    navigation.navigate('MainTabs', {
      screen: 'Chart',
      params: { symbol: sym },
    });
  };

  const renderRow = ({ item, index }: { item: Strike; index: number }) => {
    const isAtm = index === atmIndex;
    // Live overlay — snapshot LTP + live socket tick if present.
    const ceSym = item.ce?.symbol;
    const peSym = item.pe?.symbol;
    const ceLive = ceSym ? prices[ceSym] : null;
    const peLive = peSym ? prices[peSym] : null;
    const ceLtp = Number(ceLive?.lastPrice ?? ceLive?.bid ?? item.ce?.ltp ?? 0);
    const peLtp = Number(peLive?.lastPrice ?? peLive?.bid ?? item.pe?.ltp ?? 0);
    const ceOi = Number(ceLive?.oi ?? item.ce?.oi ?? 0);
    const peOi = Number(peLive?.oi ?? item.pe?.oi ?? 0);
    // Zerodha ticks carry `change` as a percent. If absent, show '—'.
    const ceChg = Number(ceLive?.change ?? 0);
    const peChg = Number(peLive?.change ?? 0);

    const ceActive = activeLeg?.strike === item.strike && activeLeg.side === 'ce';
    const peActive = activeLeg?.strike === item.strike && activeLeg.side === 'pe';

    return (
      <View style={[styles.row, isAtm && { backgroundColor: colors.blueDim }]}>
        {/* CE side */}
        <Pressable
          onPress={() => toggleActiveLeg(item.strike, 'ce', ceSym)}
          style={({ pressed }) => [styles.leg, { opacity: pressed ? 0.6 : 1 }]}
          disabled={!ceSym}
        >
          {ceActive ? (
            <View style={styles.pillRow}>
              <Pressable onPress={() => { openOrderSheet(ceSym, 'sell', item.ce); setActiveLeg(null); }} style={[styles.pill, { backgroundColor: colors.red }]} hitSlop={6}>
                <Text style={styles.pillTxt}>SELL</Text>
              </Pressable>
              <Pressable onPress={() => { openOptionChartForSymbol(ceSym); setActiveLeg(null); }} style={[styles.pillIcon, { backgroundColor: colors.blue }]} hitSlop={6}>
                <Ionicons name="stats-chart" size={13} color="#fff" />
              </Pressable>
              <Pressable onPress={() => { openOrderSheet(ceSym, 'buy', item.ce); setActiveLeg(null); }} style={[styles.pill, { backgroundColor: colors.green }]} hitSlop={6}>
                <Text style={styles.pillTxt}>BUY</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.legRow}>
              <Text style={[styles.oiCell, { color: colors.t3 }]}>{fmtOI(ceOi)}</Text>
              <Text style={[styles.ltpCell, { color: colors.green }]}>{fmtPrice(ceLtp)}</Text>
              <Text style={[styles.chgCell, { color: ceChg >= 0 ? colors.green : colors.red }]}>
                {ceLive && ceChg ? `${ceChg > 0 ? '+' : ''}${ceChg.toFixed(1)}%` : '—'}
              </Text>
            </View>
          )}
        </Pressable>

        {/* Strike center */}
        <View style={[styles.strikeCell, { borderColor: colors.border }]}>
          <Text style={{ color: isAtm ? colors.blue : colors.t1, fontSize: 13, fontWeight: '800' }}>
            {item.strike}
          </Text>
        </View>

        {/* PE side */}
        <Pressable
          onPress={() => toggleActiveLeg(item.strike, 'pe', peSym)}
          style={({ pressed }) => [styles.leg, { opacity: pressed ? 0.6 : 1 }]}
          disabled={!peSym}
        >
          {peActive ? (
            <View style={styles.pillRow}>
              <Pressable onPress={() => { openOrderSheet(peSym, 'sell', item.pe); setActiveLeg(null); }} style={[styles.pill, { backgroundColor: colors.red }]} hitSlop={6}>
                <Text style={styles.pillTxt}>SELL</Text>
              </Pressable>
              <Pressable onPress={() => { openOptionChartForSymbol(peSym); setActiveLeg(null); }} style={[styles.pillIcon, { backgroundColor: colors.blue }]} hitSlop={6}>
                <Ionicons name="stats-chart" size={13} color="#fff" />
              </Pressable>
              <Pressable onPress={() => { openOrderSheet(peSym, 'buy', item.pe); setActiveLeg(null); }} style={[styles.pill, { backgroundColor: colors.green }]} hitSlop={6}>
                <Text style={styles.pillTxt}>BUY</Text>
              </Pressable>
            </View>
          ) : (
            <View style={styles.legRow}>
              <Text style={[styles.chgCell, { color: peChg >= 0 ? colors.green : colors.red }]}>
                {peLive && peChg ? `${peChg > 0 ? '+' : ''}${peChg.toFixed(1)}%` : '—'}
              </Text>
              <Text style={[styles.ltpCell, { color: colors.red }]}>{fmtPrice(peLtp)}</Text>
              <Text style={[styles.oiCell, { color: colors.t3 }]}>{fmtOI(peOi)}</Text>
            </View>
          )}
        </Pressable>
      </View>
    );
  };

  const spotDisplay = spot?.lastPrice ?? spot?.bid ?? spot?.ask;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg0 }]} edges={['top']}>
      {/* Page header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.t1} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.t1, fontSize: 17, fontWeight: '700' }}>Option Chain</Text>
          <Text style={{ color: colors.t3, fontSize: 11 }}>
            {underlying}
            {spotDisplay ? ` · ₹${Number(spotDisplay).toFixed(2)}` : ''}
          </Text>
        </View>
        <TouchableOpacity onPress={onRefresh} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="refresh" size={20} color={colors.t2} />
        </TouchableOpacity>
      </View>

      {/* Segment pills */}
      <View style={[styles.segRow, { backgroundColor: colors.bg3 }]}>
        {SEGMENTS.map((s) => (
          <TouchableOpacity
            key={s}
            style={[styles.segPill, segment === s && { backgroundColor: colors.blue }]}
            onPress={() => onSegmentChange(s)}
            activeOpacity={0.85}
          >
            <Text style={{ color: segment === s ? '#fff' : colors.t2, fontSize: 12, fontWeight: '700' }}>
              {s === 'CRYPTO' ? 'Crypto' : s}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Underlying + expiry selectors */}
      <View style={styles.selectorRow}>
        <TouchableOpacity
          style={[styles.selector, { backgroundColor: colors.bg2, borderColor: colors.border }]}
          onPress={() => setShowUnderlyingPicker(true)}
        >
          <Text style={[styles.selectorLabel, { color: colors.t3 }]}>UNDERLYING</Text>
          <View style={styles.selectorValueRow}>
            <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '700' }}>{underlying}</Text>
            <Ionicons name="chevron-down" size={14} color={colors.t3} />
          </View>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.selector, { backgroundColor: colors.bg2, borderColor: colors.border }]}
          onPress={() => setShowExpiryPicker(true)}
          disabled={!expiries.length}
        >
          <Text style={[styles.selectorLabel, { color: colors.t3 }]}>EXPIRY</Text>
          <View style={styles.selectorValueRow}>
            <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '700' }}>
              {expiry || '—'}
            </Text>
            <Ionicons name="chevron-down" size={14} color={colors.t3} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Column headers */}
      <View style={[styles.colHeader, { borderBottomColor: colors.border }]}>
        <View style={styles.legHdr}>
          <Text style={[styles.hdrCell, styles.oiCell, { color: colors.t3 }]}>OI</Text>
          <Text style={[styles.hdrCell, styles.ltpCell, { color: colors.green }]}>CALL</Text>
          <Text style={[styles.hdrCell, styles.chgCell, { color: colors.t3 }]}>Δ%</Text>
        </View>
        <View style={[styles.strikeCell, { borderColor: 'transparent' }]}>
          <Text style={[styles.hdrCell, { color: colors.t3 }]}>STRIKE</Text>
        </View>
        <View style={styles.legHdr}>
          <Text style={[styles.hdrCell, styles.chgCell, { color: colors.t3 }]}>Δ%</Text>
          <Text style={[styles.hdrCell, styles.ltpCell, { color: colors.red }]}>PUT</Text>
          <Text style={[styles.hdrCell, styles.oiCell, { color: colors.t3 }]}>OI</Text>
        </View>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.blue} />
        </View>
      ) : strikes.length === 0 ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
          <Ionicons name="options-outline" size={44} color={colors.t3} />
          <Text style={{ color: colors.t1, fontSize: 15, fontWeight: '600', marginTop: 10 }}>No strikes found</Text>
          <Text style={{ color: colors.t3, fontSize: 12, marginTop: 4, textAlign: 'center' }}>
            Try a different underlying or expiry. Indian instrument ticks arrive after Zerodha is authorised.
          </Text>
        </View>
      ) : (
        <FlatList
          ref={listRef}
          data={strikes}
          keyExtractor={(s) => String(s.strike)}
          renderItem={renderRow}
          contentContainerStyle={{ paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} />}
          initialNumToRender={20}
          windowSize={11}
          onScrollToIndexFailed={() => {}}
        />
      )}

      {/* Underlying picker */}
      <Modal visible={showUnderlyingPicker} transparent animationType="fade" onRequestClose={() => setShowUnderlyingPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowUnderlyingPicker(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.bg1, borderColor: colors.border }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: colors.t1 }]}>Underlying</Text>
            {/* Current underlying always included so a deep-linked stock
                (e.g. HDFCBANK) that isn't in the preset list stays visible. */}
            {[...new Set([underlying, ...UNDERLYINGS[segment]])].map((u) => (
              <TouchableOpacity
                key={u}
                style={styles.modalRow}
                onPress={() => { setUnderlying(u); setExpiry(''); didAutoScrollRef.current = false; setShowUnderlyingPicker(false); }}
              >
                <Text style={{ color: colors.t1, fontSize: 15, fontWeight: underlying === u ? '800' : '500' }}>{u}</Text>
                {underlying === u && <Ionicons name="checkmark" size={18} color={colors.blue} />}
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>

      {/* Expiry picker */}
      <Modal visible={showExpiryPicker} transparent animationType="fade" onRequestClose={() => setShowExpiryPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowExpiryPicker(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.bg1, borderColor: colors.border }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: colors.t1 }]}>Expiry</Text>
            {expiries.map((e) => (
              <TouchableOpacity
                key={e}
                style={styles.modalRow}
                onPress={() => { setExpiry(e); didAutoScrollRef.current = false; setShowExpiryPicker(false); }}
              >
                <Text style={{ color: colors.t1, fontSize: 15, fontWeight: expiry === e ? '800' : '500' }}>{e}</Text>
                {expiry === e && <Ionicons name="checkmark" size={18} color={colors.blue} />}
              </TouchableOpacity>
            ))}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },

  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, gap: 8 },
  backBtn: { padding: 4 },
  iconBtn: { padding: 6 },

  segRow: { flexDirection: 'row', marginHorizontal: 12, marginTop: 10, borderRadius: 10, padding: 4 },
  segPill: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: 7 },

  selectorRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 12, marginTop: 10, marginBottom: 8 },
  selector: { flex: 1, borderWidth: 1, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 8 },
  selectorLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginBottom: 2 },
  selectorValueRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  colHeader: { flexDirection: 'row', paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1 },
  legHdr: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  hdrCell: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, textAlign: 'center' },

  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 8, minHeight: 46 },
  leg: { flex: 1 },
  legRow: { flexDirection: 'row', alignItems: 'center' },
  oiCell: { flex: 1, textAlign: 'center', fontSize: 11 },
  ltpCell: { flex: 1, textAlign: 'center', fontSize: 13, fontWeight: '700' },
  chgCell: { flex: 1, textAlign: 'center', fontSize: 10 },

  strikeCell: { width: 72, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderRightWidth: 1 },

  // Tap-to-reveal pills (mobile equivalent of the web's hover reveal).
  pillRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  pill: { paddingHorizontal: 8, paddingVertical: 5, borderRadius: 12, minWidth: 46, alignItems: 'center' },
  pillIcon: { width: 28, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  pillTxt: { color: '#fff', fontSize: 10, fontWeight: '800', letterSpacing: 0.4 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 320, borderRadius: 14, borderWidth: 1, paddingVertical: 8, maxHeight: '70%' },
  modalTitle: { fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 10, letterSpacing: 0.4 },
  modalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
});

export default OptionChainScreen;
