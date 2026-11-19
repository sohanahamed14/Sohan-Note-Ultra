import { useLocalSearchParams } from 'expo-router';
import { useMemo, useState } from 'react';
import { db } from '@/db/client';
import { errorMessage } from '@/lib/errors';
import { exportReportExcel, exportReportPdf, getReportTitle } from '@/services/export';
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
  type AnyReport,
  type DateRange,
  type ReportKind,
} from '@/services/reports';
import { useCurrentShop } from '@/store/useCurrentShop';
import { AppHeader, EmptyState, Loading, Screen, useToast, type HeaderAction } from '@/ui';
import { useLiveRefresh } from '@/features/home/useLiveRefresh';
import { ExportActionBar } from '@/features/reports/ReportControls';
import {
  DEFAULT_FILTERS,
  ReportDetailBody,
  type ReportFilters,
} from '@/features/reports/ReportDetailBody';
import {
  REPORT_CATALOG,
  getPresetRange,
  isReportKind,
  type DatePreset,
} from '@/features/reports/datePresets';

function parsePreset(raw: string | undefined): DatePreset {
  if (
    raw === 'today' ||
    raw === 'week' ||
    raw === 'month' ||
    raw === 'last_month' ||
    raw === 'year' ||
    raw === 'custom'
  ) {
    return raw;
  }
  return 'month';
}

function parseInitialRange(fromRaw: string | undefined, toRaw: string | undefined): DateRange {
  const f = Number(fromRaw);
  const t = Number(toRaw);
  if (Number.isSafeInteger(f) && Number.isSafeInteger(t) && f > 0 && f <= t) {
    return { from: f, to: t };
  }
  return getPresetRange('month');
}

export default function ReportDetailScreen() {
  const params = useLocalSearchParams<{
    type?: string;
    from?: string;
    to?: string;
    preset?: string;
  }>();
  const toast = useToast();
  const { shopId, role, shop } = useCurrentShop();

  const kind: ReportKind | null = isReportKind(params.type) ? params.type : null;
  const catalogItem = REPORT_CATALOG.find((r) => r.kind === kind) ?? null;

  const [preset, setPreset] = useState<DatePreset>(() => parsePreset(params.preset));
  const [range, setRange] = useState<DateRange>(() => parseInitialRange(params.from, params.to));
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_FILTERS);
  const [refreshing, setRefreshing] = useState(false);
  const [exportBusy, setExportBusy] = useState<'pdf' | 'excel' | null>(null);
  const [tick, refresh] = useLiveRefresh();

  const canView = can(role, 'viewReports');
  const decimal = shop?.decimal_enabled === 1;
  const shopName = shop?.name ?? 'Sohan Note Ultra';

  const result = useMemo<{ report: AnyReport | null; error: string | null }>(() => {
    void tick;
    if (!shopId || !canView || !kind) return { report: null, error: null };
    const ctx = { shopId, role };
    const method = filters.method === 'all' ? undefined : filters.method;
    try {
      switch (kind) {
        case 'pnl':
          return { report: getProfitAndLossReport(db, ctx, range), error: null };
        case 'sales':
          return {
            report: getSalesReport(db, ctx, range, {
              method,
              kind: filters.saleKind === 'all' ? undefined : filters.saleKind,
            }),
            error: null,
          };
        case 'purchases':
          return { report: getPurchasesReport(db, ctx, range, { method }), error: null };
        case 'expenses':
          return { report: getExpensesReport(db, ctx, range, { method }), error: null };
        case 'stock':
          return {
            report: getStockValuationReport(db, ctx, { status: filters.stockStatus }),
            error: null,
          };
        case 'dues':
          return {
            report: getDuesReport(db, ctx, {
              direction: filters.dueDirection,
              partyType: filters.partyType === 'all' ? undefined : filters.partyType,
            }),
            error: null,
          };
        case 'cashflow':
          return { report: getCashFlowReport(db, ctx, range, { method }), error: null };
        case 'product-profit':
          return {
            report: getProductProfitReport(db, ctx, range, { sortBy: filters.productSort }),
            error: null,
          };
      }
    } catch (e) {
      return { report: null, error: errorMessage(e) };
    }
  }, [shopId, role, canView, kind, range, filters, tick]);

  const title = kind ? getReportTitle(kind) : 'Report';
  const meta = { shopName, phone: shop?.phone, address: shop?.address, decimal };

  const handleExport = async (mode: 'pdf' | 'excel' | 'print') => {
    if (!result.report) return;
    setExportBusy(mode === 'excel' ? 'excel' : 'pdf');
    try {
      if (mode === 'excel') {
        await exportReportExcel(result.report, meta);
        toast.show('Excel report exported', 'success');
      } else if (mode === 'print') {
        await exportReportPdf(result.report, meta, { print: true });
        toast.show('Print dialog opened', 'success');
      } else {
        await exportReportPdf(result.report, meta);
        toast.show('PDF report ready', 'success');
      }
    } catch (e) {
      toast.show(errorMessage(e), 'error');
    } finally {
      setExportBusy(null);
    }
  };

  const rightActions: HeaderAction[] =
    result.report && canView
      ? [
          { icon: 'printer-outline', label: 'Print', onPress: () => void handleExport('print') },
          { icon: 'file-excel-box', label: 'Export Excel', onPress: () => void handleExport('excel') },
        ]
      : [];

  const header = <AppHeader title={title} back right={rightActions} />;

  if (!canView) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState
          icon="lock-outline"
          title="Restricted access"
          message="Business reports are available to owners and managers only."
        />
      </Screen>
    );
  }

  if (!kind || !catalogItem) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState
          icon="file-alert-outline"
          title="Report not found"
          message="The requested report type does not exist."
        />
      </Screen>
    );
  }

  if (!shopId) {
    return (
      <Screen header={header} scroll={false}>
        <Loading label="Loading report…" />
      </Screen>
    );
  }

  if (result.error || !result.report) {
    return (
      <Screen header={header} scroll={false}>
        <EmptyState
          icon="alert-circle-outline"
          title="Could not load report"
          message={result.error ?? 'Unexpected error'}
          action={{ label: 'Retry', onPress: refresh }}
        />
      </Screen>
    );
  }

  return (
    <Screen header={header} scroll={false} padded={false}>
      <ReportDetailBody
        report={result.report}
        decimal={decimal}
        usesDateRange={catalogItem.usesDateRange}
        preset={preset}
        range={range}
        filters={filters}
        refreshing={refreshing}
        onChangePreset={setPreset}
        onChangeRange={setRange}
        onChangeFilters={setFilters}
        onRefresh={() => {
          setRefreshing(true);
          refresh();
          setTimeout(() => setRefreshing(false), 180);
        }}
      />
      <ExportActionBar
        busy={exportBusy}
        onExportPdf={() => void handleExport('pdf')}
        onExportExcel={() => void handleExport('excel')}
      />
    </Screen>
  );
}
