import { useEffect, useState } from 'react';
import api from '../services/api';

/**
 * Mobile equivalent of the web MarketPage segment-settings flow.
 *
 * Resolves a NettingSegment code from a tradingsymbol + (optional) instrument
 * meta, fetches the user's effective settings via /api/user/segment-settings,
 * and exposes a `validateLot()` helper that mirrors the web's pre-trade
 * lot-size / quantity rules. Without this hook the mobile order ticket was
 * sending raw lot values to the engine — admin-set min lot / per-order lot
 * / max lot caps were silently ignored, and 0.1-lot orders went through on
 * segments configured to require min 1.
 */

export type SegmentSettings = {
  isActive?: boolean;
  tradingEnabled?: boolean;
  exitOnlyMode?: boolean;
  allowOvernight?: boolean;
  limitType?: 'lot' | 'price';
  minLots?: number | null;
  orderLots?: number | null;
  maxLots?: number | null;
  maxExchangeLots?: number | null;
  minQty?: number | null;
  perOrderQty?: number | null;
  maxQtyPerScript?: number | null;
  intradayMargin?: number | null;
  overnightMargin?: number | null;
  marginCalcMode?: 'fixed' | 'percent' | 'times';
  buyingStrikeFar?: number | null;
  sellingStrikeFar?: number | null;
  buyingStrikeFarPercent?: number | null;
  sellingStrikeFarPercent?: number | null;
  optionBuyIntraday?: number | null;
  optionBuyOvernight?: number | null;
  optionSellIntraday?: number | null;
  optionSellOvernight?: number | null;
  expiryDayIntradayMargin?: number | null;
  expiryDayOptionBuyMargin?: number | null;
  expiryDayOptionSellMargin?: number | null;
  // Plus any other dynamic fields server returns
  [k: string]: unknown;
};

export type SegmentCode =
  | 'NSE_EQ' | 'NSE_FUT' | 'NSE_OPT'
  | 'BSE_EQ' | 'BSE_FUT' | 'BSE_OPT'
  | 'MCX_FUT' | 'MCX_OPT'
  | 'FOREX' | 'STOCKS' | 'INDICES' | 'COMMODITIES'
  | 'CRYPTO' | 'CRYPTO_PERPETUAL' | 'CRYPTO_OPTIONS';

const MAJOR_CRYPTO_PERP_BASES = [
  'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'DOGE', 'TRX',
  'LTC', 'AVAX', 'DOT', 'LINK', 'MATIC', 'UNI', 'ATOM', 'XLM',
];
const FOREX_PAIRS = new Set([
  'EURUSD', 'GBPUSD', 'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF', 'USDJPY',
]);

/** Mirror of the web `resolveSegmentApiName()` in MarketPage.jsx. */
export function resolveSegmentCode(
  symbol: string | null | undefined,
  inst: any = {},
): SegmentCode | null {
  if (!symbol) return null;
  const sym = String(symbol).toUpperCase();
  const ex = String(inst?.exchange || '').toUpperCase();
  const ct = String(inst?.contract_type || '').toLowerCase();
  const src = String(inst?.source || '').toLowerCase();

  if (src === 'delta_exchange' || ex === 'DELTA' || ex === 'FX_DELTA') {
    if (ct.includes('call_options') || ct.includes('put_options')) return 'CRYPTO_OPTIONS';
    return 'CRYPTO_PERPETUAL';
  }
  if (/^[CP]-/.test(sym)) return 'CRYPTO_OPTIONS';
  if (ct) {
    if (ct.includes('call_options') || ct.includes('put_options')) return 'CRYPTO_OPTIONS';
    if (ct.includes('future') || ct.includes('perpetual')) return 'CRYPTO_PERPETUAL';
  }

  if (sym.endsWith('USD') && !sym.includes('/') && !FOREX_PAIRS.has(sym) &&
      !sym.includes('XAU') && !sym.includes('XAG')) {
    return 'CRYPTO_PERPETUAL';
  }
  if (sym.endsWith('USDT') && !sym.includes('/') && !sym.includes('XAU') && !sym.includes('XAG')) {
    const base = sym.replace(/USDT$/i, '');
    if (MAJOR_CRYPTO_PERP_BASES.includes(base)) return 'CRYPTO_PERPETUAL';
  }

  if (ex === 'INDICES') return 'INDICES';
  if (ex === 'FOREX') return 'FOREX';
  if (ex === 'COMMODITIES') return 'COMMODITIES';
  if (ex === 'STOCKS') return 'STOCKS';
  if (/ROLL$/i.test(sym)) return 'INDICES';
  if (!['NSE', 'NFO', 'BSE', 'BFO', 'MCX'].includes(ex)) {
    if (/^(US|UK|DE|EU|JP|AUS|HK|SG|CHINA)[0-9]{2,4}/i.test(sym)) return 'INDICES';
  }

  if (ex === 'NSE') return 'NSE_EQ';
  if (ex === 'NFO') return /[CP]E$/i.test(sym) ? 'NSE_OPT' : 'NSE_FUT';
  if (ex === 'MCX') return /[CP]E$/i.test(sym) ? 'MCX_OPT' : 'MCX_FUT';
  if (ex === 'BSE') return 'BSE_EQ';
  if (ex === 'BFO') return /[CP]E$/i.test(sym) ? 'BSE_OPT' : 'BSE_FUT';

  // No exchange hint — last-ditch tradingsymbol patterns (NSE F&O default)
  if (/^[A-Z&]+\d{2}[A-Z]{3}\d*(CE|PE)$/.test(sym)) return 'NSE_OPT';
  if (/^[A-Z&]+\d{2}[A-Z]{3}\d*FUT$/.test(sym)) return 'NSE_FUT';

  return null;
}

const CASH_EQ_CODES = new Set<SegmentCode>(['NSE_EQ', 'BSE_EQ']);

/**
 * Fetch effective segment settings for the active symbol. Re-runs whenever
 * the resolved segment OR the symbol changes. Returns null while loading or
 * if the segment is unresolved.
 */
/**
 * Mirror of the web's applySegmentSpread (UserLayout.jsx). Takes the
 * raw bid/ask coming off the WS tick and returns the spread-adjusted
 * pair the user should actually see + trade on. Without this the
 * mobile order ticket showed Zerodha's raw LTP-as-bid-ask while the
 * server applied an admin-configured spread on top — the position
 * opened at a price different from what was shown.
 */
export function applySegmentSpread(
  rawBid: number,
  rawAsk: number,
  settings: SegmentSettings | null | undefined,
): { bid: number; ask: number; spreadAmount: number } {
  if (rawBid <= 0 && rawAsk <= 0) return { bid: rawBid, ask: rawAsk, spreadAmount: 0 };
  const spreadPips = Number(settings?.spreadPips) || 0;
  if (spreadPips <= 0) {
    return { bid: rawBid, ask: rawAsk, spreadAmount: Math.abs(rawAsk - rawBid) };
  }
  const st = String(settings?.spreadType || 'fixed').toLowerCase();
  const mid = (rawBid + rawAsk) / 2 || rawBid || rawAsk;
  let applied = spreadPips;
  if (st === 'floating') {
    const natural = Math.abs(rawAsk - rawBid);
    applied = Math.max(spreadPips, natural);
  }
  const half = applied / 2;
  return { bid: mid - half, ask: mid + half, spreadAmount: applied };
}

export function useSegmentSettings(
  symbol: string | null | undefined,
  instrument: any = {},
  userOderId: string | null | undefined,
  tradingMode: 'netting' | 'binary' | string = 'netting',
): {
  segment: SegmentCode | null;
  settings: SegmentSettings | null;
  loading: boolean;
  validateLot: (volume: number) => { ok: boolean; message?: string };
  adjustQuote: (rawBid: number, rawAsk: number) => { bid: number; ask: number; spreadAmount: number };
} {
  const segment = resolveSegmentCode(symbol || null, instrument || {});
  const [settings, setSettings] = useState<SegmentSettings | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (tradingMode !== 'netting' || !segment || !symbol) {
      setSettings(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    const params = new URLSearchParams();
    params.set('symbol', String(symbol));
    if (userOderId) params.set('userId', String(userOderId));
    api
      .get(`/api/user/segment-settings/${segment}?${params.toString()}`)
      .then((res) => {
        if (cancelled) return;
        if (res.data?.success) setSettings(res.data.settings || null);
        else setSettings(null);
      })
      .catch(() => {
        if (!cancelled) setSettings(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [segment, symbol, userOderId, tradingMode]);

  const validateLot = (volume: number): { ok: boolean; message?: string } => {
    const vol = Number(volume) || 0;
    if (vol <= 0) return { ok: false, message: 'Enter a valid lot size.' };
    if (tradingMode !== 'netting' || !segment) return { ok: true };

    // Top-level segment block flags (mirror web)
    if (settings?.isActive === false) {
      return { ok: false, message: 'This segment is currently disabled.' };
    }
    if (settings?.tradingEnabled === false) {
      return { ok: false, message: 'Trading is disabled for this segment.' };
    }

    const isShares = CASH_EQ_CODES.has(segment) && settings?.limitType !== 'lot';
    if (isShares) {
      if (Math.abs(vol - Math.round(vol)) > 1e-9) {
        return { ok: false, message: 'Quantity must be a whole number.' };
      }
      const minQty = Number(settings?.minQty) || 1;
      const perOrderQty = Number(settings?.perOrderQty) || 0;
      const maxQtyPerScript = Number(settings?.maxQtyPerScript) || 0;
      if (vol < minQty) return { ok: false, message: `Minimum quantity is ${minQty}.` };
      if (perOrderQty > 0 && vol > perOrderQty) return { ok: false, message: `Max ${perOrderQty} qty per order.` };
      if (maxQtyPerScript > 0 && vol > maxQtyPerScript) return { ok: false, message: `Max ${maxQtyPerScript} qty per script.` };
      return { ok: true };
    }

    // Lot-based segments
    const minLots = Number.isFinite(settings?.minLots as any) && (settings?.minLots as any) != null
      ? Number(settings?.minLots) : 0.01;
    const orderLots = Number(settings?.orderLots) || 0;
    const maxLots = Number(settings?.maxLots) || 0;
    if (vol < minLots) return { ok: false, message: `Minimum lot size is ${minLots}.` };
    if (orderLots > 0 && vol > orderLots) return { ok: false, message: `Max ${orderLots} lots per order.` };
    if (maxLots > 0 && vol > maxLots) return { ok: false, message: `Max ${maxLots} lots per script.` };
    return { ok: true };
  };

  const adjustQuote = (rawBid: number, rawAsk: number) =>
    applySegmentSpread(rawBid, rawAsk, settings);

  return { segment, settings, loading, validateLot, adjustQuote };
}
