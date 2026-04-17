import React, { createContext, useContext, useEffect, useState, useRef, useCallback, ReactNode } from 'react';
import socketService from '../services/socket';
import { useAuth } from './AuthContext';

interface SocketContextType {
  isConnected: boolean;
  prices: Record<string, any>;
  getPrice: (symbol: string) => any | null;
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

      // Throttle price updates to avoid re-rendering too frequently
      const unsubPrices = socketService.onPriceUpdate((newPrices) => {
        latestPricesRef.current = newPrices;
        if (!priceThrottleRef.current) {
          priceThrottleRef.current = setTimeout(() => {
            setPrices({ ...latestPricesRef.current });
            priceThrottleRef.current = null;
          }, 500);
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

  const onPositionUpdate = useCallback((callback: (data: any) => void) => {
    return socketService.onPositionUpdate(callback);
  }, []);

  return (
    <SocketContext.Provider
      value={{
        isConnected,
        prices,
        getPrice,
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
