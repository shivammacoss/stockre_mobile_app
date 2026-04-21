import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTheme } from '../theme/ThemeContext';

/**
 * Mobile bottom status footer — mirrors web `.mobi-fixed-footer`.
 * Shown above the tab bar on Orders/Market pages.
 *
 *   [BTCUSD]  Bal ₹9.3Cr   [▼ More]
 *
 * INR-only — no currency toggle.
 */
interface Props {
  symbol?: string;
  /** INR balance to display. */
  balanceInr: number;
  onMorePress?: () => void;
  onSymbolPress?: () => void;
  // Legacy props kept for call-site compat — ignored
  balanceUsd?: number;
  displayCurrency?: string;
  onCurrencyChange?: (c: string) => void;
  rate?: number;
}

const MobileStatusFooter: React.FC<Props> = ({
  symbol,
  balanceInr,
  onMorePress,
  onSymbolPress,
}) => {
  const { colors } = useTheme();
  const balDisplay = '₹' + (balanceInr || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <View style={[styles.wrap, { backgroundColor: colors.bg1, borderTopColor: colors.border }]}>
      {/* Left — symbol */}
      <Pressable style={styles.left} onPress={onSymbolPress} disabled={!onSymbolPress} hitSlop={4}>
        <Text style={{ color: colors.blue, fontSize: 12, fontWeight: '700' }} numberOfLines={1}>
          {symbol || 'XAUUSD'}
        </Text>
      </Pressable>

      {/* Center — balance */}
      <View style={styles.center} pointerEvents="none">
        <Text style={{ color: colors.t2, fontSize: 12 }} numberOfLines={1} ellipsizeMode="tail">
          Bal <Text style={{ color: colors.t1, fontWeight: '700' }}>{balDisplay}</Text>
        </Text>
      </View>

      {/* Right — optional More button */}
      <View style={styles.right}>
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
