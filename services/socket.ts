import { io, Socket } from 'socket.io-client';
import { API_URL } from '../config';

type PriceCallback = (prices: Record<string, any>) => void;
type ConnectionCallback = (connected: boolean) => void;
type PositionCallback = (data: any) => void;

/**
 * Socket service — mirrors the web client's socketService.js exactly.
 * Server emits these events:
 *   - 'price_tick'          → single MetaAPI price { symbol, bid, ask, ... }
 *   - 'prices_batch'        → all MetaAPI prices { EURUSD: {...}, XAUUSD: {...} }
 *   - 'delta_price_tick'    → single Delta Exchange price
 *   - 'delta_prices_batch'  → all Delta Exchange prices
 *   - 'zerodha-tick'        → array of Zerodha ticks
 *   - 'positionUpdate'      → { mode, positions }
 *   - 'pendingOrderExecuted'→ order fill notification
 *   - 'legClosedBySLTP'     → SL/TP hit on a leg
 *   - 'positionClosedBySLTP'→ SL/TP hit on full position
 *   - 'expirySettlement'    → position expired
 *   - 'marginCall'          → margin call warning
 *   - 'stopOut'             → stop out
 * Client emits:
 *   - 'join'                → join user room for targeted events
 *   - 'subscribePrices'     → join prices broadcast room
 *   - 'subscribeZerodhaTicks' → join Zerodha tick room
 */
class SocketService {
  private socket: Socket | null = null;
  private priceListeners: Set<PriceCallback> = new Set();
  private connectionListeners: Set<ConnectionCallback> = new Set();
  private positionListeners: Set<PositionCallback> = new Set();
  private priceCache: Record<string, any> = {};
  private userId: string | null = null;

  connect(userId?: string): Socket {
    // Reuse existing connection only when the same user is reconnecting.
    // Different userId (account switch) or disconnected socket → full reset so
    // the new user gets a clean session with fresh room subscriptions.
    if (this.socket?.connected && this.userId === userId) {
      return this.socket;
    }

    // Account switch or stale socket — tear down completely before reconnecting.
    if (this.socket) {
      try {
        this.socket.removeAllListeners();
        this.socket.disconnect();
      } catch (_) {}
      this.socket = null;
    }
    this.priceCache = {};
    if (userId) this.userId = userId;

    if (__DEV__) console.log('[Socket] Connecting to', API_URL, 'as user', userId);

    this.socket = io(API_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      timeout: 20000,
      forceNew: true,
    });

    const emitSubscriptions = () => {
      if (this.userId) this.joinUserRoom(this.userId);
      this.socket?.emit('subscribePrices', []);
      this.socket?.emit('subscribeZerodhaTicks');
    };

    this.socket.on('connect', () => {
      if (__DEV__) console.log('[Socket] Connected, id:', this.socket?.id);
      this.notifyConnectionListeners(true);
      emitSubscriptions();
    });

    // Also emit immediately if socket is already connected by the time we
    // return (rare, but eliminates the race where the `connect` handler fires
    // before listeners are attached on fast networks).
    setTimeout(() => {
      if (this.socket?.connected) emitSubscriptions();
    }, 300);

    this.socket.on('disconnect', (reason) => {
      if (__DEV__) console.log('[Socket] Disconnected:', reason);
      this.notifyConnectionListeners(false);
    });

    this.socket.on('connect_error', (error) => {
      if (__DEV__) console.log('[Socket] Error:', error.message);
    });

    // ── MetaAPI price events (EXACT event names from server) ──
    this.socket.on('price_tick', (priceData: any) => {
      if (priceData?.symbol) {
        this.priceCache[priceData.symbol] = {
          ...this.priceCache[priceData.symbol],
          ...priceData,
          lastUpdated: Date.now(),
        };
        this.notifyPriceListeners();
      }
    });

    this.socket.on('prices_batch', (allPrices: Record<string, any>) => {
      if (allPrices && typeof allPrices === 'object') {
        for (const [sym, p] of Object.entries(allPrices)) {
          this.priceCache[sym] = {
            ...this.priceCache[sym],
            ...p,
            lastUpdated: Date.now(),
          };
        }
        this.notifyPriceListeners();
      }
    });

    // ── Delta Exchange price events ──
    this.socket.on('delta_price_tick', (priceData: any) => {
      if (priceData?.symbol) {
        this.priceCache[priceData.symbol] = {
          ...this.priceCache[priceData.symbol],
          ...priceData,
          lastUpdated: Date.now(),
        };
        this.notifyPriceListeners();
      }
    });

    this.socket.on('delta_prices_batch', (allPrices: Record<string, any>) => {
      if (allPrices && typeof allPrices === 'object') {
        for (const [sym, p] of Object.entries(allPrices)) {
          this.priceCache[sym] = {
            ...this.priceCache[sym],
            ...p,
            lastUpdated: Date.now(),
          };
        }
        this.notifyPriceListeners();
      }
    });

    // ── Zerodha Indian market ticks ──
    this.socket.on('zerodha-tick', (ticks: any[]) => {
      if (Array.isArray(ticks)) {
        ticks.forEach(t => {
          const sym = t.tradingSymbol || t.symbol;
          if (sym) {
            this.priceCache[sym] = {
              ...this.priceCache[sym],
              bid: t.lastPrice || t.last_price || t.ltp,
              ask: t.lastPrice || t.last_price || t.ltp,
              lastPrice: t.lastPrice || t.last_price || t.ltp,
              high: t.ohlc?.high || t.high,
              low: t.ohlc?.low || t.low,
              change: t.change,
              lastUpdated: Date.now(),
              ...t,
            };
          }
        });
        this.notifyPriceListeners();
      }
    });

    // ── Position/Order events (sent to userId room) ──
    this.socket.on('positionUpdate', (data: any) => {
      if (__DEV__) console.log('[Socket] positionUpdate');
      this.positionListeners.forEach(cb => { try { cb(data); } catch (_) {} });
    });

    this.socket.on('pendingOrderExecuted', (data: any) => {
      if (__DEV__) console.log('[Socket] pendingOrderExecuted:', data?.symbol);
      this.positionListeners.forEach(cb => { try { cb({ type: 'orderExecuted', ...data }); } catch (_) {} });
    });

    this.socket.on('legClosedBySLTP', (data: any) => {
      if (__DEV__) console.log('[Socket] legClosedBySLTP:', data?.symbol, data?.reason);
      this.positionListeners.forEach(cb => { try { cb({ type: 'legClosed', ...data }); } catch (_) {} });
    });

    this.socket.on('positionClosedBySLTP', (data: any) => {
      if (__DEV__) console.log('[Socket] positionClosedBySLTP:', data?.symbol, data?.reason);
      this.positionListeners.forEach(cb => { try { cb({ type: 'positionClosed', ...data }); } catch (_) {} });
    });

    this.socket.on('expirySettlement', (data: any) => {
      if (__DEV__) console.log('[Socket] expirySettlement:', data?.message);
    });

    this.socket.on('marginCall', (data: any) => {
      if (__DEV__) console.log('[Socket] marginCall:', data?.message);
    });

    this.socket.on('stopOut', (data: any) => {
      if (__DEV__) console.log('[Socket] stopOut:', data?.message);
    });

    if (userId) this.joinUserRoom(userId);

    return this.socket;
  }

  private joinUserRoom(userId: string): void {
    this.userId = userId;
    this.socket?.emit('join', userId);
    if (__DEV__) console.log('[Socket] Joined user room:', userId);
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
    }
    this.userId = null;
    // Clear cached prices + position listeners so the next user starts fresh.
    // Without this, account B sees account A's stale prices / position events
    // until a new tick overwrites them — the Market screen looked "blank"
    // because bid/ask rendered as stale-or-zero from the previous session.
    this.priceCache = {};
    this.notifyPriceListeners();
  }

  private notifyPriceListeners(): void {
    const snapshot = { ...this.priceCache };
    this.priceListeners.forEach(cb => { try { cb(snapshot); } catch (_) {} });
  }

  private notifyConnectionListeners(connected: boolean): void {
    this.connectionListeners.forEach(cb => { try { cb(connected); } catch (_) {} });
  }

  onPriceUpdate(callback: PriceCallback): () => void {
    this.priceListeners.add(callback);
    if (Object.keys(this.priceCache).length > 0) callback({ ...this.priceCache });
    return () => this.priceListeners.delete(callback);
  }

  onConnectionChange(callback: ConnectionCallback): () => void {
    this.connectionListeners.add(callback);
    callback(this.socket?.connected ?? false);
    return () => this.connectionListeners.delete(callback);
  }

  onPositionUpdate(callback: PositionCallback): () => void {
    this.positionListeners.add(callback);
    return () => this.positionListeners.delete(callback);
  }

  getPrice(symbol: string): any | null { return this.priceCache[symbol] || null; }
  getAllPrices(): Record<string, any> { return { ...this.priceCache }; }
  isConnectedStatus(): boolean { return this.socket?.connected ?? false; }
  getSocket(): Socket | null { return this.socket; }
}

export const socketService = new SocketService();
export default socketService;
