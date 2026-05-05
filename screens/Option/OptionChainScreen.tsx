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
  close?: number;
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
  const { prices, mergePrice } = useSocket();

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
  // How many strikes around ATM to show. Matches the web's "N Strikes"
  // dropdown; previously mobile always rendered the full chain which (a)
  // made far-OTM strikes dominate the view and (b) was the user-visible
  // reason "the strike I want isn't showing" — it was simply below the
  // ATM-centered viewport without a way to expand the window.
  const [strikeCount, setStrikeCount] = useState(18);
  const [showStrikeCountPicker, setShowStrikeCountPicker] = useState(false);
  const STRIKE_COUNT_OPTIONS = [10, 14, 18, 24, 30, 40, 60, 999];

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

  // Poll the chain every 5s so LTP / bid / ask / OI move in step with
  // the broker's REST quote feed — same cadence the web client uses.
  // Option contracts aren't on the Kite WebSocket subscription set
  // (Kite caps WS tokens; tens of thousands of legs would saturate it),
  // so the server's GET /api/options-chain pulls a fresh quoteMap each
  // call. Without this poll the mobile chain froze at the snapshot
  // taken on screen mount.
  useEffect(() => {
    const id = setInterval(() => {
      // Silent reload: don't show the spinner, just swap in new strikes.
      load().catch(() => { /* keep last snapshot on transient failure */ });
    }, 5000);
    return () => clearInterval(id);
  }, [load]);

  // Underlying spot — Indian indexes tick under their plain symbol on Zerodha
  // ticks (NIFTY 50 -> NIFTY). For crypto we look up BTCUSD etc. Fall back to
  // the tradingsymbol the user picked.
  const spotSymbol = useMemo(() => {
    if (segment === 'CRYPTO') return `${underlying}USD`;
    return underlying;
  }, [segment, underlying]);

  // Resolve the spot tick. Exact match works for indices (NIFTY, BANKNIFTY,
  // SENSEX — Zerodha streams those under their plain name) and crypto perps.
  // MCX underlyings (CRUDEOIL, GOLD, SILVER) have NO index stream — Zerodha
  // only ticks specific contracts (CRUDEOIL26MAYFUT, GOLD26JUNFUT, …), so we
  // look for the nearest-expiry FUTURES contract for that underlying and
  // use its LTP as the spot proxy (basis is ~pennies for the front month).
  //
  // The pattern is STRICT: `^<UNDERLYING><YY><MON3>FUT$`. Earlier I used a
  // bare `startsWith(needle)` check which would:
  //   - match `CRUDEOIL26MAY2800CE` as the spot (picking an option premium
  //     of ~₹870 as the "spot" of a commodity trading at ~₹6500)
  //   - match `GOLDM26JUNFUT` (gold mini, a different commodity) when the
  //     user picked `GOLD`
  // Both produced nonsense in the header chip.
  const spot = useMemo(() => {
    if (!spotSymbol) return null;
    const direct = prices[spotSymbol];
    const priceOf = (t: any) => Number(t?.lastPrice || t?.bid || t?.ask || 0);
    if (direct && priceOf(direct) > 0) return direct;
    const needle = String(spotSymbol).toUpperCase();
    const escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    // ^<UNDERLYING><YY><MON3>FUT$ — no strike, not an option, correct commodity.
    const futRe = new RegExp(`^${escaped}(\\d{2})([A-Z]{3})FUT$`);
    const MON_INDEX: Record<string, number> = {
      JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6,
      JUL: 7, AUG: 8, SEP: 9, OCT: 10, NOV: 11, DEC: 12,
    };
    let best: any = null;
    let bestScore = Number.POSITIVE_INFINITY;
    for (const key of Object.keys(prices)) {
      const m = String(key).toUpperCase().match(futRe);
      if (!m) continue;
      const t = prices[key];
      if (!t || priceOf(t) <= 0) continue;
      // Score by YY*100 + month so the earliest chronological contract wins.
      const score = Number(m[1]) * 100 + (MON_INDEX[m[2]] || 99);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
    return best;
  }, [prices, spotSymbol]);

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

  // Slice of strikes actually shown — N strikes centered on ATM. `999`
  // means "show everything" (no ATM centering needed). The ATM highlight
  // still uses the global atmIndex but we map it into the visible slice
  // for auto-scroll below.
  const { visibleStrikes, visibleAtmIndex } = useMemo(() => {
    if (!strikes.length) return { visibleStrikes: [] as Strike[], visibleAtmIndex: -1 };
    if (strikeCount >= strikes.length || atmIndex < 0) {
      return { visibleStrikes: strikes, visibleAtmIndex: atmIndex };
    }
    const half = Math.floor(strikeCount / 2);
    const start = Math.max(0, Math.min(strikes.length - strikeCount, atmIndex - half));
    const end = Math.min(strikes.length, start + strikeCount);
    return { visibleStrikes: strikes.slice(start, end), visibleAtmIndex: atmIndex - start };
  }, [strikes, atmIndex, strikeCount]);

  // Auto-scroll once after first load so ATM lands near the middle.
  useEffect(() => {
    if (didAutoScrollRef.current) return;
    if (visibleAtmIndex < 0 || !visibleStrikes.length) return;
    didAutoScrollRef.current = true;
    // Slight delay for FlatList to measure.
    const t = setTimeout(() => {
      try {
        listRef.current?.scrollToIndex({ index: visibleAtmIndex, animated: false, viewPosition: 0.5 });
      } catch {}
    }, 120);
    return () => clearTimeout(t);
  }, [visibleAtmIndex, visibleStrikes.length]);

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
    sym: string | undefined,
    side: 'buy' | 'sell',
    ctx: {
      strike?: number;
      type?: 'CE' | 'PE';
      bid?: number;
      ask?: number;
      ltp?: number;
    } | null = null
  ) => {
    if (!sym) return;
    // Log the full payload so we can confirm in Metro that the clicked
    // strike is binding correctly — not the premium alone. Symbol is the
    // already-constructed Zerodha tradingsymbol from the API response
    // (e.g. HDFCLIFE26APR530CE). Strike + type are extra for clarity;
    // they aren't required by the order sheet (it parses them from sym)
    // but they're carried so debug logs + future pages can use them.
    if (__DEV__) {
      // eslint-disable-next-line no-console
      console.log('[OptionChain] onTrade ->', {
        symbol: sym,
        side,
        strike: ctx?.strike,
        type: ctx?.type,
        bid: ctx?.bid,
        ask: ctx?.ask,
        ltp: ctx?.ltp,
      });
    }
    // Kick off the on-demand WS subscribe so Kite starts streaming
    // ticks for this option leg as soon as MarketScreen renders. Same
    // endpoint web hits from MarketPage's selected-symbol useEffect.
    instrumentsAPI.subscribeZerodhaInstrumentBySymbol(sym).catch(() => { /* no-op */ });
    // Cold strike (no live bid/ask/ltp on the chain row) — pull a
    // single-symbol REST quote to seed prices before MarketScreen's
    // order panel renders, so BUY/SELL aren't stuck at ₹0.00 while
    // the WS subscribe spins up.
    const _b = Number(ctx?.bid || 0), _a = Number(ctx?.ask || 0), _l = Number(ctx?.ltp || 0);
    if (_b <= 0 && _a <= 0 && _l <= 0 && typeof mergePrice === 'function') {
      const u = String(sym).toUpperCase();
      let exch = 'NFO';
      if (/^(SENSEX|BANKEX)/.test(u)) exch = 'BFO';
      else if (/^(GOLD|GOLDM|SILVER|SILVERM|CRUDEOIL|NATURALGAS|COPPER|ZINC|ALUMINIUM|LEAD|NICKEL)/.test(u)) exch = 'MCX';
      instrumentsAPI
        .getZerodhaQuote(exch, sym)
        .then((r) => {
          const d: any = r?.data;
          if (d?.success) {
            mergePrice(sym, {
              bid: Number(d.bid) || 0,
              ask: Number(d.ask) || 0,
              lastPrice: Number(d.ltp) || 0,
            });
          }
        })
        .catch(() => { /* leave order panel at 0 — no broker quote */ });
    }
    navigation.navigate('MainTabs', {
      screen: 'Market',
      params: {
        openOrderFor: sym,
        preferredSide: side,
        seedBid: ctx?.bid ?? undefined,
        seedAsk: ctx?.ask ?? undefined,
        seedLtp: ctx?.ltp ?? undefined,
      },
    });
  };

  const openOptionChartForSymbol = (
    sym?: string,
    ctx: { bid?: number; ask?: number; ltp?: number } | null = null
  ) => {
    if (!sym) return;
    // Seed the price store from the chain's REST /quote snapshot BEFORE
    // navigating. Option symbols aren't on the Kite WS feed until the
    // server subscribes them on demand (~300-800ms), so without this seed
    // ChartScreen would show 0 in its OHLC header and the LTP line would
    // be absent for the first couple of seconds.
    const bid = Number(ctx?.bid || 0);
    const ask = Number(ctx?.ask || 0);
    const ltp = Number(ctx?.ltp || 0);
    if ((bid > 0 || ask > 0 || ltp > 0) && typeof mergePrice === 'function') {
      mergePrice(sym, { bid, ask, lastPrice: ltp });
    } else if (typeof mergePrice === 'function') {
      // Cold strike — chain row had no live numbers. Hit the server's
      // single-symbol REST quote so the chart + footer see whatever
      // Kite has (depth, previous close, etc.) instead of blank ₹0.00
      // while we wait for the WS subscribe to spin up.
      const u = String(sym).toUpperCase();
      let exch = 'NFO';
      if (/^(SENSEX|BANKEX)/.test(u)) exch = 'BFO';
      else if (/^(GOLD|GOLDM|SILVER|SILVERM|CRUDEOIL|NATURALGAS|COPPER|ZINC|ALUMINIUM|LEAD|NICKEL)/.test(u)) exch = 'MCX';
      instrumentsAPI
        .getZerodhaQuote(exch, sym)
        .then((r) => {
          const d: any = r?.data;
          if (d?.success) {
            mergePrice(sym, {
              bid: Number(d.bid) || 0,
              ask: Number(d.ask) || 0,
              lastPrice: Number(d.ltp) || 0,
            });
          }
        })
        .catch(() => { /* no-op — chart will populate once Kite WS streams */ });
    }
    // Kick off an on-demand subscribe so the broker starts streaming real
    // WS ticks for this contract. Fire-and-forget — the chart is usable
    // from the seeded price while this round-trips. Same endpoint the
    // web client hits from MarketPage's subscribe-by-symbol effect.
    instrumentsAPI.subscribeZerodhaInstrumentBySymbol(sym).catch(() => { /* no-op */ });
    // Chart lives inside MainTabs (bottom-tab navigator), not the RootStack.
    // navigate('Chart', ...) directly from here fails with
    // "not handled by any navigator" — nest it under MainTabs.
    navigation.navigate('MainTabs', {
      screen: 'Chart',
      params: { symbol: sym },
    });
  };

  const renderRow = ({ item, index }: { item: Strike; index: number }) => {
    const isAtm = index === visibleAtmIndex;
    // Divider above the ATM row — a horizontal line with a floating badge
    // carrying the live spot price. Mirrors the web OptionsChain so the
    // user can see WHERE the underlying is sitting between the visible
    // strikes at a glance. Only the first render inside the visible slice
    // gets it (can't repeat).
    const spotLtpNum = Number(spotDisplay || 0);
    const showAtmDivider = index === visibleAtmIndex && spotLtpNum > 0 && index > 0;
    // Live overlay — snapshot LTP + live socket tick if present.
    const ceSym = item.ce?.symbol;
    const peSym = item.pe?.symbol;
    const ceLive = ceSym ? prices[ceSym] : null;
    const peLive = peSym ? prices[peSym] : null;
    // LTP must not fall back to bid — bid is someone's offer to buy, not a
    // traded price. If neither live lastPrice nor the REST snapshot LTP
    // is present, show 0 and let the row render '—' for Δ% naturally.
    const ceLtp = Number(ceLive?.lastPrice ?? item.ce?.ltp ?? 0);
    const peLtp = Number(peLive?.lastPrice ?? item.pe?.ltp ?? 0);
    const ceClose = Number(item.ce?.close ?? 0);
    const peClose = Number(item.pe?.close ?? 0);
    const ceOi = Number(item.ce?.oi ?? 0);
    const peOi = Number(item.pe?.oi ?? 0);
    // Safe Δ% — strict spec: null when either ltp or close is 0 or
    // missing. Show '—' in the UI instead of inventing a ratio.
    const cePct = (ceLtp > 0 && ceClose > 0) ? ((ceLtp - ceClose) / ceClose) * 100 : null;
    const pePct = (peLtp > 0 && peClose > 0) ? ((peLtp - peClose) / peClose) * 100 : null;

    const ceActive = activeLeg?.strike === item.strike && activeLeg.side === 'ce';
    const peActive = activeLeg?.strike === item.strike && activeLeg.side === 'pe';

    return (
      <>
        {showAtmDivider && (
          <View style={styles.atmDividerWrap} pointerEvents="none">
            <View style={[styles.atmDividerLine, { backgroundColor: colors.blue }]} />
            <View style={[styles.atmDividerBadge, { backgroundColor: colors.bg0, borderColor: colors.blue }]}>
              <Text style={{ color: colors.blue, fontSize: 11, fontWeight: '800' }}>
                {spotLtpNum.toFixed(2)}
              </Text>
            </View>
          </View>
        )}
      <View style={[styles.row, isAtm && { backgroundColor: colors.blueDim }]}>
        {/* CE side — whole area taps to reveal pills. When active the
            pill row spans the full side (CLOSE hides during reveal) so
            there's enough width on mobile to avoid overlap. */}
        <Pressable
          onPress={() => toggleActiveLeg(item.strike, 'ce', ceSym)}
          style={({ pressed }) => [styles.sidePressable, { opacity: pressed ? 0.6 : 1 }]}
          disabled={!ceSym}
        >
          {ceActive ? (
            <View style={[styles.pillRow, { flex: 1 }]}>
              <Pressable
                onPress={() => {
                  openOrderSheet(ceSym, 'sell', { strike: item.strike, type: 'CE', bid: item.ce?.bid, ask: item.ce?.ask, ltp: item.ce?.ltp });
                  setActiveLeg(null);
                }}
                style={[styles.pill, { backgroundColor: colors.red }]}
                hitSlop={6}
              >
                <Text style={styles.pillTxt}>SELL</Text>
              </Pressable>
              <Pressable onPress={() => { openOptionChartForSymbol(ceSym, { bid: item.ce?.bid, ask: item.ce?.ask, ltp: item.ce?.ltp }); setActiveLeg(null); }} style={[styles.pillIcon, { backgroundColor: colors.blue }]} hitSlop={6}>
                <Ionicons name="stats-chart" size={13} color="#fff" />
              </Pressable>
              <Pressable
                onPress={() => {
                  openOrderSheet(ceSym, 'buy', { strike: item.strike, type: 'CE', bid: item.ce?.bid, ask: item.ce?.ask, ltp: item.ce?.ltp });
                  setActiveLeg(null);
                }}
                style={[styles.pill, { backgroundColor: colors.green }]}
                hitSlop={6}
              >
                <Text style={styles.pillTxt}>BUY</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <Text style={[styles.oiCell, { color: colors.t3 }]}>{fmtOI(ceOi)}</Text>
              <View style={styles.legCell}>
                <Text style={[styles.ltpCell, { color: colors.t1 }]}>{fmtPrice(ceLtp)}</Text>
                <Text style={[styles.pctCell, { color: cePct === null ? colors.t3 : cePct >= 0 ? colors.green : colors.red }]}>
                  {cePct === null ? '—' : `${cePct >= 0 ? '+' : ''}${cePct.toFixed(2)}%`}
                </Text>
              </View>
            </>
          )}
        </Pressable>

        {/* Strike center */}
        <View style={[styles.strikeCell, { borderColor: colors.border }]}>
          <Text style={{ color: isAtm ? colors.blue : colors.t1, fontSize: 13, fontWeight: '800' }}>
            {item.strike}
          </Text>
        </View>

        {/* PE side — mirror of CE. */}
        <Pressable
          onPress={() => toggleActiveLeg(item.strike, 'pe', peSym)}
          style={({ pressed }) => [styles.sidePressable, { opacity: pressed ? 0.6 : 1 }]}
          disabled={!peSym}
        >
          {peActive ? (
            <View style={[styles.pillRow, { flex: 1 }]}>
              <Pressable
                onPress={() => {
                  openOrderSheet(peSym, 'sell', { strike: item.strike, type: 'PE', bid: item.pe?.bid, ask: item.pe?.ask, ltp: item.pe?.ltp });
                  setActiveLeg(null);
                }}
                style={[styles.pill, { backgroundColor: colors.red }]}
                hitSlop={6}
              >
                <Text style={styles.pillTxt}>SELL</Text>
              </Pressable>
              <Pressable onPress={() => { openOptionChartForSymbol(peSym, { bid: item.pe?.bid, ask: item.pe?.ask, ltp: item.pe?.ltp }); setActiveLeg(null); }} style={[styles.pillIcon, { backgroundColor: colors.blue }]} hitSlop={6}>
                <Ionicons name="stats-chart" size={13} color="#fff" />
              </Pressable>
              <Pressable
                onPress={() => {
                  openOrderSheet(peSym, 'buy', { strike: item.strike, type: 'PE', bid: item.pe?.bid, ask: item.pe?.ask, ltp: item.pe?.ltp });
                  setActiveLeg(null);
                }}
                style={[styles.pill, { backgroundColor: colors.green }]}
                hitSlop={6}
              >
                <Text style={styles.pillTxt}>BUY</Text>
              </Pressable>
            </View>
          ) : (
            <>
              <View style={styles.legCell}>
                <Text style={[styles.ltpCell, { color: colors.t1 }]}>{fmtPrice(peLtp)}</Text>
                <Text style={[styles.pctCell, { color: pePct === null ? colors.t3 : pePct >= 0 ? colors.green : colors.red }]}>
                  {pePct === null ? '—' : `${pePct >= 0 ? '+' : ''}${pePct.toFixed(2)}%`}
                </Text>
              </View>
              <Text style={[styles.oiCell, { color: colors.t3 }]}>{fmtOI(peOi)}</Text>
            </>
          )}
        </Pressable>
      </View>
      </>
    );
  };

  // Underlying spot — show only lastPrice; bid/ask aren't an LTP.
  const spotDisplay = spot?.lastPrice ?? spot?.bid ?? spot?.ask;
  // Day-change %: prefer pre-computed change, else ltp-vs-close.
  const spotChangePct = (() => {
    const p = Number(spotDisplay || 0);
    const close = Number(spot?.close || spot?.ohlc?.close || spot?.previousClose || 0);
    if (spot && typeof spot.change === 'number' && close > 0) {
      return (spot.change / close) * 100;
    }
    if (p > 0 && close > 0) return ((p - close) / close) * 100;
    return null;
  })();

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg0 }]} edges={['top']}>
      {/* Page header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.t1} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.t1, fontSize: 17, fontWeight: '700' }}>Option Chain</Text>
          <Text style={{ color: colors.t3, fontSize: 11 }}>{underlying}</Text>
        </View>
        {/* Spot-price chip — visible colored pill instead of the tiny gray
            text it used to be. Green/red tint follows intraday direction
            so glancing at the header tells you whether calls or puts are
            likely in the money. Currency prefix is the underlying's
            native currency: Indian segments → ₹, crypto / international
            → $. */}
        {spotDisplay != null && Number(spotDisplay) > 0 && (
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: 4,
              paddingHorizontal: 8,
              paddingVertical: 4,
              borderRadius: 8,
              borderWidth: 1,
              backgroundColor: (spotChangePct ?? 0) >= 0 ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)',
              borderColor: (spotChangePct ?? 0) >= 0 ? 'rgba(16,185,129,0.35)' : 'rgba(239,68,68,0.35)',
              marginHorizontal: 6,
            }}
          >
            <Text style={{ color: (spotChangePct ?? 0) >= 0 ? colors.green : colors.red, fontSize: 12, fontWeight: '800' }}>
              {segment === 'CRYPTO' ? '$' : '₹'}{Number(spotDisplay).toFixed(2)}
            </Text>
            {spotChangePct !== null && (
              <Text style={{ color: (spotChangePct ?? 0) >= 0 ? colors.green : colors.red, fontSize: 10, fontWeight: '600', opacity: 0.9 }}>
                {spotChangePct >= 0 ? '+' : ''}{spotChangePct.toFixed(2)}%
              </Text>
            )}
          </View>
        )}
        <TouchableOpacity onPress={onRefresh} style={styles.iconBtn} hitSlop={10}>
          <Ionicons name="refresh" size={20} color={colors.t2} />
        </TouchableOpacity>
      </View>

      {/* Segment pills removed — Option Chain is always reached from a
          specific stock's "OPTION TRADE" button, so segment is already
          pre-selected by openOptionChainForSymbol in MarketScreen. Kept
          onSegmentChange around in case the underlying picker needs it
          later (e.g. switching NIFTY -> SENSEX auto-flips NSE -> BSE). */}

      {/* Underlying + expiry + strike-count selectors */}
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
        <TouchableOpacity
          style={[styles.selector, { backgroundColor: colors.bg2, borderColor: colors.border, flex: 0.7 }]}
          onPress={() => { didAutoScrollRef.current = false; setShowStrikeCountPicker(true); }}
          disabled={!strikes.length}
        >
          <Text style={[styles.selectorLabel, { color: colors.t3 }]}>STRIKES</Text>
          <View style={styles.selectorValueRow}>
            <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '700' }}>
              {strikeCount >= 999 ? 'All' : strikeCount}
            </Text>
            <Ionicons name="chevron-down" size={14} color={colors.t3} />
          </View>
        </TouchableOpacity>
      </View>

      {/* Calls / Puts section labels (match web layout) */}
      <View style={[styles.sectionLabelRow, { borderBottomColor: colors.border }]}>
        <Text style={[styles.sectionLabel, { color: colors.green }]}>Calls</Text>
        <Text style={[styles.sectionLabel, { color: colors.red }]}>Puts</Text>
      </View>

      {/* Column headers — OI · LTP · STRIKE · LTP · OI.
          CE / PE wrapper Views mirror the row's sidePressable layout so
          the header cells line up above the row cells. */}
      <View style={[styles.colHeader, { borderBottomColor: colors.border }]}>
        <View style={styles.sidePressable}>
          <Text style={[styles.hdrCell, styles.oiCell, { color: colors.t3 }]}>OI</Text>
          <Text style={[styles.hdrCell, styles.legCell, { color: colors.t3 }]}>LTP</Text>
        </View>
        <View style={[styles.strikeCell, { borderColor: 'transparent' }]}>
          <Text style={[styles.hdrCell, { color: colors.blue }]}>STRIKE</Text>
        </View>
        <View style={styles.sidePressable}>
          <Text style={[styles.hdrCell, styles.legCell, { color: colors.t3 }]}>LTP</Text>
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
          data={visibleStrikes}
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

      {/* Strike count picker */}
      <Modal visible={showStrikeCountPicker} transparent animationType="fade" onRequestClose={() => setShowStrikeCountPicker(false)}>
        <Pressable style={styles.modalOverlay} onPress={() => setShowStrikeCountPicker(false)}>
          <Pressable style={[styles.modalCard, { backgroundColor: colors.bg1, borderColor: colors.border }]} onPress={() => {}}>
            <Text style={[styles.modalTitle, { color: colors.t1 }]}>Strikes around ATM</Text>
            {STRIKE_COUNT_OPTIONS.map((n) => (
              <TouchableOpacity
                key={n}
                style={styles.modalRow}
                onPress={() => { setStrikeCount(n); didAutoScrollRef.current = false; setShowStrikeCountPicker(false); }}
              >
                <Text style={{ color: colors.t1, fontSize: 15, fontWeight: strikeCount === n ? '800' : '500' }}>
                  {n >= 999 ? 'All strikes' : `${n} strikes`}
                </Text>
                {strikeCount === n && <Ionicons name="checkmark" size={18} color={colors.blue} />}
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

  sectionLabelRow: { flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 8, borderBottomWidth: 1 },
  sectionLabel: { fontSize: 13, fontWeight: '700', letterSpacing: 0.4 },

  colHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 6, borderBottomWidth: 1 },
  hdrCell: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5, textAlign: 'center' },

  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8, paddingVertical: 10, minHeight: 54 },
  // ATM divider — 2px horizontal line with a floating price badge
  // centered on it. Rendered above the ATM row so the user sees exactly
  // where spot sits between strikes at a glance.
  atmDividerWrap: { height: 18, marginHorizontal: 12, alignItems: 'center', justifyContent: 'center', position: 'relative' },
  atmDividerLine: { position: 'absolute', left: 0, right: 0, top: 8, height: 2 },
  atmDividerBadge: { borderWidth: 2, borderRadius: 10, paddingHorizontal: 10, paddingVertical: 1 },
  // Wraps CLOSE + LTP (CE) or LTP + CLOSE (PE) into one tap area so
  // clicking either column reveals the SELL/chart/BUY pills.
  sidePressable: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  // OI columns on both ends — fixed narrow width, muted text.
  oiCell: { width: 56, textAlign: 'center', fontSize: 10, fontWeight: '500' },
  // LTP + Δ% stack. flex so it grows to fill the remaining width.
  legCell: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ltpCell: { fontSize: 14, fontWeight: '700' },
  pctCell: { fontSize: 11, fontWeight: '600', marginTop: 2 },

  strikeCell: { width: 72, alignItems: 'center', justifyContent: 'center', borderLeftWidth: 1, borderRightWidth: 1 },

  // Tap-to-reveal pills (mobile equivalent of the web's hover reveal).
  // Sized to fit inside one side of a ~360px screen after paddings.
  pillRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 3 },
  pill: { paddingHorizontal: 6, paddingVertical: 5, borderRadius: 11, minWidth: 40, alignItems: 'center' },
  pillIcon: { width: 26, height: 22, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  pillTxt: { color: '#fff', fontSize: 9, fontWeight: '800', letterSpacing: 0.3 },

  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', alignItems: 'center', padding: 24 },
  modalCard: { width: '100%', maxWidth: 320, borderRadius: 14, borderWidth: 1, paddingVertical: 8, maxHeight: '70%' },
  modalTitle: { fontSize: 13, fontWeight: '700', paddingHorizontal: 16, paddingVertical: 10, letterSpacing: 0.4 },
  modalRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingVertical: 12 },
});

export default OptionChainScreen;
