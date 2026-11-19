import { File, Paths } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import { Platform } from 'react-native';
import * as XLSX from 'xlsx';
import { formatDate, formatDateTime, toDateInput } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { formatTaka, fromPaisa } from '@/lib/money';
import type { AnyReport, ReportKind } from './reports';

export type ExportMeta = {
  shopName: string;
  phone?: string | null;
  address?: string | null;
  decimal?: boolean;
};

const TITLES: Record<ReportKind, string> = {
  pnl: 'Profit & Loss Report',
  sales: 'Sales Report',
  purchases: 'Purchase Report',
  expenses: 'Expense Report',
  stock: 'Stock Valuation Report',
  dues: 'Due Report',
  cashflow: 'Cash Flow Report',
  'product-profit': 'Product Profit Report',
};

export function getReportTitle(kind: ReportKind): string {
  return TITLES[kind];
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugify(name: string): string {
  const s = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return s.slice(0, 32) || 'shop';
}

function periodText(report: AnyReport): string {
  if ('range' in report) {
    return `${formatDate(report.range.from)} – ${formatDate(report.range.to)}`;
  }
  return `As of ${formatDate(report.generatedAt)}`;
}

export function buildReportFilename(
  report: AnyReport,
  meta: ExportMeta,
  ext: 'pdf' | 'xlsx',
): string {
  const stamp = 'range' in report ? toDateInput(report.range.to) : toDateInput(report.generatedAt);
  return `${slugify(meta.shopName)}_${report.kind}_${stamp}.${ext}`;
}

function labelMethod(m: string): string {
  const map: Record<string, string> = {
    cash: 'Cash',
    bkash: 'bKash',
    nagad: 'Nagad',
    card: 'Card',
    bank: 'Bank',
    other: 'Other',
  };
  return map[m] ?? m;
}

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

function htmlTable(headers: string[], rows: string[][], rightCols: Set<number> = new Set()): string {
  const th = headers
    .map((h, i) => `<th${rightCols.has(i) ? ' class="num"' : ''}>${escapeHtml(h)}</th>`)
    .join('');
  const body =
    rows.length === 0
      ? `<tr><td colspan="${headers.length}" class="empty">No records for this period</td></tr>`
      : rows
          .map(
            (r) =>
              `<tr>${r
                .map((cell, i) => `<td${rightCols.has(i) ? ' class="num"' : ''}>${escapeHtml(cell)}</td>`)
                .join('')}</tr>`,
          )
          .join('');
  return `<table><thead><tr>${th}</tr></thead><tbody>${body}</tbody></table>`;
}

function htmlKpis(items: { label: string; value: string; tone?: 'pos' | 'neg' }[]): string {
  return `<div class="kpis">${items
    .map(
      (k) =>
        `<div class="kpi"><div class="kpi-label">${escapeHtml(k.label)}</div><div class="kpi-val ${k.tone ?? ''}">${escapeHtml(k.value)}</div></div>`,
    )
    .join('')}</div>`;
}

/** Builds a print-ready A4 HTML document for any of the 8 business reports. */
export function buildReportHtml(report: AnyReport, meta: ExportMeta): string {
  const dec = meta.decimal ?? false;
  const fmt = (p: number) => formatTaka(p, dec);
  const title = getReportTitle(report.kind);
  let bodyHtml = '';

  switch (report.kind) {
    case 'pnl': {
      bodyHtml =
        htmlKpis([
          { label: 'Net Sales', value: fmt(report.netSales) },
          { label: 'COGS', value: fmt(report.cogs) },
          { label: 'Total Expenses', value: fmt(report.totalExpenses), tone: 'neg' },
          {
            label: `Net Profit (${report.netMarginPercent}%)`,
            value: fmt(report.netProfit),
            tone: report.netProfit >= 0 ? 'pos' : 'neg',
          },
        ]) +
        '<h3>Income Statement</h3>' +
        htmlTable(
          ['Line Item', 'Amount'],
          [
            ['Gross Sales', fmt(report.grossSales)],
            ['Less: Discounts', fmt(-report.totalDiscount)],
            ['Plus: VAT', fmt(report.totalVat)],
            ['Net Sales', fmt(report.netSales)],
            ['Less: Cost of Goods Sold (COGS)', fmt(-report.cogs)],
            [`Gross Profit (${report.grossMarginPercent}%)`, fmt(report.grossProfit)],
            ['Less: Operating Expenses', fmt(-report.totalExpenses)],
            [`Net Profit (${report.netMarginPercent}%)`, fmt(report.netProfit)],
            ['Reference: Sales Collected', fmt(report.salesCollected)],
            ['Reference: Sales Due', fmt(report.salesDue)],
            ['Reference: Total Purchases', fmt(report.totalPurchases)],
          ],
          new Set([1]),
        ) +
        '<h3>Expenses by Category</h3>' +
        htmlTable(
          ['Category', 'Entries', 'Share', 'Amount'],
          report.expensesByCategory.map((c) => [
            c.categoryName,
            String(c.count),
            `${c.sharePercent}%`,
            fmt(c.amount),
          ]),
          new Set([1, 2, 3]),
        );
      break;
    }
    case 'sales': {
      bodyHtml =
        htmlKpis([
          { label: 'Invoices', value: String(report.count) },
          { label: 'Total Sales', value: fmt(report.total) },
          { label: 'Collected', value: fmt(report.paid), tone: 'pos' },
          { label: 'Due', value: fmt(report.due), tone: report.due > 0 ? 'neg' : undefined },
        ]) +
        '<h3>By Payment Method</h3>' +
        htmlTable(
          ['Method', 'Count', 'Total', 'Collected'],
          report.byMethod.map((m) => [
            labelMethod(m.method),
            String(m.count),
            fmt(m.total),
            fmt(m.paid),
          ]),
          new Set([1, 2, 3]),
        ) +
        '<h3>Sales Invoices</h3>' +
        htmlTable(
          ['Date', 'Invoice #', 'Customer', 'Channel', 'Method', 'Total', 'Paid', 'Due'],
          report.rows.map((r) => [
            formatDate(r.date),
            r.invoiceNo,
            r.partyName,
            r.kind.toUpperCase(),
            labelMethod(r.method),
            fmt(r.total),
            fmt(r.paid),
            fmt(r.due),
          ]),
          new Set([5, 6, 7]),
        );
      break;
    }
    case 'purchases': {
      bodyHtml =
        htmlKpis([
          { label: 'Bills', value: String(report.count) },
          { label: 'Total Purchases', value: fmt(report.total) },
          { label: 'Paid', value: fmt(report.paid) },
          { label: 'Due', value: fmt(report.due), tone: report.due > 0 ? 'neg' : undefined },
        ]) +
        '<h3>Purchase Bills</h3>' +
        htmlTable(
          ['Date', 'Bill #', 'Supplier', 'Method', 'Total', 'Paid', 'Due'],
          report.rows.map((r) => [
            formatDate(r.date),
            r.billNo,
            r.partyName,
            labelMethod(r.method),
            fmt(r.total),
            fmt(r.paid),
            fmt(r.due),
          ]),
          new Set([4, 5, 6]),
        );
      break;
    }
    case 'expenses': {
      bodyHtml =
        htmlKpis([
          { label: 'Entries', value: String(report.count) },
          { label: 'Total Expenses', value: fmt(report.total), tone: 'neg' },
          { label: 'Categories', value: String(report.byCategory.length) },
        ]) +
        '<h3>By Category</h3>' +
        htmlTable(
          ['Category', 'Entries', 'Share', 'Amount'],
          report.byCategory.map((c) => [
            c.categoryName,
            String(c.count),
            `${c.sharePercent}%`,
            fmt(c.amount),
          ]),
          new Set([1, 2, 3]),
        ) +
        '<h3>Expense Entries</h3>' +
        htmlTable(
          ['Date', 'Category', 'Method', 'Note', 'Amount'],
          report.rows.map((r) => [
            formatDate(r.date),
            r.categoryName,
            labelMethod(r.method),
            r.note ?? '',
            fmt(r.amount),
          ]),
          new Set([4]),
        );
      break;
    }
    case 'stock': {
      bodyHtml =
        htmlKpis([
          { label: 'Products', value: String(report.totalProducts) },
          { label: 'Total Units', value: String(report.totalQty) },
          { label: 'Cost Value', value: fmt(report.totalCostValue) },
          { label: 'Sell Value', value: fmt(report.totalSellValue), tone: 'pos' },
        ]) +
        '<h3>Inventory Valuation</h3>' +
        htmlTable(
          ['Product', 'Category', 'Qty', 'Buy Price', 'Sell Price', 'Cost Value', 'Sell Value', 'Status'],
          report.rows.map((r) => [
            r.name,
            r.categoryName,
            `${r.qty} ${r.unit}`,
            fmt(r.buyPrice),
            fmt(r.sellPrice),
            fmt(r.costValue),
            fmt(r.sellValue),
            r.isOutOfStock ? 'Out' : r.isLowStock ? 'Low' : 'OK',
          ]),
          new Set([2, 3, 4, 5, 6]),
        );
      break;
    }
    case 'dues': {
      bodyHtml =
        htmlKpis([
          { label: `Receivable (${report.receivableCount})`, value: fmt(report.totalReceivable), tone: 'pos' },
          { label: `Payable (${report.payableCount})`, value: fmt(report.totalPayable), tone: 'neg' },
          {
            label: 'Net Due',
            value: fmt(report.netDue),
            tone: report.netDue >= 0 ? 'pos' : 'neg',
          },
        ]) +
        '<h3>Party Balances</h3>' +
        htmlTable(
          ['Party', 'Type', 'Phone', 'Direction', 'Amount', 'Last Activity'],
          report.rows.map((r) => [
            r.name,
            r.type,
            r.phone ?? '',
            r.balance > 0 ? 'Receivable (Given)' : 'Payable (Taken)',
            fmt(Math.abs(r.balance)),
            r.lastActivityAt ? formatDate(r.lastActivityAt) : '—',
          ]),
          new Set([4]),
        );
      break;
    }
    case 'cashflow': {
      bodyHtml =
        htmlKpis([
          { label: 'Opening Balance', value: fmt(report.openingBalance) },
          { label: 'Cash In', value: fmt(report.totalIn), tone: 'pos' },
          { label: 'Cash Out', value: fmt(report.totalOut), tone: 'neg' },
          {
            label: 'Closing Balance',
            value: fmt(report.closingBalance),
            tone: report.closingBalance >= 0 ? 'pos' : 'neg',
          },
        ]) +
        '<h3>By Payment Method</h3>' +
        htmlTable(
          ['Method', 'Opening', 'In', 'Out', 'Closing'],
          report.byMethod.map((m) => [
            labelMethod(m.method),
            fmt(m.openingBalance),
            fmt(m.totalIn),
            fmt(m.totalOut),
            fmt(m.closingBalance),
          ]),
          new Set([1, 2, 3, 4]),
        ) +
        '<h3>Cash Entries</h3>' +
        htmlTable(
          ['Date', 'Type', 'Method', 'Note', 'Amount'],
          report.rows.map((r) => [
            formatDate(r.date),
            labelCashType(r.type),
            labelMethod(r.method),
            r.note ?? '',
            fmt(r.amount),
          ]),
          new Set([4]),
        );
      break;
    }
    case 'product-profit': {
      bodyHtml =
        htmlKpis([
          { label: 'Products Sold', value: String(report.productCount) },
          { label: 'Revenue', value: fmt(report.totalRevenue) },
          { label: 'COGS', value: fmt(report.totalCogs) },
          {
            label: `Profit (${report.marginPercent}%)`,
            value: fmt(report.totalProfit),
            tone: report.totalProfit >= 0 ? 'pos' : 'neg',
          },
        ]) +
        '<h3>Product-wise Profitability</h3>' +
        htmlTable(
          ['Product', 'Qty Sold', 'Sales', 'Revenue', 'COGS', 'Profit', 'Margin'],
          report.rows.map((r) => [
            r.name,
            `${r.qtySold} ${r.unit}`,
            String(r.saleCount),
            fmt(r.revenue),
            fmt(r.cogs),
            fmt(r.profit),
            `${r.marginPercent}%`,
          ]),
          new Set([1, 2, 3, 4, 5, 6]),
        );
      break;
    }
  }

  const subMeta = [meta.phone, meta.address].filter(Boolean).join(' · ');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<title>${escapeHtml(title)} — ${escapeHtml(meta.shopName)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; color: #1B1B1B; margin: 0; padding: 24px; font-size: 12px; }
  .header { border-bottom: 3px solid #F6BE25; padding-bottom: 12px; margin-bottom: 16px; display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; }
  .shop { font-size: 20px; font-weight: 700; margin: 0; }
  .sub { color: #6B6B6B; margin-top: 3px; font-size: 11px; }
  .report-meta { text-align: right; }
  .report-title { font-size: 16px; font-weight: 700; color: #1A5DD6; margin: 0; }
  .kpis { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 18px; }
  .kpi { flex: 1; min-width: 120px; border: 1px solid #ECECEC; border-radius: 6px; padding: 10px; background: #FCFCFC; }
  .kpi-label { font-size: 11px; color: #6B6B6B; }
  .kpi-val { font-size: 15px; font-weight: 700; margin-top: 4px; }
  .pos { color: #2E9E5B; }
  .neg { color: #E53935; }
  h3 { font-size: 13px; margin: 16px 0 8px; color: #1B1B1B; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 12px; }
  th, td { border: 1px solid #ECECEC; padding: 6px 8px; text-align: left; }
  th { background: #F2F2F2; font-weight: 700; font-size: 11px; }
  td.num, th.num { text-align: right; white-space: nowrap; }
  td.empty { text-align: center; color: #6B6B6B; padding: 14px; }
  .footer { margin-top: 24px; border-top: 1px solid #ECECEC; padding-top: 8px; color: #6B6B6B; font-size: 10px; display: flex; justify-content: space-between; }
</style>
</head>
<body>
  <div class="header">
    <div>
      <h1 class="shop">${escapeHtml(meta.shopName)}</h1>
      ${subMeta ? `<div class="sub">${escapeHtml(subMeta)}</div>` : ''}
    </div>
    <div class="report-meta">
      <div class="report-title">${escapeHtml(title)}</div>
      <div class="sub">${escapeHtml(periodText(report))}</div>
    </div>
  </div>
  ${bodyHtml}
  <div class="footer">
    <span>Generated by Sohan Note Ultra</span>
    <span>${escapeHtml(formatDateTime(Date.now()))}</span>
  </div>
</body>
</html>`;
}

/** Builds a SheetJS Excel workbook with Summary + Details sheets (numeric BDT values). */
export function buildReportWorkbook(report: AnyReport, meta: ExportMeta): XLSX.WorkBook {
  const wb = XLSX.utils.book_new();
  const title = getReportTitle(report.kind);
  const headerRows: (string | number)[][] = [
    ['Shop', meta.shopName],
    ['Report', title],
    ['Period', periodText(report)],
    ['Currency', 'BDT (৳)'],
    [],
  ];

  const appendSheet = (name: string, aoa: (string | number)[][]) => {
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  };

  switch (report.kind) {
    case 'pnl': {
      appendSheet('Summary', [
        ...headerRows,
        ['Line Item', 'Amount (BDT)'],
        ['Gross Sales', fromPaisa(report.grossSales)],
        ['Total Discount', fromPaisa(report.totalDiscount)],
        ['Total VAT', fromPaisa(report.totalVat)],
        ['Net Sales', fromPaisa(report.netSales)],
        ['Cost of Goods Sold (COGS)', fromPaisa(report.cogs)],
        ['Gross Profit', fromPaisa(report.grossProfit)],
        ['Gross Margin (%)', report.grossMarginPercent],
        ['Total Expenses', fromPaisa(report.totalExpenses)],
        ['Net Profit', fromPaisa(report.netProfit)],
        ['Net Margin (%)', report.netMarginPercent],
        ['Sales Collected', fromPaisa(report.salesCollected)],
        ['Sales Due', fromPaisa(report.salesDue)],
        ['Total Purchases (Ref)', fromPaisa(report.totalPurchases)],
      ]);
      appendSheet('Expenses', [
        ['Category', 'Entries', 'Share (%)', 'Amount (BDT)'],
        ...report.expensesByCategory.map((c) => [
          c.categoryName,
          c.count,
          c.sharePercent,
          fromPaisa(c.amount),
        ]),
      ]);
      break;
    }
    case 'sales': {
      appendSheet('Summary', [
        ...headerRows,
        ['Metric', 'Value'],
        ['Invoice Count', report.count],
        ['Subtotal (BDT)', fromPaisa(report.subtotal)],
        ['Discount (BDT)', fromPaisa(report.discount)],
        ['VAT (BDT)', fromPaisa(report.vat)],
        ['Total Sales (BDT)', fromPaisa(report.total)],
        ['Collected (BDT)', fromPaisa(report.paid)],
        ['Due (BDT)', fromPaisa(report.due)],
      ]);
      appendSheet('Details', [
        [
          'Date',
          'Invoice No',
          'Customer',
          'Channel',
          'Method',
          'Subtotal',
          'Discount',
          'VAT',
          'Total',
          'Paid',
          'Due',
          'Note',
        ],
        ...report.rows.map((r) => [
          toDateInput(r.date),
          r.invoiceNo,
          r.partyName,
          r.kind,
          labelMethod(r.method),
          fromPaisa(r.subtotal),
          fromPaisa(r.discount),
          fromPaisa(r.vat),
          fromPaisa(r.total),
          fromPaisa(r.paid),
          fromPaisa(r.due),
          r.note ?? '',
        ]),
      ]);
      appendSheet('By Method', [
        ['Method', 'Count', 'Total (BDT)', 'Collected (BDT)'],
        ...report.byMethod.map((m) => [
          labelMethod(m.method),
          m.count,
          fromPaisa(m.total),
          fromPaisa(m.paid),
        ]),
      ]);
      break;
    }
    case 'purchases': {
      appendSheet('Summary', [
        ...headerRows,
        ['Metric', 'Value'],
        ['Bill Count', report.count],
        ['Subtotal (BDT)', fromPaisa(report.subtotal)],
        ['Discount (BDT)', fromPaisa(report.discount)],
        ['VAT (BDT)', fromPaisa(report.vat)],
        ['Total Purchases (BDT)', fromPaisa(report.total)],
        ['Paid (BDT)', fromPaisa(report.paid)],
        ['Due (BDT)', fromPaisa(report.due)],
      ]);
      appendSheet('Details', [
        ['Date', 'Bill No', 'Supplier', 'Method', 'Subtotal', 'Discount', 'VAT', 'Total', 'Paid', 'Due', 'Note'],
        ...report.rows.map((r) => [
          toDateInput(r.date),
          r.billNo,
          r.partyName,
          labelMethod(r.method),
          fromPaisa(r.subtotal),
          fromPaisa(r.discount),
          fromPaisa(r.vat),
          fromPaisa(r.total),
          fromPaisa(r.paid),
          fromPaisa(r.due),
          r.note ?? '',
        ]),
      ]);
      break;
    }
    case 'expenses': {
      appendSheet('Summary', [
        ...headerRows,
        ['Entries', report.count],
        ['Total Expenses (BDT)', fromPaisa(report.total)],
        [],
        ['Category', 'Entries', 'Share (%)', 'Amount (BDT)'],
        ...report.byCategory.map((c) => [
          c.categoryName,
          c.count,
          c.sharePercent,
          fromPaisa(c.amount),
        ]),
      ]);
      appendSheet('Details', [
        ['Date', 'Category', 'Method', 'Amount (BDT)', 'Note'],
        ...report.rows.map((r) => [
          toDateInput(r.date),
          r.categoryName,
          labelMethod(r.method),
          fromPaisa(r.amount),
          r.note ?? '',
        ]),
      ]);
      break;
    }
    case 'stock': {
      appendSheet('Summary', [
        ...headerRows,
        ['Total Products', report.totalProducts],
        ['In-Stock Products', report.inStockProducts],
        ['Low Stock Count', report.lowStockCount],
        ['Out of Stock Count', report.outOfStockCount],
        ['Total Units', report.totalQty],
        ['Total Cost Value (BDT)', fromPaisa(report.totalCostValue)],
        ['Total Sell Value (BDT)', fromPaisa(report.totalSellValue)],
        ['Potential Profit (BDT)', fromPaisa(report.potentialProfit)],
      ]);
      appendSheet('Details', [
        [
          'Product',
          'Code',
          'Category',
          'Qty',
          'Unit',
          'Buy Price',
          'Sell Price',
          'Cost Value',
          'Sell Value',
          'Potential Profit',
          'Status',
        ],
        ...report.rows.map((r) => [
          r.name,
          r.code ?? '',
          r.categoryName,
          r.qty,
          r.unit,
          fromPaisa(r.buyPrice),
          fromPaisa(r.sellPrice),
          fromPaisa(r.costValue),
          fromPaisa(r.sellValue),
          fromPaisa(r.potentialProfit),
          r.isOutOfStock ? 'Out of stock' : r.isLowStock ? 'Low stock' : 'OK',
        ]),
      ]);
      break;
    }
    case 'dues': {
      appendSheet('Summary', [
        ...headerRows,
        ['Total Receivable (BDT)', fromPaisa(report.totalReceivable)],
        ['Receivable Parties', report.receivableCount],
        ['Total Payable (BDT)', fromPaisa(report.totalPayable)],
        ['Payable Parties', report.payableCount],
        ['Net Due (BDT)', fromPaisa(report.netDue)],
      ]);
      appendSheet('Details', [
        ['Party', 'Type', 'Phone', 'Direction', 'Signed Balance (BDT)', 'Amount (BDT)', 'Last Activity'],
        ...report.rows.map((r) => [
          r.name,
          r.type,
          r.phone ?? '',
          r.balance > 0 ? 'Receivable' : 'Payable',
          fromPaisa(r.balance),
          fromPaisa(Math.abs(r.balance)),
          r.lastActivityAt ? toDateInput(r.lastActivityAt) : '',
        ]),
      ]);
      break;
    }
    case 'cashflow': {
      appendSheet('Summary', [
        ...headerRows,
        ['Opening Balance (BDT)', fromPaisa(report.openingBalance)],
        ['Cash In (BDT)', fromPaisa(report.totalIn)],
        ['Cash Out (BDT)', fromPaisa(report.totalOut)],
        ['Net Flow (BDT)', fromPaisa(report.netFlow)],
        ['Closing Balance (BDT)', fromPaisa(report.closingBalance)],
        [],
        ['Method', 'Opening', 'In', 'Out', 'Closing'],
        ...report.byMethod.map((m) => [
          labelMethod(m.method),
          fromPaisa(m.openingBalance),
          fromPaisa(m.totalIn),
          fromPaisa(m.totalOut),
          fromPaisa(m.closingBalance),
        ]),
      ]);
      appendSheet('Details', [
        ['Date', 'Type', 'Method', 'Amount (BDT)', 'Note'],
        ...report.rows.map((r) => [
          toDateInput(r.date),
          labelCashType(r.type),
          labelMethod(r.method),
          fromPaisa(r.amount),
          r.note ?? '',
        ]),
      ]);
      break;
    }
    case 'product-profit': {
      appendSheet('Summary', [
        ...headerRows,
        ['Products Sold', report.productCount],
        ['Total Qty Sold', report.totalQtySold],
        ['Total Revenue (BDT)', fromPaisa(report.totalRevenue)],
        ['Total COGS (BDT)', fromPaisa(report.totalCogs)],
        ['Total Profit (BDT)', fromPaisa(report.totalProfit)],
        ['Margin (%)', report.marginPercent],
        ['Invoice-level Discounts (BDT)', fromPaisa(report.invoiceDiscountTotal)],
      ]);
      appendSheet('Details', [
        ['Product', 'Qty Sold', 'Unit', 'Sales Count', 'Revenue (BDT)', 'COGS (BDT)', 'Profit (BDT)', 'Margin (%)'],
        ...report.rows.map((r) => [
          r.name,
          r.qtySold,
          r.unit,
          r.saleCount,
          fromPaisa(r.revenue),
          fromPaisa(r.cogs),
          fromPaisa(r.profit),
          r.marginPercent,
        ]),
      ]);
      break;
    }
  }

  return wb;
}

/** Serializes the workbook into `.xlsx` binary bytes (Uint8Array). */
export function buildReportXlsxBytes(report: AnyReport, meta: ExportMeta): Uint8Array {
  const wb = buildReportWorkbook(report, meta);
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer | number[];
  return new Uint8Array(out);
}

/** Exports a report as PDF (or triggers native/browser print when `opts.print` is true). */
export async function exportReportPdf(
  report: AnyReport,
  meta: ExportMeta,
  opts?: { print?: boolean },
): Promise<{ uri: string | null; filename: string }> {
  const html = buildReportHtml(report, meta);
  const filename = buildReportFilename(report, meta, 'pdf');
  const title = getReportTitle(report.kind);

  if (Platform.OS === 'web' || opts?.print) {
    await Print.printAsync({ html });
    return { uri: null, filename };
  }

  const printed = await Print.printToFileAsync({ html });
  let shareUri = printed.uri;
  try {
    const src = new File(printed.uri);
    const dest = new File(Paths.cache, filename);
    if (dest.exists) dest.delete();
    await src.copy(dest, { overwrite: true });
    shareUri = dest.uri;
  } catch {
    // Keep original temp file URI if copy fails
  }

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(shareUri, {
      mimeType: 'application/pdf',
      dialogTitle: `Share ${title}`,
      UTI: 'com.adobe.pdf',
    });
  }
  return { uri: shareUri, filename };
}

/** Exports a report as an `.xlsx` spreadsheet (download on web, share sheet on native). */
export async function exportReportExcel(
  report: AnyReport,
  meta: ExportMeta,
): Promise<{ uri: string | null; filename: string }> {
  const bytes = buildReportXlsxBytes(report, meta);
  const filename = buildReportFilename(report, meta, 'xlsx');
  const title = getReportTitle(report.kind);

  if (Platform.OS === 'web') {
    if (typeof document === 'undefined' || typeof Blob === 'undefined') {
      throw new AppError('UNKNOWN', 'Browser download is unavailable');
    }
    const copy = new Uint8Array(bytes.byteLength);
    copy.set(bytes);
    const blob = new Blob([copy.buffer], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return { uri: null, filename };
  }

  const file = new File(Paths.cache, filename);
  file.create({ overwrite: true });
  await file.write(bytes);

  if (await Sharing.isAvailableAsync()) {
    await Sharing.shareAsync(file.uri, {
      mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      dialogTitle: `Share ${title} (Excel)`,
      UTI: 'org.openxmlformats.spreadsheetml.sheet',
    });
  }
  return { uri: file.uri, filename };
}
