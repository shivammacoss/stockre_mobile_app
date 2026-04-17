import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

/**
 * Mobile bottom status footer — mirrors web `.mobi-fixed-footer`.
 * Shown above the tab bar on Orders/Market pages.
 *
 *   [BTCUSD]  Bal ₹9.3Cr     [USD][INR]   [▼ More]
 *
 * Toggling USD/INR is a view-only currency switch — the parent applies the
 * active currency to P/L/balance formatting.
 */
interface Props {
  symbol?: string;
  /** USD-native balance (fallback if `balanceInr` not provided). */
  balanceUsd: number;
  /** INR-native balance (preferred — matches what the user deposited). */
  balanceInr?: number;
  displayCurrency: 'USD' | 'INR';
  onCurrencyChange: (c: 'USD' | 'INR') => void;
  rate: number;
  onMorePress?: () => void;
  onSymbolPress?: () => void;
}

const MobileStatusFooter: React.FC<Props> = ({
  symbol,
  balanceUsd,
  balanceInr,
  displayCurrency,
  onCurrencyChange,
  rate,
  onMorePress,
  onSymbolPress,
}) => {
  const { colors } = useTheme();
  // Prefer the native-currency balance (walletINR.balance / walletUSD.balance)
  // so the displayed value matches Market + Wallet pages exactly. Falls back
  // to USD×rate only if caller didn't pass a native INR value.
  const balDisplay =
    displayCurrency === 'INR'
      ? '₹' + (balanceInr ?? balanceUsd * rate).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : '$' + balanceUsd.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <View style={[styles.wrap, { backgroundColor: colors.bg1, borderTopColor: colors.border }]}>
      {/* Left — symbol */}
      <Pressable style={styles.left} onPress={onSymbolPress} disabled={!onSymbolPress} hitSlop={4}>
        <Text style={{ color: colors.blue, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
          {symbol || 'XAUUSD'}
        </Text>
      </Pressable>

      {/* Center — balance (truly centered, truncates if too long) */}
      <View style={styles.center} pointerEvents="none">
        <Text style={{ color: colors.t2, fontSize: 12 }} numberOfLines={1} ellipsizeMode="tail">
          Bal <Text style={{ color: colors.t1, fontWeight: '700' }}>{balDisplay}</Text>
        </Text>
      </View>

      {/* Right — currency toggle (and optional More) */}
      <View style={styles.right}>
        <View style={[styles.toggle, { backgroundColor: colors.bg3, borderColor: colors.border }]}>
          <TouchableOpacity
            style={[styles.togglePill, displayCurrency === 'USD' && { backgroundColor: colors.blue }]}
            onPress={() => onCurrencyChange('USD')}
          >
            <Text style={{ color: displayCurrency === 'USD' ? '#fff' : colors.t3, fontSize: 10, fontWeight: '700' }}>USD</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.togglePill, displayCurrency === 'INR' && { backgroundColor: colors.blue }]}
            onPress={() => onCurrencyChange('INR')}
          >
            <Text style={{ color: displayCurrency === 'INR' ? '#fff' : colors.t3, fontSize: 10, fontWeight: '700' }}>INR</Text>
          </TouchableOpacity>
        </View>

        {onMorePress && (
          <TouchableOpacity
            style={[styles.moreBtn, { backgroundColor: colors.bg3, borderColor: colors.border }]}
            onPress={onMorePress}
          >
            <Ionicons name="caret-down" size={10} color={colors.t2} />
            <Text style={{ color: colors.t2, fontSize: 11, fontWeight: '600' }}>More</Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 8,
    borderTopWidth: 1,
  },
  // 3-column layout: left (symbol) | center (balance) | right (toggle)
  left: {
    minWidth: 80,
    maxWidth: 110,
    justifyContent: 'center',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 8,
  },
  right: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    justifyContent: 'flex-end',
  },
  toggle: {
    flexDirection: 'row',
    borderRadius: 6,
    borderWidth: 1,
    overflow: 'hidden',
  },
  togglePill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  moreBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    borderWidth: 1,
  },
});

export default MobileStatusFooter;
