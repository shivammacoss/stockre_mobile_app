import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable, FlatList,
  TextInput, ScrollView, Modal, Dimensions, Alert, ActivityIndicator,
  PanResponder, Animated, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { useTheme } from '../../theme/ThemeContext';
import { tradingAPI, instrumentsAPI, userAPI, walletAPI } from '../../services/api';
import AppHeader from '../../components/AppHeader';
import { useNavigation, useRoute } from '@react-navigation/native';
import { useSegmentSettings } from '../../hooks/useSegmentSettings';

const SW = Dimensions.get('window').width;
const SH = Dimensions.get('window').height;

// Segment order matches the web client: Favourites → Indian → Crypto → International.
const SEGMENT_TABS = [
  { key: 'FAVOURITES', label: '★ Favourites' },
  // Indian markets first (per product spec — matches MarketPage.jsx)
  { key: 'NSE EQ', label: 'NSE EQ' },
  { key: 'NSE FUT', label: 'NSE FUT' },
  { key: 'NSE OPT', label: 'NSE OPT' },
  { key: 'BSE EQ', label: 'BSE EQ' },
  { key: 'MCX FUT', label: 'MCX FUT' },
  { key: 'MCX OPT', label: 'MCX OPT' },
  // Crypto
  { key: 'Crypto Perpetual', label: 'Crypto' },
  { key: 'Crypto Options', label: 'Options' },
  // International
  { key: 'Forex', label: 'Forex' },
  { key: 'Stocks (International)', label: 'Stocks' },
  { key: 'Indices', label: 'Indices' },
  { key: 'Commodities', label: 'Commodities' },
];

// Default instruments (same as web userConfig.js)
const DEFAULT_INSTRUMENTS: Record<string, any[]> = {
  'Forex': [
    { symbol: 'EURUSD', name: 'Euro/USD' }, { symbol: 'GBPUSD', name: 'GBP/USD' },
    { symbol: 'USDJPY', name: 'USD/JPY' }, { symbol: 'USDCHF', name: 'USD/CHF' },
    { symbol: 'AUDUSD', name: 'AUD/USD' }, { symbol: 'USDCAD', name: 'USD/CAD' },
    { symbol: 'NZDUSD', name: 'NZD/USD' }, { symbol: 'EURGBP', name: 'EUR/GBP' },
    { symbol: 'EURJPY', name: 'EUR/JPY' }, { symbol: 'GBPJPY', name: 'GBP/JPY' },
    { symbol: 'EURCHF', name: 'EUR/CHF' }, { symbol: 'EURAUD', name: 'EUR/AUD' },
    { symbol: 'AUDNZD', name: 'AUD/NZD' }, { symbol: 'CADJPY', name: 'CAD/JPY' },
    { symbol: 'AUDCAD', name: 'AUD/CAD' }, { symbol: 'EURNZD', name: 'EUR/NZD' },
    { symbol: 'CHFJPY', name: 'CHF/JPY' }, { symbol: 'AUDCHF', name: 'AUD/CHF' },
    { symbol: 'AUDJPY', name: 'AUD/JPY' }, { symbol: 'CADCHF', name: 'CAD/CHF' },
    { symbol: 'EURCAD', name: 'EUR/CAD' }, { symbol: 'GBPNZD', name: 'GBP/NZD' },
    { symbol: 'GBPCAD', name: 'GBP/CAD' }, { symbol: 'GBPCHF', name: 'GBP/CHF' },
    { symbol: 'NZDCAD', name: 'NZD/CAD' }, { symbol: 'NZDJPY', name: 'NZD/JPY' },
  ],
  'Indices': [
    { symbol: 'US30', name: 'Dow Jones' }, { symbol: 'US500', name: 'S&P 500' },
    { symbol: 'UK100', name: 'FTSE 100' },
  ],
  'Commodities': [
    { symbol: 'XAUUSD', name: 'Gold' }, { symbol: 'XAGUSD', name: 'Silver' },
    { symbol: 'USOIL', name: 'WTI Crude' }, { symbol: 'UKOIL', name: 'Brent Crude' },
  ],
  'Crypto Perpetual': [
    { symbol: 'BTCUSD', name: 'Bitcoin' }, { symbol: 'ETHUSD', name: 'Ethereum' },
    { symbol: 'LTCUSD', name: 'Litecoin' }, { symbol: 'XRPUSD', name: 'Ripple' },
    { symbol: 'ADAUSD', name: 'Cardano' },
  ],
};

const DEFAULT_WATCHLIST = ['XAUUSD', 'EURUSD', 'GBPUSD', 'USDJPY', 'BTCUSD', 'US30', 'USDCHF', 'AUDUSD'];

// Indian F&O segments — these have expiry dates and need filtering
const FNO_CATEGORIES_FOR_EXPIRY = new Set(['NSE FUT', 'NSE OPT', 'MCX FUT', 'MCX OPT', 'BSE FUT', 'BSE OPT']);

// Indian exchange codes used on Zerodha instrument payloads.
const INDIAN_EXCHANGES = new Set(['NSE', 'BSE', 'NFO', 'BFO', 'MCX', 'CDS']);

// Known Indian index underlyings. Used for ₹ / $ detection when the symbol
// isn't a registered instrument (e.g. user lands on NIFTY from a deep link
// before the NSE EQ segment has been loaded).
const INDIAN_INDEX_NAMES = [
  'NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50',
  'SENSEX', 'BANKEX',
];

/**
 * Return true if this symbol/instrument trades in ₹ (NSE/BSE/MCX/F&O).
 * Accepts an optional `inst` — when available we use its exchange / segment
 * / token metadata (most reliable). Falls back to well-known symbol
 * patterns so cash stocks (SBIN, RELIANCE), index symbols (NIFTY), and
 * F&O contracts (monthly + weekly expiries) still get ₹ formatting even
 * before the category list has been fetched.
 */
function looksIndian(sym: string, inst?: any): boolean {
  if (!sym) return false;
  if (inst) {
    const ex = String(inst.exchange || '').toUpperCase();
    if (INDIAN_EXCHANGES.has(ex)) return true;
    const seg = String(inst.segment || '').toLowerCase();
    if (seg.startsWith('nse') || seg.startsWith('bse') || seg.startsWith('mcx') || seg.startsWith('nfo') || seg.startsWith('bfo')) return true;
    const cat = String(inst.category || '').toLowerCase();
    if (cat.startsWith('nse_') || cat.startsWith('bse_') || cat.startsWith('mcx_')) return true;
    // Every Zerodha instrument carries a numeric token; Delta / Infoway don't.
    if (inst.token) return true;
    if (String(inst.source || '').toLowerCase() === 'zerodha' || String(inst.source || '').toLowerCase() === 'accelpix') return true;
  }
  const s = sym.toUpperCase();
  // Indian F&O contracts. Two accepted endings:
  //   options → digit + CE/PE   (strike price ends the symbol)
  //   futures → literal FUT     (no strike; just YYMON prefix)
  // Covers monthly (SBIN25APR1050CE, GOLDM26MAYFUT) and weekly
  // (NIFTY24D0524000CE) Kite tradingsymbol formats.
  if (/^[A-Z&]{2,}\d+.*(?:\d(?:CE|PE)|FUT)$/.test(s)) return true;
  // Underlying index names.
  if (INDIAN_INDEX_NAMES.some((n) => s === n || s.startsWith(n))) return true;
  return false;
}

// Map segment tab key → Zerodha segment code (matches web)
const ZERODHA_SEGMENT_MAP: Record<string, string> = {
  'NSE EQ': 'nseEq', 'NSE FUT': 'nseFut', 'NSE OPT': 'nseOpt',
  'BSE EQ': 'bseEq', 'MCX FUT': 'mcxFut', 'MCX OPT': 'mcxOpt',
};

/** Hide Indian F&O whose expiry date is before today in IST (matches server cleanup). */
function isExpiredFnO(category: string, expiryRaw?: string | number | Date | null): boolean {
  if (!FNO_CATEGORIES_FOR_EXPIRY.has(category) || expiryRaw == null || expiryRaw === '') return false;
  const d = new Date(expiryRaw as any);
  if (Number.isNaN(d.getTime())) return false;
  const istExp = new Date(d.toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const istNow = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }));
  const exp0 = new Date(istExp.getFullYear(), istExp.getMonth(), istExp.getDate()).getTime();
  const now0 = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate()).getTime();
  return exp0 < now0;
}

const MarketScreen: React.FC = () => {
  const { user } = useAuth();
  const { prices, isConnected } = useSocket();
  const { colors } = useTheme();
  const navigation = useNavigation<any>();
  const route = useRoute<any>();
  const [activeCat, setActiveCat] = useState('FAVOURITES');
  const [search, setSearch] = useState('');
  const [instrumentsByCategory, setInstrumentsByCategory] = useState<Record<string, any[]>>(DEFAULT_INSTRUMENTS);
  const [favourites, setFavourites] = useState<string[]>(DEFAULT_WATCHLIST);
  const [loading, setLoading] = useState(true);
  const [indianResults, setIndianResults] = useState<any[]>([]);
  const [indianSearching, setIndianSearching] = useState(false);
  const indianSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Prices seeded from route params (e.g. OptionChain -> order-sheet
  // deep link). Stored per-symbol so the fallback works for any option
  // leg the user drills into.
  const [seedPrices, setSeedPrices] = useState<Record<string, { bid: number; ask: number; lastPrice: number }>>({});

  // Order panel state
  const [orderSheetOpen, setOrderSheetOpen] = useState(false);
  const [orderSymbol, setOrderSymbol] = useState('XAUUSD');
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState('market');
  const [volume, setVolume] = useState('0.01');
  const [lotSize, setLotSize] = useState(1);
  const [limitPrice, setLimitPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [showSL, setShowSL] = useState(false);
  const [showTP, setShowTP] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [tradingMode, setTradingMode] = useState('netting');
  const [allowedTradeModes, setAllowedTradeModes] = useState<{ netting: boolean; binary: boolean }>({ netting: true, binary: false });
  // Binary state
  const [binaryDirection, setBinaryDirection] = useState<'up' | 'down'>('up');
  const [binaryAmount, setBinaryAmount] = useState('100');
  const [binaryExpiry, setBinaryExpiry] = useState(300);
  const [wallet, setWallet] = useState<any>(null);
  const [walletINR, setWalletINR] = useState<{ balance: number }>({ balance: 0 });

  // Animated bottom-sheet: translateY drives both open/close + swipe
  const sheetAnim = useRef(new Animated.Value(SH)).current;          // starts off-screen
  const backdropAnim = useRef(new Animated.Value(0)).current;        // backdrop opacity
  const sheetDragOffset = useRef(0);                                 // tracks drag during gesture

  const openSheet = useCallback(() => {
    setOrderSheetOpen(true);
    sheetAnim.setValue(SH);
    backdropAnim.setValue(0);
    Animated.parallel([
      Animated.spring(sheetAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }),
      Animated.timing(backdropAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();
  }, []);

  const closeSheet = useCallback(() => {
    Animated.parallel([
      Animated.timing(sheetAnim, { toValue: SH, duration: 220, useNativeDriver: true }),
      Animated.timing(backdropAnim, { toValue: 0, duration: 220, useNativeDriver: true }),
    ]).start(() => {
      setOrderSheetOpen(false);
    });
  }, []);

  const sheetPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_, g) => g.dy > 5,
      onPanResponderGrant: () => { sheetDragOffset.current = 0; },
      onPanResponderMove: (_, g) => {
        if (g.dy > 0) {
          sheetDragOffset.current = g.dy;
          sheetAnim.setValue(g.dy);
          backdropAnim.setValue(Math.max(0, 1 - g.dy / (SH * 0.85)));
        }
      },
      onPanResponderRelease: (_, g) => {
        if (g.dy > 80 || g.vy > 0.5) {
          closeSheet();
        } else {
          Animated.parallel([
            Animated.spring(sheetAnim, { toValue: 0, useNativeDriver: true, tension: 65, friction: 11 }),
            Animated.timing(backdropAnim, { toValue: 1, duration: 150, useNativeDriver: true }),
          ]).start();
        }
      },
    })
  ).current;

  useEffect(() => {
    // Reset instrument + wallet state on user change so switching accounts
    // doesn't leave the previous user's data on screen if the new fetch
    // returns a smaller set or fails.
    setInstrumentsByCategory(DEFAULT_INSTRUMENTS);
    setFavourites(DEFAULT_WATCHLIST);
    setIndianResults([]);
    setWallet(null);
    setWalletINR({ balance: 0 });
    loadData();
  }, [user?.id, user?.oderId]);

  const loadData = async () => {
    setLoading(true);
    await Promise.all([fetchInstruments(), fetchWallet(), fetchAllowedTradeModes()]);
    setLoading(false);
  };

  const fetchWallet = async () => {
    if (!user?.id && !user?.oderId) return;
    try {
      const uid = user?.oderId || user?.id || '';
      const res = await walletAPI.getUserWallet(uid);
      if (res.data?.wallet) setWallet(res.data.wallet);
      if (res.data?.walletINR) setWalletINR(res.data.walletINR);
    } catch (_) {}
  };

  const fetchAllowedTradeModes = async () => {
    if (!user?.id && !user?.oderId) return;
    try {
      const uid = user?.oderId || user?.id || '';
      const res = await userAPI.getUserDetails(uid);
      if (res.data?.success && res.data?.user) {
        const u = res.data.user;
        const raw = u.allowedTradeModes || {};
        let modes: { netting: boolean; binary: boolean } = {
          netting: true,
          binary: !!raw.binary,
        };
        if (u.role === 'admin' || u.role === 'superadmin') {
          modes = { netting: true, binary: true };
        }
        setAllowedTradeModes(modes);
        if (!modes[tradingMode as keyof typeof modes]) {
          setTradingMode('netting');
        }
      }
    } catch (_) {}
  };

  const fetchInstruments = async () => {
    try {
      const userId = user?.oderId || user?.id;
      if (userId) {
        const res = await userAPI.getUserInstruments(userId);
        if (res.data?.success && res.data?.instruments) {
          const dbInst = res.data.instruments;
          setInstrumentsByCategory(prev => {
            const merged = { ...prev };
            Object.keys(dbInst).forEach(cat => {
              if (dbInst[cat] && dbInst[cat].length > 0) {
                merged[cat] = dbInst[cat];
              }
            });
            return merged;
          });
        }
      }
      const [metaRes, deltaRes] = await Promise.all([
        instrumentsAPI.getInstruments().catch(() => ({ data: { instruments: [] } })),
        instrumentsAPI.getDeltaInstruments().catch(() => ({ data: { instruments: [] } })),
      ]);
      const metaInst = Array.isArray(metaRes.data?.instruments) ? metaRes.data.instruments : [];
      const deltaInst = Array.isArray(deltaRes.data?.instruments) ? deltaRes.data.instruments : [];
      setInstrumentsByCategory(prev => {
        const merged = { ...prev };
        metaInst.forEach((inst: any) => {
          const cat = inst.category?.toLowerCase() || '';
          let targetCat = 'Forex';
          if (cat.includes('forex') || cat === 'yen') targetCat = 'Forex';
          else if (cat.includes('indic') || cat.includes('index')) targetCat = 'Indices';
          else if (cat.includes('metal') || cat.includes('energy') || cat.includes('commod')) targetCat = 'Commodities';
          else if (cat.includes('stock')) targetCat = 'Stocks (International)';
          if (!merged[targetCat]) merged[targetCat] = [];
          if (!merged[targetCat].some((i: any) => i.symbol === inst.symbol)) {
            merged[targetCat].push(inst);
          }
        });
        deltaInst.forEach((inst: any) => {
          const cat = inst.contract_type === 'call_options' || inst.contract_type === 'put_options'
            ? 'Crypto Options' : 'Crypto Perpetual';
          if (!merged[cat]) merged[cat] = [];
          if (!merged[cat].some((i: any) => i.symbol === inst.symbol)) {
            merged[cat].push(inst);
          }
        });
        return merged;
      });
    } catch (e) {
      console.error('Failed to fetch instruments:', e);
    }
  };

  const isIndianSegment = activeCat in ZERODHA_SEGMENT_MAP;

  const getInstrumentsForCategory = useCallback(() => {
    if (activeCat === 'FAVOURITES') {
      const allInst = Object.values(instrumentsByCategory).flat();
      return favourites.map(sym => {
        const found = allInst.find((i: any) => i.symbol === sym);
        return found || { symbol: sym, name: sym };
      });
    }
    // Indian segments with active search → use server results
    if (isIndianSegment && search.trim().length >= 2) {
      return indianResults;
    }
    const list = instrumentsByCategory[activeCat] || [];
    // Strip expired F&O (matches web UserLayout cleanup)
    return list.filter((inst: any) => !isExpiredFnO(activeCat, inst.expiry));
  }, [activeCat, instrumentsByCategory, favourites, isIndianSegment, search, indianResults]);

  const instruments = getInstrumentsForCategory().filter((inst: any) => {
    // For Indian segments, server already filtered — skip local filter
    if (isIndianSegment && search.trim().length >= 2) return true;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (inst.symbol || '').toLowerCase().includes(q) || (inst.name || '').toLowerCase().includes(q);
  });

  // Debounced Zerodha search for Indian segments
  useEffect(() => {
    if (!isIndianSegment) { setIndianResults([]); setIndianSearching(false); return; }
    const q = search.trim();
    if (q.length < 2) { setIndianResults([]); return; }
    if (indianSearchTimer.current) clearTimeout(indianSearchTimer.current);
    indianSearchTimer.current = setTimeout(async () => {
      setIndianSearching(true);
      try {
        const seg = ZERODHA_SEGMENT_MAP[activeCat] || 'nseEq';
        const res = await instrumentsAPI.searchZerodha(q, seg);
        if (res.data?.success && Array.isArray(res.data.instruments)) {
          const filtered = res.data.instruments.filter((i: any) => !isExpiredFnO(activeCat, i.expiry));
          setIndianResults(filtered);
        } else {
          setIndianResults([]);
        }
      } catch {
        setIndianResults([]);
      } finally {
        setIndianSearching(false);
      }
    }, 350);
    return () => { if (indianSearchTimer.current) clearTimeout(indianSearchTimer.current); };
  }, [search, activeCat, isIndianSegment]);

  // Parse an Indian F&O tradingsymbol into its parts so the order sheet
  // can render "HDFCLIFE · 525 CE · 28 Apr" instead of a dense
  // "HDFCLIFE26APR525CE". Returns null for anything that isn't an option
  // or future — the caller falls back to showing orderSymbol as-is.
  const parseFnoSymbol = (sym: string): { underlying: string; strike?: number; kind: 'CE' | 'PE' | 'FUT'; expiry: string } | null => {
    const m = /^([A-Z&]+)(\d{2})([A-Z]{3})(\d*)(CE|PE|FUT)$/.exec((sym || '').toUpperCase());
    if (!m) return null;
    const [, underlying, yy, mon, strikeRaw, kind] = m;
    return {
      underlying,
      strike: strikeRaw ? Number(strikeRaw) : undefined,
      kind: kind as 'CE' | 'PE' | 'FUT',
      expiry: `${mon} 20${yy}`,
    };
  };

  // Check if a symbol belongs to an Indian segment (has ₹ pricing).
  // Accepts an optional inst — when present we inspect exchange / segment
  // / token metadata (authoritative). Otherwise we fall back to looking
  // the symbol up in the already-loaded category lists, search results,
  // and a pattern-based check (covers cash stocks, indices, and F&O
  // contracts in both monthly and weekly formats).
  const isIndianSymbol = useCallback((sym: string, inst?: any): boolean => {
    if (!sym) return false;
    if (looksIndian(sym, inst)) return true;
    for (const cat of Object.keys(ZERODHA_SEGMENT_MAP)) {
      const found = instrumentsByCategory[cat]?.find((i: any) => i.symbol === sym);
      if (found) return true;
    }
    if (indianResults.some((i: any) => i.symbol === sym)) return true;
    // Current tab is an Indian segment — anything we render there is ₹.
    if (isIndianSegment) return true;
    return false;
  }, [instrumentsByCategory, isIndianSegment, indianResults]);

  const fmtP = (sym: string, val?: number, inst?: any) => {
    if (!val || val === 0) return '---';
    if (isIndianSymbol(sym, inst)) {
      return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (sym.includes('JPY') || sym.includes('XAU') || sym.includes('XAG') || sym.includes('BTC') ||
        sym.includes('ETH') || sym.includes('US3') || sym.includes('US5') || sym.includes('UK1') ||
        sym.includes('OIL')) {
      return `$${val.toFixed(sym.includes('BTC') || sym.includes('ETH') ? 4 : 2)}`;
    }
    if (sym.includes('USDJPY') || sym.includes('EURJPY') || sym.includes('GBPJPY') || sym.includes('CADJPY') ||
        sym.includes('AUDJPY') || sym.includes('NZDJPY') || sym.includes('CHFJPY')) {
      return `$${val.toFixed(2)}`;
    }
    return `$${val.toFixed(4)}`;
  };

  const isInstrumentInSegment = useCallback((sym: string): boolean => {
    return instrumentsByCategory[activeCat]?.some((i: any) => i.symbol === sym) || false;
  }, [instrumentsByCategory, activeCat]);

  const addZerodhaInstrument = async (inst: any) => {
    try {
      const res = await instrumentsAPI.subscribeZerodhaInstrument(inst);
      if (res.data?.success) {
        setInstrumentsByCategory(prev => {
          const merged = { ...prev };
          const list = merged[activeCat] ? [...merged[activeCat]] : [];
          if (!list.some((i: any) => i.symbol === inst.symbol)) {
            list.push(inst);
          }
          merged[activeCat] = list;
          return merged;
        });
      } else {
        Alert.alert('Error', res.data?.error || 'Failed to add instrument');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    }
  };

  const removeZerodhaInstrument = async (inst: any) => {
    if (!inst.token) {
      Alert.alert('Error', 'Cannot remove: missing token');
      return;
    }
    try {
      const res = await instrumentsAPI.unsubscribeZerodhaInstrument(inst.token);
      if (res.data?.success) {
        setInstrumentsByCategory(prev => {
          const merged = { ...prev };
          if (merged[activeCat]) {
            merged[activeCat] = merged[activeCat].filter((i: any) => i.symbol !== inst.symbol);
          }
          return merged;
        });
      } else {
        Alert.alert('Error', res.data?.error || 'Failed to remove instrument');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    }
  };

  const openOrderSheet = (sym: string) => {
    console.log('[Market] Opening order sheet for', sym);
    setOrderSymbol(sym);
    setOrderSide('buy');
    setOrderType('market');
    // Indian markets trade in whole lots; FX/commodities/crypto in 0.01 micro-lots.
    setVolume(isIndianSymbol(sym) ? '1' : '0.01');
    setLotSize(1);
    setStopLoss('');
    setTakeProfit('');
    setLimitPrice('');
    setShowSL(false);
    setShowTP(false);
    setBinaryDirection('up');
    setBinaryAmount('100');
    setBinaryExpiry(300);
    openSheet();
  };

  const openChartForSymbol = (sym: string) => {
    navigation.navigate('Chart', { symbol: sym });
  };

  // Open the Option Chain screen for the underlying of whatever option /
  // future / equity is currently selected. Strips expiry/strike tails so
  // HDFCBANK25APR800CE -> HDFCBANK, NIFTY25APR23000PE -> NIFTY. Auto-picks
  // segment by underlying — only called for Indian symbols (button hides
  // otherwise; see renderOptionTradeBtn).
  const openOptionChainForSymbol = (sym: string) => {
    closeSheet();
    const underlyingName = (sym.match(/^[A-Z]+/)?.[0] || sym).toUpperCase();
    const MCX_UNDERLYINGS = ['GOLD', 'GOLDM', 'SILVER', 'SILVERM', 'CRUDEOIL', 'NATURALGAS', 'COPPER', 'ZINC', 'ALUMINIUM', 'LEAD', 'NICKEL'];
    const BSE_UNDERLYINGS = ['SENSEX', 'BANKEX'];
    const seg = MCX_UNDERLYINGS.includes(underlyingName)
      ? 'MCX'
      : BSE_UNDERLYINGS.includes(underlyingName)
        ? 'BSE'
        : 'NSE';
    navigation.navigate('OptionChain', { segment: seg, underlying: underlyingName });
  };

  // Deep-link hook — when another screen (e.g. OptionChain) navigates here
  // with { openOrderFor, preferredSide, seedBid, seedAsk, seedLtp }, open
  // the order sheet on mount with that symbol + side pre-selected and
  // seed the price fallback so Bid/Ask/LTP actually render (options aren't
  // on the mobile WS feed). Params cleared after consuming.
  useEffect(() => {
    const sym = route.params?.openOrderFor;
    if (!sym) return;
    const side = route.params?.preferredSide;
    const seedBid = Number(route.params?.seedBid || 0);
    const seedAsk = Number(route.params?.seedAsk || 0);
    const seedLtp = Number(route.params?.seedLtp || 0);
    if (seedBid > 0 || seedAsk > 0 || seedLtp > 0) {
      setSeedPrices((prev) => ({
        ...prev,
        [String(sym)]: { bid: seedBid, ask: seedAsk, lastPrice: seedLtp },
      }));
    }
    openOrderSheet(String(sym));
    if (side === 'buy' || side === 'sell') {
      // openOrderSheet resets side to 'buy' by default; override after.
      setOrderSide(side);
    }
    navigation.setParams?.({
      openOrderFor: undefined,
      preferredSide: undefined,
      seedBid: undefined,
      seedAsk: undefined,
      seedLtp: undefined,
    });
  }, [route.params?.openOrderFor, route.params?.preferredSide, route.params?.seedBid, route.params?.seedAsk, route.params?.seedLtp]);

  const handlePlaceOrder = async () => {
    if (!user?.id && !user?.oderId) return;
    setIsPlacingOrder(true);
    try {
      const uid = user?.oderId || user?.id || '';
      // ── Unified trade contract ──
      // Both Web and Mobile follow the same rules:
      //   symbol     = Zerodha tradingsymbol (server-composed, e.g. HDFCLIFE26APR530CE)
      //   price(buy) = ask    price(sell) = bid
      //   entry must be > 0 — no 0 / stale-price orders
      //   source    = live WS tick when present, else the seeded price
      //               (populated from OptionChain REST /quote for options
      //               that aren't on the WS feed)
      const p = prices[orderSymbol] || seedPrices[orderSymbol] || null;
      // Use the spread-adjusted quote the user actually saw on the
      // BUY / SELL cards. Server gets `spreadPreApplied: true` below
      // so it doesn't add the spread a second time.
      const rawBid = Number(p?.bid || p?.lastPrice || 0);
      const rawAsk = Number(p?.ask || p?.lastPrice || 0);
      const adjusted =
        rawBid > 0 || rawAsk > 0 ? adjustQuote(rawBid, rawAsk) : { bid: rawBid, ask: rawAsk, spreadAmount: 0 };
      const entryPrice = orderSide === 'buy' ? Number(adjusted.ask || 0) : Number(adjusted.bid || 0);

      // Strict guard — reject before any network call if the price the
      // user would trade at is missing/zero. Keeps behaviour identical
      // to the web MarketPage onTrade handler.
      if (tradingMode !== 'binary' && (!entryPrice || entryPrice <= 0)) {
        Alert.alert(
          'Cannot place order',
          `${orderSymbol} has no live ${orderSide === 'buy' ? 'ask' : 'bid'} right now. Wait for the next tick and try again.`,
        );
        setIsPlacingOrder(false);
        return;
      }

      // Pre-trade segment check: enforce admin-set min lot, per-order
      // cap, max lot per script, and segment-disabled flags before
      // hitting the server. Mirrors web MarketPage validation.
      if (tradingMode !== 'binary') {
        const v = parseFloat(volume) || 0;
        const r = validateLot(v);
        if (!r.ok) {
          Alert.alert('Cannot place order', r.message || 'Invalid lot size.');
          setIsPlacingOrder(false);
          return;
        }
      }

      if (tradingMode === 'binary') {
        await tradingAPI.placeOrder({
          userId: uid,
          symbol: orderSymbol,
          side: binaryDirection,
          volume: parseFloat(binaryAmount) || 100,
          orderType: 'market',
          price: adjusted.bid || 0,
          mode: 'binary',
          marketData: { bid: adjusted.bid || 0, ask: adjusted.ask || 0 },
          session: `${binaryExpiry}`,
        } as any);
        const expiryLabel = binaryExpiry >= 60 ? `${Math.floor(binaryExpiry / 60)}m` : `${binaryExpiry}s`;
        Alert.alert('Success', `${binaryDirection.toUpperCase()} ₹${binaryAmount} on ${orderSymbol} - ${expiryLabel}`);
      } else {
        // When trading an option deep-linked from OptionChainScreen the
        // symbol isn't in the local watchlist, so activeInstrument is
        // null and exchange/segment come through as undefined. Derive
        // them from the tradingsymbol pattern so the server gets the
        // same fields it would from the watchlist flow.
        const fnoExchange = (() => {
          if (activeInstrument?.exchange) return activeInstrument.exchange;
          const under = (orderSymbol.match(/^[A-Z&]+/)?.[0] || '').toUpperCase();
          if (['GOLD','GOLDM','SILVER','SILVERM','CRUDEOIL','NATURALGAS','COPPER','ZINC','ALUMINIUM','LEAD','NICKEL'].includes(under)) return 'MCX';
          if (['SENSEX','BANKEX'].includes(under)) return 'BFO';
          if (/^[A-Z&]+\d{2}[A-Z]{3}\d*(CE|PE|FUT)$/.test(orderSymbol)) return 'NFO';
          return undefined;
        })();
        const fnoSegment = activeInstrument?.segment || activeCat || (
          /^[A-Z&]+\d{2}[A-Z]{3}\d*(CE|PE)$/.test(orderSymbol) ? 'NSE OPT'
          : /^[A-Z&]+\d{2}[A-Z]{3}FUT$/.test(orderSymbol) ? 'NSE FUT'
          : undefined
        );

        await tradingAPI.placeOrder({
          userId: uid,
          symbol: orderSymbol,
          side: orderSide,
          volume: parseFloat(volume) || 0.01,
          orderType,
          price: orderType !== 'market' ? parseFloat(limitPrice) : entryPrice,
          stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
          takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
          mode: tradingMode,
          exchange: fnoExchange,
          segment: fnoSegment,
          lotSize: activeLotSize,
          // Send the same bid/ask the user saw on the cards. For market
          // orders flag `spreadPreApplied: true` so the engine doesn't
          // re-apply the segment spread on top of an already-adjusted
          // entry price (matches web MarketPage).
          marketData: { bid: adjusted.bid || 0, ask: adjusted.ask || 0 },
          spreadPreApplied: orderType === 'market',
        } as any);
        Alert.alert('Success', `${orderSide.toUpperCase()} ${volume} lots ${orderSymbol} placed`);
      }
      closeSheet();
    } catch (e: any) {
      Alert.alert('Order Error', e?.response?.data?.error || e?.response?.data?.message || e.message);
    } finally {
      setIsPlacingOrder(false);
    }
  };

  const toggleFav = (sym: string) => {
    setFavourites(prev => prev.includes(sym) ? prev.filter(s => s !== sym) : [...prev, sym]);
  };

  // Seeded prices for symbols that aren't on the mobile WS tick feed
  // (mainly option contracts deep-linked from OptionChainScreen). Keyed
  // by tradingsymbol so multiple legs can coexist; live WS ticks always
  // win when present.
  const orderPrice =
    prices[orderSymbol] ||
    seedPrices[orderSymbol] ||
    undefined;

  // Resolve the active instrument object (for lotSize, exchange, etc.)
  const activeInstrument: any = useMemo(() => {
    for (const cat of Object.keys(instrumentsByCategory)) {
      const hit = instrumentsByCategory[cat]?.find((i: any) => i.symbol === orderSymbol);
      if (hit) return hit;
    }
    return indianResults.find((i: any) => i.symbol === orderSymbol) || null;
  }, [orderSymbol, instrumentsByCategory, indianResults]);

  const activeLotSize = Number(activeInstrument?.lotSize) || 1;
  const isOrderIndian = isIndianSymbol(orderSymbol, activeInstrument);

  // Pull effective NettingSegment settings for the active symbol —
  // admin-configured min lot / per-order lot / max lot caps + segment
  // block flags. Without this the mobile ticket was using its own
  // hardcoded min lot (1 / 0.01) and ignoring whatever the admin set
  // (e.g. min lot 1 was bypassed by 0.1-lot orders).
  const { settings: segmentSettings, validateLot, adjustQuote } = useSegmentSettings(
    orderSymbol,
    activeInstrument,
    user?.oderId,
    tradingMode,
  );

  // Stepper increment + floor for the lot input. Admin's minLots wins
  // when present; fall back to the per-market default. The stepper
  // increment also tracks minLots so admins setting a fractional min
  // (e.g. 0.3) can actually be reached from the +/- buttons — without
  // this the Indian-default step of 1 would skip past 0.3 → 1.3.
  const adminMinLot =
    typeof segmentSettings?.minLots === 'number' && segmentSettings.minLots! > 0
      ? Number(segmentSettings.minLots)
      : null;
  const defaultLotStep = isOrderIndian ? 1 : 0.01;
  const lotStep = adminMinLot != null && adminMinLot < defaultLotStep ? adminMinLot : defaultLotStep;
  const minLot = adminMinLot ?? (isOrderIndian ? 1 : 0.01);

  // Snap the lot input up to the admin minimum once segment settings
  // load. openOrderSheet defaulted to 1 / 0.01; if admin set min 0.3,
  // we want the ticket to start at 0.3 not 1. Only snaps on increase
  // so the user's typed value isn't overwritten downward.
  useEffect(() => {
    if (!minLot || minLot <= 0) return;
    const cur = parseFloat(volume) || 0;
    if (cur < minLot) setVolume(String(minLot));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [minLot]);

  // Spread-adjusted bid/ask the user actually sees and trades on.
  // Mirrors web UserLayout.applySegmentSpread: mid ± half(spread). The
  // raw Zerodha tick has bid==ask==LTP for Indian instruments, so
  // without this every Indian order opened at the server's
  // post-spread price (different from what the ticket displayed).
  const tradeQuote = useMemo(() => {
    const rawBid = Number(orderPrice?.bid || orderPrice?.lastPrice || 0);
    const rawAsk = Number(orderPrice?.ask || orderPrice?.lastPrice || 0);
    if (rawBid <= 0 && rawAsk <= 0) return { bid: rawBid, ask: rawAsk, spreadAmount: 0 };
    return adjustQuote(rawBid, rawAsk);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orderPrice?.bid, orderPrice?.ask, orderPrice?.lastPrice, segmentSettings?.spreadPips, segmentSettings?.spreadType]);

  const bal = Number(wallet?.balance || 0);

  // ── INSTRUMENT ROW ──
  const renderInstrument = ({ item: inst }: { item: any }) => {
    const sym = inst.symbol || '';
    const name = inst.name || '';
    const p = prices[sym];
    const bid = p?.bid || p?.lastPrice || p?.mark_price || 0;
    const ask = p?.ask || p?.lastPrice || p?.mark_price || 0;
    const spread = bid > 0 && ask > 0 ? Math.abs(ask - bid) : 0;
    const isFav = favourites.includes(sym);
    const isSearching = isIndianSegment && search.trim().length >= 2;
    const alreadyAdded = isIndianSegment && isInstrumentInSegment(sym);
    const showAddButton = isSearching && !alreadyAdded;
    const showRemoveButton = isIndianSegment && !isSearching;
    return (
      <View style={[styles.instRow, { borderBottomColor: colors.border }]}>
        {/* Tappable body */}
        <Pressable
          style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }}
          onPress={() => !showAddButton && openOrderSheet(sym)}
          android_ripple={{ color: colors.blueDim }}
        >
          {/* Left: symbol + name (+ expiry tag for F&O) */}
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={{ color: colors.t1, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{sym}</Text>
            <Text style={{ color: colors.t3, fontSize: 11, marginTop: 1 }} numberOfLines={1}>
              {name}{inst.expiry ? ` • Exp: ${inst.expiry}` : ''}
            </Text>
          </View>
          {/* Center: bid / spread / ask (hidden for search results not yet added) */}
          {!showAddButton && (
            <View style={{ alignItems: 'flex-end', marginRight: 10 }}>
              <Text style={{ color: colors.red, fontSize: 14, fontWeight: '600' }}>
                {fmtP(sym, bid, inst)}
              </Text>
              <Text style={{ color: colors.t3, fontSize: 10 }}>
                {spread > 0 ? spread.toFixed(isIndianSymbol(sym, inst) ? 2 : sym.includes('JPY') || sym.includes('XAU') || sym.includes('BTC') ? 2 : 4) : '0.00'}
              </Text>
              <Text style={{ color: colors.green, fontSize: 14, fontWeight: '600' }}>
                {fmtP(sym, ask, inst)}
              </Text>
            </View>
          )}
        </Pressable>
        {/* Right actions */}
        <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center', paddingLeft: 6 }}>
          {showAddButton ? (
            <TouchableOpacity
              style={[styles.addBtn, { backgroundColor: colors.blue }]}
              onPress={() => addZerodhaInstrument(inst)}
              activeOpacity={0.7}
            >
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={{ color: '#fff', fontSize: 12, fontWeight: '600', marginLeft: 2 }}>Add</Text>
            </TouchableOpacity>
          ) : (
            <>
              <TouchableOpacity style={styles.iconBtn} onPress={() => openChartForSymbol(sym)} activeOpacity={0.6}>
                <Ionicons name="bar-chart-outline" size={20} color={colors.t3} />
              </TouchableOpacity>
              <TouchableOpacity style={styles.iconBtn} onPress={() => toggleFav(sym)} activeOpacity={0.6}>
                <Ionicons name={isFav ? 'star' : 'star-outline'} size={20} color={isFav ? colors.amber : colors.t3} />
              </TouchableOpacity>
              {showRemoveButton && (
                <TouchableOpacity
                  style={styles.iconBtn}
                  onPress={() => removeZerodhaInstrument(inst)}
                  activeOpacity={0.6}
                >
                  <Ionicons name="trash-outline" size={18} color={colors.red} />
                </TouchableOpacity>
              )}
            </>
          )}
          {alreadyAdded && isSearching && (
            <Text style={{ color: colors.green, fontSize: 11, fontWeight: '600', marginLeft: 4 }}>Added</Text>
          )}
        </View>
      </View>
    );
  };

  return (
    <>
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg0 }]} edges={['top']}>
      <AppHeader />

      {/* ── Segment tabs (horizontal scroll, matches Image 1) ── */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ backgroundColor: colors.bg0, maxHeight: 42, minHeight: 42 }}
        contentContainerStyle={{ paddingHorizontal: 8, alignItems: 'center', gap: 0 }}
      >
        {SEGMENT_TABS.map(tab => {
          const active = activeCat === tab.key;
          return (
            <TouchableOpacity
              key={tab.key}
              style={{ paddingHorizontal: 14, paddingVertical: 10, borderBottomWidth: 2, borderBottomColor: active ? colors.blue : 'transparent' }}
              onPress={() => { setActiveCat(tab.key); setSearch(''); setIndianResults([]); }}
            >
              <Text style={{ color: active ? colors.blue : colors.t3, fontSize: 13, fontWeight: active ? '700' : '500' }}>
                {tab.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </ScrollView>

      {/* ── Search bar (always visible, segment-aware placeholder) ── */}
      <View style={{ paddingHorizontal: 10, paddingTop: 6, paddingBottom: 4 }}>
        <View style={[styles.searchWrap, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
          <Ionicons name="search" size={16} color={colors.t3} style={{ marginRight: 8 }} />
          <TextInput
            style={{ flex: 1, color: colors.t1, fontSize: 13, padding: 0 }}
            placeholder={
              isIndianSegment
                ? `Search ${activeCat} (e.g. RELIANCE)...`
                : 'Search instruments...'
            }
            placeholderTextColor={colors.t3}
            value={search}
            onChangeText={setSearch}
            autoCorrect={false}
            autoCapitalize="characters"
          />
          {indianSearching && <ActivityIndicator size="small" color={colors.blue} />}
          {search.length > 0 && !indianSearching && (
            <Pressable onPress={() => setSearch('')} hitSlop={8}>
              <Ionicons name="close-circle" size={16} color={colors.t3} />
            </Pressable>
          )}
        </View>
        {isIndianSegment && search.trim().length > 0 && search.trim().length < 2 && (
          <Text style={{ color: colors.t3, fontSize: 10, marginTop: 4, marginLeft: 4 }}>
            Type at least 2 characters to search
          </Text>
        )}
      </View>

      {/* ── Instrument list (matches Image 1) ── */}
      <FlatList
        data={instruments}
        renderItem={renderInstrument}
        keyExtractor={(i: any, idx) => (i.symbol || '') + idx}
        style={{ flex: 1, backgroundColor: colors.bg0 }}
        contentContainerStyle={{ paddingBottom: 80 }}
        ListEmptyComponent={
          <View style={{ alignItems: 'center', paddingVertical: 48 }}>
            <Text style={{ color: colors.t3, fontSize: 13 }}>
              {loading
                ? 'Loading instruments...'
                : isIndianSegment && search.trim().length < 2
                  ? `Search ${activeCat} to see instruments`
                  : isIndianSegment && indianSearching
                    ? 'Searching...'
                    : 'No instruments found'}
            </Text>
          </View>
        }
      />

      {/* ── BOTTOM STATUS BAR (INR only) ── */}
      <View style={[styles.bottomBar, { backgroundColor: colors.bg1, borderTopColor: colors.border }]}>
        <Text style={{ color: colors.blue, fontSize: 11, fontWeight: '600' }}>{orderSymbol || 'XAUUSD'}</Text>
        <Text style={{ color: colors.t2, fontSize: 11 }}>
          Bal ₹{Number(walletINR.balance || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
        </Text>
      </View>
    </SafeAreaView>

      {/* ── ORDER PANEL BOTTOM SHEET ── */}
      <Modal
        visible={orderSheetOpen}
        animationType="none"
        transparent={true}
        statusBarTranslucent={true}
        onRequestClose={closeSheet}
      >
        <View style={styles.sheetOverlay}>
          <Animated.View style={[styles.sheetBackdrop, { opacity: backdropAnim }]}>
            <Pressable style={{ flex: 1 }} onPress={closeSheet} />
          </Animated.View>
          <Animated.View style={[styles.sheetContent, { backgroundColor: colors.bg1, transform: [{ translateY: sheetAnim }] }]}>
            {/* Handle + chart + close — swipe down to dismiss */}
            <View {...sheetPanResponder.panHandlers} style={styles.sheetHeader}>
              <View style={[styles.handleBar, { backgroundColor: colors.t3 }]} />
              <View style={{ position: 'absolute', right: 12, top: 6, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                <Pressable
                  onPress={() => { closeSheet(); openChartForSymbol(orderSymbol); }}
                  style={[styles.sheetIconBtn, { backgroundColor: colors.bg3, borderColor: colors.border }]}
                  hitSlop={8}
                >
                  <Ionicons name="stats-chart" size={16} color={colors.blue} />
                </Pressable>
                <Pressable onPress={closeSheet} style={{ padding: 8 }} hitSlop={8}>
                  <Ionicons name="close" size={22} color={colors.t2} />
                </Pressable>
              </View>
            </View>

            {/* Symbol header + OHLC/LTP row */}
            <View style={[styles.sheetSymbolHeader, { borderBottomColor: colors.border }]}>
              {(() => {
                // For option / future tradingsymbols show the structured
                // breakdown: "HDFCLIFE · 525 CE" with a muted expiry below.
                // Falls back to the raw symbol for equities / forex /
                // crypto where there's nothing to split.
                const parsed = parseFnoSymbol(orderSymbol);
                if (parsed) {
                  const kindColor = parsed.kind === 'CE' ? '#22c55e' : parsed.kind === 'PE' ? '#ef4444' : colors.blue;
                  return (
                    <View style={{ marginBottom: 8 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap' }}>
                        <Text style={{ color: colors.t1, fontSize: 20, fontWeight: '800', letterSpacing: 0.3 }} numberOfLines={1}>
                          {parsed.underlying}
                        </Text>
                        {parsed.strike !== undefined && (
                          <Text style={{ color: colors.t1, fontSize: 20, fontWeight: '800', letterSpacing: 0.3, marginLeft: 8 }}>
                            {parsed.strike}
                          </Text>
                        )}
                        <View style={{ backgroundColor: kindColor, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, marginLeft: 8 }}>
                          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '800', letterSpacing: 0.5 }}>{parsed.kind}</Text>
                        </View>
                      </View>
                      <Text style={{ color: colors.t3, fontSize: 11, fontWeight: '600', marginTop: 2, letterSpacing: 0.3 }}>
                        EXPIRY · {parsed.expiry}
                      </Text>
                    </View>
                  );
                }
                return (
                  <Text style={{ color: colors.t1, fontSize: 20, fontWeight: '800', letterSpacing: 0.3, marginBottom: 8 }} numberOfLines={1}>{orderSymbol}</Text>
                );
              })()}
              <View style={styles.ohlcRow}>
                <View style={styles.ohlcCell}>
                  <Text style={[styles.ohlcLabel, { color: colors.t3 }]}>LTP</Text>
                  <Text style={[styles.ohlcValue, { color: colors.t1 }]}>{fmtP(orderSymbol, orderPrice?.lastPrice, activeInstrument)}</Text>
                </View>
                <View style={[styles.ohlcDivider, { backgroundColor: colors.border }]} />
                <View style={styles.ohlcCell}>
                  <Text style={[styles.ohlcLabel, { color: colors.t3 }]}>DAY HIGH</Text>
                  <Text style={[styles.ohlcValue, { color: '#22c55e' }]}>{fmtP(orderSymbol, orderPrice?.high, activeInstrument)}</Text>
                </View>
                <View style={[styles.ohlcDivider, { backgroundColor: colors.border }]} />
                <View style={styles.ohlcCell}>
                  <Text style={[styles.ohlcLabel, { color: colors.t3 }]}>DAY LOW</Text>
                  <Text style={[styles.ohlcValue, { color: '#ef4444' }]}>{fmtP(orderSymbol, orderPrice?.low, activeInstrument)}</Text>
                </View>
              </View>
            </View>

            {/* Pinned SELL / spread / BUY cards — stays visible no matter how far
                the user scrolls through SL / TP / session below. Matches web
                order panel layout the client signed off on. */}
            <View style={[styles.pinnedSideSection, { backgroundColor: colors.bg1, borderBottomColor: colors.border }]}>
              <View style={styles.sideRow}>
                <TouchableOpacity
                  style={[
                    styles.sideCard,
                    { borderColor: '#ef4444', backgroundColor: orderSide === 'sell' ? '#ef4444' : 'rgba(239,68,68,0.08)' },
                  ]}
                  onPress={() => setOrderSide('sell')}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: orderSide === 'sell' ? '#fff' : '#ef4444', fontSize: 11, fontWeight: '700', letterSpacing: 0.6 }}>SELL</Text>
                  <Text style={{ color: orderSide === 'sell' ? '#fff' : '#ef4444', fontSize: 18, fontWeight: '800', marginTop: 3 }}>
                    {fmtP(orderSymbol, tradeQuote.bid || orderPrice?.bid, activeInstrument)}
                  </Text>
                </TouchableOpacity>
                <View style={[styles.spreadChip, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
                  <Text style={{ color: colors.t3, fontSize: 8, fontWeight: '700', letterSpacing: 0.4 }}>SPRD</Text>
                  <Text style={{ color: colors.t2, fontSize: 11, fontWeight: '700' }}>
                    {tradeQuote.spreadAmount > 0 ? tradeQuote.spreadAmount.toFixed(2) : (orderPrice?.bid && orderPrice?.ask ? Math.abs(orderPrice.ask - orderPrice.bid).toFixed(2) : '—')}
                  </Text>
                </View>
                <TouchableOpacity
                  style={[
                    styles.sideCard,
                    { borderColor: '#22c55e', backgroundColor: orderSide === 'buy' ? '#22c55e' : 'rgba(34,197,94,0.08)' },
                  ]}
                  onPress={() => setOrderSide('buy')}
                  activeOpacity={0.85}
                >
                  <Text style={{ color: orderSide === 'buy' ? '#fff' : '#22c55e', fontSize: 11, fontWeight: '700', letterSpacing: 0.6 }}>BUY</Text>
                  <Text style={{ color: orderSide === 'buy' ? '#fff' : '#22c55e', fontSize: 18, fontWeight: '800', marginTop: 3 }}>
                    {fmtP(orderSymbol, tradeQuote.ask || orderPrice?.ask, activeInstrument)}
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 50 }} keyboardShouldPersistTaps="handled" bounces={false} showsVerticalScrollIndicator={true}>
              {/* Trading mode tabs — only rendered when there's a real choice to make */}
              {(() => {
                const modes = [
                  { key: 'netting', icon: 'stats-chart', label: 'Netting' },
                  { key: 'binary', icon: 'diamond-outline', label: 'Binary' },
                ].filter(m => allowedTradeModes[m.key as keyof typeof allowedTradeModes]);
                if (modes.length < 2) return null;
                return (
                  <View style={{ flexDirection: 'row', marginBottom: 14, gap: 8 }}>
                    {modes.map(mode => (
                      <TouchableOpacity
                        key={mode.key}
                        style={[styles.modeTab, { backgroundColor: colors.bg3 }, tradingMode === mode.key && { backgroundColor: colors.blue }]}
                        onPress={() => setTradingMode(mode.key)}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                          <Ionicons name={mode.icon as any} size={14} color={tradingMode === mode.key ? '#fff' : colors.t2} />
                          <Text style={{ color: tradingMode === mode.key ? '#fff' : colors.t2, fontSize: 12, fontWeight: '600' }}>
                            {mode.label}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    ))}
                  </View>
                );
              })()}

              {/* ═══════════ NETTING MODE ═══════════ */}
              {tradingMode === 'netting' && (
                <>
                  {/* Order type segmented control */}
                  <View style={[styles.segGroup, { backgroundColor: colors.bg3 }]}>
                    {[{ key: 'market', label: 'Market' }, { key: 'limit', label: 'Limit' }, { key: 'slm', label: 'SL-M' }].map(t => (
                      <TouchableOpacity key={t.key} style={[styles.segTab, orderType === t.key && { backgroundColor: colors.blue }]} onPress={() => setOrderType(t.key)} activeOpacity={0.85}>
                        <Text style={{ color: orderType === t.key ? '#fff' : colors.t2, fontSize: 13, fontWeight: '600' }}>{t.label}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {/* SELL / BUY cards rendered as pinned section above the
                      ScrollView (see styles.pinnedSideSection) so they stay
                      visible while user scrolls through SL/TP/session. */}
                  {/* Option Trade shortcut — opens the Option Chain for this
                      instrument's underlying. Indian symbols only. */}
                  {isOrderIndian && (
                    <TouchableOpacity
                      style={[styles.optionTradeBtn, { borderColor: colors.blue, backgroundColor: colors.blueDim }]}
                      onPress={() => openOptionChainForSymbol(orderSymbol)}
                      activeOpacity={0.85}
                    >
                      <Ionicons name="options-outline" size={16} color={colors.blue} />
                      <Text style={{ color: colors.blue, fontSize: 13, fontWeight: '700', letterSpacing: 0.4 }}>OPTION TRADE</Text>
                    </TouchableOpacity>
                  )}
                  {orderType !== 'market' && (
                    <View style={styles.inputGroup}>
                      <Text style={[styles.inputLabel, { color: colors.t2 }]}>{orderType === 'limit' ? 'Limit Price' : 'Trigger Price'}</Text>
                      <TextInput style={[styles.input, { backgroundColor: colors.bg3, color: colors.t1, borderColor: colors.border }]} value={limitPrice} onChangeText={setLimitPrice} keyboardType="decimal-pad" placeholder={(orderPrice?.bid || 0).toFixed(2)} placeholderTextColor={colors.t3} />
                    </View>
                  )}
                  {/* Lot Size — elevated stepper card */}
                  <Text style={[styles.sectionLabel, { color: colors.t2 }]}>LOT SIZE</Text>
                  <View style={[styles.stepperCard, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
                    <TouchableOpacity
                      style={[styles.stepperBtn, { backgroundColor: colors.bg3 }]}
                      onPress={() => setVolume(prev => Math.max(minLot, parseFloat(((parseFloat(prev) || minLot) - lotStep).toFixed(6))).toString())}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="remove" size={22} color={colors.t1} />
                    </TouchableOpacity>
                    <TextInput
                      style={[styles.stepperInput, { color: colors.t1 }]}
                      value={volume}
                      onChangeText={v => { if (v === '' || /^[0-9]*\.?[0-9]*$/.test(v)) setVolume(v); }}
                      keyboardType="decimal-pad"
                    />
                    <TouchableOpacity
                      style={[styles.stepperBtn, { backgroundColor: colors.bg3 }]}
                      onPress={() => setVolume(prev => parseFloat(((parseFloat(prev) || minLot) + lotStep).toFixed(6)).toString())}
                      activeOpacity={0.7}
                    >
                      <Ionicons name="add" size={22} color={colors.t1} />
                    </TouchableOpacity>
                  </View>
                  <Text style={{ color: colors.t3, fontSize: 11, marginTop: 6, marginBottom: 12 }}>{(parseFloat(volume) || 0).toFixed(isOrderIndian ? 0 : 4)} lots</Text>

                  {/* Lot size info (F&O / indices when lotSize > 1) */}
                  {activeLotSize > 1 && (
                    <View style={styles.lotSizeBox}>
                      <Text style={{ color: '#3b82f6', fontSize: 12, fontWeight: '600' }}>
                        1 lot = {activeLotSize} units (index points / Qty per exchange)
                      </Text>
                      <Text style={{ color: colors.t3, fontSize: 11, marginTop: 2 }}>
                        Total contracts: {((parseFloat(volume) || 0) * activeLotSize).toFixed(4)}
                      </Text>
                    </View>
                  )}

                  {/* Collapsible Stop Loss / Target — tappable row with shevron */}
                  <TouchableOpacity style={[styles.collapsibleRow, { borderColor: colors.border }]} onPress={() => setShowSL(!showSL)} activeOpacity={0.7}>
                    <Text style={[styles.sectionLabel, { color: colors.t2, marginBottom: 0 }]}>STOP LOSS</Text>
                    <Ionicons name={showSL ? 'chevron-up' : 'chevron-down'} size={16} color={colors.t3} />
                  </TouchableOpacity>
                  {showSL && <TextInput style={[styles.input, { backgroundColor: colors.bg3, color: colors.t1, borderColor: colors.border, marginBottom: 8 }]} value={stopLoss} onChangeText={setStopLoss} keyboardType="decimal-pad" placeholder="Optional" placeholderTextColor={colors.t3} />}
                  <TouchableOpacity style={[styles.collapsibleRow, { borderColor: colors.border }]} onPress={() => setShowTP(!showTP)} activeOpacity={0.7}>
                    <Text style={[styles.sectionLabel, { color: colors.t2, marginBottom: 0 }]}>TARGET PRICE</Text>
                    <Ionicons name={showTP ? 'chevron-up' : 'chevron-down'} size={16} color={colors.t3} />
                  </TouchableOpacity>
                  {showTP && <TextInput style={[styles.input, { backgroundColor: colors.bg3, color: colors.t1, borderColor: colors.border, marginBottom: 8 }]} value={takeProfit} onChangeText={setTakeProfit} keyboardType="decimal-pad" placeholder="Optional" placeholderTextColor={colors.t3} />}
                  {/* Margin info card */}
                  {(() => {
                    const ep = orderSide === 'buy' ? (tradeQuote.ask || orderPrice?.ask || 0) : (tradeQuote.bid || orderPrice?.bid || 0);
                    const vol = parseFloat(volume) || 0;
                    const notional = ep * vol;
                    const intraday = notional > 0 ? `₹${notional.toFixed(2)}` : '—';
                    const available = Number(walletINR?.balance || 0);
                    return (
                      <View style={[styles.marginCard, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
                        <View style={styles.marginRow}>
                          <Text style={{ color: colors.t3, fontSize: 11 }}>Margin Mode</Text>
                          <Text style={{ color: colors.t2, fontSize: 12, fontWeight: '600' }}>Fixed · ₹100/lot</Text>
                        </View>
                        <View style={[styles.marginDivider, { backgroundColor: colors.border }]} />
                        <View style={styles.marginRow}>
                          <Text style={{ color: colors.t3, fontSize: 11 }}>Intraday Margin</Text>
                          <Text style={{ color: colors.blue, fontSize: 13, fontWeight: '700' }}>₹{(vol * 100).toFixed(2)}</Text>
                        </View>
                        <View style={styles.marginRow}>
                          <Text style={{ color: colors.t3, fontSize: 11 }}>Carryforward Margin</Text>
                          <Text style={{ color: colors.blue, fontSize: 13, fontWeight: '700' }}>{intraday}</Text>
                        </View>
                        <View style={[styles.marginDivider, { backgroundColor: colors.border }]} />
                        <View style={styles.marginRow}>
                          <Text style={{ color: colors.t2, fontSize: 11, fontWeight: '600' }}>Available Margin</Text>
                          <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '800' }}>
                            ₹{available.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                          </Text>
                        </View>
                      </View>
                    );
                  })()}
                  {/* Submit */}
                  <TouchableOpacity style={[styles.submitBtn, { backgroundColor: orderSide === 'buy' ? '#14b8a6' : '#ef4444', opacity: isPlacingOrder ? 0.6 : 1 }]} onPress={handlePlaceOrder} disabled={isPlacingOrder} activeOpacity={0.8}>
                    {isPlacingOrder ? <ActivityIndicator color="#fff" size="small" /> : (
                      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{orderSide === 'buy' ? 'BUY' : 'SELL'} {(parseFloat(volume) || 0).toFixed(isOrderIndian ? 0 : 2)} lots</Text>
                    )}
                  </TouchableOpacity>
                  <Text style={{ color: colors.t3, fontSize: 10, textAlign: 'center', marginTop: 6 }}>
                    {(parseFloat(volume) || 0).toFixed(isOrderIndian ? 0 : 2)} lots @ {fmtP(orderSymbol, orderSide === 'buy' ? (tradeQuote.ask || orderPrice?.ask) : (tradeQuote.bid || orderPrice?.bid), activeInstrument)} (intraday)
                  </Text>
                </>
              )}

              {/* ═══════════ BINARY MODE ═══════════ */}
              {tradingMode === 'binary' && (
                <>
                  {/* Current price display */}
                  <View style={{ backgroundColor: colors.bg3, borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 16 }}>
                    <Text style={{ color: colors.t2, fontSize: 12, marginBottom: 4 }}>Current Price</Text>
                    <Text style={{ color: colors.t1, fontSize: 28, fontWeight: '800' }}>{fmtP(orderSymbol, orderPrice?.bid, activeInstrument)}</Text>
                  </View>
                  {/* UP / DOWN buttons */}
                  <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                    <TouchableOpacity
                      style={[styles.sideBtn, { flex: 1, paddingVertical: 24, backgroundColor: binaryDirection === 'up' ? '#14b8a6' : 'rgba(20,184,166,0.15)', borderColor: '#14b8a6' }]}
                      onPress={() => setBinaryDirection('up')}
                    >
                      <Ionicons name="caret-up" size={28} color={binaryDirection === 'up' ? '#fff' : '#14b8a6'} />
                      <Text style={{ color: binaryDirection === 'up' ? '#fff' : '#14b8a6', fontSize: 16, fontWeight: '700', marginTop: 4 }}>UP</Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.sideBtn, { flex: 1, paddingVertical: 24, backgroundColor: binaryDirection === 'down' ? '#ef4444' : 'rgba(239,68,68,0.15)', borderColor: '#ef4444' }]}
                      onPress={() => setBinaryDirection('down')}
                    >
                      <Ionicons name="caret-down" size={28} color={binaryDirection === 'down' ? '#fff' : '#ef4444'} />
                      <Text style={{ color: binaryDirection === 'down' ? '#fff' : '#ef4444', fontSize: 16, fontWeight: '700', marginTop: 4 }}>DOWN</Text>
                    </TouchableOpacity>
                  </View>
                  {/* Trade amount */}
                  <Text style={{ color: colors.t1, fontSize: 12, fontWeight: '600', marginBottom: 6 }}>Trade Amount (₹) — limits ₹1–₹10000</Text>
                  <View style={[styles.volumeRow, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
                    <TouchableOpacity style={styles.volumeBtn} onPress={() => setBinaryAmount(prev => Math.max(1, (parseInt(prev) || 100) - 10).toString())}>
                      <Text style={[styles.volumeBtnTxt, { color: colors.t1 }]}>−</Text>
                    </TouchableOpacity>
                    <TextInput style={[styles.volumeInput, { color: colors.t1 }]} value={binaryAmount} onChangeText={v => { if (v === '' || /^\d+$/.test(v)) setBinaryAmount(v); }} keyboardType="number-pad" />
                    <TouchableOpacity style={styles.volumeBtn} onPress={() => setBinaryAmount(prev => Math.min(10000, (parseInt(prev) || 100) + 10).toString())}>
                      <Text style={[styles.volumeBtnTxt, { color: colors.t1 }]}>+</Text>
                    </TouchableOpacity>
                  </View>
                  {/* Expiry Time */}
                  <Text style={{ color: colors.t1, fontSize: 12, fontWeight: '600', marginTop: 14, marginBottom: 8 }}>Expiry Time</Text>
                  <View style={{ flexDirection: 'row', gap: 6, marginBottom: 16 }}>
                    {[{ s: 30, l: '30s' }, { s: 60, l: '1m' }, { s: 120, l: '2m' }, { s: 300, l: '5m' }, { s: 600, l: '10m' }].map(e => (
                      <TouchableOpacity key={e.s} style={[styles.orderTypeTab, binaryExpiry === e.s && { backgroundColor: '#3b82f6' }]} onPress={() => setBinaryExpiry(e.s)}>
                        <Text style={{ color: binaryExpiry === e.s ? '#fff' : '#64748b', fontSize: 12, fontWeight: '600' }}>{e.l}</Text>
                      </TouchableOpacity>
                    ))}
                  </View>
                  {/* Win/Lose preview */}
                  <View style={{ backgroundColor: colors.bg3, borderRadius: 10, padding: 12, marginBottom: 16 }}>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
                      <Text style={{ color: colors.t2, fontSize: 12 }}>If you win:</Text>
                      <Text style={{ color: '#22c55e', fontSize: 13, fontWeight: '700' }}>+₹{((parseInt(binaryAmount) || 0) * 0.85).toFixed(2)}</Text>
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
                      <Text style={{ color: colors.t2, fontSize: 12 }}>If you lose:</Text>
                      <Text style={{ color: '#ef4444', fontSize: 13, fontWeight: '700' }}>-₹{(parseInt(binaryAmount) || 0).toFixed(2)}</Text>
                    </View>
                  </View>
                  {/* Submit */}
                  <TouchableOpacity
                    style={[styles.submitBtn, { backgroundColor: binaryDirection === 'up' ? '#14b8a6' : '#ef4444', opacity: isPlacingOrder ? 0.6 : 1 }]}
                    onPress={handlePlaceOrder} disabled={isPlacingOrder} activeOpacity={0.8}
                  >
                    {isPlacingOrder ? <ActivityIndicator color="#fff" size="small" /> : (
                      <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Trade {binaryDirection.toUpperCase()} - ₹{binaryAmount}</Text>
                    )}
                  </TouchableOpacity>
                  <Text style={{ color: colors.t3, fontSize: 10, textAlign: 'center', marginTop: 6 }}>
                    Trade expires in {binaryExpiry >= 60 ? `${Math.floor(binaryExpiry / 60)}m ${binaryExpiry % 60}s` : `${binaryExpiry}s`}
                  </Text>
                  <Text style={{ color: colors.t3, fontSize: 10, textAlign: 'center', marginTop: 2 }}>
                    ₹{binaryAmount} on {binaryDirection.toUpperCase()} - {binaryExpiry >= 60 ? `${Math.floor(binaryExpiry / 60)}m` : `${binaryExpiry}s`} expiry
                  </Text>
                </>
              )}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  searchInput: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, fontSize: 13, borderWidth: 1 },
  searchWrap: {
    flexDirection: 'row', alignItems: 'center',
    borderWidth: 1, borderRadius: 10,
    paddingHorizontal: 10, paddingVertical: 8,
  },
  instRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 14, borderBottomWidth: 1 },
  iconBtn: { width: 32, height: 32, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#2962FF', paddingHorizontal: 10, paddingVertical: 6, borderRadius: 6,
  },
  lotSizeBox: {
    backgroundColor: 'rgba(59,130,246,0.10)',
    borderColor: 'rgba(59,130,246,0.30)',
    borderWidth: 1, borderRadius: 8,
    paddingHorizontal: 10, paddingVertical: 8,
    marginBottom: 14,
  },
  // Bottom status bar
  bottomBar: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 8, borderTopWidth: 1 },
  currPill: { paddingHorizontal: 10, paddingVertical: 4, borderRadius: 4 },
  // Order sheet
  sheetOverlay: { flex: 1, justifyContent: 'flex-end' },
  sheetBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheetContent: { borderTopLeftRadius: 20, borderTopRightRadius: 20, height: SH * 0.85 },
  sheetHeader: { alignItems: 'center', paddingVertical: 12 },
  handleBar: { width: 40, height: 4, borderRadius: 4 },
  modeTab: { flex: 1, paddingVertical: 10, alignItems: 'center', borderRadius: 20 },
  orderTypeTab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 8 },
  sideBtn: { flex: 1, paddingVertical: 12, alignItems: 'center', borderRadius: 12, borderWidth: 1 },
  inputGroup: { marginBottom: 14 },
  inputLabel: { fontSize: 11, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase' },
  input: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1 },
  submitBtn: { borderRadius: 12, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  volumeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, borderRadius: 10, borderWidth: 1 },
  volumeBtn: { width: 50, height: 48, alignItems: 'center', justifyContent: 'center' },
  volumeBtnTxt: { fontSize: 20, fontWeight: '600' },
  volumeInput: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', padding: 10 },

  // Redesigned order sheet bits
  segGroup: { flexDirection: 'row', borderRadius: 10, padding: 4, marginBottom: 14 },
  segTab: { flex: 1, paddingVertical: 9, alignItems: 'center', borderRadius: 7 },
  sideRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  sideCard: { flex: 1, paddingVertical: 14, alignItems: 'center', borderRadius: 14, borderWidth: 1.5 },
  spreadChip: { marginHorizontal: 8, paddingHorizontal: 10, paddingVertical: 6, borderRadius: 10, borderWidth: 1, alignItems: 'center', minWidth: 48 },
  sectionLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.6, marginBottom: 8, textTransform: 'uppercase' },
  stepperCard: { flexDirection: 'row', alignItems: 'center', borderRadius: 12, borderWidth: 1, padding: 4 },
  stepperBtn: { width: 48, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 9 },
  stepperInput: { flex: 1, textAlign: 'center', fontSize: 20, fontWeight: '700', padding: 10 },
  collapsibleRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderTopWidth: 1 },
  marginCard: { borderRadius: 12, borderWidth: 1, padding: 14, marginTop: 10, marginBottom: 16 },
  marginRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 4 },
  marginDivider: { height: 1, marginVertical: 6 },
  sheetSymbolHeader: { paddingHorizontal: 16, paddingBottom: 12, borderBottomWidth: 1 },
  pinnedSideSection: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4, borderBottomWidth: 1 },
  optionTradeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 1.5,
    marginTop: -4,
    marginBottom: 14,
  },
  sheetIconBtn: { width: 32, height: 32, borderRadius: 10, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  ohlcRow: { flexDirection: 'row', alignItems: 'center' },
  ohlcCell: { flex: 1 },
  ohlcLabel: { fontSize: 9, fontWeight: '600', letterSpacing: 0.5, marginBottom: 2 },
  ohlcValue: { fontSize: 13, fontWeight: '700' },
  ohlcDivider: { width: 1, height: 24, marginHorizontal: 8 },
});

export default MarketScreen;
