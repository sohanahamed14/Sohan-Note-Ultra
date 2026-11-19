import { StyleSheet, View } from 'react-native';
import { endOfDay, formatDate, startOfDay } from '@/lib/date';
import { formatTaka } from '@/lib/money';
import type { DateRange } from '@/services/reports';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { AppText, Button, Card, ChipRow, DateField } from '@/ui';
import { PRESET_OPTIONS, getPresetRange, type DatePreset } from './datePresets';

export function DateRangeControl({
  preset,
  range,
  onChangePreset,
  onChangeRange,
}: {
  preset: DatePreset;
  range: DateRange;
  onChangePreset: (p: DatePreset) => void;
  onChangeRange: (r: DateRange) => void;
}) {
  const handlePreset = (p: DatePreset) => {
    onChangePreset(p);
    if (p !== 'custom') {
      onChangeRange(getPresetRange(p));
    }
  };

  return (
    <Card style={styles.rangeCard}>
      <ChipRow options={PRESET_OPTIONS} value={preset} onChange={handlePreset} />
      {preset === 'custom' ? (
        <View style={styles.customRow}>
          <View style={styles.flex}>
            <DateField
              label="From"
              value={range.from}
              onChange={(ts) => {
                const nextFrom = startOfDay(ts);
                onChangeRange({
                  from: nextFrom,
                  to: nextFrom > range.to ? endOfDay(ts) : range.to,
                });
              }}
            />
          </View>
          <View style={styles.flex}>
            <DateField
              label="To"
              value={range.to}
              onChange={(ts) => {
                const nextTo = endOfDay(ts);
                onChangeRange({
                  from: nextTo < range.from ? startOfDay(ts) : range.from,
                  to: nextTo,
                });
              }}
            />
          </View>
        </View>
      ) : (
        <AppText variant="label" muted>
          Period: {formatDate(range.from)} – {formatDate(range.to)}
        </AppText>
      )}
    </Card>
  );
}

export type KpiItem = {
  label: string;
  value: string;
  sub?: string;
  tone?: 'neutral' | 'positive' | 'negative' | 'accent';
};

export function KpiGrid({ items }: { items: KpiItem[] }) {
  const { colors } = useTheme();
  return (
    <View style={styles.kpiGrid}>
      {items.map((item) => {
        const color =
          item.tone === 'positive'
            ? colors.success
            : item.tone === 'negative'
              ? colors.danger
              : item.tone === 'accent'
                ? colors.accent
                : colors.text;
        return (
          <View
            key={item.label}
            style={[
              styles.kpiBox,
              { backgroundColor: colors.surface, borderColor: colors.border },
            ]}
          >
            <AppText variant="label" muted numberOfLines={1}>
              {item.label}
            </AppText>
            <AppText bold numberOfLines={1} adjustsFontSizeToFit style={[styles.kpiVal, { color }]}>
              {item.value}
            </AppText>
            {item.sub ? (
              <AppText variant="label" muted numberOfLines={1}>
                {item.sub}
              </AppText>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

export type BarDatum = {
  key: string;
  label: string;
  amount: number;
  sub?: string;
  color?: string;
};

export function BarBreakdownCard({
  title,
  items,
  decimal,
}: {
  title: string;
  items: BarDatum[];
  decimal: boolean;
}) {
  const { colors } = useTheme();
  if (items.length === 0) return null;
  const max = Math.max(...items.map((i) => Math.abs(i.amount)), 1);

  return (
    <Card style={styles.barCard}>
      <AppText variant="secondary" bold>
        {title}
      </AppText>
      {items.map((item) => {
        const widthPct = Math.max(3, Math.round((Math.abs(item.amount) / max) * 100));
        return (
          <View key={item.key} style={styles.barRow}>
            <View style={styles.barHead}>
              <AppText variant="secondary" numberOfLines={1} style={styles.flex}>
                {item.label}
                {item.sub ? (
                  <AppText variant="label" muted>
                    {' '}
                    ({item.sub})
                  </AppText>
                ) : null}
              </AppText>
              <AppText variant="secondary" bold>
                {formatTaka(item.amount, decimal)}
              </AppText>
            </View>
            <View style={[styles.barTrack, { backgroundColor: colors.surfaceMuted }]}>
              <View
                style={[
                  styles.barFill,
                  {
                    width: `${widthPct}%`,
                    backgroundColor: item.color ?? colors.accent,
                  },
                ]}
              />
            </View>
          </View>
        );
      })}
    </Card>
  );
}

export function ExportActionBar({
  busy,
  onExportPdf,
  onExportExcel,
}: {
  busy: 'pdf' | 'excel' | null;
  onExportPdf: () => void;
  onExportExcel: () => void;
}) {
  const { colors } = useTheme();
  return (
    <View
      style={[
        styles.exportBar,
        { backgroundColor: colors.surface, borderTopColor: colors.border },
      ]}
    >
      <Button
        label="Export PDF"
        icon="file-pdf-box"
        variant="primary"
        loading={busy === 'pdf'}
        disabled={busy !== null}
        onPress={onExportPdf}
        style={styles.flex}
      />
      <Button
        label="Export Excel"
        icon="file-excel-box"
        variant="yellow"
        loading={busy === 'excel'}
        disabled={busy !== null}
        onPress={onExportExcel}
        style={styles.flex}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  rangeCard: { gap: 8 },
  customRow: { flexDirection: 'row', gap: 10 },
  flex: { flex: 1 },
  kpiGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  kpiBox: {
    width: '48.5%',
    flexGrow: 1,
    borderWidth: 1,
    borderRadius: radius.card,
    padding: 12,
    gap: 2,
  },
  kpiVal: { fontSize: 17 },
  barCard: { gap: 10 },
  barRow: { gap: 4 },
  barHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  barTrack: { height: 8, borderRadius: 4, overflow: 'hidden' },
  barFill: { height: '100%', borderRadius: 4 },
  exportBar: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
});
