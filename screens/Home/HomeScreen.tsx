import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity,
  RefreshControl, Dimensions, Linking, ActivityIndicator, Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { WebView } from 'react-native-webview';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { useTheme } from '../../theme/ThemeContext';
import { tradingAPI, walletAPI, bannerAPI } from '../../services/api';
import AppHeader from '../../components/AppHeader';
import { useNavigation } from '@react-navigation/native';

const SW = Dimensions.get('window').width;

/* ================================================================
   HomePage — matches web mobile view
   Sections: Banner → USD Card → INR Card → Quick Actions →
             Positions → Market Overview → Market Heatmap → News
   Live equity/margin/freeMargin from positions + socket prices
   ================================================================ */

// ── Sample news fallback (same as web) ──
const SAMPLE_NEWS = [
  { id: '1', headline: 'Gold Prices Surge Amid Global Uncertainty', summary: 'Gold prices reached new highs as investors seek safe-haven assets.', image: 'https://images.unsplash.com/photo-1610375461246-83df859d849d?w=400', source: 'Market Watch', datetime: Date.now() / 1000 - 3600, category: 'commodities' },
  { id: '2', headline: 'Fed Signals Potential Rate Cuts in 2026', summary: 'Federal Reserve officials hint at possible interest rate reductions.', image: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400', source: 'Reuters', datetime: Date.now() / 1000 - 7200, category: 'forex' },
  { id: '3', headline: 'Bitcoin Breaks $100K Resistance Level', summary: 'Cryptocurrency markets rally as Bitcoin surpasses key barrier.', image: 'https://images.unsplash.com/photo-1518546305927-5a555bb7020d?w=400', source: 'CoinDesk', datetime: Date.now() / 1000 - 10800, category: 'crypto' },
  { id: '4', headline: 'Tech Stocks Lead Market Rally', summary: 'Major technology companies drive gains in US equity markets.', image: 'https://images.unsplash.com/photo-1611974789855-9c2a0a7236a3?w=400', source: 'Bloomberg', datetime: Date.now() / 1000 - 14400, category: 'stocks' },
  { id: '5', headline: 'EUR/USD Volatility Increases on ECB Decision', summary: 'European Central Bank policy announcement sparks currency movements.', image: 'https://images.unsplash.com/photo-1526304640581-d334cdbbf45e?w=400', source: 'FX Street', datetime: Date.now() / 1000 - 18000, category: 'forex' },
  { id: '6', headline: 'Oil Prices Stabilize After OPEC Meeting', summary: 'Crude oil markets find balance following production discussions.', image: 'https://images.unsplash.com/photo-1513828583688-c52646db42da?w=400', source: 'Energy News', datetime: Date.now() / 1000 - 21600, category: 'commodities' },
];

const HomeScreen: React.FC = () => {
  const { user, refreshUser } = useAuth();
  const { prices, isConnected, onPositionUpdate } = useSocket();
  const { colors, isDark } = useTheme();
  const navigation = useNavigation<any>();
  const [refreshing, setRefreshing] = useState(false);
  const [positions, setPositions] = useState<any[]>([]);
  const [banners, setBanners] = useState<any[]>([]);
  const [bannerIdx, setBannerIdx] = useState(0);
  const [wallet, setWallet] = useState<any>(null);
  const [walletINR, setWalletINR] = useState<{ balance: number }>({ balance: 0 });
  const [walletUSD, setWalletUSD] = useState<{ balance: number }>({ balance: 0 });
  const [usdInrRate, setUsdInrRate] = useState(83);
  const [news, setNews] = useState<any[]>([]);
  const [newsLoading, setNewsLoading] = useState(true);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastGoodMarginRef = useRef(0);

  // ── Data loading ──
  const loadData = useCallback(async () => {
    if (!user?.id && !user?.oderId) return;
    try {
      const uid = user?.oderId || user?.id;
      const [posRes, walRes, rateRes] = await Promise.all([
        tradingAPI.getAllPositions(uid),
        walletAPI.getUserWallet(uid),
        walletAPI.getExchangeRate().catch(() => ({ data: { rate: 83 } })),
      ]);
      if (posRes.data?.positions) {
        setPositions(posRes.data.positions.filter((p: any) => p.status === 'open' || p.status === 'active' || !p.status));
      }
      if (walRes.data?.wallet) setWallet(walRes.data.wallet);
      if (walRes.data?.walletINR) setWalletINR(walRes.data.walletINR);
      if (walRes.data?.walletUSD) setWalletUSD(walRes.data.walletUSD);
      const rateData = rateRes.data;
      if (rateData?.USD_TO_INR) setUsdInrRate(rateData.USD_TO_INR);
      else if (rateData?.rates?.USD_TO_INR) setUsdInrRate(rateData.rates.USD_TO_INR);
      else if (rateData?.rate) setUsdInrRate(rateData.rate);
    } catch (e) { console.error('Home load:', e); }
  }, [user?.id, user?.oderId]);

  // Fetch news
  const loadNews = useCallback(async () => {
    setNewsLoading(true);
    try {
      const res = await fetch('https://finnhub.io/api/v1/news?category=general&token=demo');
      const data = await res.json();
      if (Array.isArray(data) && data.length > 0) setNews(data.slice(0, 8));
      else setNews(SAMPLE_NEWS);
    } catch (_) { setNews(SAMPLE_NEWS); }
    setNewsLoading(false);
  }, []);

  useEffect(() => {
    loadData();
    loadNews();
    // Fetch admin-controlled banners once
    bannerAPI.getActive()
      .then(res => {
        const list = res.data?.banners || [];
        setBanners(list.filter((b: any) => b?.imageData || b?.imageUrl));
      })
      .catch(() => {});
    // Poll every 5s for live wallet + positions
    pollRef.current = setInterval(loadData, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [loadData, loadNews]);

  // Auto-rotate banner every 4s (matches web)
  useEffect(() => {
    if (banners.length <= 1) return;
    const id = setInterval(() => {
      setBannerIdx(i => (i + 1) % banners.length);
    }, 4000);
    return () => clearInterval(id);
  }, [banners.length]);

  // Re-fetch positions on socket position updates
  useEffect(() => {
    const unsub = onPositionUpdate(() => { loadData(); });
    return unsub;
  }, [onPositionUpdate, loadData]);

  const onRefresh = async () => { setRefreshing(true); await Promise.all([loadData(), loadNews(), refreshUser()]); setRefreshing(false); };

  // ── Live PnL + equity calculation (mirrors web UserLayout) ──
  const n = (v: any) => Number(v || 0);
  const rate = usdInrRate;
  const bal = n(wallet?.balance ?? user?.wallet?.balance);
  const cr = n(wallet?.credit);

  let totalPnl = 0;
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
    const ex = (pos.exchange || '').toUpperCase();
    const isIndian = ex === 'NSE' || ex === 'BSE' || ex === 'NFO' || ex === 'BFO' || ex === 'MCX' ||
      sym.includes('NIFTY') || sym.includes('BANKNIFTY') || sym.includes('SENSEX');
    let pnl: number;
    if (isIndian) {
      const qty = n(pos.quantity || (pos.volume * (pos.lotSize || 1)));
      pnl = priceDiff * qty;
    } else {
      const vol = n(pos.volume);
      let cs = 100000;
      if (sym.includes('BTC') || sym.includes('ETH')) cs = 1;
      else if (sym === 'XAUUSD' || sym === 'XPTUSD') cs = 100;
      else if (sym === 'XAGUSD') cs = 5000;
      else if (sym.includes('US100') || sym.includes('US30') || sym.includes('US2000')) cs = 1;
      const pnlUSD = sym.includes('JPY') ? (priceDiff * 100000 * vol) / 100 : priceDiff * cs * vol;
      // Convert forex P&L (USD) to INR for display (wallet is INR-only)
      pnl = pnlUSD * usdInrRate;
    }
    if (!isNaN(pnl) && isFinite(pnl)) totalPnl += pnl;
  });

  if (totalMargin > 0) lastGoodMarginRef.current = totalMargin;
  const effectiveMargin = (totalMargin === 0 && positions.length > 0 && lastGoodMarginRef.current > 0)
    ? lastGoodMarginRef.current : totalMargin;

  const mg = positions.length > 0 ? effectiveMargin : n(wallet?.margin);
  const eq = bal + cr + totalPnl;
  const fm = Math.max(0, eq - mg);
  const pctChange = bal > 0 ? ((eq - bal) / bal) * 100 : 0;

  // INR-only: fmtUSD kept as alias of INR format so existing call sites render ₹
  const fmtUSD = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
  const fmtINR = (v: number) => `₹${(v * rate).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  const fmtINRNative = (v: number) => `₹${v.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
  const fmtUSDNative = (v: number) => `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

  // Wallet is INR-only now — balance, credit, margin, and per-position P/L
  // all come from the server in ₹. totalPnl (live) is computed in-memory
  // using INR for Indian and USD for forex; convert forex portion here.
  const balINR = bal;
  const crINR = cr;
  const mgINR = mg;
  // totalPnl from positions is mixed-currency today — convert forex P&L (USD)
  // to INR using live rate. Indian P&L is already INR in calcLivePnl above.
  // For display simplicity, treat totalPnl as INR (forex P&L gets rate-adjusted
  // for live display while position is open; on close, server stores INR).
  const eqINR = balINR + crINR + totalPnl;
  const fmINR = Math.max(0, eqINR - mgINR);

  // Per-position P/L for display
  const calcLivePnl = (pos: any) => {
    const sym = pos.symbol || '';
    const lp = prices[sym];
    if (!lp || (!lp.bid && !lp.ask)) return n(pos.profit);
    const curPrice = n(pos.side === 'buy' ? lp.bid : lp.ask);
    const entryPrice = n(pos.entryPrice || pos.avgPrice);
    const priceDiff = pos.side === 'buy' ? curPrice - entryPrice : entryPrice - curPrice;
    const ex = (pos.exchange || '').toUpperCase();
    const isIndian = ex === 'NSE' || ex === 'BSE' || ex === 'NFO' || ex === 'BFO' || ex === 'MCX' ||
      sym.includes('NIFTY') || sym.includes('BANKNIFTY') || sym.includes('SENSEX');
    if (isIndian) return priceDiff * n(pos.quantity || (pos.volume * (pos.lotSize || 1)));
    const vol = n(pos.volume);
    let cs = 100000;
    if (sym.includes('BTC') || sym.includes('ETH')) cs = 1;
    else if (sym === 'XAUUSD' || sym === 'XPTUSD') cs = 100;
    else if (sym === 'XAGUSD') cs = 5000;
    else if (sym.includes('US100') || sym.includes('US30') || sym.includes('US2000')) cs = 1;
    // Forex P&L in USD → convert to INR (wallet is INR-only)
    const pnlUSD = sym.includes('JPY') ? (priceDiff * 100000 * vol) / 100 : priceDiff * cs * vol;
    return pnlUSD * usdInrRate;
  };

  const formatTime = (ts: number) => {
    const diff = Math.floor((Date.now() / 1000 - ts) / 60);
    if (diff < 60) return `${diff}m ago`;
    if (diff < 1440) return `${Math.floor(diff / 60)}h ago`;
    return new Date(ts * 1000).toLocaleDateString();
  };

  // TradingView heatmap HTML — uses forex-heat-map widget for clean fill
  const heatmapHtml = `<!DOCTYPE html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><style>*{margin:0;padding:0}html,body{width:100%;height:100%;overflow:hidden;background:transparent}</style></head><body><div class="tradingview-widget-container"><div class="tradingview-widget-container__widget"></div><script src="https://s3.tradingview.com/external-embedding/embed-widget-stock-heatmap.js" async>{"exchanges":[],"dataSource":"SPX500","grouping":"sector","blockSize":"market_cap_basic","blockColor":"change","locale":"en","symbolUrl":"","colorTheme":"${isDark ? 'dark' : 'light'}","hasTopBar":false,"isDataSetEnabled":false,"isZoomEnabled":false,"hasSymbolTooltip":true,"isTransparent":true,"width":"100%","height":"100%"}</script></div></body></html>`;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg0 }]} edges={['top']}>
      <AppHeader />

      <ScrollView
        style={{ flex: 1 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} />}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ padding: 12, paddingBottom: 130, gap: 12 }}
      >
        {/* ── Connection Status ── */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 4, marginBottom: -4 }}>
          <Text style={{ color: isConnected ? '#22c55e' : '#ef4444', fontSize: 10, fontWeight: '600' }}>
            {isConnected ? '● Live Data Connected' : '○ Connecting...'}
          </Text>
          <Text style={{ color: colors.t3, fontSize: 10 }}>Positions: {positions.length}</Text>
        </View>

        {/* ── 1. HERO BANNER (admin-controlled carousel) ── */}
        {banners.length > 0 ? (
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={() => {
              const link = banners[bannerIdx]?.link;
              if (link) Linking.openURL(link).catch(() => {});
            }}
          >
            <View style={styles.bannerImageWrap}>
              <Image
                source={{ uri: banners[bannerIdx]?.imageData || banners[bannerIdx]?.imageUrl }}
                style={styles.bannerImage}
                resizeMode="cover"
              />
              {banners.length > 1 && (
                <View style={styles.bannerDots}>
                  {banners.map((_: any, i: number) => (
                    <View
                      key={i}
                      style={[
                        styles.bannerDot,
                        { backgroundColor: i === bannerIdx ? '#fff' : 'rgba(255,255,255,0.4)' },
                      ]}
                    />
                  ))}
                </View>
              )}
            </View>
          </TouchableOpacity>
        ) : (
          <View style={styles.banner}>
            <View style={styles.bannerAccent1} />
            <View style={styles.bannerAccent2} />
            <View style={{ zIndex: 2, paddingVertical: 12 }}>
              <Text style={styles.bannerTitle}>STOCKTRE</Text>
              <Text style={styles.bannerTagline}>TRADE SMARTER</Text>
              <Text style={styles.bannerSub}>Forex  ·  Crypto  ·  Commodities  ·  Indices</Text>
            </View>
          </View>
        )}

        {/* ── ACCOUNT CARD (INR only) ── */}
        <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          <View style={styles.cardHeader}>
            <Text style={[styles.cardLabel, { color: colors.t3 }]}>ACCOUNT</Text>
            <View style={[styles.badge, { backgroundColor: pctChange >= 0 ? colors.greenDim : colors.redDim }]}>
              <Text style={{ color: pctChange >= 0 ? colors.green : colors.red, fontSize: 11, fontWeight: '600' }}>
                {pctChange >= 0 ? '+' : ''}{pctChange.toFixed(1)}%
              </Text>
            </View>
          </View>
          <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.bigBal, { color: colors.t1 }]}>{fmtINRNative(balINR)}</Text>
          <View style={styles.statsRow}>
            <View style={[styles.statBox, { backgroundColor: colors.bg3 }]}>
              <Text style={[styles.statLabel, { color: colors.t3 }]}>FREE MARGIN</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statVal, { color: colors.t1 }]}>{fmtINRNative(fmINR)}</Text>
            </View>
            <View style={[styles.statBox, { backgroundColor: colors.bg3 }]}>
              <Text style={[styles.statLabel, { color: colors.t3 }]}>EQUITY</Text>
              <Text numberOfLines={1} adjustsFontSizeToFit style={[styles.statVal, { color: colors.t1 }]}>{fmtINRNative(eqINR)}</Text>
            </View>
          </View>
        </View>

        {/* ── 4. QUICK ACTIONS ── */}
        <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          <Text style={[styles.secTitle, { color: colors.t1 }]}>QUICK ACTIONS</Text>

          <TouchableOpacity style={[styles.actionRow, { backgroundColor: colors.bg3, borderColor: colors.border }]} activeOpacity={0.7} onPress={() => navigation.navigate('Wallet')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={[styles.actionIcon, { backgroundColor: colors.greenDim, borderColor: `${colors.green}30` }]}>
                <Ionicons name="arrow-down-outline" size={18} color={colors.green} />
              </View>
              <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '500' }}>Deposit Funds</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.t3} />
          </TouchableOpacity>

          <TouchableOpacity style={[styles.actionRow, { backgroundColor: colors.bg3, borderColor: colors.border, marginTop: 10 }]} activeOpacity={0.7} onPress={() => navigation.navigate('Wallet')}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
              <View style={[styles.actionIcon, { backgroundColor: colors.blueDim, borderColor: colors.blueBorder }]}>
                <Ionicons name="arrow-up-outline" size={18} color={colors.blue} />
              </View>
              <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '500' }}>Withdraw Profits</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={colors.t3} />
          </TouchableOpacity>
        </View>

        {/* ── 5. OPEN POSITIONS (if any) ── */}
        {positions.length > 0 && (
          <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
              <Text style={[styles.secTitle, { color: colors.t1, marginBottom: 0 }]}>OPEN POSITIONS</Text>
              <Text style={{ color: colors.blue, fontSize: 12, fontWeight: '700' }}>{positions.length}</Text>
            </View>
            <Text style={{ color: totalPnl >= 0 ? colors.green : colors.red, fontSize: 14, fontWeight: '700', marginBottom: 8 }}>
              Total P/L: {totalPnl >= 0 ? '+' : ''}{fmtUSD(totalPnl)}
            </Text>
            {positions.slice(0, 5).map((pos: any, idx: number) => {
              const livePnl = calcLivePnl(pos);
              const lp = prices[pos.symbol];
              const currentP = lp ? (pos.side === 'buy' ? n(lp.bid) : n(lp.ask)) : n(pos.currentPrice);
              return (
                <View key={pos.oderId || idx} style={[styles.posRow, { borderBottomColor: idx < Math.min(positions.length, 5) - 1 ? colors.border : 'transparent' }]}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                    <View style={[styles.sideBadge, { backgroundColor: pos.side === 'buy' ? colors.greenDim : colors.redDim }]}>
                      <Text style={{ color: pos.side === 'buy' ? colors.green : colors.red, fontSize: 9, fontWeight: '700' }}>
                        {(pos.side || 'BUY').toUpperCase()}
                      </Text>
                    </View>
                    <View>
                      <Text style={{ color: colors.t1, fontSize: 13, fontWeight: '600' }}>{pos.symbol}</Text>
                      <Text style={{ color: colors.t3, fontSize: 10 }}>{pos.volume} lots · {currentP.toFixed(2)}</Text>
                    </View>
                  </View>
                  <Text style={{ color: livePnl >= 0 ? colors.green : colors.red, fontSize: 13, fontWeight: '700' }}>
                    {livePnl >= 0 ? '+' : ''}{fmtUSD(livePnl)}
                  </Text>
                </View>
              );
            })}
          </View>
        )}

        {/* ── 6. MARKET OVERVIEW ── */}
        <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          <Text style={[styles.secTitle, { color: colors.t1 }]}>MARKET OVERVIEW</Text>
          {[
            { sym: 'XAUUSD', label: 'Gold / USD', icon: 'diamond-outline' as const, clr: '#f59e0b' },
            { sym: 'EURUSD', label: 'Euro / USD', icon: 'cash-outline' as const, clr: '#3b82f6' },
            { sym: 'GBPUSD', label: 'Pound / USD', icon: 'card-outline' as const, clr: '#8b5cf6' },
            { sym: 'BTCUSD', label: 'Bitcoin / USD', icon: 'logo-bitcoin' as const, clr: '#f97316' },
            { sym: 'USDJPY', label: 'USD / Yen', icon: 'swap-horizontal-outline' as const, clr: '#06b6d4' },
            { sym: 'XAGUSD', label: 'Silver / USD', icon: 'ellipse-outline' as const, clr: '#94a3b8' },
          ].map((item, idx) => {
            const p = prices[item.sym];
            const bid = n(p?.bid);
            const ask = n(p?.ask);
            const ch = n(p?.change);
            const isUp = ch >= 0;
            const decimals = item.sym.includes('XAU') || item.sym.includes('XAG') || item.sym.includes('BTC') ? 2 : item.sym.includes('JPY') ? 3 : 5;
            return (
              <View key={item.sym} style={[styles.mktRow, { borderBottomColor: idx < 5 ? colors.border : 'transparent' }]}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1 }}>
                  <View style={{ width: 32, height: 32, borderRadius: 8, backgroundColor: `${item.clr}15`, alignItems: 'center', justifyContent: 'center' }}>
                    <Ionicons name={item.icon} size={16} color={item.clr} />
                  </View>
                  <View>
                    <Text style={{ color: colors.t1, fontSize: 13, fontWeight: '700' }}>{item.sym}</Text>
                    <Text style={{ color: colors.t3, fontSize: 10 }}>{item.label}</Text>
                  </View>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 2 }}>
                  <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
                    {bid ? bid.toFixed(decimals) : '---'}
                  </Text>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                    {bid > 0 && ask > 0 && (
                      <Text style={{ color: colors.t3, fontSize: 9 }}>Spd {((ask - bid) * (item.sym.includes('JPY') ? 1000 : 100000)).toFixed(1)}</Text>
                    )}
                    <View style={[styles.chgBadge, { backgroundColor: isUp ? colors.greenDim : colors.redDim }]}>
                      <Ionicons name={isUp ? 'caret-up' : 'caret-down'} size={8} color={isUp ? colors.green : colors.red} />
                      <Text style={{ color: isUp ? colors.green : colors.red, fontSize: 10, fontWeight: '700' }}>
                        {Math.abs(ch).toFixed(2)}%
                      </Text>
                    </View>
                  </View>
                </View>
              </View>
            );
          })}
        </View>

        {/* ── 7. MARKET HEATMAP (TradingView) ── */}
        <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
            <Text style={[styles.secTitle, { color: colors.t1, marginBottom: 0 }]}>MARKET HEATMAP</Text>
            <Text style={{ color: colors.t3, fontSize: 10 }}>S&P 500</Text>
          </View>
          <View style={{ height: 300, borderRadius: 8, overflow: 'hidden' }}>
            <WebView
              source={{ html: heatmapHtml }}
              style={{ flex: 1, backgroundColor: 'transparent' }}
              scrollEnabled={false}
              javaScriptEnabled
              domStorageEnabled
            />
          </View>
        </View>

        {/* ── 8. MARKET NEWS ── */}
        <View style={[styles.card, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
          <Text style={[styles.secTitle, { color: colors.t1 }]}>MARKET NEWS</Text>
          {newsLoading ? (
            <ActivityIndicator size="small" color={colors.blue} style={{ marginVertical: 20 }} />
          ) : (
            news.map((item: any, idx: number) => (
              <TouchableOpacity
                key={item.id || idx}
                style={[styles.newsRow, { borderBottomColor: idx < news.length - 1 ? colors.border : 'transparent' }]}
                activeOpacity={0.7}
                onPress={() => item.url && item.url !== '#' && Linking.openURL(item.url)}
              >
                {item.image && (
                  <Image source={{ uri: item.image }} style={styles.newsImage} />
                )}
                <View style={{ flex: 1, gap: 4 }}>
                  <Text style={{ color: colors.t1, fontSize: 13, fontWeight: '600', lineHeight: 18 }} numberOfLines={2}>
                    {item.headline}
                  </Text>
                  {item.summary && (
                    <Text style={{ color: colors.t3, fontSize: 11, lineHeight: 15 }} numberOfLines={2}>
                      {item.summary}
                    </Text>
                  )}
                  <View style={{ flexDirection: 'row', gap: 8, marginTop: 2 }}>
                    <Text style={{ color: colors.blue, fontSize: 10, fontWeight: '600' }}>{item.source}</Text>
                    <Text style={{ color: colors.t3, fontSize: 10 }}>{formatTime(item.datetime)}</Text>
                  </View>
                </View>
              </TouchableOpacity>
            ))
          )}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

/* ── STYLES ── */
const styles = StyleSheet.create({
  safe: { flex: 1 },

  // Banner
  banner: {
    borderRadius: 16, overflow: 'hidden', paddingHorizontal: 24, paddingVertical: 32,
    minHeight: 170, justifyContent: 'center', backgroundColor: '#0c1929',
  },
  bannerAccent1: {
    position: 'absolute', right: -30, top: -50, width: 220, height: 220,
    backgroundColor: 'rgba(59,130,246,0.12)', transform: [{ rotate: '30deg' }], borderRadius: 40,
  },
  bannerAccent2: {
    position: 'absolute', left: -20, bottom: -30, width: 160, height: 160,
    backgroundColor: 'rgba(6,182,212,0.08)', transform: [{ rotate: '-15deg' }], borderRadius: 30,
  },
  bannerTitle: {
    fontSize: 32, fontWeight: '900', color: '#3b82f6', letterSpacing: 2, lineHeight: 38,
  },
  bannerTagline: {
    fontSize: 16, fontWeight: '700', color: '#ffffff', letterSpacing: 3, marginTop: 4,
  },
  bannerSub: { fontSize: 11, color: 'rgba(255,255,255,0.45)', marginTop: 10, letterSpacing: 1.5, fontWeight: '500' },
  bannerImageWrap: {
    borderRadius: 14, overflow: 'hidden', position: 'relative',
    aspectRatio: 16 / 7,
  },
  bannerImage: { width: '100%', height: '100%' },
  bannerDots: {
    position: 'absolute', bottom: 8, left: 0, right: 0,
    flexDirection: 'row', justifyContent: 'center', gap: 4,
  },
  bannerDot: { width: 6, height: 6, borderRadius: 3 },

  // Cards
  card: { borderRadius: 16, padding: 16, borderWidth: 1 },
  cardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 },
  cardLabel: { fontSize: 11, fontWeight: '600', letterSpacing: 1, textTransform: 'uppercase' },
  badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  bigBal: { fontSize: 26, fontWeight: '800', marginBottom: 14 },

  // Stats
  statsRow: { flexDirection: 'row', gap: 10 },
  statBox: { flex: 1, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8 },
  statLabel: { fontSize: 10, fontWeight: '600', letterSpacing: 0.5, textTransform: 'uppercase', marginBottom: 4 },
  statVal: { fontSize: 14, fontWeight: '600' },

  // Quick Actions
  secTitle: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, marginBottom: 12 },
  actionRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    padding: 14, borderRadius: 10, borderWidth: 1,
  },
  actionIcon: {
    width: 36, height: 36, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1,
  },

  // Positions
  posRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1 },
  sideBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 4 },

  // Market Overview
  mktRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: 12, borderBottomWidth: 1,
  },
  chgBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 3,
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
  },

  // News
  newsRow: { flexDirection: 'row', gap: 12, paddingVertical: 12, borderBottomWidth: 1 },
  newsImage: { width: 72, height: 72, borderRadius: 8, backgroundColor: '#333' },
});

export default HomeScreen;
