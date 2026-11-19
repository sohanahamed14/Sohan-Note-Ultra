/** @jest-environment node */
import { newRow } from '@/db/helpers';
import {
  categories,
  expenses,
  parties,
  products,
  purchases,
  sale_items,
  sales,
} from '@/db/schema';
import type { AppDb } from '@/db/types';
import { endOfMonth, startOfMonth } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { createTestDb } from '@/test/testDb';
import { postCash, postLedger, postStock, restoreWithRefs, softDeleteWithRefs } from './posting';
import {
  getCashFlowReport,
  getDuesReport,
  getExpensesReport,
  getProductProfitReport,
  getProfitAndLossReport,
  getPurchasesReport,
  getSalesReport,
  getStockValuationReport,
} from './reports';

const SHOP = 'shop-r1';
const OTHER = 'shop-r2';
const USER = 'owner-1';
const OWNER = { shopId: SHOP, role: 'owner' as const };
const MANAGER = { shopId: SHOP, role: 'manager' as const };
const CASHIER = { shopId: SHOP, role: 'cashier' as const };

const NOV_10 = new Date(2026, 10, 10, 11, 0, 0).getTime();
const NOV_15 = new Date(2026, 10, 15, 16, 0, 0).getTime();
const OCT_20 = new Date(2026, 9, 20, 9, 0, 0).getTime();
const NOV_RANGE = { from: startOfMonth(NOV_10), to: endOfMonth(NOV_10) };

function seedBusinessData(db: AppDb) {
  const catProd = newRow(SHOP, USER, NOV_10);
  const catRent = newRow(SHOP, USER, NOV_10);
  const catUtil = newRow(SHOP, USER, NOV_10);
  db.insert(categories)
    .values([
      { ...catProd, name: 'Groceries', kind: 'product' },
      { ...catRent, name: 'Rent', kind: 'expense' },
      { ...catUtil, name: 'Electricity', kind: 'expense' },
    ])
    .run();

  const pRice = newRow(SHOP, USER, NOV_10);
  const pOil = newRow(SHOP, USER, NOV_10);
  const pSalt = newRow(SHOP, USER, NOV_10);
  db.insert(products)
    .values([
      {
        ...pRice,
        name: 'Miniket Rice',
        category_id: catProd.id,
        unit: 'kg',
        buy_price: 6000, // ৳60
        sell_price: 7500, // ৳75
        low_stock_alert: 5,
      },
      {
        ...pOil,
        name: 'Soybean Oil',
        category_id: catProd.id,
        unit: 'L',
        buy_price: 15000, // ৳150
        sell_price: 18000, // ৳180
        low_stock_alert: 10,
      },
      {
        ...pSalt,
        name: 'Iodized Salt',
        category_id: catProd.id,
        unit: 'pack',
        buy_price: 3000, // ৳30
        sell_price: 4000, // ৳40
        low_stock_alert: 3,
      },
    ])
    .run();

  // Opening stock: Rice 20kg, Oil 8L (low!), Salt 0 (out!)
  postStock(db, {
    shopId: SHOP,
    userId: USER,
    refId: null,
    date: OCT_20,
    productId: pRice.id,
    qty: 20,
    type: 'opening',
  });
  postStock(db, {
    shopId: SHOP,
    userId: USER,
    refId: null,
    date: OCT_20,
    productId: pOil.id,
    qty: 8,
    type: 'opening',
  });

  const cust = newRow(SHOP, USER, NOV_10);
  const supp = newRow(SHOP, USER, NOV_10);
  db.insert(parties)
    .values([
      { ...cust, type: 'customer', name: 'Aminul', phone: '01711111111' },
      { ...supp, type: 'supplier', name: 'Bengal Traders', phone: '01822222222' },
    ])
    .run();

  // Opening cash in Oct: +5000.00 (500000 paisa)
  postCash(db, {
    shopId: SHOP,
    userId: USER,
    refId: null,
    date: OCT_20,
    amount: 500000,
    type: 'capital_in',
    method: 'cash',
    note: 'Opening capital',
  });

  // Sale 1 on Nov 10: 2.5 kg Rice @ 75 (buy snapshot 60 -> COGS 150.00) + 2 L Oil @ 180 (buy snapshot 140 -> COGS 280.00)
  // Subtotal = 187.50 + 360.00 = 547.50 (54750), discount = 47.50 (4750), total = 500.00 (50000), paid 300.00 cash, due 200.00
  const s1 = newRow(SHOP, USER, NOV_10);
  db.transaction((tx) => {
    tx.insert(sales)
      .values({
        ...s1,
        invoice_no: 'INV-20261110-0001',
        party_id: cust.id,
        date: NOV_10,
        subtotal: 54750,
        discount: 4750,
        vat: 0,
        total: 50000,
        paid: 30000,
        due: 20000,
        method: 'cash',
        kind: 'pos',
      })
      .run();
    tx.insert(sale_items)
      .values([
        {
          ...newRow(SHOP, USER, NOV_10),
          sale_id: s1.id,
          product_id: pRice.id,
          name: 'Miniket Rice',
          qty: 2.5,
          unit_price: 7500,
          buy_price: 6000,
          total: 18750,
        },
        {
          ...newRow(SHOP, USER, NOV_10),
          sale_id: s1.id,
          product_id: pOil.id,
          name: 'Soybean Oil',
          qty: 2,
          unit_price: 18000,
          buy_price: 14000, // historical snapshot lower than current buy_price 15000
          total: 36000,
        },
      ])
      .run();
    postStock(tx, {
      shopId: SHOP,
      userId: USER,
      refId: s1.id,
      date: NOV_10,
      productId: pRice.id,
      qty: -2.5,
      type: 'sale',
    });
    postStock(tx, {
      shopId: SHOP,
      userId: USER,
      refId: s1.id,
      date: NOV_10,
      productId: pOil.id,
      qty: -2,
      type: 'sale',
    });
    postCash(tx, {
      shopId: SHOP,
      userId: USER,
      refId: s1.id,
      date: NOV_10,
      amount: 30000,
      type: 'sale',
      method: 'cash',
    });
    postLedger(tx, {
      shopId: SHOP,
      userId: USER,
      refId: s1.id,
      date: NOV_10,
      partyId: cust.id,
      amount: 20000,
      type: 'sale_due',
    });
  });

  // Sale 2 on Nov 15 (online, bkash): 1 kg Rice @ 75 (buy 60), paid 75
  const s2 = newRow(SHOP, USER, NOV_15);
  db.transaction((tx) => {
    tx.insert(sales)
      .values({
        ...s2,
        invoice_no: 'INV-20261115-0001',
        date: NOV_15,
        subtotal: 7500,
        total: 7500,
        paid: 7500,
        due: 0,
        method: 'bkash',
        kind: 'online',
      })
      .run();
    tx.insert(sale_items)
      .values({
        ...newRow(SHOP, USER, NOV_15),
        sale_id: s2.id,
        product_id: pRice.id,
        name: 'Miniket Rice',
        qty: 1,
        unit_price: 7500,
        buy_price: 6000,
        total: 7500,
      })
      .run();
    postStock(tx, {
      shopId: SHOP,
      userId: USER,
      refId: s2.id,
      date: NOV_15,
      productId: pRice.id,
      qty: -1,
      type: 'sale',
    });
    postCash(tx, {
      shopId: SHOP,
      userId: USER,
      refId: s2.id,
      date: NOV_15,
      amount: 7500,
      type: 'sale',
      method: 'bkash',
    });
  });

  // Purchase on Nov 12: ৳1,000, paid 600 cash, due 400 to supplier
  const pur = newRow(SHOP, USER, NOV_10);
  db.transaction((tx) => {
    tx.insert(purchases)
      .values({
        ...pur,
        bill_no: 'BILL-20261110-0001',
        party_id: supp.id,
        date: NOV_10,
        subtotal: 100000,
        total: 100000,
        paid: 60000,
        due: 40000,
        method: 'cash',
      })
      .run();
    postCash(tx, {
      shopId: SHOP,
      userId: USER,
      refId: pur.id,
      date: NOV_10,
      amount: -60000,
      type: 'purchase',
      method: 'cash',
    });
    postLedger(tx, {
      shopId: SHOP,
      userId: USER,
      refId: pur.id,
      date: NOV_10,
      partyId: supp.id,
      amount: -40000,
      type: 'purchase_due',
    });
  });

  // Expenses in Nov: Rent ৳100 (10000), Electricity ৳50 (5000)
  const exp1 = newRow(SHOP, USER, NOV_10);
  const exp2 = newRow(SHOP, USER, NOV_15);
  db.insert(expenses)
    .values([
      { ...exp1, category_id: catRent.id, amount: 10000, date: NOV_10, method: 'cash', note: 'Shop rent' },
      { ...exp2, category_id: catUtil.id, amount: 5000, date: NOV_15, method: 'bkash', note: 'Bill' },
    ])
    .run();
  postCash(db, {
    shopId: SHOP,
    userId: USER,
    refId: exp1.id,
    date: NOV_10,
    amount: -10000,
    type: 'expense',
    method: 'cash',
  });
  postCash(db, {
    shopId: SHOP,
    userId: USER,
    refId: exp2.id,
    date: NOV_15,
    amount: -5000,
    type: 'expense',
    method: 'bkash',
  });

  // Noise in another shop (must never leak)
  db.insert(sales)
    .values({
      ...newRow(OTHER, USER, NOV_10),
      invoice_no: 'INV-OTHER',
      date: NOV_10,
      subtotal: 999900,
      total: 999900,
      paid: 999900,
      due: 0,
    })
    .run();

  return { s1, s2, pur, pRice, pOil, pSalt, cust, supp, catRent };
}

describe('reports service', () => {
  it('blocks cashier from all 8 reports with FORBIDDEN and allows manager', () => {
    const db = createTestDb();
    const fns = [
      () => getProfitAndLossReport(db, CASHIER, NOV_RANGE),
      () => getSalesReport(db, CASHIER, NOV_RANGE),
      () => getPurchasesReport(db, CASHIER, NOV_RANGE),
      () => getExpensesReport(db, CASHIER, NOV_RANGE),
      () => getStockValuationReport(db, CASHIER),
      () => getDuesReport(db, CASHIER),
      () => getCashFlowReport(db, CASHIER, NOV_RANGE),
      () => getProductProfitReport(db, CASHIER, NOV_RANGE),
    ];
    for (const fn of fns) {
      expect(fn).toThrow(AppError);
      try {
        fn();
      } catch (e) {
        expect((e as AppError).code).toBe('FORBIDDEN');
      }
    }
    // Manager allowed
    expect(getProfitAndLossReport(db, MANAGER, NOV_RANGE).netSales).toBe(0);
    expect(getStockValuationReport(db, MANAGER).totalProducts).toBe(0);
  });

  it('rejects inverted date range (from > to) with VALIDATION error', () => {
    const db = createTestDb();
    expect(() =>
      getProfitAndLossReport(db, OWNER, { from: NOV_15, to: NOV_10 }),
    ).toThrow(AppError);
  });

  it('calculates Profit & Loss using historical buy_price snapshots and reverses on soft-delete/restore', () => {
    const db = createTestDb();
    const { s1 } = seedBusinessData(db);

    const pnl = getProfitAndLossReport(db, OWNER, NOV_RANGE);
    // Net sales = 50000 + 7500 = 57500
    // COGS = (2.5 * 6000 = 15000) + (2 * 14000 = 28000) + (1 * 6000 = 6000) = 49000
    // Gross profit = 57500 - 49000 = 8500
    // Expenses = 10000 + 5000 = 15000
    // Net profit = 8500 - 15000 = -6500
    expect(pnl.salesCount).toBe(2);
    expect(pnl.grossSales).toBe(62250);
    expect(pnl.totalDiscount).toBe(4750);
    expect(pnl.netSales).toBe(57500);
    expect(pnl.cogs).toBe(49000);
    expect(pnl.grossProfit).toBe(8500);
    expect(pnl.totalExpenses).toBe(15000);
    expect(pnl.netProfit).toBe(-6500);
    expect(pnl.totalPurchases).toBe(100000);
    expect(pnl.expensesByCategory).toHaveLength(2);
    expect(pnl.expensesByCategory[0].categoryName).toBe('Rent');

    // Soft-delete s1 -> P&L reflects only s2
    db.transaction((tx) =>
      softDeleteWithRefs(tx, {
        shopId: SHOP,
        table: sales,
        id: s1.id,
        items: { table: sale_items, fk: 'sale_id' },
      }),
    );
    const afterDel = getProfitAndLossReport(db, OWNER, NOV_RANGE);
    expect(afterDel.netSales).toBe(7500);
    expect(afterDel.cogs).toBe(6000);
    expect(afterDel.grossProfit).toBe(1500);

    // Restore s1 -> exact original P&L restored
    db.transaction((tx) =>
      restoreWithRefs(tx, {
        shopId: SHOP,
        table: sales,
        id: s1.id,
        items: { table: sale_items, fk: 'sale_id' },
      }),
    );
    expect(getProfitAndLossReport(db, OWNER, NOV_RANGE).netProfit).toBe(-6500);
  });

  it('builds sales, purchases, and expenses reports with method/kind filters', () => {
    const db = createTestDb();
    seedBusinessData(db);

    const salesAll = getSalesReport(db, OWNER, NOV_RANGE);
    expect(salesAll.count).toBe(2);
    expect(salesAll.total).toBe(57500);
    expect(salesAll.paid).toBe(37500);
    expect(salesAll.due).toBe(20000);
    expect(salesAll.byMethod).toHaveLength(2);
    expect(salesAll.byKind).toHaveLength(2);
    expect(salesAll.daily).toHaveLength(2);

    const salesBkash = getSalesReport(db, OWNER, NOV_RANGE, { method: 'bkash', kind: 'online' });
    expect(salesBkash.count).toBe(1);
    expect(salesBkash.total).toBe(7500);

    const purAll = getPurchasesReport(db, OWNER, NOV_RANGE);
    expect(purAll.count).toBe(1);
    expect(purAll.total).toBe(100000);
    expect(purAll.due).toBe(40000);
    expect(purAll.rows[0].partyName).toBe('Bengal Traders');

    const expAll = getExpensesReport(db, OWNER, NOV_RANGE);
    expect(expAll.count).toBe(2);
    expect(expAll.total).toBe(15000);
    expect(expAll.byCategory[0].sharePercent).toBeCloseTo(66.67, 1);
  });

  it('computes stock valuation from derived movements and filters low/out of stock', () => {
    const db = createTestDb();
    seedBusinessData(db);

    const stock = getStockValuationReport(db, OWNER);
    // Rice: 20 - 2.5 - 1 = 16.5 kg @ buy 6000 = 99000, sell 7500 = 123750
    // Oil: 8 - 2 = 6 L @ buy 15000 = 90000, sell 18000 = 108000 (alert 10 -> low!)
    // Salt: 0 pack (alert 3 -> low & out!)
    expect(stock.totalProducts).toBe(3);
    expect(stock.inStockProducts).toBe(2);
    expect(stock.lowStockCount).toBe(2);
    expect(stock.outOfStockCount).toBe(1);
    expect(stock.totalQty).toBe(22.5);
    expect(stock.totalCostValue).toBe(189000);
    expect(stock.totalSellValue).toBe(231750);
    expect(stock.potentialProfit).toBe(42750);

    expect(getStockValuationReport(db, OWNER, { status: 'low' }).rows).toHaveLength(2);
    expect(getStockValuationReport(db, OWNER, { status: 'out' }).rows).toHaveLength(1);
  });

  it('computes dues report separating receivables and payables', () => {
    const db = createTestDb();
    seedBusinessData(db);

    const dues = getDuesReport(db, OWNER);
    expect(dues.totalReceivable).toBe(20000);
    expect(dues.totalPayable).toBe(40000);
    expect(dues.netDue).toBe(-20000);
    expect(dues.receivables).toHaveLength(1);
    expect(dues.payables).toHaveLength(1);

    expect(getDuesReport(db, OWNER, { direction: 'receivable' }).rows).toHaveLength(1);
    expect(getDuesReport(db, OWNER, { direction: 'payable' }).rows).toHaveLength(1);
  });

  it('computes cash flow report with opening balance, inflows, outflows, and closing balance', () => {
    const db = createTestDb();
    seedBusinessData(db);

    const cf = getCashFlowReport(db, OWNER, NOV_RANGE);
    // Opening (Oct): 500000 (cash)
    // Nov In: +30000 (sale cash) + 7500 (sale bkash) = 37500
    // Nov Out: -60000 (purchase cash) - 10000 (expense cash) - 5000 (expense bkash) = 75000
    // Net: -37500; Closing: 462500
    expect(cf.openingBalance).toBe(500000);
    expect(cf.totalIn).toBe(37500);
    expect(cf.totalOut).toBe(75000);
    expect(cf.netFlow).toBe(-37500);
    expect(cf.closingBalance).toBe(462500);
    expect(cf.byMethod).toHaveLength(2);

    const cashOnly = getCashFlowReport(db, OWNER, NOV_RANGE, { method: 'cash' });
    expect(cashOnly.openingBalance).toBe(500000);
    expect(cashOnly.totalIn).toBe(30000);
    expect(cashOnly.totalOut).toBe(70000);
    expect(cashOnly.closingBalance).toBe(460000);
  });

  it('computes product-wise profit report with sorting', () => {
    const db = createTestDb();
    seedBusinessData(db);

    const pp = getProductProfitReport(db, OWNER, NOV_RANGE);
    // Oil: qty 2, rev 36000, cogs 28000, profit 8000
    // Rice: qty 3.5, rev 26250, cogs 21000, profit 5250
    expect(pp.productCount).toBe(2);
    expect(pp.totalQtySold).toBe(5.5);
    expect(pp.totalRevenue).toBe(62250);
    expect(pp.totalCogs).toBe(49000);
    expect(pp.totalProfit).toBe(13250);
    expect(pp.invoiceDiscountTotal).toBe(4750);
    expect(pp.rows[0].name).toBe('Soybean Oil');
    expect(pp.rows[0].profit).toBe(8000);
    expect(pp.rows[1].name).toBe('Miniket Rice');
    expect(pp.rows[1].profit).toBe(5250);

    const byQty = getProductProfitReport(db, OWNER, NOV_RANGE, { sortBy: 'qty' });
    expect(byQty.rows[0].name).toBe('Miniket Rice');
  });
});
