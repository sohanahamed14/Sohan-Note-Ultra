import { AppError } from './errors';
import { add, formatTaka, fromPaisa, mulQty, percentOf, roundQty, toPaisa } from './money';

describe('money', () => {
  it('toPaisa parses strings exactly', () => {
    expect(toPaisa('1,250.50')).toBe(125050);
    expect(toPaisa('0.1')).toBe(10);
    expect(toPaisa('19.99')).toBe(1999);
    expect(toPaisa('৳ 5')).toBe(500);
    expect(toPaisa('1.005')).toBe(101);
    expect(toPaisa('-2.5')).toBe(-250);
    expect(toPaisa('.5')).toBe(50);
  });
  it('toPaisa handles floats', () => {
    expect(toPaisa(0.1 + 0.2)).toBe(30);
    expect(toPaisa(1.15)).toBe(115);
  });
  it('rejects bad input', () => {
    for (const bad of ['', 'abc', '1.2.3', '-', '.']) {
      expect(() => toPaisa(bad)).toThrow(AppError);
    }
    expect(() => toPaisa(NaN)).toThrow(AppError);
    expect(() => toPaisa(Infinity)).toThrow(AppError);
  });
  it('fromPaisa', () => {
    expect(fromPaisa(125050)).toBe(1250.5);
    expect(() => fromPaisa(1.5)).toThrow(AppError);
  });
  it('formatTaka', () => {
    expect(formatTaka(125050)).toBe('৳ 1,250.50');
    expect(formatTaka(125000)).toBe('৳ 1,250');
    expect(formatTaka(125000, true)).toBe('৳ 1,250.00');
    expect(formatTaka(0)).toBe('৳ 0');
    expect(formatTaka(5)).toBe('৳ 0.05');
    expect(formatTaka(-250)).toBe('-৳ 2.50');
    expect(formatTaka(123456789)).toBe('৳ 1,234,567.89');
  });
  it('add is integer safe', () => {
    expect(add(10, 20, 30)).toBe(60);
    expect(add()).toBe(0);
    expect(() => add(1.5, 1)).toThrow(AppError);
  });
  it('mulQty', () => {
    expect(mulQty(1000, 3)).toBe(3000);
    expect(mulQty(1999, 0.5)).toBe(1000);
    expect(mulQty(333, 1.5)).toBe(500);
    expect(mulQty(100, 0.001)).toBe(0);
    expect(mulQty(100, 0)).toBe(0);
  });
  it('percentOf', () => {
    expect(percentOf(10000, 5)).toBe(500);
    expect(percentOf(999, 10)).toBe(100);
    expect(percentOf(10000, 7.5)).toBe(750);
    expect(percentOf(0, 10)).toBe(0);
  });
  it('roundQty', () => {
    expect(roundQty(1.00049)).toBe(1);
    expect(roundQty(0.1 + 0.2)).toBe(0.3);
  });
});
