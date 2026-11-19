import { endOfDay, endOfMonth, startOfDay, startOfMonth } from '@/lib/date';

export type DatePreset = 'today' | 'month' | 'all' | 'custom';

export const DATE_PRESET_OPTIONS: { value: DatePreset; label: string }[] = [
  { value: 'today', label: 'Today' },
  { value: 'month', label: 'This Month' },
  { value: 'all', label: 'All Time' },
  { value: 'custom', label: 'Custom' },
];

export function resolveDateRange(
  preset: DatePreset,
  customFrom: number,
  customTo: number,
  refNow: number = Date.now(),
): { from?: number; to?: number } {
  if (preset === 'today') {
    return { from: startOfDay(refNow), to: endOfDay(refNow) };
  }
  if (preset === 'month') {
    return { from: startOfMonth(refNow), to: endOfMonth(refNow) };
  }
  if (preset === 'custom') {
    const lo = Math.min(customFrom, customTo);
    const hi = Math.max(customFrom, customTo);
    return { from: startOfDay(lo), to: endOfDay(hi) };
  }
  return {};
}
