import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View, Text, StyleSheet, TouchableOpacity, Pressable, TextInput,
  ScrollView, Modal, Alert, ActivityIndicator, Dimensions,
  PanResponder, Animated, KeyboardAvoidingView, Platform,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../contexts/AuthContext';
import { useSocket } from '../../contexts/SocketContext';
import { useTheme } from '../../theme/ThemeContext';
import { tradingAPI, userAPI } from '../../services/api';
import { API_URL, CHART_LIB_URL } from '../../config';
import AppHeader from '../../components/AppHeader';
import { useSegmentSettings } from '../../hooks/useSegmentSettings';

const SW = Dimensions.get('window').width;
const SH = Dimensions.get('window').height;

// Data source detection for historical candle API routing.
//
// Returning 'zerodha' for Indian symbols isn't a hard pin to Kite — the
// WebView's getBars walks a candidate list (Zerodha → Accelpix) so the
// Accelpix backend (pix-apidata) takes over automatically when Zerodha
// has no session. We default to 'zerodha' here so the existing Zerodha-
// stamped instruments keep their current ordering; pure Accelpix-side
// instruments get 'accelpix' below.
function getDataSource(symbol: string): string {
  const s = (symbol || '').toUpperCase();
  // Accelpix continuous-future tickers (RELIANCE-1, NIFTY-2, etc.) come
  // exclusively from the Accelpix master — no Zerodha equivalent.
  if (/^[A-Z&]{2,}-\d+$/.test(s)) return 'accelpix';
  // Indian F&O tradingsymbol patterns. Must come before the generic
  // keyword check so deep-linked options from OptionChain route to
  // Zerodha (they aren't on MetaAPI / Delta). The WebView's getBars
  // falls back to Accelpix automatically if Zerodha returns nothing.
  //   Monthly: HDFCLIFE26APR525CE, NIFTY25APR23000PE, GOLDM26MAYFUT
  //   Weekly : NIFTY24D0524000CE (year 24, month-letter D, day 05, strike 24000)
  if (/^[A-Z&]+\d{2}[A-Z]{3}\d*(CE|PE|FUT)$/.test(s)) return 'zerodha';
  if (/^[A-Z&]{2,}\d+.*\d(CE|PE)$/.test(s)) return 'zerodha';
  // Indian instruments (index / watchlist shortcuts)
  if (s.includes('NIFTY') || s.includes('BANKNIFTY') || s.includes('SENSEX') || s.endsWith('.NS') || s.endsWith('.BO') || s.includes('SBIN')) return 'zerodha';
  // Crypto
  if (s.includes('BTC') || s.includes('ETH') || s.includes('LTC') || s.includes('XRP') || s.includes('ADA') || s.includes('SOL') || s.includes('DOGE') || s.includes('DOT') || s.includes('AVAX') || s.includes('LINK') || s.includes('MATIC')) return 'delta';
  // Infoway (forex, metals, indices, stocks)
  return 'infoway';
}

// Build chart HTML with inline custom datafeed (no external files needed).
// libUrl serves the TradingView Charting Library static files (web host).
// apiUrl is the REST backend used for historical candles + data APIs.
// These can be the same host, or split (e.g. stocktre.com + api.stocktre.com).
function buildChartHTML(apiUrl: string, libUrl: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;overflow:hidden;background:#000;transition:background 0.2s}
html.light,body.light{background:#ffffff}
#tv_chart_container{width:100%;height:100%}
#loading{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#94a3b8;font-family:system-ui;font-size:13px;background:#000}
body.light #loading{background:#ffffff;color:#4a587a}
</style>
<script>
// Forward uncaught JS errors + unhandled promise rejections to RN so a
// broken chart surfaces as a real message in the Metro console instead
// of a generic "didn't respond within 20s" timeout overlay.
window.addEventListener('error', function(e){
  try{
    window.ReactNativeWebView.postMessage(JSON.stringify({
      type:'consoleError',
      message:(e && e.message) || 'error',
      src:(e && e.filename) || '',
      line:(e && e.lineno) || 0,
    }));
  }catch(_){}
});
window.addEventListener('unhandledrejection', function(e){
  try{
    var r = e && (e.reason && (e.reason.message || String(e.reason))) || 'rejection';
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'consoleError',message:r}));
  }catch(_){}
});
</script>
<script src="${libUrl}/charting_library/charting_library.standalone.js"
  onerror="try{window.ReactNativeWebView.postMessage(JSON.stringify({type:'chartLibFailed',src:'${libUrl}/charting_library/charting_library.standalone.js'}));}catch(e){}"></script>
</head>
<body>
<div id="loading">Loading chart…</div>
<div id="tv_chart_container"></div>
<script>
// ─── State ───
var currentSymbol = 'BTCUSD';
var currentDataSource = 'infoway';
var API_BASE = '${apiUrl}';
var livePrices = {};
var subscriptions = {};

// ─── Resolve interval strings ───
// accelpix minute strings ('1','5','15','60','EOD') match what the
// pix-apidata SDK accepts on getIntraEod / getEod — see server-side
// AccelpixService.INTERVAL_MAP for the full set.
var TV_TO_API = {
  '1': { zerodha:'minute', meta:'1m', delta:'1m', accelpix:'1', sec:60 },
  '5': { zerodha:'5minute', meta:'5m', delta:'5m', accelpix:'5', sec:300 },
  '15':{ zerodha:'15minute',meta:'15m',delta:'15m',accelpix:'15',sec:900 },
  '60':{ zerodha:'60minute',meta:'1h', delta:'1h', accelpix:'60',sec:3600 },
  'D': { zerodha:'day',     meta:'1d', delta:'1d', accelpix:'EOD',sec:86400 },
  '1D':{ zerodha:'day',     meta:'1d', delta:'1d', accelpix:'EOD',sec:86400 },
};
var DELTA_LB = {'1':172800,'5':604800,'15':1209600,'60':2592000,'1D':31536000,'D':31536000};

function getPricescale(s){
  s=(s||'').toUpperCase();
  if(s.includes('JPY'))return 1000;
  if(s.includes('XAU')||s.includes('GOLD'))return 100;
  if(s.includes('XAG')||s.includes('SILVER'))return 1000;
  if(s.includes('BTC'))return 100;
  if(s.includes('ETH'))return 100;
  if(s.includes('US30')||s.includes('US100')||s.includes('US500'))return 100;
  if(s.length>=6&&s.length<=10)return 100000;
  return 100;
}

function candleMs(t){var n=Number(t);if(!isFinite(n))return null;return n>1e12?Math.floor(n):Math.floor(n*1000);}

// ─── Custom Datafeed ───
var Datafeed = {
  onReady: function(cb){
    setTimeout(function(){
      cb({
        supported_resolutions:['1','5','15','60','1D'],
        exchanges:[{value:'MARKET',name:'MARKET',desc:'Market'}],
        symbols_types:[{name:'All',value:'all'}]
      });
    });
  },
  searchSymbols: function(q,ex,st,cb){cb([]);},
  resolveSymbol: function(name,ok,err){
    setTimeout(function(){
      ok({
        name:name,full_name:name,description:name,type:'crypto',
        session:'24x7',timezone:'Asia/Kolkata',exchange:'MARKET',
        minmov:1,pricescale:getPricescale(name),
        has_intraday:true,visible_plots_set:'ohlcv',
        has_weekly_and_monthly:false,
        supported_resolutions:['1','5','15','60','1D'],
        volume_precision:2,data_status:'streaming'
      });
    });
  },
  getBars: function(si,res,pp,onHist,onErr){
    var sym = si.name;
    var from = pp.from;
    var to = pp.to;
    var m = TV_TO_API[res]||TV_TO_API['60'];
    // Build candidate URL list. For Indian symbols Zerodha is the
    // primary source; if its session isn't authenticated (typical
    // outside Kite trading hours, or right after the daily 08:00 IST
    // token reset), the request returns no candles. Fall back to
    // Accelpix (pix-apidata) which has its own EOD + intraday store.
    var urls = [];
    if(currentDataSource==='zerodha'){
      urls.push(API_BASE+'/api/zerodha/historical/'+encodeURIComponent(sym)+'?interval='+m.zerodha+'&from='+from+'&to='+to);
      urls.push(API_BASE+'/api/accelpix/historical/'+encodeURIComponent(sym)+'?interval='+(m.accelpix||'5')+'&from='+from+'&to='+to);
    } else if(currentDataSource==='accelpix'){
      urls.push(API_BASE+'/api/accelpix/historical/'+encodeURIComponent(sym)+'?interval='+(m.accelpix||'5')+'&from='+from+'&to='+to);
    } else if(currentDataSource==='delta'){
      var lb=DELTA_LB[res]||604800;
      urls.push(API_BASE+'/api/delta/history/'+encodeURIComponent(sym)+'?resolution='+m.delta+'&lookbackSec='+lb);
    } else {
      urls.push(API_BASE+'/api/infoway/historical/'+encodeURIComponent(sym)+'?timeframe='+m.meta+'&limit=500&startTime='+from);
    }
    // Walk the candidates serially; first one with candles wins. Each
    // attempt has its own 15s abort controller so a slow first source
    // can't starve the fallback.
    var attempt = 0;
    function tryNext(){
      if(attempt >= urls.length){ onHist([],{noData:true}); return; }
      var url = urls[attempt++];
      var ctrl=new AbortController();
      var tid=setTimeout(function(){ctrl.abort();},15000);
      fetch(url,{signal:ctrl.signal}).then(function(r){return r.json();}).then(function(data){
        clearTimeout(tid);
        var raw=Array.isArray(data&&data.candles)?data.candles:[];
        if(data&&data.success&&raw.length>0){
          var bars=[];
          for(var i=0;i<raw.length;i++){
            var t=candleMs(raw[i].time);
            if(t!=null)bars.push({time:t,open:raw[i].open,high:raw[i].high,low:raw[i].low,close:raw[i].close,volume:raw[i].volume||0});
          }
          var fMs=from*1000,tMs=to*1000;
          var f=bars.filter(function(b){return b.time>=fMs&&b.time<=tMs;});
          var out=f.length>0?f:bars;
          onHist(out.length>0?out:[],{noData:out.length===0});
        } else {
          tryNext();
        }
      }).catch(function(){ clearTimeout(tid); tryNext(); });
    }
    tryNext();
  },
  subscribeBars: function(si,res,onRT,uid){
    subscriptions[uid]={symbol:si.name,resolution:res,lastBarTime:null,lastBarOpen:0,lastBarHigh:0,lastBarLow:0,callback:onRT};
  },
  unsubscribeBars: function(uid){delete subscriptions[uid];}
};

// ─── Live price injection (called from RN) ───
function updateLivePrice(sym, priceObj){
  livePrices[sym]=priceObj;
  var chartPrice=priceObj.bid||priceObj.last_price||priceObj.ask||0;
  if(!chartPrice)return;
  var now=Date.now();
  var keys=Object.keys(subscriptions);
  for(var k=0;k<keys.length;k++){
    var sub=subscriptions[keys[k]];
    if(sub.symbol!==sym)continue;
    var rd=TV_TO_API[sub.resolution]||TV_TO_API['60'];
    var rm=rd.sec*1000;
    var bt=Math.floor(now/rm)*rm;
    if(sub.lastBarTime===bt){
      sub.lastBarHigh=Math.max(sub.lastBarHigh,chartPrice);
      sub.lastBarLow=Math.min(sub.lastBarLow,chartPrice);
      sub.callback({time:bt,open:sub.lastBarOpen,high:sub.lastBarHigh,low:sub.lastBarLow,close:chartPrice,volume:0});
    } else {
      sub.lastBarTime=bt;sub.lastBarOpen=chartPrice;sub.lastBarHigh=chartPrice;sub.lastBarLow=chartPrice;
      sub.callback({time:bt,open:chartPrice,high:chartPrice,low:chartPrice,close:chartPrice,volume:0});
    }
  }
}

// ─── Change symbol (called from RN) ───
function changeSymbol(sym, ds){
  currentSymbol=sym;
  currentDataSource=ds;
  if(window.__tvWidget){
    try{window.__tvWidget.activeChart().setSymbol(sym);}catch(e){}
  }
}

// ─── Theme overrides ───
var currentTheme = 'Dark';
function themeOverrides(theme){
  var isLight = theme === 'Light';
  return {
    'paneProperties.background': isLight ? '#ffffff' : '#000000',
    'paneProperties.backgroundType':'solid',
    'paneProperties.vertGridProperties.color': isLight ? '#e6e6e6' : '#1a1a1a',
    'paneProperties.horzGridProperties.color': isLight ? '#e6e6e6' : '#1a1a1a',
    'scalesProperties.backgroundColor': isLight ? '#ffffff' : '#000000',
    'scalesProperties.lineColor': isLight ? '#e6e6e6' : '#1a1a1a',
    'scalesProperties.textColor': isLight ? '#363a45' : '#d1d4dc'
  };
}

// Force-restyle TradingView's sidebar drawing-tools toolbar + top header —
// these DOM elements render with a hardcoded dark bg by the library and
// don't follow the widget theme alone. Use CSS to cover both modes.
function applyThemeCss(theme){
  var light = theme === 'Light';
  document.documentElement.classList.toggle('light', light);
  document.body.classList.toggle('light', light);
  var styleId='stk-theme-overrides';
  var old=document.getElementById(styleId);
  if(old) old.remove();
  var s=document.createElement('style');
  s.id=styleId;
  s.textContent = light ? [
    '[class*="toolbar"],[class*="leftToolbar"],[class*="drawingToolbarWidget"]{background:#ffffff!important;border-color:#e6e6e6!important}',
    '[class*="toolbar"] svg,[class*="leftToolbar"] svg,[class*="drawingToolbarWidget"] svg{color:#363a45!important;fill:#363a45!important}',
    '[class*="button-"]:hover,[class*="group-"]:hover{background:#f0f4ff!important}',
    '[class*="separator-"]{background:#e6e6e6!important}'
  ].join('\\n') : [
    '[class*="toolbar"],[class*="leftToolbar"],[class*="drawingToolbarWidget"]{background:#000000!important;border-color:#1a1a1a!important}',
    '[class*="toolbar"] svg,[class*="leftToolbar"] svg,[class*="drawingToolbarWidget"] svg{color:#d1d4dc!important;fill:#d1d4dc!important}',
    '[class*="separator-"]{background:#1a1a1a!important}'
  ].join('\\n');
  document.head.appendChild(s);
}

function changeTheme(theme){
  var newTheme = (theme === 'Light' ? 'Light' : 'Dark');
  if(newTheme === currentTheme && window.__tvWidget) return;
  currentTheme = newTheme;
  // Full re-init: the left drawing toolbar (pencil/line/ruler icons) renders
  // with the theme it was created with — calling widget.changeTheme() updates
  // the chart pane but NOT the toolbar chrome. Destroying and recreating the
  // widget guarantees every piece of chrome picks up the new theme.
  if(window.__tvWidget){
    try{window.__tvWidget.remove();}catch(e){}
    window.__tvWidget = null;
  }
  initChart(currentSymbol, currentDataSource, currentTheme);
}

// ─── Init widget ───
function initChart(sym, ds, theme){
  currentSymbol=sym;
  currentDataSource=ds;
  currentTheme = (theme === 'Light' ? 'Light' : 'Dark');
  applyThemeCss(currentTheme);
  if(typeof TradingView === 'undefined' || !TradingView.widget){
    document.getElementById('loading').innerText='Chart library failed to load. Check API_URL.';
    return;
  }
  var loadingEl=document.getElementById('loading');
  if(loadingEl) loadingEl.style.display='flex';
  if(window.__tvWidget){try{window.__tvWidget.remove();}catch(e){}}
  var w = new TradingView.widget({
    symbol: sym,
    datafeed: Datafeed,
    interval: '5',
    container: 'tv_chart_container',
    library_path: '${libUrl}/charting_library/',
    locale: 'en',
    fullscreen: false,
    autosize: true,
    theme: currentTheme,
    toolbar_bg: currentTheme === 'Light' ? '#ffffff' : '#000000',
    disabled_features: [
      'use_localstorage_for_settings','header_symbol_search','header_compare',
      'display_market_status','timeframes_toolbar','popup_hints',
      'header_fullscreen_button'
    ],
    enabled_features: [
      'study_templates','hide_left_toolbar_by_default','items_favoriting'
    ],
    overrides: themeOverrides(currentTheme)
  });
  window.__tvWidget=w;
  w.onChartReady(function(){
    var le=document.getElementById('loading'); if(le) le.style.display='none';
    window.ReactNativeWebView.postMessage(JSON.stringify({type:'chartReady'}));
  });
}

// ─── Listen for RN messages ───
document.addEventListener('message', function(e){handleMsg(e);});
window.addEventListener('message', function(e){handleMsg(e);});
function handleMsg(e){
  try{
    var d=JSON.parse(e.data);
    if(d.type==='init') initChart(d.symbol, d.dataSource, d.theme);
    else if(d.type==='changeSymbol') changeSymbol(d.symbol, d.dataSource);
    else if(d.type==='livePrice') updateLivePrice(d.symbol, d.price);
    else if(d.type==='theme') changeTheme(d.theme);
  }catch(err){}
}

// Post ready
window.addEventListener('DOMContentLoaded', function(){
  window.ReactNativeWebView.postMessage(JSON.stringify({type:'webviewReady'}));
});
</script>
</body>
</html>`;
}

interface ChartScreenProps {
  route?: any;
}

// Sanitize strings before interpolating into injectJavaScript to prevent XSS.
// Only allow alphanumeric, dots, hyphens, underscores, and slashes.
const sanitizeForJS = (s: string) => s.replace(/[^a-zA-Z0-9._\-\/]/g, '');

const ChartScreen: React.FC<ChartScreenProps> = ({ route }) => {
  const { user } = useAuth();
  const { prices, isConnected } = useSocket();
  const { colors, isDark } = useTheme();
  const insets = useSafeAreaInsets();
  const bottomPad = Math.max(insets.bottom, 12);
  const webViewRef = useRef<WebView>(null);

  // Chart tabs (like Image 2 top bar)
  const [chartTabs, setChartTabs] = useState<string[]>(['BTCUSD']);
  const [activeTab, setActiveTab] = useState('BTCUSD');
  const [chartReady, setChartReady] = useState(false);
  // Surfaces "Chart couldn't load" in the overlay when the widget doesn't
  // confirm ready within a reasonable window OR the WebView itself errors.
  const [chartError, setChartError] = useState<string>('');

  // Order panel state
  const [orderSheetOpen, setOrderSheetOpen] = useState(false);
  const [orderSide, setOrderSide] = useState<'buy' | 'sell'>('buy');
  const [orderType, setOrderType] = useState('market');
  const [volume, setVolume] = useState('0.01');
  const [limitPrice, setLimitPrice] = useState('');
  const [stopLoss, setStopLoss] = useState('');
  const [takeProfit, setTakeProfit] = useState('');
  const [showSL, setShowSL] = useState(false);
  const [showTP, setShowTP] = useState(false);
  const [isPlacingOrder, setIsPlacingOrder] = useState(false);
  const [tradingMode, setTradingMode] = useState('netting');
  const [allowedTradeModes, setAllowedTradeModes] = useState<{ netting: boolean; binary: boolean }>({ netting: true, binary: false });
  const [binaryDirection, setBinaryDirection] = useState<'up' | 'down'>('up');
  const [binaryAmount, setBinaryAmount] = useState('100');
  const [binaryExpiry, setBinaryExpiry] = useState(300);

  // Animated bottom-sheet: translateY drives both open/close + swipe
  const sheetAnim = useRef(new Animated.Value(SH)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const sheetDragOffset = useRef(0);

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

  // Swipe-up on trade bar to open order panel
  const tradeBarPanResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, g) => g.dy < -15,
      onPanResponderRelease: (_, g) => {
        if (g.dy < -30 || g.vy < -0.3) {
          openSheet();
        }
      },
    })
  ).current;

  // Fetch allowed trade modes
  useEffect(() => {
    const fetchModes = async () => {
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
          if (u.role === 'admin' || u.role === 'superadmin') modes = { netting: true, binary: true };
          setAllowedTradeModes(modes);
        }
      } catch (_) {}
    };
    fetchModes();
  }, [user?.id]);

  // Handle incoming symbol from navigation (Market → Chart icon)
  useEffect(() => {
    const sym = route?.params?.symbol;
    if (sym && sym !== activeTab) {
      addChartTab(sym);
    }
  }, [route?.params?.symbol]);

  // Send live prices to WebView
  useEffect(() => {
    if (!chartReady || !webViewRef.current) return;
    const p = prices[activeTab];
    if (p) {
      webViewRef.current.injectJavaScript(
        `updateLivePrice('${sanitizeForJS(activeTab)}', ${JSON.stringify(p)}); true;`
      );
    }
  }, [prices, activeTab, chartReady]);

  const addChartTab = (sym: string) => {
    if (!chartTabs.includes(sym)) {
      setChartTabs(prev => [...prev, sym]);
    }
    setActiveTab(sym);
    // Tell WebView to change symbol
    if (chartReady && webViewRef.current) {
      const ds = getDataSource(sym);
      webViewRef.current.injectJavaScript(
        `changeSymbol('${sanitizeForJS(sym)}', '${sanitizeForJS(ds)}'); true;`
      );
    }
  };

  const removeChartTab = (sym: string) => {
    const newTabs = chartTabs.filter(s => s !== sym);
    if (newTabs.length === 0) newTabs.push('BTCUSD');
    setChartTabs(newTabs);
    if (activeTab === sym) {
      const newActive = newTabs[newTabs.length - 1];
      setActiveTab(newActive);
      if (chartReady && webViewRef.current) {
        const ds = getDataSource(newActive);
        webViewRef.current.injectJavaScript(
          `changeSymbol('${newActive}', '${ds}'); true;`
        );
      }
    }
  };

  const onWebViewMessage = (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data);
      if (data.type === 'webviewReady') {
        // Init chart
        const ds = getDataSource(activeTab);
        const theme = isDark ? 'Dark' : 'Light';
        webViewRef.current?.injectJavaScript(
          `initChart('${sanitizeForJS(activeTab)}', '${sanitizeForJS(ds)}', '${sanitizeForJS(theme)}'); true;`
        );
      } else if (data.type === 'chartReady') {
        setChartReady(true);
        setChartError('');
      } else if (data.type === 'chartLibFailed') {
        setChartError(`Chart library failed to load from ${data.src || 'CHART_LIB_URL'}. Check the phone can reach that URL.`);
      } else if (data.type === 'consoleError') {
        // Bubble up to Metro. These were invisible before — a broken chart
        // silently hit the 20s timeout without any clue in logs.
        // eslint-disable-next-line no-console
        console.warn('[Chart WebView]', data.message, data.src ? `(${data.src}:${data.line || 0})` : '');
      }
    } catch (_) {}
  };

  // Fallback timeout — if the chart hasn't reported ready within 20s, the
  // TradingView script probably didn't load (stocktre.com unreachable,
  // blocked, or the WebView silently choked). Show a real error instead
  // of leaving the user on an infinite spinner.
  useEffect(() => {
    if (chartReady) return;
    const t = setTimeout(() => {
      if (!chartReady) {
        setChartError('Chart didn\'t respond within 20 seconds — library may be unreachable.');
      }
    }, 20000);
    return () => clearTimeout(t);
  }, [chartReady, activeTab]);

  // React to theme changes after the chart is ready
  useEffect(() => {
    if (!chartReady) return;
    const theme = isDark ? 'Dark' : 'Light';
    webViewRef.current?.injectJavaScript(`changeTheme('${theme}'); true;`);
  }, [isDark, chartReady]);

  // Pull effective NettingSegment settings for the symbol on chart so
  // the buy/sell action enforces admin-set min lot / per-order cap /
  // max lot before hitting the engine. Mirrors the web MarketPage
  // pre-trade validation.
  const { validateLot: validateChartLot } = useSegmentSettings(
    activeTab,
    null,
    user?.oderId,
    tradingMode,
  );

  const handlePlaceOrder = async () => {
    if (!user?.id && !user?.oderId) return;
    setIsPlacingOrder(true);
    try {
      const uid = user?.oderId || user?.id || '';
      const p = prices[activeTab];
      const entryPrice = orderSide === 'buy' ? (p?.ask || 0) : (p?.bid || 0);

      // Pre-trade segment guard — admin min lot / per-order / max lot.
      if (tradingMode !== 'binary') {
        const r = validateChartLot(parseFloat(volume) || 0);
        if (!r.ok) {
          Alert.alert('Cannot place order', r.message || 'Invalid lot size.');
          setIsPlacingOrder(false);
          return;
        }
      }

      if (tradingMode === 'binary') {
        await tradingAPI.placeOrder({
          userId: uid,
          symbol: activeTab,
          side: binaryDirection,
          volume: parseFloat(binaryAmount) || 100,
          orderType: 'market',
          price: p?.bid || 0,
          mode: 'binary',
          marketData: { bid: p?.bid || 0, ask: p?.ask || 0 },
          session: `${binaryExpiry}`,
        } as any);
        const expiryLabel = binaryExpiry >= 60 ? `${Math.floor(binaryExpiry / 60)}m` : `${binaryExpiry}s`;
        Alert.alert('Success', `${binaryDirection.toUpperCase()} ₹${binaryAmount} on ${activeTab} - ${expiryLabel}`);
      } else {
        await tradingAPI.placeOrder({
          userId: uid,
          symbol: activeTab,
          side: orderSide,
          volume: parseFloat(volume) || 0.01,
          orderType,
          price: orderType !== 'market' ? parseFloat(limitPrice) : entryPrice,
          stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
          takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
          mode: tradingMode,
          marketData: { bid: p?.bid || 0, ask: p?.ask || 0 },
        });
        Alert.alert('Success', `${orderSide.toUpperCase()} ${volume} lots ${activeTab} placed`);
      }
      closeSheet();
    } catch (e: any) {
      Alert.alert('Order Error', e?.response?.data?.error || e?.response?.data?.message || e.message);
    } finally {
      setIsPlacingOrder(false);
    }
  };

  const handleQuickTrade = async (side: 'buy' | 'sell') => {
    if (!user?.id && !user?.oderId) return;
    try {
      const uid = user?.oderId || user?.id || '';
      const p = prices[activeTab];

      // Pre-trade segment guard — admin min lot / per-order / max lot.
      if (tradingMode !== 'binary') {
        const r = validateChartLot(parseFloat(volume) || 0);
        if (!r.ok) {
          Alert.alert('Cannot place order', r.message || 'Invalid lot size.');
          return;
        }
      }

      await tradingAPI.placeOrder({
        userId: uid, symbol: activeTab, side,
        volume: parseFloat(volume) || 1,
        orderType: 'market',
        price: side === 'buy' ? (p?.ask || 0) : (p?.bid || 0),
        mode: tradingMode,
        marketData: { bid: p?.bid || 0, ask: p?.ask || 0 },
      });
      Alert.alert('Success', `${side.toUpperCase()} ${volume} lots ${activeTab}`);
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || e.message);
    }
  };

  const fmtP = (sym: string, val?: number) => {
    if (!val || val === 0) return '---';
    // Indian instruments render in ₹. Detection mirrors the helper in
    // MarketScreen: F&O tradingsymbol patterns (monthly + weekly options
    // and futures) and known index underlyings. Without this branch,
    // clicking an option from the chain landed on the chart with "$222.20"
    // headers even though the underlying + premium are INR-quoted.
    const s = sym.toUpperCase();
    const INDIAN_INDEX_NAMES = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'MIDCPNIFTY', 'NIFTYNXT50', 'SENSEX', 'BANKEX'];
    const isIndian =
      /^[A-Z&]{2,}\d+.*(?:\d(?:CE|PE)|FUT)$/.test(s) ||
      INDIAN_INDEX_NAMES.some((n) => s === n || s.startsWith(n));
    if (isIndian) {
      return `₹${val.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }
    if (sym.includes('JPY') || sym.includes('XAU') || sym.includes('XAG') || sym.includes('BTC') ||
        sym.includes('ETH') || sym.includes('US3') || sym.includes('US5') || sym.includes('UK1') ||
        sym.includes('OIL')) {
      return `$${val.toFixed(sym.includes('BTC') || sym.includes('ETH') ? 4 : 2)}`;
    }
    return `$${val.toFixed(4)}`;
  };

  const currentPrice = prices[activeTab];
  const chartHTML = buildChartHTML(API_URL, CHART_LIB_URL);

  return (
    <>
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg0 }]} edges={['top']}>
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior="padding"
        keyboardVerticalOffset={0}
      >
      <AppHeader />

      {/* ── Chart Tabs (matches Image 2 top: USDCHF × | BTCUSD × | US30 × | +) ── */}
      <View style={[styles.tabBar, { backgroundColor: colors.bg0, borderBottomColor: colors.border }]}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ alignItems: 'center', paddingRight: 8 }}>
          {chartTabs.map(sym => {
            const isActive = activeTab === sym;
            return (
              <TouchableOpacity
                key={sym}
                style={[styles.chartTab, isActive && { backgroundColor: colors.blueDim }]}
                onPress={() => addChartTab(sym)}
              >
                <Text style={{ color: isActive ? '#fff' : '#64748b', fontSize: 11, fontWeight: isActive ? '700' : '500' }}>
                  {sym}
                </Text>
                <Pressable
                  onPress={() => removeChartTab(sym)}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                  style={{ marginLeft: 4 }}
                >
                  <Ionicons name="close" size={12} color={isActive ? '#fff' : '#64748b'} />
                </Pressable>
              </TouchableOpacity>
            );
          })}
          <TouchableOpacity
            style={styles.addTabBtn}
            onPress={() => {
              // Quick add — could open a symbol picker
              Alert.alert('Add Symbol', 'Navigate to Market tab and tap the chart icon on any instrument.');
            }}
          >
            <Text style={{ color: colors.t3, fontSize: 16 }}>+</Text>
          </TouchableOpacity>
        </ScrollView>
      </View>

      {/* ── TradingView Chart (WebView with custom datafeed) ── */}
      <View style={{ flex: 1 }}>
        <WebView
          ref={webViewRef}
          // baseUrl is the document origin inside the WebView. Use
          // CHART_LIB_URL (not API_URL) so the TradingView library + its
          // lazy-loaded `bundles/*` chunks stay SAME-ORIGIN with the
          // document. The library fetches chunks via fetch()/import()
          // which respect CORS, and stocktre.com/charting_library/ does
          // NOT send CORS headers — so on production where API_URL and
          // CHART_LIB_URL are different hosts, pointing baseUrl at the
          // API host would block every chunk and stall the chart.
          //
          // API calls go cross-origin, but the API server explicitly
          // allows stocktre.com as an origin (access-control-allow-origin
          // + access-control-allow-credentials), so that direction works.
          //
          // In local dev CHART_LIB_URL is http://<lan-ip>:3001 too (the
          // backend now serves /charting_library/) so same-origin holds
          // for both library AND API — no mixed content either way.
          source={{ html: chartHTML, baseUrl: CHART_LIB_URL }}
          style={{ flex: 1, backgroundColor: isDark ? '#000' : '#fff' }}
          javaScriptEnabled
          domStorageEnabled
          // '*' must include `blob:` — TradingView spawns Web Workers from
          // `URL.createObjectURL(new Blob([...]))`. Without blob: in the
          // whitelist, RN intercepts the worker's URL and hands it to the
          // native Linking handler, which can't open a blob: and logs
          // "Can't open url: blob:...". The worker never spawns, the chart
          // stalls, and our 20-second fallback fires with "library may be
          // unreachable" — masking the real cause.
          originWhitelist={['*']}
          mixedContentMode="always"
          allowsInlineMediaPlayback
          // Keeps navigation inside the WebView. Without this, taps on any
          // in-chart link / the worker's blob URL get routed to Linking.
          // We return true for everything — the datafeed only fetches from
          // our backend and the TV library loads sub-resources from
          // CHART_LIB_URL.
          onShouldStartLoadWithRequest={() => true}
          setSupportMultipleWindows={false}
          onMessage={onWebViewMessage}
          onError={(e: any) => setChartError(`WebView error: ${e?.nativeEvent?.description || 'unknown'}`)}
          onHttpError={(e: any) => setChartError(`HTTP ${e?.nativeEvent?.statusCode || ''} loading chart library`)}
        />
        {/* Our own overlay — stays up until the chart widget signals
            onChartReady OR the init timeout fires. The WebView's built-in
            startInLoadingState hid silently for "indefinite loading" cases
            (e.g. the TradingView library URL hangs) and the user was left
            staring at a black screen with no explanation. */}
        {!chartReady && (
          <View pointerEvents="none" style={[styles.loadingOverlay, { backgroundColor: isDark ? '#000' : '#fff' }]}>
            {chartError ? (
              <>
                <Ionicons name="alert-circle-outline" size={40} color={colors.red} />
                <Text style={{ color: colors.t1, marginTop: 10, fontSize: 14, fontWeight: '600', textAlign: 'center', paddingHorizontal: 20 }}>
                  Chart couldn't load
                </Text>
                <Text style={{ color: colors.t3, marginTop: 4, fontSize: 11, textAlign: 'center', paddingHorizontal: 24 }}>
                  {chartError}
                </Text>
              </>
            ) : (
              <>
                <ActivityIndicator size="large" color={colors.blue} />
                <Text style={{ color: colors.t3, marginTop: 8, fontSize: 12 }}>Loading chart…</Text>
              </>
            )}
          </View>
        )}
      </View>

      {/* ── BOTTOM TRADE BAR (matches Image 2: SELL | LOTS | BUY) ── */}
      <View {...tradeBarPanResponder.panHandlers} style={[styles.tradeBar, { backgroundColor: colors.bg1, borderTopColor: colors.border, paddingBottom: bottomPad }]}>
        <TouchableOpacity style={styles.handleWrap} onPress={openSheet}>
          <View style={[styles.handleBarSmall, { backgroundColor: colors.t3 }]} />
        </TouchableOpacity>
        <View style={styles.tradeRow}>
          <TouchableOpacity
            style={[styles.tradeBtn, { backgroundColor: '#ef4444' }]}
            onPress={() => handleQuickTrade('sell')}
            activeOpacity={0.8}
          >
            <Text style={styles.tradeLbl}>SELL</Text>
            <Text style={styles.tradePrice}>{fmtP(activeTab, currentPrice?.bid)}</Text>
          </TouchableOpacity>
          <View style={[styles.lotBox, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
            <Text style={{ color: colors.t3, fontSize: 8, fontWeight: '600' }}>LOTS</Text>
            <TextInput
              style={{ color: colors.t1, fontSize: 14, fontWeight: '700', textAlign: 'center', padding: 0, minWidth: 36 }}
              value={volume}
              onChangeText={v => { if (v === '' || /^[0-9]*\.?[0-9]*$/.test(v)) setVolume(v); }}
              keyboardType="decimal-pad"
            />
          </View>
          <TouchableOpacity
            style={[styles.tradeBtn, { backgroundColor: '#22c55e' }]}
            onPress={() => handleQuickTrade('buy')}
            activeOpacity={0.8}
          >
            <Text style={styles.tradeLbl}>BUY</Text>
            <Text style={styles.tradePrice}>{fmtP(activeTab, currentPrice?.ask)}</Text>
          </TouchableOpacity>
        </View>
      </View>
      </KeyboardAvoidingView>
    </SafeAreaView>

      {/* ── ORDER PANEL (swipe-up) ── */}
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
          <Animated.View style={[styles.sheetContent, { backgroundColor: colors.bg1, paddingBottom: bottomPad, transform: [{ translateY: sheetAnim }] }]}>
            <View {...sheetPanResponder.panHandlers} style={styles.sheetHeader}>
              <View style={[styles.handleBar, { backgroundColor: colors.t3 }]} />
              <Pressable onPress={closeSheet} style={{ position: 'absolute', right: 16, top: 10 }} hitSlop={12}>
                <Ionicons name="close" size={24} color={colors.t2} />
              </Pressable>
            </View>

            {/* Symbol header */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingBottom: 8 }}>
              <Text style={{ color: colors.t1, fontSize: 18, fontWeight: '700' }}>{activeTab}</Text>
              <View style={{ flexDirection: 'row', gap: 12 }}>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colors.t3, fontSize: 9 }}>BID</Text>
                  <Text style={{ color: '#ef4444', fontSize: 14, fontWeight: '700' }}>{fmtP(activeTab, currentPrice?.bid)}</Text>
                </View>
                <View style={{ alignItems: 'flex-end' }}>
                  <Text style={{ color: colors.t3, fontSize: 9 }}>ASK</Text>
                  <Text style={{ color: '#22c55e', fontSize: 14, fontWeight: '700' }}>{fmtP(activeTab, currentPrice?.ask)}</Text>
                </View>
              </View>
            </View>

            <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: 16, paddingBottom: 50 }} keyboardShouldPersistTaps="handled" bounces={false} showsVerticalScrollIndicator={true}>
              {/* ── Trading mode tabs ── */}
              <View style={{ flexDirection: 'row', marginBottom: 14, gap: 8 }}>
                {[
                  { key: 'netting', icon: 'stats-chart', label: 'Netting' },
                  { key: 'binary', icon: 'diamond-outline', label: 'Binary' },
                ].filter(m => allowedTradeModes[m.key as keyof typeof allowedTradeModes]).map(mode => (
                  <TouchableOpacity key={mode.key} style={[styles.modeTab, { backgroundColor: colors.bg3 }, tradingMode === mode.key && { backgroundColor: colors.blue }]} onPress={() => setTradingMode(mode.key)}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
                      <Ionicons name={mode.icon as any} size={14} color={tradingMode === mode.key ? '#0f172a' : '#94a3b8'} />
                      <Text style={{ color: tradingMode === mode.key ? '#0f172a' : '#94a3b8', fontSize: 12, fontWeight: '600' }}>{mode.label}</Text>
                    </View>
                  </TouchableOpacity>
                ))}
              </View>

              {/* ═══ NETTING ═══ */}
              {tradingMode === 'netting' && (<>
                <View style={{ flexDirection: 'row', marginBottom: 14, gap: 6 }}>
                  {[{ key: 'market', label: 'Market' }, { key: 'limit', label: 'Limit' }, { key: 'slm', label: 'SL-M' }].map(t => (
                    <TouchableOpacity key={t.key} style={[styles.orderTypeTab, { backgroundColor: colors.bg3 }, orderType === t.key && { backgroundColor: colors.blue }]} onPress={() => setOrderType(t.key)}>
                      <Text style={{ color: orderType === t.key ? '#e2e8f0' : '#64748b', fontSize: 13, fontWeight: '600' }}>{t.label}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 16 }}>
                  <TouchableOpacity style={[styles.sideBtn, { backgroundColor: orderSide === 'sell' ? '#ef4444' : 'rgba(239,68,68,0.12)', borderColor: '#ef4444' }]} onPress={() => setOrderSide('sell')}>
                    <Text style={{ color: orderSide === 'sell' ? '#fff' : '#ef4444', fontSize: 11, fontWeight: '600' }}>SELL</Text>
                    <Text style={{ color: orderSide === 'sell' ? '#fff' : '#ef4444', fontSize: 16, fontWeight: '700' }}>{fmtP(activeTab, currentPrice?.bid)}</Text>
                  </TouchableOpacity>
                  <Text style={{ color: colors.t3, fontSize: 11 }}>{currentPrice?.bid && currentPrice?.ask ? Math.abs(currentPrice.ask - currentPrice.bid).toFixed(2) : '0.00'}</Text>
                  <TouchableOpacity style={[styles.sideBtn, { backgroundColor: orderSide === 'buy' ? '#22c55e' : 'rgba(34,197,94,0.12)', borderColor: '#22c55e' }]} onPress={() => setOrderSide('buy')}>
                    <Text style={{ color: orderSide === 'buy' ? '#fff' : '#22c55e', fontSize: 11, fontWeight: '600' }}>BUY</Text>
                    <Text style={{ color: orderSide === 'buy' ? '#fff' : '#22c55e', fontSize: 16, fontWeight: '700' }}>{fmtP(activeTab, currentPrice?.ask)}</Text>
                  </TouchableOpacity>
                </View>
                {orderType !== 'market' && (
                  <View style={styles.inputGroup}>
                    <Text style={[styles.inputLabel, { color: colors.t2 }]}>{orderType === 'limit' ? 'Limit Price' : 'Trigger Price'}</Text>
                    <TextInput style={[styles.input, { backgroundColor: colors.bg3, color: colors.t1, borderColor: colors.border }]} value={limitPrice} onChangeText={setLimitPrice} keyboardType="decimal-pad" placeholder={(currentPrice?.bid || 0).toFixed(2)} placeholderTextColor={colors.t3} />
                  </View>
                )}
                <Text style={{ color: colors.t1, fontSize: 12, fontWeight: '600', marginBottom: 6 }}>Lot Size</Text>
                <View style={[styles.volumeRow, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
                  <TouchableOpacity style={styles.volumeBtn} onPress={() => setVolume(p => Math.max(0.01, parseFloat(((parseFloat(p) || 0.01) - 0.01).toFixed(6))).toString())}><Text style={[styles.volumeBtnTxt, { color: colors.t1 }]}>−</Text></TouchableOpacity>
                  <TextInput style={[styles.volumeInput, { color: colors.t1 }]} value={volume} onChangeText={v => { if (v === '' || /^[0-9]*\.?[0-9]*$/.test(v)) setVolume(v); }} keyboardType="decimal-pad" />
                  <TouchableOpacity style={styles.volumeBtn} onPress={() => setVolume(p => parseFloat(((parseFloat(p) || 0.01) + 0.01).toFixed(6)).toString())}><Text style={[styles.volumeBtnTxt, { color: colors.t1 }]}>+</Text></TouchableOpacity>
                </View>
                <Text style={{ color: colors.t3, fontSize: 11, marginBottom: 14 }}>{(parseFloat(volume) || 0).toFixed(4)} lots</Text>
                <TouchableOpacity style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 }} onPress={() => setShowSL(!showSL)}>
                  <Text style={[styles.inputLabel, { color: colors.t2 }]}>Stop Loss</Text>
                  <Ionicons name={showSL ? 'chevron-up' : 'chevron-down'} size={16} color="#475569" />
                </TouchableOpacity>
                {showSL && <TextInput style={[styles.input, { backgroundColor: colors.bg3, color: colors.t1, borderColor: colors.border, marginBottom: 10 }]} value={stopLoss} onChangeText={setStopLoss} keyboardType="decimal-pad" placeholder="Optional" placeholderTextColor={colors.t3} />}
                <TouchableOpacity style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 10 }} onPress={() => setShowTP(!showTP)}>
                  <Text style={[styles.inputLabel, { color: colors.t2 }]}>Target Price</Text>
                  <Ionicons name={showTP ? 'chevron-up' : 'chevron-down'} size={16} color="#475569" />
                </TouchableOpacity>
                {showTP && <TextInput style={[styles.input, { backgroundColor: colors.bg3, color: colors.t1, borderColor: colors.border, marginBottom: 10 }]} value={takeProfit} onChangeText={setTakeProfit} keyboardType="decimal-pad" placeholder="Optional" placeholderTextColor={colors.t3} />}
                {(() => {
                  const ep = orderSide === 'buy' ? (currentPrice?.ask || 0) : (currentPrice?.bid || 0);
                  const vol = parseFloat(volume) || 0;
                  const notional = ep * vol;
                  const cfm = notional > 0 ? `₹${notional.toFixed(2)}` : '—';
                  return (
                    <View style={{ backgroundColor: colors.bg3, borderRadius: 10, padding: 12, marginTop: 8, marginBottom: 14 }}>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}><Text style={{ color: colors.t2, fontSize: 11 }}>Margin Mode</Text><Text style={{ color: colors.t2, fontSize: 11, fontWeight: '600' }}>Fixed — ₹100/lot</Text></View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 }}><Text style={{ color: colors.t2, fontSize: 11 }}>Intraday Margin</Text><Text style={{ color: '#3b82f6', fontSize: 11, fontWeight: '600' }}>₹{(vol * 100).toFixed(2)}</Text></View>
                      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: colors.t2, fontSize: 11 }}>Carryforward Margin</Text><Text style={{ color: '#3b82f6', fontSize: 11, fontWeight: '600' }}>{cfm}</Text></View>
                    </View>
                  );
                })()}
                <TouchableOpacity style={[styles.submitBtn, { backgroundColor: orderSide === 'buy' ? '#14b8a6' : '#ef4444', opacity: isPlacingOrder ? 0.6 : 1 }]} onPress={handlePlaceOrder} disabled={isPlacingOrder} activeOpacity={0.8}>
                  {isPlacingOrder ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>{orderSide === 'buy' ? 'BUY' : 'SELL'} {(parseFloat(volume) || 0).toFixed(2)} lots</Text>}
                </TouchableOpacity>
                <Text style={{ color: colors.t3, fontSize: 10, textAlign: 'center', marginTop: 6 }}>{(parseFloat(volume) || 0).toFixed(2)} lots @ {fmtP(activeTab, orderSide === 'buy' ? currentPrice?.ask : currentPrice?.bid)} (intraday)</Text>
              </>)}

              {/* ═══ BINARY ═══ */}
              {tradingMode === 'binary' && (<>
                <View style={{ backgroundColor: colors.bg3, borderRadius: 12, padding: 16, alignItems: 'center', marginBottom: 16 }}>
                  <Text style={{ color: colors.t2, fontSize: 12, marginBottom: 4 }}>Current Price</Text>
                  <Text style={{ color: colors.t1, fontSize: 28, fontWeight: '800' }}>{fmtP(activeTab, currentPrice?.bid)}</Text>
                </View>
                <View style={{ flexDirection: 'row', gap: 10, marginBottom: 16 }}>
                  <TouchableOpacity style={[styles.sideBtn, { flex: 1, paddingVertical: 24, backgroundColor: binaryDirection === 'up' ? '#14b8a6' : 'rgba(20,184,166,0.15)', borderColor: '#14b8a6' }]} onPress={() => setBinaryDirection('up')}>
                    <Ionicons name="caret-up" size={28} color={binaryDirection === 'up' ? '#fff' : '#14b8a6'} />
                    <Text style={{ color: binaryDirection === 'up' ? '#fff' : '#14b8a6', fontSize: 16, fontWeight: '700', marginTop: 4 }}>UP</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={[styles.sideBtn, { flex: 1, paddingVertical: 24, backgroundColor: binaryDirection === 'down' ? '#ef4444' : 'rgba(239,68,68,0.15)', borderColor: '#ef4444' }]} onPress={() => setBinaryDirection('down')}>
                    <Ionicons name="caret-down" size={28} color={binaryDirection === 'down' ? '#fff' : '#ef4444'} />
                    <Text style={{ color: binaryDirection === 'down' ? '#fff' : '#ef4444', fontSize: 16, fontWeight: '700', marginTop: 4 }}>DOWN</Text>
                  </TouchableOpacity>
                </View>
                <Text style={{ color: colors.t1, fontSize: 12, fontWeight: '600', marginBottom: 6 }}>Trade Amount (₹) — limits ₹1–₹10000</Text>
                <View style={[styles.volumeRow, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
                  <TouchableOpacity style={styles.volumeBtn} onPress={() => setBinaryAmount(p => Math.max(1, (parseInt(p) || 100) - 10).toString())}><Text style={[styles.volumeBtnTxt, { color: colors.t1 }]}>−</Text></TouchableOpacity>
                  <TextInput style={[styles.volumeInput, { color: colors.t1 }]} value={binaryAmount} onChangeText={v => { if (v === '' || /^\d+$/.test(v)) setBinaryAmount(v); }} keyboardType="number-pad" />
                  <TouchableOpacity style={styles.volumeBtn} onPress={() => setBinaryAmount(p => Math.min(10000, (parseInt(p) || 100) + 10).toString())}><Text style={[styles.volumeBtnTxt, { color: colors.t1 }]}>+</Text></TouchableOpacity>
                </View>
                <Text style={{ color: colors.t1, fontSize: 12, fontWeight: '600', marginTop: 14, marginBottom: 8 }}>Expiry Time</Text>
                <View style={{ flexDirection: 'row', gap: 6, marginBottom: 16 }}>
                  {[{ s: 30, l: '30s' }, { s: 60, l: '1m' }, { s: 120, l: '2m' }, { s: 300, l: '5m' }, { s: 600, l: '10m' }].map(e => (
                    <TouchableOpacity key={e.s} style={[styles.orderTypeTab, binaryExpiry === e.s && { backgroundColor: '#3b82f6' }]} onPress={() => setBinaryExpiry(e.s)}>
                      <Text style={{ color: binaryExpiry === e.s ? '#fff' : '#64748b', fontSize: 12, fontWeight: '600' }}>{e.l}</Text>
                    </TouchableOpacity>
                  ))}
                </View>
                <View style={{ backgroundColor: colors.bg3, borderRadius: 10, padding: 12, marginBottom: 16 }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}><Text style={{ color: colors.t2, fontSize: 12 }}>If you win:</Text><Text style={{ color: '#22c55e', fontSize: 13, fontWeight: '700' }}>+₹{((parseInt(binaryAmount) || 0) * 0.85).toFixed(2)}</Text></View>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}><Text style={{ color: colors.t2, fontSize: 12 }}>If you lose:</Text><Text style={{ color: '#ef4444', fontSize: 13, fontWeight: '700' }}>-₹{(parseInt(binaryAmount) || 0).toFixed(2)}</Text></View>
                </View>
                <TouchableOpacity style={[styles.submitBtn, { backgroundColor: binaryDirection === 'up' ? '#14b8a6' : '#ef4444', opacity: isPlacingOrder ? 0.6 : 1 }]} onPress={handlePlaceOrder} disabled={isPlacingOrder} activeOpacity={0.8}>
                  {isPlacingOrder ? <ActivityIndicator color="#fff" size="small" /> : <Text style={{ color: '#fff', fontSize: 15, fontWeight: '700' }}>Trade {binaryDirection.toUpperCase()} - ₹{binaryAmount}</Text>}
                </TouchableOpacity>
                <Text style={{ color: colors.t3, fontSize: 10, textAlign: 'center', marginTop: 6 }}>Trade expires in {binaryExpiry >= 60 ? `${Math.floor(binaryExpiry / 60)}m ${binaryExpiry % 60}s` : `${binaryExpiry}s`}</Text>
                <Text style={{ color: colors.t3, fontSize: 10, textAlign: 'center', marginTop: 2 }}>₹{binaryAmount} on {binaryDirection.toUpperCase()} - {binaryExpiry >= 60 ? `${Math.floor(binaryExpiry / 60)}m` : `${binaryExpiry}s`} expiry</Text>
              </>)}
            </ScrollView>
          </Animated.View>
        </View>
      </Modal>
    </>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  // Chart tabs
  tabBar: { borderBottomWidth: 1, paddingHorizontal: 4, height: 36 },
  chartTab: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, paddingVertical: 6, marginRight: 2, borderRadius: 6 },
  addTabBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  // Loading
  loadingOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, justifyContent: 'center', alignItems: 'center' },
  // Trade bar
  tradeBar: { borderTopWidth: 1, paddingHorizontal: 10, paddingBottom: 4 },
  handleWrap: { alignItems: 'center', paddingVertical: 6 },
  handleBarSmall: { width: 40, height: 4, borderRadius: 4 },
  tradeRow: { flexDirection: 'row', gap: 6, alignItems: 'stretch' },
  tradeBtn: { flex: 1, borderRadius: 10, paddingVertical: 12, alignItems: 'center', justifyContent: 'center' },
  tradeLbl: { color: '#fff', fontSize: 12, fontWeight: '700', letterSpacing: 0.5 },
  tradePrice: { color: '#fff', fontSize: 13, fontWeight: '700', marginTop: 2 },
  lotBox: { width: 56, borderRadius: 8, borderWidth: 1, alignItems: 'center', justifyContent: 'center', gap: 1, paddingVertical: 2 },
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
  inputLabel: { fontSize: 11, fontWeight: '600', marginBottom: 4, textTransform: 'uppercase' as const },
  input: { borderRadius: 8, paddingHorizontal: 12, paddingVertical: 10, fontSize: 14, borderWidth: 1 },
  submitBtn: { borderRadius: 12, paddingVertical: 16, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  volumeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4, borderRadius: 10, borderWidth: 1 },
  volumeBtn: { width: 50, height: 48, alignItems: 'center', justifyContent: 'center' },
  volumeBtnTxt: { fontSize: 20, fontWeight: '600' },
  volumeInput: { flex: 1, textAlign: 'center', fontSize: 18, fontWeight: '700', padding: 10 },
});

export default ChartScreen;
