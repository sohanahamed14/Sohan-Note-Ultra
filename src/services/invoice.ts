import { File } from 'expo-file-system';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import type { AppDb } from '@/db/types';
import type { Method, Party, Sale, SaleItem, Shop } from '@/db/schema';
import { formatDate, formatDateTime } from '@/lib/date';
import { AppError } from '@/lib/errors';
import { formatTaka } from '@/lib/money';
import { getSaleById, getSalePaymentStatus } from '@/services/sales';

export type InvoiceData = {
  sale: Sale;
  items: SaleItem[];
  party: Party | null;
  shop: Shop;
};

const METHOD_LABELS: Record<Method, string> = {
  cash: 'Cash',
  bkash: 'bKash',
  nagad: 'Nagad',
  card: 'Card',
  bank: 'Bank',
  other: 'Other',
};

export function formatMethodLabel(method: Method): string {
  return METHOD_LABELS[method];
}

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Load invoice data (sale + items + customer + shop); throws NOT_FOUND if missing. */
export function getInvoiceData(db: AppDb, shopId: string, saleId: string): InvoiceData {
  const detail = getSaleById(db, shopId, saleId);
  if (!detail || !detail.shop) {
    throw new AppError('NOT_FOUND', 'Invoice not found');
  }
  return {
    sale: detail.sale,
    items: detail.items,
    party: detail.party,
    shop: detail.shop,
  };
}

/** Build printable HTML invoice with shop header, line items, totals, and payment QR. */
export function buildInvoiceHtml(
  data: InvoiceData,
  media?: { logoUri?: string | null; paymentQrUri?: string | null },
): string {
  const { sale, items, party, shop } = data;
  const dec = Boolean(shop.decimal_enabled);
  const logoSrc = media?.logoUri !== undefined ? media.logoUri : shop.logo_uri;
  const qrSrc = media?.paymentQrUri !== undefined ? media.paymentQrUri : shop.payment_qr_uri;
  const status = getSalePaymentStatus(sale);
  const statusLabel = status === 'paid' ? 'PAID' : status === 'partial' ? 'PARTIAL DUE' : 'DUE';
  const statusColor = status === 'paid' ? '#2E9E5B' : status === 'partial' ? '#C77700' : '#E53935';

  const itemRows = items
    .map((item, idx) => {
      const warrantyHtml = item.warranty_until
        ? `<div class="sub">Warranty until ${escapeHtml(formatDate(item.warranty_until))}</div>`
        : '';
      return `<tr>
        <td class="num">${idx + 1}</td>
        <td>
          <div class="item-name">${escapeHtml(item.name)}</div>
          ${warrantyHtml}
        </td>
        <td class="num">${item.qty}</td>
        <td class="num">${escapeHtml(formatTaka(item.unit_price, dec))}</td>
        <td class="num bold">${escapeHtml(formatTaka(item.total, dec))}</td>
      </tr>`;
    })
    .join('');

  const discountRow =
    sale.discount > 0
      ? `<tr><td>Discount</td><td class="num">-${escapeHtml(formatTaka(sale.discount, dec))}</td></tr>`
      : '';
  const vatRow =
    sale.vat > 0
      ? `<tr><td>VAT</td><td class="num">${escapeHtml(formatTaka(sale.vat, dec))}</td></tr>`
      : '';

  const customerBlock = party
    ? `<div class="meta-val bold">${escapeHtml(party.name)}</div>
       ${party.phone ? `<div class="meta-sub">${escapeHtml(party.phone)}</div>` : ''}
       ${party.address ? `<div class="meta-sub">${escapeHtml(party.address)}</div>` : ''}`
    : `<div class="meta-val">Walk-in Customer</div>`;

  const logoBlock = logoSrc
    ? `<img src="${escapeHtml(logoSrc)}" alt="Shop logo" class="logo" />`
    : '';

  const qrBlock = qrSrc
    ? `<div class="qr-box">
         <img src="${escapeHtml(qrSrc)}" alt="Payment QR" class="qr" />
         <div class="qr-caption">Scan to Pay</div>
       </div>`
    : '';

  const noteBlock = sale.note
    ? `<div class="note-box"><span class="bold">Note:</span> ${escapeHtml(sale.note)}</div>`
    : '';

  const footerText = shop.invoice_footer
    ? `<div class="footer-custom">${escapeHtml(shop.invoice_footer)}</div>`
    : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Invoice ${escapeHtml(sale.invoice_no)}</title>
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1B1B1B; margin: 0; padding: 24px; background: #FFFFFF; font-size: 13px; line-height: 1.45; }
  .sheet { max-width: 720px; margin: 0 auto; border: 1px solid #ECECEC; border-radius: 10px; overflow: hidden; }
  .bar { height: 8px; background: #F6BE25; }
  .inner { padding: 20px 24px; }
  .header { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; padding-bottom: 16px; border-bottom: 1px solid #ECECEC; }
  .shop-left { display: flex; align-items: center; gap: 12px; }
  .logo { width: 52px; height: 52px; object-fit: cover; border-radius: 8px; border: 1px solid #ECECEC; }
  .shop-name { font-size: 20px; font-weight: 700; margin: 0 0 2px; }
  .shop-sub { color: #6B6B6B; font-size: 12px; }
  .inv-right { text-align: right; }
  .inv-title { font-size: 12px; letter-spacing: 1px; color: #6B6B6B; font-weight: 700; }
  .inv-no { font-size: 16px; font-weight: 700; margin: 2px 0; }
  .badge { display: inline-block; padding: 2px 10px; border-radius: 99px; font-size: 11px; font-weight: 700; color: #FFFFFF; background: ${statusColor}; margin-top: 4px; }
  .meta { display: flex; justify-content: space-between; gap: 16px; padding: 14px 0; border-bottom: 1px solid #ECECEC; }
  .meta-label { font-size: 11px; color: #6B6B6B; text-transform: uppercase; margin-bottom: 4px; }
  .meta-val { font-size: 13px; }
  .meta-sub { font-size: 12px; color: #6B6B6B; }
  table.items { width: 100%; border-collapse: collapse; margin-top: 14px; }
  table.items th { background: #F7F7F7; color: #6B6B6B; font-size: 11px; text-transform: uppercase; text-align: left; padding: 8px 10px; border-bottom: 1px solid #ECECEC; }
  table.items th.num, table.items td.num { text-align: right; white-space: nowrap; }
  table.items td { padding: 9px 10px; border-bottom: 1px solid #F0F0F0; vertical-align: top; }
  .item-name { font-weight: 600; }
  .sub { font-size: 11px; color: #1A5DD6; margin-top: 2px; }
  .bold { font-weight: 700; }
  .bottom-grid { display: flex; justify-content: space-between; align-items: flex-start; gap: 20px; margin-top: 18px; }
  .qr-box { text-align: center; padding: 10px; border: 1px solid #ECECEC; border-radius: 8px; min-width: 130px; }
  .qr { width: 110px; height: 110px; object-fit: contain; display: block; margin: 0 auto; }
  .qr-caption { font-size: 11px; color: #6B6B6B; margin-top: 6px; font-weight: 600; }
  .totals { margin-left: auto; min-width: 240px; border-collapse: collapse; }
  .totals td { padding: 5px 8px; }
  .totals tr.grand td { border-top: 2px solid #1B1B1B; padding-top: 8px; font-size: 15px; font-weight: 700; }
  .totals tr.paid td { color: #2E9E5B; font-weight: 600; }
  .totals tr.due td { color: #E53935; font-weight: 700; }
  .note-box { margin-top: 14px; padding: 10px 12px; background: #FCFCFC; border: 1px solid #ECECEC; border-radius: 6px; font-size: 12px; }
  .footer { margin-top: 20px; padding-top: 12px; border-top: 1px dashed #DCDCDC; text-align: center; color: #6B6B6B; font-size: 11px; }
  .footer-custom { color: #1B1B1B; font-size: 12px; margin-bottom: 6px; }
</style>
</head>
<body>
  <div class="sheet">
    <div class="bar"></div>
    <div class="inner">
      <div class="header">
        <div class="shop-left">
          ${logoBlock}
          <div>
            <h1 class="shop-name">${escapeHtml(shop.name)}</h1>
            ${shop.phone ? `<div class="shop-sub">Phone: ${escapeHtml(shop.phone)}</div>` : ''}
            ${shop.address ? `<div class="shop-sub">${escapeHtml(shop.address)}</div>` : ''}
          </div>
        </div>
        <div class="inv-right">
          <div class="inv-title">INVOICE</div>
          <div class="inv-no">${escapeHtml(sale.invoice_no)}</div>
          <div class="shop-sub">${escapeHtml(formatDateTime(sale.date))}</div>
          <span class="badge">${statusLabel}</span>
        </div>
      </div>

      <div class="meta">
        <div>
          <div class="meta-label">Billed To</div>
          ${customerBlock}
        </div>
        <div style="text-align:right">
          <div class="meta-label">Payment Method</div>
          <div class="meta-val bold">${escapeHtml(formatMethodLabel(sale.method))}</div>
          <div class="meta-sub">Channel: ${escapeHtml(sale.kind.toUpperCase())}</div>
        </div>
      </div>

      <table class="items">
        <thead>
          <tr>
            <th class="num" style="width:32px">#</th>
            <th>Item</th>
            <th class="num">Qty</th>
            <th class="num">Rate</th>
            <th class="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          ${itemRows}
        </tbody>
      </table>

      <div class="bottom-grid">
        ${qrBlock}
        <table class="totals">
          <tr><td>Subtotal</td><td class="num">${escapeHtml(formatTaka(sale.subtotal, dec))}</td></tr>
          ${discountRow}
          ${vatRow}
          <tr class="grand"><td>Total</td><td class="num">${escapeHtml(formatTaka(sale.total, dec))}</td></tr>
          <tr class="paid"><td>Paid (${escapeHtml(formatMethodLabel(sale.method))})</td><td class="num">${escapeHtml(formatTaka(sale.paid, dec))}</td></tr>
          ${sale.due > 0 ? `<tr class="due"><td>Due</td><td class="num">${escapeHtml(formatTaka(sale.due, dec))}</td></tr>` : ''}
        </table>
      </div>

      ${noteBlock}

      <div class="footer">
        ${footerText}
        <div>Thank you for your business — Sohan Note Ultra</div>
      </div>
    </div>
  </div>
</body>
</html>`;
}

/** Plain-text invoice summary suitable for WhatsApp / SMS sharing. */
export function buildInvoiceShareText(data: InvoiceData): string {
  const { sale, items, party, shop } = data;
  const dec = Boolean(shop.decimal_enabled);
  const lines: string[] = [
    `*${shop.name}*`,
    ...(shop.phone ? [`Phone: ${shop.phone}`] : []),
    `Invoice: ${sale.invoice_no}`,
    `Date: ${formatDateTime(sale.date)}`,
    ...(party ? [`Customer: ${party.name}`] : []),
    '----------------',
    ...items.map(
      (i) =>
        `${i.name} × ${i.qty} = ${formatTaka(i.total, dec)}${i.warranty_until ? ` (Warranty: ${formatDate(i.warranty_until)})` : ''}`,
    ),
    '----------------',
    `Subtotal: ${formatTaka(sale.subtotal, dec)}`,
    ...(sale.discount > 0 ? [`Discount: -${formatTaka(sale.discount, dec)}`] : []),
    ...(sale.vat > 0 ? [`VAT: ${formatTaka(sale.vat, dec)}`] : []),
    `*Total: ${formatTaka(sale.total, dec)}*`,
    `Paid (${formatMethodLabel(sale.method)}): ${formatTaka(sale.paid, dec)}`,
    ...(sale.due > 0 ? [`*Due: ${formatTaka(sale.due, dec)}*`] : ['Status: PAID']),
    ...(shop.invoice_footer ? ['', shop.invoice_footer] : []),
  ];
  return lines.join('\n');
}

function guessMimeFromUri(uri: string): string {
  const lower = uri.toLowerCase();
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.webp')) return 'image/webp';
  return 'image/jpeg';
}

/** Convert local file:// URIs to base64 data URIs so iOS WKWebView print renders them reliably. */
export async function resolveImageForPrint(uri: string | null | undefined): Promise<string | null> {
  if (!uri) return null;
  if (uri.startsWith('http://') || uri.startsWith('https://') || uri.startsWith('data:')) {
    return uri;
  }
  if (!uri.startsWith('file://')) return uri;
  try {
    const file = new File(uri);
    if (!file.exists) return null;
    const b64 = await file.base64();
    return `data:${guessMimeFromUri(uri)};base64,${b64}`;
  } catch {
    return null;
  }
}

async function buildResolvedHtml(data: InvoiceData): Promise<string> {
  const [logoUri, paymentQrUri] = await Promise.all([
    resolveImageForPrint(data.shop.logo_uri),
    resolveImageForPrint(data.shop.payment_qr_uri),
  ]);
  return buildInvoiceHtml(data, { logoUri, paymentQrUri });
}

/** Render the invoice HTML into a cached PDF file via expo-print. */
export async function generateInvoicePdf(
  data: InvoiceData,
): Promise<{ uri: string; html: string }> {
  const html = await buildResolvedHtml(data);
  const result = await Print.printToFileAsync({ html });
  return { uri: result.uri, html };
}

/** Open the native/web print dialog for an invoice. */
export async function printInvoice(data: InvoiceData): Promise<void> {
  const html = await buildResolvedHtml(data);
  await Print.printAsync({ html });
}

/** Generate PDF and open the native share sheet. */
export async function shareInvoicePdf(data: InvoiceData): Promise<void> {
  const available = await Sharing.isAvailableAsync();
  if (!available) {
    throw new AppError('UNKNOWN', 'File sharing is not supported on this device');
  }
  const { uri } = await generateInvoicePdf(data);
  await Sharing.shareAsync(uri, {
    mimeType: 'application/pdf',
    UTI: 'com.adobe.pdf',
    dialogTitle: `Invoice ${data.sale.invoice_no}`,
  });
}
