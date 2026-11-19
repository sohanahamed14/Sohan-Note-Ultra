/** @jest-environment node */
import type { Shop } from '@/db/schema';
import { buildBusinessCardHtml, buildCardQrValue, escapeHtml } from './businessCardHtml';

const SAMPLE_SHOP: Shop = {
  id: 's1',
  shop_id: 's1',
  created_at: 1,
  updated_at: 1,
  deleted_at: null,
  created_by: 'u1',
  dirty: 0,
  name: 'Sohan & Sons <Dhaka>',
  slug: 'sohan-sons',
  phone: '+8801840673882',
  address: 'Satarkul, Badda, Dhaka',
  business_type: 'Gas & Fuel',
  logo_uri: null,
  vat_percent: 0,
  invoice_footer: null,
  payment_qr_uri: null,
  decimal_enabled: 0,
  online_enabled: 0,
  online_theme: null,
  delivery_inside: 0,
  delivery_outside: 0,
  shop_policy: null,
  owner_id: 'u1',
  online_visits: 0,
};

describe('businessCardHtml', () => {
  it('escapes HTML entities', () => {
    expect(escapeHtml('<script>"a&b"</script>')).toBe('&lt;script&gt;&quot;a&amp;b&quot;&lt;/script&gt;');
  });

  it('uses storefront URL when online shop is enabled, else vCard', () => {
    const vcard = buildCardQrValue(SAMPLE_SHOP, 'Sohan', 'sohan@test.com');
    expect(vcard).toContain('BEGIN:VCARD');
    expect(vcard).toContain('ORG:Sohan & Sons <Dhaka>');
    expect(vcard).toContain('TEL;TYPE=CELL:+8801840673882');

    const url = buildCardQrValue({ ...SAMPLE_SHOP, online_enabled: 1 }, 'Sohan', 'sohan@test.com');
    expect(url).toBe('https://sohannote.app/s/sohan-sons');
  });

  it('builds escaped printable HTML for all themes', () => {
    const html = buildBusinessCardHtml(SAMPLE_SHOP, 'Sohan', 'sohan@test.com', 'gold');
    expect(html).toContain('Sohan &amp; Sons &lt;Dhaka&gt;');
    expect(html).toContain('#F6BE25');
    expect(html).toContain('Gas &amp; Fuel');
  });
});
