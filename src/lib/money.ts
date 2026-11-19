import { AppError } from './errors';

/** All money is integer paisa (1 taka = 100 paisa). */

function assertSafe(n: number): number {
  if (!Number.isSafeInteger(n)) throw new AppError('VALIDATION', 'Invalid amount');
  return n;
}

/** Parse "1,250.50" / 1250.5 into paisa. Exact for ≤2 decimals; extra decimals are rounded. */
export function toPaisa(input: string | number): number {
  if (typeof input === 'number') {
    if (!Number.isFinite(input)) throw new AppError('VALIDATION', 'Invalid amount');
    return assertSafe(Math.round(Number((input * 100).toPrecision(15))));
  }
  const s = input.replace(/[,\s৳]/g, '');
  if (!/^-?\d*\.?\d*$/.test(s) || s === '' || s === '-' || s === '.') {
    throw new AppError('VALIDATION', 'Invalid amount');
  }
  const neg = s.startsWith('-');
  const [whole = '0', frac = ''] = s.replace('-', '').split('.');
  const padded = (frac + '000').slice(0, 3);
  let paisa = Number(whole || '0') * 100 + Number(padded.slice(0, 2));
  if (Number(padded[2]) >= 5) paisa += 1;
  return assertSafe(neg ? -paisa : paisa);
}

export function fromPaisa(paisa: number): number {
  return assertSafe(paisa) / 100;
}

function group(intPart: string): string {
  return intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** "৳ 1,250.50". Decimals shown when `decimal` is true or paisa is non-zero. */
export function formatTaka(paisa: number, decimal = false): string {
  assertSafe(paisa);
  const abs = Math.abs(paisa);
  const whole = Math.floor(abs / 100);
  const frac = abs % 100;
  const showFrac = decimal || frac !== 0;
  const text = group(String(whole)) + (showFrac ? '.' + String(frac).padStart(2, '0') : '');
  return `${paisa < 0 ? '-' : ''}৳ ${text}`;
}

export function add(...amounts: number[]): number {
  return assertSafe(amounts.reduce((sum, a) => sum + assertSafe(a), 0));
}

/** Round qty to 3 decimals. */
export function roundQty(qty: number): number {
  if (!Number.isFinite(qty)) throw new AppError('VALIDATION', 'Invalid quantity');
  return Math.round(Number((qty * 1000).toPrecision(15))) / 1000;
}

/** unit price (paisa) × qty (≤3dp) → paisa, rounded half up. */
export function mulQty(unitPaisa: number, qty: number): number {
  const milli = Math.round(roundQty(qty) * 1000);
  return assertSafe(Math.round((assertSafe(unitPaisa) * milli) / 1000));
}

/** percent (≤2dp) of an amount in paisa, rounded half up. */
export function percentOf(amountPaisa: number, percent: number): number {
  if (!Number.isFinite(percent)) throw new AppError('VALIDATION', 'Invalid percent');
  const basis = Math.round(percent * 100);
  return assertSafe(Math.round((assertSafe(amountPaisa) * basis) / 10000));
}
