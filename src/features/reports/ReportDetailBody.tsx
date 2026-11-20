import { FlatList, RefreshControl, StyleSheet, View } from 'react-native';
import { METHODS, type Method } from '@/db/schema';
import { formatDate } from '@/lib/date';
import { formatTaka } from '@/lib/money';
import type { AnyReport, DateRange } from '@/services/reports';
import { useTheme } from '@/theme';
import {
  AmountText,
  AppText,
  Badge,
  Card,
  ChipRow,
  Divider,
  EmptyState,
  ListRow,
} from '@/ui';
import {
  BarBreakdownCard,
  DateRangeControl,
  KpiGrid,
  type BarDatum,
  type KpiItem,
} from './ReportControls';
import type { DatePreset } from './datePresets';

export type ReportFilters = {
  method: Method | 'all';
  saleKind: 'all' | 'pos' | 'quick' | 'online';
  stockStatus: 'all' | 'low' | 'out';
  dueDirection: 'all' | 'receivable' | 'payable';
  partyType: 'all' | 'customer' | 'supplier' | 'employee';
  productSort: 'profit' | 'revenue' | 'qty';
};

export const DEFAULT_FILTERS: ReportFilters = {
  method: 'all',
  saleKind: 'all',
  stockStatus: 'all',
  dueDirection: 'all',
  partyType: 'all',
  productSort: 'profit',
};

const METHOD_OPTIONS: { value: Method | 'all'; label: string }[] = [
  { value: 'all', label: 'All Methods' },
  ...METHODS.map((m) => ({
    value: m,
    label: m === 'bkash' ? 'bKash' : m[0].toUpperCase() + m.slice(1),
  })),
];

function labelCashType(t: string): string {
  const map: Record<string, string> = {
    sale: 'Sale',
    purchase: 'Purchase',
    expense: 'Expense',
    received: 'Due Received',
    paid: 'Supplier Paid',
    capital_in: 'Capital In',
    capital_out: 'Capital Out',
    cash_in: 'Cash In',
    cash_out: 'Cash Out',
  };
  return map[t] ?? t;
}

type FlatRow = {
  id: string;
  title: string;
  subtitle: string;
  amount: number;
  tone: 'auto' | 'neutral' | 'positive' | 'negative';
  secondaryRight?: string;
  badge?: { label: string; tone: 'success' | 'danger' | 'warning' | 'neutral' };
};

export function ReportDetailBody({
  report,
  decimal,
  usesDateRange,
  preset,
  range,
  filters,
  refreshing,
  onChangePreset,
  onChangeRange,
  onChangeFilters,
  onRefresh,
}: {
  report: AnyReport;
  decimal: boolean;
  usesDateRange: boolean;
  preset: DatePreset;
  range: DateRange;
  filters: ReportFilters;
  refreshing: boolean;
  onChangePreset: (p: DatePreset) => void;
  onChangeRange: (r: DateRange) => void;
  onChangeFilters: (next: ReportFilters) => void;
  onRefresh: () => void;
}) {
  const { colors } = useTheme();
  const fmt = (p: number) => formatTaka(p, decimal);

  let kpis: KpiItem[] = [];
  let bars: { title: string; items: BarDatum[] } | null = null;
  let rows: FlatRow[] = [];
  let sectionLabel = 'Details';

  switch (report.kind) {
    case 'pnl': {
      kpis = [
        {
          label: 'Net Profit',
          value: fmt(report.netProfit),
          sub: `Margin ${report.netMarginPercent}%`,
          tone: report.netProfit >= 0 ? 'positive' : 'negative',
        },
        {
          label: 'Gross Profit',
          value: fmt(report.grossProfit),
          sub: `Margin ${report.grossMarginPercent}%`,
          tone: report.grossProfit >= 0 ? 'positive' : 'negative',
        },
        {
          label: 'Net Sales',
          value: fmt(report.netSales),
          sub: `${report.salesCount} sales`,
          tone: 'accent',
        },
        {
          label: 'Total Expenses',
          value: fmt(report.totalExpenses),
          sub: `${report.expenseCount} entries`,
          tone: 'negative',
        },
      ];
      bars = {
        title: 'Expense Breakdown',
        items: report.expensesByCategory.map((c) => ({
          key: c.categoryId ?? 'uncat',
          label: c.categoryName,
          amount: c.amount,
          sub: `${c.sharePercent}%`,
          color: colors.danger,
        })),
      };
      sectionLabel = 'Income Statement';
      rows = [
        { id: 'gross', title: 'Gross Sales', subtitle: 'Before discounts & VAT', amount: report.grossSales, tone: 'neutral' },
        { id: 'disc', title: 'Discounts Given', subtitle: 'Invoice discounts', amount: -report.totalDiscount, tone: report.totalDiscount > 0 ? 'negative' : 'neutral' },
        { id: 'vat', title: 'VAT Collected', subtitle: 'Tax on sales', amount: report.totalVat, tone: 'neutral' },
        { id: 'netSales', title: 'Net Sales', subtitle: `${report.salesCount} ${report.salesCount === 1 ? 'invoice' : 'invoices'}`, amount: report.netSales, tone: 'positive' },
        { id: 'cogs', title: 'Cost of Goods Sold (COGS)', subtitle: 'At historical buy price snapshot', amount: -report.cogs, tone: 'negative' },
        { id: 'grossProfit', title: 'Gross Profit', subtitle: `${report.grossMarginPercent}% of net sales`, amount: report.grossProfit, tone: 'auto' },
        { id: 'exp', title: 'Operating Expenses', subtitle: `${report.expenseCount} ${report.expenseCount === 1 ? 'expense entry' : 'expense entries'}`, amount: -report.totalExpenses, tone: 'negative' },
        { id: 'netProfit', title: 'Net Profit', subtitle: `${report.netMarginPercent}% net margin`, amount: report.netProfit, tone: 'auto' },
        { id: 'pur', title: 'Purchases (Memo)', subtitle: 'Inventory bought in period', amount: report.totalPurchases, tone: 'neutral' },
      ];
      break;
    }

    case 'sales': {
      kpis = [
        { label: 'Total Sales', value: fmt(report.total), sub: `${report.count} ${report.count === 1 ? 'invoice' : 'invoices'}`, tone: 'accent' },
        { label: 'Collected', value: fmt(report.paid), tone: 'positive' },
        { label: 'Due', value: fmt(report.due), tone: report.due > 0 ? 'negative' : 'neutral' },
        { label: 'Discount / VAT', value: fmt(report.discount), sub: `VAT ${fmt(report.vat)}` },
      ];
      bars = {
        title: 'Sales by Payment Method',
        items: report.byMethod.map((m) => ({
          key: m.method,
          label: m.method === 'bkash' ? 'bKash' : m.method.toUpperCase(),
          amount: m.total,
          sub: `${m.count}`,
          color: colors.accent,
        })),
      };
      sectionLabel = `Sales Invoices (${report.rows.length})`;
      rows = report.rows.map((r) => ({
        id: r.id,
        title: `${r.invoiceNo} · ${r.partyName}`,
        subtitle: `${formatDate(r.date)} · ${r.kind.toUpperCase()} · ${r.method}`,
        amount: r.total,
        tone: 'neutral',
        secondaryRight: r.due > 0 ? `Due ${fmt(r.due)}` : 'Paid',
        badge: r.due > 0 ? { label: 'Due', tone: 'danger' } : { label: 'Paid', tone: 'success' },
      }));
      break;
    }

    case 'purchases': {
      kpis = [
        { label: 'Total Purchases', value: fmt(report.total), sub: `${report.count} bills`, tone: 'accent' },
        { label: 'Paid', value: fmt(report.paid), tone: 'neutral' },
        { label: 'Due to Suppliers', value: fmt(report.due), tone: report.due > 0 ? 'negative' : 'positive' },
        { label: 'Discounts', value: fmt(report.discount), sub: `VAT ${fmt(report.vat)}` },
      ];
      bars = {
        title: 'Purchases by Payment Method',
        items: report.byMethod.map((m) => ({
          key: m.method,
          label: m.method === 'bkash' ? 'bKash' : m.method.toUpperCase(),
          amount: m.total,
          sub: `${m.count}`,
          color: '#0D9488',
        })),
      };
      sectionLabel = `Purchase Bills (${report.rows.length})`;
      rows = report.rows.map((r) => ({
        id: r.id,
        title: `${r.billNo} · ${r.partyName}`,
        subtitle: `${formatDate(r.date)} · ${r.method}`,
        amount: r.total,
        tone: 'neutral',
        secondaryRight: r.due > 0 ? `Due ${fmt(r.due)}` : 'Paid',
        badge: r.due > 0 ? { label: 'Due', tone: 'warning' } : { label: 'Paid', tone: 'success' },
      }));
      break;
    }

    case 'expenses': {
      kpis = [
        { label: 'Total Expenses', value: fmt(report.total), sub: `${report.count} entries`, tone: 'negative' },
        { label: 'Categories', value: String(report.byCategory.length), sub: 'active categories' },
      ];
      bars = {
        title: 'Expenses by Category',
        items: report.byCategory.map((c) => ({
          key: c.categoryId ?? 'uncat',
          label: c.categoryName,
          amount: c.amount,
          sub: `${c.sharePercent}%`,
          color: colors.danger,
        })),
      };
      sectionLabel = `Expense Entries (${report.rows.length})`;
      rows = report.rows.map((r) => ({
        id: r.id,
        title: r.categoryName,
        subtitle: `${formatDate(r.date)} · ${r.method}${r.note ? ` · ${r.note}` : ''}`,
        amount: r.amount,
        tone: 'negative',
      }));
      break;
    }

    case 'stock': {
      kpis = [
        { label: 'Cost Value', value: fmt(report.totalCostValue), sub: `${report.totalProducts} products`, tone: 'accent' },
        { label: 'Sell Value', value: fmt(report.totalSellValue), sub: `${report.totalQty} units`, tone: 'positive' },
        { label: 'Potential Profit', value: fmt(report.potentialProfit), tone: 'positive' },
        {
          label: 'Low / Out of Stock',
          value: `${report.lowStockCount} / ${report.outOfStockCount}`,
          tone: report.lowStockCount > 0 ? 'negative' : 'neutral',
        },
      ];
      sectionLabel = `Inventory Valuation (${report.rows.length})`;
      rows = report.rows.map((r) => ({
        id: r.productId,
        title: r.name,
        subtitle: `${r.qty} ${r.unit} · Buy ${fmt(r.buyPrice)} · Sell ${fmt(r.sellPrice)}`,
        amount: r.costValue,
        tone: 'neutral',
        secondaryRight: `Sell ${fmt(r.sellValue)}`,
        badge: r.isOutOfStock
          ? { label: 'Out', tone: 'danger' }
          : r.isLowStock
            ? { label: 'Low', tone: 'warning' }
            : undefined,
      }));
      break;
    }

    case 'dues': {
      kpis = [
        {
          label: 'Receivable (Given)',
          value: fmt(report.totalReceivable),
          sub: `${report.receivableCount} parties`,
          tone: 'positive',
        },
        {
          label: 'Payable (Taken)',
          value: fmt(report.totalPayable),
          sub: `${report.payableCount} parties`,
          tone: 'negative',
        },
        {
          label: 'Net Due',
          value: fmt(report.netDue),
          tone: report.netDue >= 0 ? 'positive' : 'negative',
        },
      ];
      sectionLabel = `Party Balances (${report.rows.length})`;
      rows = report.rows.map((r) => ({
        id: r.partyId,
        title: r.name,
        subtitle: `${r.type}${r.phone ? ` · ${r.phone}` : ''}${r.lastActivityAt ? ` · ${formatDate(r.lastActivityAt)}` : ''}`,
        amount: r.balance,
        tone: 'auto',
        badge:
          r.balance > 0
            ? { label: 'Receivable', tone: 'success' }
            : { label: 'Payable', tone: 'danger' },
      }));
      break;
    }

    case 'cashflow': {
      kpis = [
        { label: 'Opening Balance', value: fmt(report.openingBalance) },
        { label: 'Cash In', value: fmt(report.totalIn), tone: 'positive' },
        { label: 'Cash Out', value: fmt(report.totalOut), tone: 'negative' },
        {
          label: 'Closing Balance',
          value: fmt(report.closingBalance),
          sub: `Net ${fmt(report.netFlow)}`,
          tone: report.closingBalance >= 0 ? 'positive' : 'negative',
        },
      ];
      bars = {
        title: 'Closing Balance by Method',
        items: report.byMethod.map((m) => ({
          key: m.method,
          label: m.method === 'bkash' ? 'bKash' : m.method.toUpperCase(),
          amount: m.closingBalance,
          sub: `In ${fmt(m.totalIn)} / Out ${fmt(m.totalOut)}`,
          color: m.closingBalance >= 0 ? colors.success : colors.danger,
        })),
      };
      sectionLabel = `Cash Entries (${report.rows.length})`;
      rows = report.rows.map((r) => ({
        id: r.id,
        title: labelCashType(r.type),
        subtitle: `${formatDate(r.date)} · ${r.method}${r.note ? ` · ${r.note}` : ''}`,
        amount: r.amount,
        tone: 'auto',
      }));
      break;
    }

    case 'product-profit': {
      kpis = [
        {
          label: 'Product Profit',
          value: fmt(report.totalProfit),
          sub: `Margin ${report.marginPercent}%`,
          tone: report.totalProfit >= 0 ? 'positive' : 'negative',
        },
        { label: 'Revenue', value: fmt(report.totalRevenue), sub: `${report.totalQtySold} units`, tone: 'accent' },
        { label: 'COGS', value: fmt(report.totalCogs), tone: 'negative' },
        {
          label: 'Products Sold',
          value: String(report.productCount),
          sub: report.invoiceDiscountTotal > 0 ? `Inv disc ${fmt(report.invoiceDiscountTotal)}` : undefined,
        },
      ];
      bars = {
        title: 'Top Products by Profit',
        items: report.rows.slice(0, 6).map((r) => ({
          key: r.key,
          label: r.name,
          amount: r.profit,
          sub: `${r.marginPercent}%`,
          color: r.profit >= 0 ? colors.success : colors.danger,
        })),
      };
      sectionLabel = `Product Profitability (${report.rows.length})`;
      rows = report.rows.map((r) => ({
        id: r.key,
        title: r.name,
        subtitle: `${r.qtySold} ${r.unit} · Rev ${fmt(r.revenue)} · COGS ${fmt(r.cogs)}`,
        amount: r.profit,
        tone: 'auto',
        secondaryRight: `${r.marginPercent}% margin`,
      }));
      break;
    }
  }

  const renderFilters = () => {
    switch (report.kind) {
      case 'sales':
        return (
          <View style={styles.filterGroup}>
            <ChipRow
              options={[
                { value: 'all', label: 'All Channels' },
                { value: 'pos', label: 'POS' },
                { value: 'quick', label: 'Quick' },
                { value: 'online', label: 'Online' },
              ]}
              value={filters.saleKind}
              onChange={(saleKind) => onChangeFilters({ ...filters, saleKind })}
            />
            <ChipRow
              options={METHOD_OPTIONS}
              value={filters.method}
              onChange={(method) => onChangeFilters({ ...filters, method })}
            />
          </View>
        );
      case 'purchases':
      case 'expenses':
      case 'cashflow':
        return (
          <ChipRow
            options={METHOD_OPTIONS}
            value={filters.method}
            onChange={(method) => onChangeFilters({ ...filters, method })}
          />
        );
      case 'stock':
        return (
          <ChipRow
            options={[
              { value: 'all', label: 'All Products' },
              { value: 'low', label: 'Low Stock' },
              { value: 'out', label: 'Out of Stock' },
            ]}
            value={filters.stockStatus}
            onChange={(stockStatus) => onChangeFilters({ ...filters, stockStatus })}
          />
        );
      case 'dues':
        return (
          <View style={styles.filterGroup}>
            <ChipRow
              options={[
                { value: 'all', label: 'All Dues' },
                { value: 'receivable', label: 'Receivable' },
                { value: 'payable', label: 'Payable' },
              ]}
              value={filters.dueDirection}
              onChange={(dueDirection) => onChangeFilters({ ...filters, dueDirection })}
            />
            <ChipRow
              options={[
                { value: 'all', label: 'All Parties' },
                { value: 'customer', label: 'Customers' },
                { value: 'supplier', label: 'Suppliers' },
                { value: 'employee', label: 'Employees' },
              ]}
              value={filters.partyType}
              onChange={(partyType) => onChangeFilters({ ...filters, partyType })}
            />
          </View>
        );
      case 'product-profit':
        return (
          <ChipRow
            options={[
              { value: 'profit', label: 'Sort: Profit' },
              { value: 'revenue', label: 'Sort: Revenue' },
              { value: 'qty', label: 'Sort: Qty Sold' },
            ]}
            value={filters.productSort}
            onChange={(productSort) => onChangeFilters({ ...filters, productSort })}
          />
        );
      case 'pnl':
        return null;
    }
  };

  return (
    <FlatList
      data={rows}
      keyExtractor={(item) => item.id}
      contentContainerStyle={styles.listContent}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.accent} />
      }
      ListHeaderComponent={
        <View style={styles.headerBlock}>
          {usesDateRange ? (
            <DateRangeControl
              preset={preset}
              range={range}
              onChangePreset={onChangePreset}
              onChangeRange={onChangeRange}
            />
          ) : null}
          {renderFilters()}
          <KpiGrid items={kpis} />
          {bars ? <BarBreakdownCard title={bars.title} items={bars.items} decimal={decimal} /> : null}
          <View style={styles.sectionHead}>
            <AppText variant="secondary" bold muted>
              {sectionLabel}
            </AppText>
          </View>
        </View>
      }
      renderItem={({ item }) => (
        <Card style={styles.rowWrap}>
          <ListRow
            title={item.title}
            subtitle={item.subtitle}
            right={
              <View style={styles.rowRight}>
                <AmountText paisa={item.amount} tone={item.tone} decimal={decimal} />
                {item.secondaryRight ? (
                  <AppText variant="label" muted>
                    {item.secondaryRight}
                  </AppText>
                ) : null}
                {item.badge ? <Badge label={item.badge.label} tone={item.badge.tone} /> : null}
              </View>
            }
          />
        </Card>
      )}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      ListEmptyComponent={
        <EmptyState
          icon="file-chart-outline"
          title="No data found"
          message="There are no records matching the selected filters and date range."
        />
      }
      ListFooterComponent={<Divider />}
    />
  );
}

const styles = StyleSheet.create({
  listContent: { padding: 12, paddingBottom: 24, flexGrow: 1 },
  headerBlock: { gap: 10, marginBottom: 10 },
  filterGroup: { gap: 4 },
  sectionHead: { paddingTop: 4, paddingHorizontal: 2 },
  rowWrap: { padding: 0, overflow: 'hidden' },
  rowRight: { alignItems: 'flex-end', gap: 2 },
  sep: { height: 6 },
});
