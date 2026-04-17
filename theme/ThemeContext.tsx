import React, { createContext, useContext, useState, useCallback, useMemo, useEffect } from 'react';
import * as SecureStore from 'expo-secure-store';
import { darkColors, lightColors, type ThemeColors } from './colors';

type ThemeMode = 'dark' | 'light';
const STORAGE_KEY = 'stocktre-theme-mode';

interface ThemeContextValue {
  mode: ThemeMode;
  colors: ThemeColors;
  isDark: boolean;
  toggleTheme: () => void;
  setTheme: (mode: ThemeMode) => void;
}

const ThemeContext = createContext<ThemeContextValue>({
  mode: 'dark',
  colors: darkColors,
  isDark: true,
  toggleTheme: () => {},
  setTheme: () => {},
});

export const ThemeProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [mode, setMode] = useState<ThemeMode>('dark');

  // Hydrate saved preference on first mount. SecureStore is already imported
  // elsewhere for auth tokens — reusing it avoids adding AsyncStorage.
  useEffect(() => {
    SecureStore.getItemAsync(STORAGE_KEY)
      .then((saved) => {
        if (saved === 'light' || saved === 'dark') setMode(saved);
      })
      .catch(() => {});
  }, []);

  // Persist every change so the choice survives app restarts.
  const persist = useCallback((m: ThemeMode) => {
    SecureStore.setItemAsync(STORAGE_KEY, m).catch(() => {});
  }, []);

  const toggleTheme = useCallback(() => {
    setMode(prev => {
      const next = prev === 'dark' ? 'light' : 'dark';
      persist(next);
      return next;
    });
  }, [persist]);

  const setTheme = useCallback((m: ThemeMode) => {
    setMode(m);
    persist(m);
  }, [persist]);

  const value = useMemo<ThemeContextValue>(() => ({
    mode,
    colors: mode === 'dark' ? darkColors : lightColors,
    isDark: mode === 'dark',
    toggleTheme,
    setTheme,
  }), [mode, toggleTheme, setTheme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
};

export const useTheme = () => useContext(ThemeContext);

export default ThemeContext;
