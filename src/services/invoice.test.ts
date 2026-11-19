/** @jest-environment node */
import { newRow } from '@/db/helpers';
import { parties, products, shops } from '@/db/schema';
import type { AppDb } from '@/db/types';
import { AppError } from '@/lib/errors';
import { postStock } from '@/services/posting';
import { createSale, deleteSale, type SaleContext } from '@/services/sales';
import { createTestDb } from '@/test/testDb';
import {
  buildInvoiceHtml,
  buildInvoiceShareText,
  escapeHtml,
  generateInvoicePdf,
  getInvoiceData,
  printInvoice,
  resolveImageForPrint,
  shareInvoicePdf,
} from './invoice';

const mockPrintToFile = jest.fn(async () => ({ uri: 'file:///cache/inv.pdf', numberOfPages: 1 }));
const mockPrintAsync = jest.fn(async () => undefined);
const mockIsAvailable = jest.fn(async () => true);
const mockShareAsync = jest.fn(async () => undefined);

jest.mock('expo-file-system', () => ({
  File: class MockFile {
    exists = true;
    async base64() {
      return 'AQID';
    }
  },
}));

jest.mock('expo-print', () => ({
  printToFileAsync: (...args: unknown[]) => mockPrintToFile(...(args as [])),
  printAsync: (...args: unknown[]) => mockPrintAsync(...(args as [])),
}));

jest.mock('expo-sharing', () => ({
  isAvailableAsync: () => mockIsAvailable(),
  shareAsync: (...args: unknown[]) => mockShareAsync(...(args as [])),
}));

const SHOP = 'shop_inv';
const CTX: SaleContext = { shopId: SHOP, userId: 'u1', role: 'owner' };
const DAY = new Date(2026, 10, 20, 18, 15, 0).getTime();

function seedInvoiceScenario(db: AppDb) {
  db.insert(shops)
    .values({
      id: SHOP,
      shop_id: SHOP,
      created_at: DAY,
      updated_at: DAY,
      deleted_at: null,
      created_by: 'u1',
      dirty: 1,
      name: 'Sohan <Store> & Co',
      phone: '01711223344',
      address: 'Banani, Dhaka',
      logo_uri: 'https://cdn.example.com/logo.png',
      payment_qr_uri: 'https://cdn.example.com/qr.png',
      invoice_footer: 'No return after 7 days',
      decimal_enabled: 1,
      owner_id: 'u1',
    })
    .run();

  const pRow = newRow(SHOP, 'u1', DAY);
  db.insert(products)
    .values({
      ...pRow,
      name: 'Smart Watch <Pro>',
      buy_price: 777700,
      sell_price: 250000,
      warranty_days: 180,
    })
    .run();
  postStock(db, {
    shopId: SHOP,
    userId: 'u1',
    refId: null,
    date: DAY,
    productId: pRow.id,
    qty: 5,
    type: 'opening',
  });

  const cRow = newRow(SHOP, 'u1', DAY);
  db.insert(parties)
    .values({
      ...cRow,
      type: 'customer',
      name: 'Tanvir Ahmed',
      phone: '01899887766',
      address: 'Uttara',
    })
    .run();

  const sale = createSale(db, CTX, {
    partyId: cRow.id,
    date: DAY,
    items: [{ productId: pRow.id, name: 'Smart Watch <Pro>', qty: 1, unitPrice: 250000 }],
    discountType: 'amount',
    discountValue: 10000,
    vatPercent: 5,
    paid: 200000,
    method: 'bkash',
    note: 'Deliver with box',
  });

  return sale.sale.id;
}

describe('invoice service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockIsAvailable.mockResolvedValue(true);
  });

  it('escapes HTML entities safely', () => {
    expect(escapeHtml('<script>"a" & \'b\'</script>')).toBe(
      '&lt;script&gt;&quot;a&quot; &amp; &#39;b&#39;&lt;/script&gt;',
    );
  });

  it('loads invoice data and throws NOT_FOUND for missing or deleted sale', () => {
    const db = createTestDb();
    const saleId = seedInvoiceScenario(db);
    const data = getInvoiceData(db, SHOP, saleId);
    expect(data.shop.name).toBe('Sohan <Store> & Co');
    expect(data.party?.name).toBe('Tanvir Ahmed');
    expect(data.items).toHaveLength(1);

    expect(() => getInvoiceData(db, SHOP, 'missing')).toThrow(AppError);
    deleteSale(db, CTX, saleId);
    expect(() => getInvoiceData(db, SHOP, saleId)).toThrow(AppError);
  });

  it('builds safe HTML with shop header, payment QR, warranty, totals, and never leaks buy_price', () => {
    const db = createTestDb();
    const saleId = seedInvoiceScenario(db);
    const data = getInvoiceData(db, SHOP, saleId);
    const html = buildInvoiceHtml(data);

    expect(html).toContain('Sohan &lt;Store&gt; &amp; Co');
    expect(html).toContain('Smart Watch &lt;Pro&gt;');
    expect(html).toContain('https://cdn.example.com/logo.png');
    expect(html).toContain('https://cdn.example.com/qr.png');
    expect(html).toContain('Scan to Pay');
    expect(html).toContain('No return after 7 days');
    expect(html).toContain('Tanvir Ahmed');
    expect(html).toContain('Warranty until');
    expect(html).toContain('PARTIAL DUE');
    expect(html).toContain('৳ 2,520.00');
    expect(html).toContain('৳ 520.00');
    expect(html).not.toContain('7,777');
    expect(html).not.toContain('777700');
  });

  it('builds plain-text invoice share summary', () => {
    const db = createTestDb();
    const saleId = seedInvoiceScenario(db);
    const data = getInvoiceData(db, SHOP, saleId);
    const text = buildInvoiceShareText(data);

    expect(text).toContain('*Sohan <Store> & Co*');
    expect(text).toContain('Invoice: INV-20261120-0001');
    expect(text).toContain('Customer: Tanvir Ahmed');
    expect(text).toContain('*Total: ৳ 2,520.00*');
    expect(text).toContain('*Due: ৳ 520.00*');
  });

  it('resolves image URIs and invokes expo-print / expo-sharing', async () => {
    expect(await resolveImageForPrint(null)).toBeNull();
    expect(await resolveImageForPrint('https://example.com/a.png')).toBe(
      'https://example.com/a.png',
    );
    expect(await resolveImageForPrint('data:image/png;base64,abc')).toBe(
      'data:image/png;base64,abc',
    );
    expect(await resolveImageForPrint('file:///tmp/qr.png')).toBe('data:image/png;base64,AQID');

    const db = createTestDb();
    const saleId = seedInvoiceScenario(db);
    const data = getInvoiceData(db, SHOP, saleId);

    const pdf = await generateInvoicePdf(data);
    expect(pdf.uri).toBe('file:///cache/inv.pdf');
    expect(mockPrintToFile).toHaveBeenCalledTimes(1);

    await printInvoice(data);
    expect(mockPrintAsync).toHaveBeenCalledTimes(1);

    await shareInvoicePdf(data);
    expect(mockShareAsync).toHaveBeenCalledWith(
      'file:///cache/inv.pdf',
      expect.objectContaining({ mimeType: 'application/pdf' }),
    );

    mockIsAvailable.mockResolvedValueOnce(false);
    await expect(shareInvoicePdf(data)).rejects.toThrow(AppError);
  });
});
