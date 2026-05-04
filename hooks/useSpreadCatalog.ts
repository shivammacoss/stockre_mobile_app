import { useEffect, useState, useCallback } from 'react';
import api from '../services/api';
import { resolveSegmentCode, applySegmentSpread } from './useSegmentSettings';

/**
 * Mirror of the web UserLayout segmentSpreads + scriptSpreads cache.
 *
 * Fetches every netting segment's (spreadType, spreadPips) and every
 * NettingScriptOverride's per-symbol spread once, keyed by segment
 * name + symbol. Returns an `applyToQuote(symbol, inst, rawBid, rawAsk)`
 * helper so list rows (MarketScreen watchlist, HomeScreen market
 * overview) can show the same spread-adjusted bid/ask the order
 * ticket trades on. Without this catalog the lists rendered raw
 * Zerodha LTP-as-bid-ask while the order ticket showed
 * mid ± half(spread) — same data drift the web fixed long ago.
 *
 * Single fetch on mode change; the catalog rarely shifts mid-session.
 */

type SegSpread = { spreadType: string; spreadPips: number };
type ScriptSpread = SegSpread & { segmentName?: string };

export type SpreadCatalog = {
  spreads: Record<string, SegSpread>;
  scriptSpreads: Record<string, ScriptSpread>;
  loaded: boolean;
  applyToQuote: (
    symbol: string | null | undefined,
    inst: any,
    rawBid: number,
    rawAsk: number,
  ) => { bid: number; ask: number; spreadAmount: number };
};

export function useSpreadCatalog(
  tradingMode: string = 'netting',
  enabled: boolean = true,
): SpreadCatalog {
  const [spreads, setSpreads] = useState<Record<string, SegSpread>>({});
  const [scriptSpreads, setScriptSpreads] = useState<Record<string, ScriptSpread>>({});
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!enabled || tradingMode !== 'netting') {
      setSpreads({});
      setScriptSpreads({});
      setLoaded(false);
      return;
    }
    let cancelled = false;
    api
      .get(`/api/user/segment-spreads?mode=${encodeURIComponent(tradingMode)}`)
      .then((res) => {
        if (cancelled) return;
        if (res.data?.success) {
          setSpreads(res.data.spreads || {});
          setScriptSpreads(res.data.scriptSpreads || {});
        }
      })
      .catch(() => { /* leave empty — list rows fall back to raw bid/ask */ })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, [tradingMode, enabled]);

  const applyToQuote = useCallback(
    (
      symbol: string | null | undefined,
      inst: any,
      rawBid: number,
      rawAsk: number,
    ) => {
      if ((rawBid <= 0 && rawAsk <= 0) || !symbol) {
        return { bid: rawBid, ask: rawAsk, spreadAmount: 0 };
      }
      const symKey = String(symbol).toUpperCase();
      // Script-level override beats segment default — same priority web uses.
      const scriptOv = scriptSpreads[symKey];
      let settings: SegSpread | null | undefined = scriptOv;
      if (!settings) {
        const segCode = resolveSegmentCode(symKey, inst || {});
        if (segCode) settings = spreads[segCode];
      }
      if (!settings || !(Number(settings.spreadPips) > 0)) {
        return { bid: rawBid, ask: rawAsk, spreadAmount: Math.abs(rawAsk - rawBid) };
      }
      return applySegmentSpread(rawBid, rawAsk, settings as any);
    },
    [spreads, scriptSpreads],
  );

  return { spreads, scriptSpreads, loaded, applyToQuote };
}
