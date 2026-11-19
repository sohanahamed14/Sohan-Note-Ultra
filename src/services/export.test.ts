/** @jest-environment node */
import * as XLSX from 'xlsx';
import { newRow } from '@/db/helpers';
import { categories, expenses, parties, products, purchases, sale_items, sales } from '@/db/schema';
import { endOfMonth, startOfMonth } from '@/lib/date';
import { createTestDb } from '@/test/testDb';
import {
  buildReportFilename,
  buildReportHtml,
  buildReportXlsxBytes,
  getReportTitle,
  type ExportMeta,
} from './export';
import { postCash, postLedger, postStock } from './posting';
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
} from './reports';

jest.mock('expo-file-system', () => ({
  File: jest.fn(),
  Paths: { cache: 'file:///cache' },
}));
jest.mock('expo-print', () => ({
  printAsync: jest.fn(),
  printToFileAsync: jest.fn(),
}));
jest.mock('expo-sharing', () => ({
  isAvailableAsync: jest.fn().mockResolvedValue(false),
  shareAsync: jest.fn(),
}));
jest.mock('react-native', () => ({
  Platform: { OS: 'ios' },
}));

const SHOP = 'shop-exp';
const USER = 'u1';
const CTX = { shopId: SHOP, role: 'owner' as const };
const DAY = new Date(2026, 10, 15, 12, 0, 0).getTime();
const RANGE = { from: startOfMonth(DAY), to: endOfMonth(DAY) };
const META: ExportMeta = {
  shopName: 'Sohan <Grocery> & Store',
  phone: '01711000000',
  address: 'Dhaka',
  decimal: true,
};

function makeAllReports(): AnyReport[] {
  const db = createTestDb();
  const cat = newRow(SHOP, USER, DAY);
  db.insert(categories).values({ ...cat, name: 'Rent', kind: 'expense' }).run();

  const prod = newRow(SHOP, USER, DAY);
  db.insert(products)
    .values({ ...prod, name: 'Rice', unit: 'kg', buy_price: 5000, sell_price: 7000, low_stock_alert: 5 })
    .run();
  postStock(db, { shopId: SHOP, userId: USER, refId: null, date: DAY, productId: prod.id, qty: 10, type: 'opening' });

  const cust = newRow(SHOP, USER, DAY);
  db.insert(parties).values({ ...cust, type: 'customer', name: '<b>Hasan</b>', phone: '01800000000' }).run();

  const sale = newRow(SHOP, USER, DAY);
  db.insert(sales)
    .values({
      ...sale,
      invoice_no: 'INV-1',
      party_id: cust.id,
      date: DAY,
      subtotal: 14000,
      total: 14000,
      paid: 10000,
      due: 4000,
      method: 'cash',
      kind: 'pos',
    })
    .run();
  db.insert(sale_items)
    .values({
      ...newRow(SHOP, USER, DAY),
      sale_id: sale.id,
      product_id: prod.id,
      name: 'Rice',
      qty: 2,
      unit_price: 7000,
      buy_price: 5000,
      total: 14000,
    })
    .run();
  postCash(db, { shopId: SHOP, userId: USER, refId: sale.id, date: DAY, amount: 10000, type: 'sale', method: 'cash' });
  postLedger(db, { shopId: SHOP, userId: USER, refId: sale.id, date: DAY, partyId: cust.id, amount: 4000, type: 'sale_due' });

  const pur = newRow(SHOP, USER, DAY);
  db.insert(purchases)
    .values({ ...pur, bill_no: 'BILL-1', date: DAY, subtotal: 5000, total: 5000, paid: 5000, due: 0, method: 'cash' })
    .run();

  db.insert(expenses)
    .values({ ...newRow(SHOP, USER, DAY), category_id: cat.id, amount: 2000, date: DAY, method: 'cash', note: 'Shop rent' })
    .run();

  return [
    getProfitAndLossReport(db, CTX, RANGE),
    getSalesReport(db, CTX, RANGE),
    getPurchasesReport(db, CTX, RANGE),
    getExpensesReport(db, CTX, RANGE),
    getStockValuationReport(db, CTX),
    getDuesReport(db, CTX),
    getCashFlowReport(db, CTX, RANGE),
    getProductProfitReport(db, CTX, RANGE),
  ];
}

describe('export service', () => {
  it('generates escaped HTML and valid multi-sheet XLSX for all 8 report types', () => {
    const reports = makeAllReports();
    expect(reports).toHaveLength(8);

    for (const report of reports) {
      const html = buildReportHtml(report, META);
      expect(html).toContain('<!doctype html>');
      expect(html).toContain('Sohan &lt;Grocery&gt; &amp; Store');
      expect(html).not.toContain('<b>Hasan</b>');
      expect(html).toContain(getReportTitle(report.kind).replace(/&/g, '&amp;'));

      const filename = buildReportFilename(report, META, 'xlsx');
      expect(filename).toMatch(/^sohan-grocery-store_[a-z-]+_\d{4}-\d{2}-\d{2}\.xlsx$/);

      const bytes = buildReportXlsxBytes(report, META);
      // XLSX is a ZIP archive starting with PK\x03\x04
      expect(bytes[0]).toBe(0x50);
      expect(bytes[1]).toBe(0x4b);

      const wb = XLSX.read(bytes, { type: 'array' });
      expect(wb.SheetNames).toContain('Summary');
      expect(wb.SheetNames.length).toBeGreaterThanOrEqual(2);
    }
  });

  it('writes exact numeric BDT values in P&L Excel Summary', () => {
    const [pnl] = makeAllReports();
    const bytes = buildReportXlsxBytes(pnl, META);
    const wb = XLSX.read(bytes, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json<(string | number)[]>(wb.Sheets.Summary, { header: 1 });
    const netSalesRow = rows.find((r) => r[0] === 'Net Sales');
    const cogsRow = rows.find((r) => r[0] === 'Cost of Goods Sold (COGS)');
    const netProfitRow = rows.find((r) => r[0] === 'Net Profit');
    expect(netSalesRow?.[1]).toBe(140);
    expect(cogsRow?.[1]).toBe(100);
    expect(netProfitRow?.[1]).toBe(20); // 140 - 100 - 20 expense
  });

  it('handles empty reports cleanly in both HTML and XLSX', () => {
    const db = createTestDb();
    const emptySales = getSalesReport(db, CTX, RANGE);
    const html = buildReportHtml(emptySales, { shopName: 'Empty Shop' });
    expect(html).toContain('No records for this period');

    const bytes = buildReportXlsxBytes(emptySales, { shopName: 'Empty Shop' });
    const wb = XLSX.read(bytes, { type: 'array' });
    expect(wb.SheetNames).toContain('Summary');
    expect(wb.SheetNames).toContain('Details');
  });
});
