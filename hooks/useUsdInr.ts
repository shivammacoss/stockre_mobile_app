import { useEffect, useState } from 'react';
import { useSocket } from '../contexts/SocketContext';
import { walletAPI } from '../services/api';

/**
 * Live USD → INR rate shared by web + mobile. Resolution order:
 *   1. Live USDINR socket tick (prices['USDINR']) — updates every tick
 *   2. Server /api/exchange-rate (which itself reads MetaAPI's live USDINR)
 *   3. Hardcoded 83
 *
 * The server is now the canonical source — it returns the latest MetaAPI
 * USDINR price, so web and APK always agree even right after a fresh login
 * (no more "898 after logout, 1000 after a few seconds" flicker because the
 * server provides the live rate immediately without waiting for the socket).
 */
export function useUsdInr() {
  const { prices } = useSocket();
  const [serverRate, setServerRate] = useState(90);
  const [markup, setMarkup] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const fetchRate = async () => {
      try {
        const res = await walletAPI.getExchangeRate();
        if (cancelled) return;
        const r = res.data?.USD_TO_INR || res.data?.rates?.USD_TO_INR;
        if (r && Number(r) > 0) setServerRate(Number(r));
        const m = Number(res.data?.usdMarkup);
        if (Number.isFinite(m)) setMarkup(m);
      } catch {}
    };
    fetchRate();
    // Refresh every 30s as a backstop in case the socket is disconnected
    const id = setInterval(fetchRate, 30000);
    return () => { cancelled = true; clearInterval(id); };
  }, []);

  // Prefer the live USDINR socket tick when available
  const live = prices?.['USDINR'];
  const liveBid = Number(live?.bid) || 0;
  const liveAsk = Number(live?.ask) || 0;
  const socketRate = liveBid && liveAsk ? (liveBid + liveAsk) / 2 : (liveBid || liveAsk);

  const baseRate = socketRate > 0 ? socketRate : serverRate;

  return {
    rate: baseRate + markup,
    baseRate,
    markup,
  };
}
