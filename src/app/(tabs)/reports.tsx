import { MaterialCommunityIcons } from '@expo/vector-icons';
import { router, type Href } from 'expo-router';
import { useMemo, useState } from 'react';
import { Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { db } from '@/db/client';
import { errorMessage } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import { exportReportExcel, exportReportPdf } from '@/services/export';
import { can } from '@/services/permissions';
import {
  getCashFlowReport,
  getDuesReport,
  getExpensesReport,
  getProductProfitReport,
  getProfitAndLossReport,
  getPurchasesReport,
  getSalesReport,
  getStockValuationReport,
  type DateRange,
  type ReportKind,
} from '@/services/reports';
import { useCurrentShop } from '@/store/useCurrentShop';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import {
  AmountText,
  AppHeader,
  AppText,
  Button,
  Card,
  Divider,
  EmptyState,
  Loading,
  Screen,
  useToast,
} from '@/ui';
import { useLiveRefresh } from '@/features/home/useLiveRefresh';
import { DateRangeControl } from '@/features/reports/ReportControls';
import {
  REPORT_CATALOG,
  getPresetRange,
  type DatePreset,
} from '@/features/reports/datePresets';

export default function ReportsHubScreen() {
  const { colors } = useTheme();
  const toast = useToast();
  const { shopId, role, shop } = useCurrentShop();
  const [preset, setPreset] = useState<DatePreset>('month');
  const [range, setRange] = useState<DateRange>(() => getPresetRange('month'));
  const [refreshing, setRefreshing] = useState(false);
  const [exportBusy, setExportBusy] = useState<'pdf' | 'excel' | null>(null);
  const [tick, refresh] = useLiveRefresh();

  const canView = can(role, 'viewReports');
  const decimal = shop?.decimal_enabled === 1;
  const shopName = shop?.name ?? 'Sohan Note Ultra';

  const summary = useMemo(() => {
    void tick;
    if (!shopId || !canView) return null;
    const ctx = { shopId, role };
    try {
      const pnl = getProfitAndLossReport(db, ctx, range);
      const sales = getSalesReport(db, ctx, range);
      const purchases = getPurchasesReport(db, ctx, range);
      const expenses = getExpensesReport(db, ctx, range);
      const stock = getStockValuationReport(db, ctx);
      const dues = getDuesReport(db, ctx);
      const cashflow = getCashFlowReport(db, ctx, range);
      const productProfit = getProductProfitReport(db, ctx, range);
      return {
        pnl,
        previews: {
          pnl: formatTaka(pnl.netProfit, decimal),
          sales: formatTaka(sales.total, decimal),
          purchases: formatTaka(purchases.total, decimal),
          expenses: formatTaka(expenses.total, decimal),
          stock: formatTaka(stock.totalCostValue, decimal),
          dues: formatTaka(dues.netDue, decimal),
          cashflow: formatTaka(cashflow.closingBalance, decimal),
          'product-profit': formatTaka(productProfit.totalProfit, decimal),
        } as Record<ReportKind, string>,
        error: null as string | null,
      };
    } catch (e) {
      return { pnl: null, previews: null, error: errorMessage(e) };
    }
  }, [shopId, role, canView, range, decimal, tick]);

  const header = <AppHeader title="Business Reports" back={false} />;

  if (!canView) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState
          icon="lock-outline"
          title="Restricted access"
          message="Business reports and profit analytics are available to owners and managers only."
        />
      </Screen>
    );
  }

  if (!shopId || !summary) {
    return (
      <Screen header={header} scroll={false}>
        <Loading label="Loading reports…" />
      </Screen>
    );
  }

  if (summary.error || !summary.pnl || !summary.previews) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState
          icon="alert-circle-outline"
          title="Could not load reports"
          message={summary.error ?? 'Unexpected error'}
          action={{ label: 'Retry', onPress: refresh }}
        />
      </Screen>
    );
  }

  const pnl = summary.pnl;
  const meta = { shopName, phone: shop?.phone, address: shop?.address, decimal };

  const handleExport = async (kind: 'pdf' | 'excel') => {
    setExportBusy(kind);
    try {
      if (kind === 'pdf') {
        await exportReportPdf(pnl, meta);
        toast.show('P&L PDF ready', 'success');
      } else {
        await exportReportExcel(pnl, meta);
        toast.show('P&L Excel exported', 'success');
      }
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setExportBusy(null);
    }
  };

  const openReport = (kind: ReportKind) => {
    router.push({
      pathname: '/reports/[type]',
      params: { type: kind, from: String(range.from), to: String(range.to), preset },
    } as Href);
  };

  return (
    <Screen header={header} scroll={false} padded={false}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => {
              setRefreshing(true);
              refresh();
              setTimeout(() => setRefreshing(false), 180);
            }}
            tintColor={colors.accent}
          />
        }
      >
        <DateRangeControl
          preset={preset}
          range={range}
          onChangePreset={setPreset}
          onChangeRange={setRange}
        />

        <Card style={styles.pnlHero}>
          <View style={styles.pnlTop}>
            <View>
              <AppText variant="label" muted>
                Net Profit (P&L)
              </AppText>
              <AmountText
                paisa={pnl.netProfit}
                tone="auto"
                decimal={decimal}
                variant="title"
              />
            </View>
            <View style={styles.marginBadge}>
              <AppText variant="label" muted>
                Net Margin
              </AppText>
              <AppText
                bold
                style={{ color: pnl.netProfit >= 0 ? colors.success : colors.danger }}
              >
                {pnl.netMarginPercent}%
              </AppText>
            </View>
          </View>

          <Divider />

          <View style={styles.pnlRow}>
            <View style={styles.pnlMetric}>
              <AppText variant="label" muted>
                Sales
              </AppText>
              <AppText variant="secondary" bold numberOfLines={1} adjustsFontSizeToFit>
                {formatTaka(pnl.netSales, decimal)}
              </AppText>
            </View>
            <View style={styles.pnlMetric}>
              <AppText variant="label" muted>
                COGS
              </AppText>
              <AppText variant="secondary" bold numberOfLines={1} adjustsFontSizeToFit>
                {formatTaka(pnl.cogs, decimal)}
              </AppText>
            </View>
            <View style={styles.pnlMetric}>
              <AppText variant="label" muted>
                Expenses
              </AppText>
              <AppText
                variant="secondary"
                bold
                numberOfLines={1}
                adjustsFontSizeToFit
                style={{ color: colors.danger }}
              >
                {formatTaka(pnl.totalExpenses, decimal)}
              </AppText>
            </View>
          </View>

          <View style={styles.heroActions}>
            <Button
              label="PDF"
              icon="file-pdf-box"
              variant="outline"
              loading={exportBusy === 'pdf'}
              disabled={exportBusy !== null}
              onPress={() => handleExport('pdf')}
              style={styles.heroBtn}
            />
            <Button
              label="Excel"
              icon="file-excel-box"
              variant="outline"
              loading={exportBusy === 'excel'}
              disabled={exportBusy !== null}
              onPress={() => handleExport('excel')}
              style={styles.heroBtn}
            />
            <Button
              label="Details"
              variant="primary"
              onPress={() => openReport('pnl')}
              style={styles.heroBtn}
            />
          </View>
        </Card>

        <View style={styles.listCardWrap}>
          <AppText variant="label" muted style={styles.groupTitle}>
            ALL REPORTS
          </AppText>
          {REPORT_CATALOG.map((item) => (
            <Pressable
              key={item.kind}
              accessibilityRole="button"
              onPress={() => openReport(item.kind)}
              style={[
                styles.reportTile,
                { backgroundColor: colors.surface, borderColor: colors.border },
              ]}
            >
              <View style={[styles.iconBox, { backgroundColor: item.color + '20' }]}>
                <MaterialCommunityIcons name={item.icon} size={24} color={item.color} />
              </View>
              <View style={styles.tileBody}>
                <AppText bold numberOfLines={1}>
                  {item.title}
                </AppText>
                <AppText variant="label" muted numberOfLines={1}>
                  {item.subtitle}
                </AppText>
              </View>
              <View style={styles.tileRight}>
                <AppText variant="secondary" bold numberOfLines={1}>
                  {summary.previews[item.kind]}
                </AppText>
                <MaterialCommunityIcons name="chevron-right" size={20} color={colors.textMuted} />
              </View>
            </Pressable>
          ))}
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: { padding: 12, gap: 12, paddingBottom: 24 },
  pnlHero: { gap: 10 },
  pnlTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  marginBadge: { alignItems: 'flex-end' },
  pnlRow: { flexDirection: 'row', gap: 8 },
  pnlMetric: { flex: 1, minWidth: 0, gap: 2 },
  heroActions: { flexDirection: 'row', gap: 8 },
  heroBtn: { flex: 1, minHeight: 38, paddingHorizontal: 8 },
  listCardWrap: { gap: 8 },
  groupTitle: { paddingHorizontal: 4 },
  reportTile: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radius.card,
    borderWidth: 1,
    gap: 12,
  },
  iconBox: {
    width: 44,
    height: 44,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tileBody: { flex: 1, minWidth: 0, gap: 2 },
  tileRight: { flexDirection: 'row', alignItems: 'center', gap: 4 },
});
