import React, { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import socketService from '../services/socket';
import { useAuth } from './AuthContext';

interface SocketContextType {
  isConnected: boolean;
  prices: Record<string, any>;
  getPrice: (symbol: string) => any | null;
  mergePrice: (symbol: string, partial: { bid?: number; ask?: number; lastPrice?: number; last?: number }) => void;
  onPositionUpdate: (callback: (data: any) => void) => () => void;
}

const SocketContext = createContext<SocketContextType | undefined>(undefined);

export const SocketProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { isAuthenticated, user } = useAuth();
  const [isConnected, setIsConnected] = useState(false);
  const [prices, setPrices] = useState<Record<string, any>>({});
  const priceThrottleRef = useRef<NodeJS.Timeout | null>(null);
  const latestPricesRef = useRef<Record<string, any>>({});

  useEffect(() => {
    if (isAuthenticated) {
      const userId = user?.oderId || user?.id;
      socketService.connect(userId);

      const unsubConnection = socketService.onConnectionChange((connected) => {
        setIsConnected(connected);
      });

      // Throttle price updates to keep React re-renders bounded — but
      // tight enough that the Orders screen P/L stays in step with the
      // live price (web has no throttle and was visibly more accurate
      // than mobile at the previous 500ms window). 100ms is ~10 fps,
      // which the JS thread + Reanimated animation budget handle fine.
      const unsubPrices = socketService.onPriceUpdate((newPrices) => {
        latestPricesRef.current = newPrices;
        if (!priceThrottleRef.current) {
          priceThrottleRef.current = setTimeout(() => {
            setPrices({ ...latestPricesRef.current });
            priceThrottleRef.current = null;
          }, 100);
        }
      });

      return () => {
        unsubConnection();
        unsubPrices();
        if (priceThrottleRef.current) clearTimeout(priceThrottleRef.current);
        socketService.disconnect();
      };
    } else {
      socketService.disconnect();
      setIsConnected(false);
      setPrices({});
    }
  }, [isAuthenticated, user?.id, user?.oderId]);

  const getPrice = useCallback((symbol: string) => {
    return prices[symbol] || socketService.getPrice(symbol);
  }, [prices]);

  // Merge an external partial price into the live-prices store.
  // OptionChainScreen uses this to inject fresh bid/ask/ltp from its REST
  // /quote response so the chart + order sheet have a real price to read
  // immediately — option contracts aren't on the Kite WS feed until the
  // server subscribes them on demand, and that takes 300-800ms. Real WS
  // ticks still overwrite when they arrive.
  const mergePrice = useCallback(
    (symbol: string, partial: { bid?: number; ask?: number; lastPrice?: number; last?: number }) => {
      if (!symbol || !partial) return;
      setPrices((prev) => {
        const next = {
          ...prev,
          [symbol]: {
            ...(prev[symbol] || {}),
            ...partial,
            lastUpdated: Date.now(),
          },
        };
        // Keep the module-level cache in sync so getPrice() (which falls
        // back to socketService.getPrice) sees the seed between renders.
        latestPricesRef.current = next;
        return next;
      });
    },
    []
  );

  const onPositionUpdate = useCallback((callback: (data: any) => void) => {
    return socketService.onPositionUpdate(callback);
  }, []);

  return (
    <SocketContext.Provider
      value={{
        isConnected,
        prices,
        getPrice,
        mergePrice,
        onPositionUpdate,
      }}
    >
      {children}
    </SocketContext.Provider>
  );
};

export const useSocket = (): SocketContextType => {
  const context = useContext(SocketContext);
  if (!context) {
    throw new Error('useSocket must be used within a SocketProvider');
  }
  return context;
};

export default SocketContext;
