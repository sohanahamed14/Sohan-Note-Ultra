import type { Shop } from '@/db/schema';

export type CardTheme = 'gold' | 'blue' | 'dark';

export const CARD_THEMES: { value: CardTheme; label: string }[] = [
  { value: 'gold', label: 'Classic Gold' },
  { value: 'blue', label: 'Royal Blue' },
  { value: 'dark', label: 'Minimal Dark' },
];

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function buildCardQrValue(
  shop: Shop,
  ownerName: string | null,
  ownerEmail: string | null,
): string {
  if (shop.online_enabled && shop.slug) {
    return `https://sohannote.app/s/${shop.slug}`;
  }
  const lines = [
    'BEGIN:VCARD',
    'VERSION:3.0',
    `FN:${ownerName || shop.name}`,
    `ORG:${shop.name}`,
    shop.phone ? `TEL;TYPE=CELL:${shop.phone}` : '',
    ownerEmail ? `EMAIL:${ownerEmail}` : '',
    shop.address ? `ADR:;;${shop.address};;;;` : '',
    'END:VCARD',
  ].filter(Boolean);
  return lines.join('\n');
}

export function buildBusinessCardHtml(
  shop: Shop,
  ownerName: string | null,
  ownerEmail: string | null,
  theme: CardTheme,
): string {
  const palette: Record<
    CardTheme,
    { bg: string; accent: string; text: string; muted: string; badgeBg: string; badgeText: string }
  > = {
    gold: {
      bg: '#F6BE25',
      accent: '#1B1B1B',
      text: '#1B1B1B',
      muted: '#4A3C0B',
      badgeBg: '#1B1B1B',
      badgeText: '#F6BE25',
    },
    blue: {
      bg: '#1A5DD6',
      accent: '#F6BE25',
      text: '#FFFFFF',
      muted: '#DCE8FF',
      badgeBg: '#FFFFFF',
      badgeText: '#1A5DD6',
    },
    dark: {
      bg: '#1B1B1B',
      accent: '#F6BE25',
      text: '#F5F5F5',
      muted: '#BDBDBD',
      badgeBg: '#F6BE25',
      badgeText: '#1B1B1B',
    },
  };
  const c = palette[theme];
  const initials = escapeHtml(shop.name.trim().slice(0, 2).toUpperCase() || 'SN');
  const logoHtml = shop.logo_uri
    ? `<img src="${escapeHtml(shop.logo_uri)}" style="width:64px;height:64px;border-radius:12px;object-fit:cover;border:2px solid ${c.accent};" />`
    : `<div style="width:64px;height:64px;border-radius:12px;background:${c.badgeBg};color:${c.badgeText};display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:800;">${initials}</div>`;

  const rows = [
    ownerName ? `<div><strong>Contact:</strong> ${escapeHtml(ownerName)}</div>` : '',
    shop.phone ? `<div><strong>Phone:</strong> ${escapeHtml(shop.phone)}</div>` : '',
    ownerEmail ? `<div><strong>Email:</strong> ${escapeHtml(ownerEmail)}</div>` : '',
    shop.address ? `<div><strong>Address:</strong> ${escapeHtml(shop.address)}</div>` : '',
    shop.online_enabled && shop.slug
      ? `<div><strong>Online Store:</strong> /s/${escapeHtml(shop.slug)}</div>`
      : '',
  ]
    .filter(Boolean)
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<style>
  body { margin: 0; padding: 32px; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f4f4f4; display: flex; justify-content: center; }
  .card { width: 520px; border-radius: 16px; background: ${c.bg}; color: ${c.text}; padding: 28px; box-sizing: border-box; box-shadow: 0 8px 24px rgba(0,0,0,0.16); }
  .top { display: flex; align-items: center; gap: 16px; margin-bottom: 20px; }
  .name { font-size: 24px; font-weight: 800; margin: 0; }
  .type { display: inline-block; margin-top: 6px; padding: 4px 10px; border-radius: 999px; background: ${c.badgeBg}; color: ${c.badgeText}; font-size: 12px; font-weight: 700; }
  .divider { height: 2px; background: ${c.accent}; opacity: 0.35; margin: 16px 0; }
  .details { font-size: 14px; line-height: 1.8; color: ${c.text}; }
  .footer { margin-top: 20px; font-size: 11px; color: ${c.muted}; text-align: right; }
</style>
</head>
<body>
  <div class="card">
    <div class="top">
      ${logoHtml}
      <div>
        <h1 class="name">${escapeHtml(shop.name)}</h1>
        ${shop.business_type ? `<span class="type">${escapeHtml(shop.business_type)}</span>` : ''}
      </div>
    </div>
    <div class="divider"></div>
    <div class="details">${rows || '<div>Add phone & address in Settings</div>'}</div>
    <div class="footer">Sohan Note Ultra · Digital Business Card</div>
  </div>
</body>
</html>`;
}
