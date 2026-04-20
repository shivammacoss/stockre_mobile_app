import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, StyleSheet, ScrollView, TouchableOpacity, Share,
  RefreshControl, ActivityIndicator, Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
import { API_URL } from '../../config';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../theme/ThemeContext';

// Server hard-enforces the 7-day window; this label is just UI-facing.
const PERIOD_LABEL = 'Last 7 days';

const fmtInr = (v: any) => `₹${Number(v || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const fmtDate = (iso: any) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: '2-digit' });
};
const fmtDateTime = (iso: any) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })} ${d.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: true })}`;
};

const ReportsScreen: React.FC<{ navigation: any }> = ({ navigation }) => {
  const { user } = useAuth();
  const { colors } = useTheme();

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [trades, setTrades] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>({ totalTrades: 0, wins: 0, losses: 0, breakeven: 0, grossPnl: 0 });
  const [period, setPeriod] = useState<{ from: string; to: string } | null>(null);

  const load = useCallback(async () => {
    const uid = user?.oderId || user?.id;
    if (!uid) return;
    try {
      const res = await axios.get(`${API_URL}/api/reports/weekly/${uid}`, { timeout: 10000 });
      if (res.data?.success) {
        setTrades(res.data.trades || []);
        setSummary(res.data.summary || {});
        setPeriod(res.data.period || null);
      }
    } catch (e: any) {
      Alert.alert('Could not load report', e?.response?.data?.error || e.message);
    }
  }, [user?.id, user?.oderId]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      await load();
      setLoading(false);
    })();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const downloadReport = async () => {
    if (!trades.length) {
      Alert.alert('Nothing to export', 'No closed trades in the last 7 days.');
      return;
    }
    const header = 'Date,Symbol,Side,Volume,Entry,Exit,P/L (INR),Mode,Remark';
    const rows = trades.map((t) => {
      const cells = [
        fmtDateTime(t.executedAt || t.createdAt),
        t.symbol || '',
        (t.side || '').toUpperCase(),
        t.volume ?? '',
        t.entryPrice ?? t.avgPrice ?? '',
        t.closePrice ?? t.exitPrice ?? '',
        Number(t.profit || 0).toFixed(2),
        (t.mode || 'netting').toUpperCase(),
        (t.remark || '').replace(/[\r\n,]/g, ' '),
      ];
      return cells.join(',');
    });
    const csv = [
      `Stocktre Weekly Report (${PERIOD_LABEL})`,
      period ? `Period: ${fmtDate(period.from)} → ${fmtDate(period.to)}` : '',
      `Total trades: ${summary.totalTrades}  Wins: ${summary.wins}  Losses: ${summary.losses}  Net P/L: ${fmtInr(summary.grossPnl)}`,
      '',
      header,
      ...rows,
    ].filter(Boolean).join('\n');

    try {
      await Share.share({ title: 'Stocktre Weekly Report', message: csv });
    } catch (e: any) {
      Alert.alert('Share failed', e?.message || 'Could not open share sheet.');
    }
  };

  const winRate = summary.totalTrades > 0 ? Math.round((summary.wins / summary.totalTrades) * 100) : 0;
  const pnlPositive = Number(summary.grossPnl || 0) >= 0;

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.bg0 }]} edges={['top']}>
      {/* Header */}
      <View style={[styles.header, { borderBottomColor: colors.border }]}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn} hitSlop={10}>
          <Ionicons name="chevron-back" size={24} color={colors.t1} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={{ color: colors.t1, fontSize: 17, fontWeight: '700' }}>Weekly Report</Text>
          <Text style={{ color: colors.t3, fontSize: 11 }}>{PERIOD_LABEL} · download or share</Text>
        </View>
        <TouchableOpacity
          onPress={downloadReport}
          style={[styles.downloadBtn, { backgroundColor: colors.blue }]}
          activeOpacity={0.85}
        >
          <Ionicons name="download-outline" size={16} color="#fff" />
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Download</Text>
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator color={colors.blue} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.blue} />}
        >
          {/* Summary card */}
          <View style={[styles.summaryCard, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
            <Text style={[styles.summaryTitle, { color: colors.t3 }]}>NET P/L · {PERIOD_LABEL}</Text>
            <Text style={{ color: pnlPositive ? colors.green : colors.red, fontSize: 28, fontWeight: '800', marginTop: 2 }}>
              {pnlPositive ? '+' : ''}{fmtInr(summary.grossPnl)}
            </Text>
            <View style={[styles.summaryDivider, { backgroundColor: colors.border }]} />
            <View style={styles.summaryRow}>
              <View style={styles.summaryCell}>
                <Text style={[styles.summaryLabel, { color: colors.t3 }]}>TRADES</Text>
                <Text style={[styles.summaryValue, { color: colors.t1 }]}>{summary.totalTrades}</Text>
              </View>
              <View style={[styles.vDivider, { backgroundColor: colors.border }]} />
              <View style={styles.summaryCell}>
                <Text style={[styles.summaryLabel, { color: colors.t3 }]}>WIN RATE</Text>
                <Text style={[styles.summaryValue, { color: colors.t1 }]}>{winRate}%</Text>
              </View>
              <View style={[styles.vDivider, { backgroundColor: colors.border }]} />
              <View style={styles.summaryCell}>
                <Text style={[styles.summaryLabel, { color: colors.t3 }]}>W / L</Text>
                <Text style={[styles.summaryValue, { color: colors.t1 }]}>
                  <Text style={{ color: colors.green }}>{summary.wins}</Text>
                  {' / '}
                  <Text style={{ color: colors.red }}>{summary.losses}</Text>
                </Text>
              </View>
            </View>
          </View>

          {/* Trade list */}
          {trades.length === 0 ? (
            <View style={{ alignItems: 'center', paddingVertical: 48 }}>
              <Ionicons name="document-text-outline" size={44} color={colors.t3} />
              <Text style={{ color: colors.t1, fontSize: 15, fontWeight: '600', marginTop: 10 }}>No trades this week</Text>
              <Text style={{ color: colors.t3, fontSize: 12, marginTop: 4 }}>Closed trades from the last 7 days will appear here.</Text>
            </View>
          ) : (
            trades.map((t, idx) => {
              const pnl = Number(t.profit || 0);
              const positive = pnl >= 0;
              return (
                <View key={(t._id || idx).toString()} style={[styles.tradeCard, { backgroundColor: colors.bg2, borderColor: colors.border }]}>
                  <View style={styles.tradeHead}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                      <View style={[styles.sidePill, { backgroundColor: t.side === 'buy' ? colors.greenDim : colors.redDim }]}>
                        <Text style={{ color: t.side === 'buy' ? colors.green : colors.red, fontSize: 10, fontWeight: '700' }}>
                          {(t.side || 'BUY').toUpperCase()}
                        </Text>
                      </View>
                      <Text style={{ color: colors.t1, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{t.symbol}</Text>
                      <Text style={{ color: colors.t3, fontSize: 11 }}>{t.volume || 0} lots</Text>
                    </View>
                    <Text style={{ color: positive ? colors.green : colors.red, fontSize: 14, fontWeight: '700' }}>
                      {positive ? '+' : ''}{fmtInr(pnl)}
                    </Text>
                  </View>
                  <View style={styles.tradeBody}>
                    <Text style={{ color: colors.t3, fontSize: 11 }}>
                      {fmtDateTime(t.executedAt || t.createdAt)}
                    </Text>
                    {(t.entryPrice || t.avgPrice) && (t.closePrice || t.exitPrice) ? (
                      <Text style={{ color: colors.t2, fontSize: 11 }}>
                        {Number(t.entryPrice || t.avgPrice).toFixed(2)} → {Number(t.closePrice || t.exitPrice).toFixed(2)}
                      </Text>
                    ) : null}
                  </View>
                </View>
              );
            })
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safe: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 12, paddingVertical: 10, borderBottomWidth: 1, gap: 8 },
  backBtn: { padding: 4 },
  downloadBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10 },

  summaryCard: { borderWidth: 1, borderRadius: 14, padding: 16, marginBottom: 14 },
  summaryTitle: { fontSize: 10, fontWeight: '700', letterSpacing: 0.6 },
  summaryDivider: { height: 1, marginVertical: 12 },
  summaryRow: { flexDirection: 'row', alignItems: 'center' },
  summaryCell: { flex: 1, alignItems: 'center' },
  summaryLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.5, marginBottom: 3 },
  summaryValue: { fontSize: 15, fontWeight: '800' },
  vDivider: { width: 1, height: 28, marginHorizontal: 4 },

  tradeCard: { borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 8 },
  tradeHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 },
  tradeBody: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sidePill: { paddingHorizontal: 7, paddingVertical: 3, borderRadius: 5 },
});

export default ReportsScreen;
