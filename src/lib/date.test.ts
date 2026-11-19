import {
  addDays,
  endOfDay,
  endOfMonth,
  formatDate,
  formatDateTime,
  parseDateInput,
  startOfDay,
  startOfMonth,
  toDateInput,
} from './date';

const t = new Date(2026, 10, 15, 19, 59, 30).getTime();

describe('date', () => {
  it('formats', () => {
    expect(formatDate(t)).toBe('15 Nov 2026');
    expect(formatDateTime(t)).toBe('15 Nov, 07:59 PM');
    expect(formatDateTime(new Date(2026, 0, 1, 0, 5).getTime())).toBe('1 Jan, 12:05 AM');
    expect(toDateInput(t)).toBe('2026-11-15');
  });
  it('ranges', () => {
    expect(new Date(startOfDay(t)).getHours()).toBe(0);
    expect(endOfDay(t) - startOfDay(t)).toBe(86400000 - 1);
    expect(new Date(startOfMonth(t)).getDate()).toBe(1);
    expect(new Date(endOfMonth(t)).getDate()).toBe(30);
    expect(toDateInput(addDays(t, 20))).toBe('2026-12-05');
  });
  it('parseDateInput', () => {
    expect(parseDateInput('2026-11-15')).toBe(startOfDay(t));
    expect(parseDateInput('2026-02-30')).toBeNull();
    expect(parseDateInput('15/11/2026')).toBeNull();
  });
});
