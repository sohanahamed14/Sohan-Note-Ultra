import { addDays, endOfDay, endOfMonth, startOfDay, startOfMonth } from '@/lib/date';
import type { DateRange, ReportKind } from '@/services/reports';
import type { IconName } from '@/ui';

export type DatePreset = 'today' | 'week' | 'month' | 'last_month' | 'year' | 'custom';

export const PRESET_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'week', label: '7 Days' },
  { value: 'month', label: 'This Month' },
  { value: 'last_month', label: 'Last Month' },
  { value: 'year', label: 'This Year' },
  { value: 'custom', label: 'Custom' },
];

export function getPresetRange(
  preset: Exclude<DatePreset, 'custom'>,
  nowTs: number = Date.now(),
): DateRange {
  const d = new Date(nowTs);
  switch (preset) {
    case 'today':
      return { from: startOfDay(nowTs), to: endOfDay(nowTs) };
    case 'week':
      return { from: startOfDay(addDays(nowTs, -6)), to: endOfDay(nowTs) };
    case 'month':
      return { from: startOfMonth(nowTs), to: endOfMonth(nowTs) };
    case 'last_month': {
      const prev = new Date(d.getFullYear(), d.getMonth() - 1, 15).getTime();
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case 'year': {
      const jan1 = new Date(d.getFullYear(), 0, 1, 0, 0, 0, 0).getTime();
      const dec31 = new Date(d.getFullYear(), 11, 31, 23, 59, 59, 999).getTime();
      return { from: jan1, to: dec31 };
    }
  }
}

export type ReportCatalogItem = {
  kind: ReportKind;
  title: string;
  subtitle: string;
  icon: IconName;
  color: string;
  usesDateRange: boolean;
};

export const REPORT_CATALOG: readonly ReportCatalogItem[] = [
  {
    kind: 'pnl',
    title: 'Profit & Loss (P&L)',
    subtitle: 'Sales, COGS, expenses & net profit',
    icon: 'chart-line',
    color: '#2E9E5B',
    usesDateRange: true,
  },
  {
    kind: 'sales',
    title: 'Sales Report',
    subtitle: 'Invoices, collections, dues & payment methods',
    icon: 'receipt-text-outline',
    color: '#1A5DD6',
    usesDateRange: true,
  },
  {
    kind: 'purchases',
    title: 'Purchase Report',
    subtitle: 'Supplier bills, paid & payable totals',
    icon: 'cart-arrow-down',
    color: '#0D9488',
    usesDateRange: true,
  },
  {
    kind: 'expenses',
    title: 'Expense Report',
    subtitle: 'Operating costs by category & method',
    icon: 'wallet-outline',
    color: '#E53935',
    usesDateRange: true,
  },
  {
    kind: 'stock',
    title: 'Stock Valuation',
    subtitle: 'Cost value, sell value & low-stock items',
    icon: 'warehouse',
    color: '#D97706',
    usesDateRange: false,
  },
  {
    kind: 'dues',
    title: 'Due Report',
    subtitle: 'Customer receivables & supplier payables',
    icon: 'book-account-outline',
    color: '#EA580C',
    usesDateRange: false,
  },
  {
    kind: 'cashflow',
    title: 'Cash Flow Report',
    subtitle: 'Opening balance, inflows, outflows & closing',
    icon: 'cash-multiple',
    color: '#15803D',
    usesDateRange: true,
  },
  {
    kind: 'product-profit',
    title: 'Product Profit',
    subtitle: 'Profit margin & COGS per sold product',
    icon: 'package-variant-closed',
    color: '#7C3AED',
    usesDateRange: true,
  },
];

export function isReportKind(val: string | undefined): val is ReportKind {
  return REPORT_CATALOG.some((r) => r.kind === val);
}
