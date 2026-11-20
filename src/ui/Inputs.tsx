import { MaterialCommunityIcons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type TextInputProps,
} from 'react-native';
import { formatDate, parseDateInput, toDateInput } from '@/lib/date';
import { fromPaisa, roundQty, toPaisa } from '@/lib/money';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { AppText } from './AppText';
import { BottomSheet } from './Overlays';

function useInputStyle(error?: string) {
  const { colors } = useTheme();
  return {
    colors,
    input: [
      styles.input,
      {
        backgroundColor: colors.surface,
        borderColor: error ? colors.danger : colors.border,
        color: colors.text,
      },
    ],
  };
}

type FieldProps = { label?: string; error?: string; helper?: string };

function FieldFrame({
  label,
  error,
  helper,
  children,
}: FieldProps & { children: React.ReactNode }) {
  const { colors } = useTheme();
  return (
    <View style={styles.field}>
      {label ? (
        <AppText variant="secondary" muted>
          {label}
        </AppText>
      ) : null}
      {children}
      {error ? (
        <AppText variant="label" style={{ color: colors.danger }}>
          {error}
        </AppText>
      ) : helper ? (
        <AppText variant="label" muted>
          {helper}
        </AppText>
      ) : null}
    </View>
  );
}

export function TextField({ label, error, helper, ...rest }: FieldProps & TextInputProps) {
  const s = useInputStyle(error);
  return (
    <FieldFrame label={label} error={error} helper={helper}>
      <TextInput
        placeholderTextColor={s.colors.textMuted}
        accessibilityLabel={label}
        {...rest}
        style={[s.input, rest.multiline && styles.multiline, rest.style]}
      />
    </FieldFrame>
  );
}

function parseMoney(text: string): number | null {
  if (text === '' || text === '.') return null;
  return toPaisa(text);
}

/** Controlled money input. `value` is integer paisa (null = empty). */
export function MoneyInput({
  label,
  error,
  helper,
  value,
  onChange,
  placeholder = '0',
}: FieldProps & {
  value: number | null;
  onChange: (paisa: number | null) => void;
  placeholder?: string;
}) {
  const s = useInputStyle(error);
  const moneyText = (v: number | null) => (v === null ? '' : String(fromPaisa(v)));
  const [text, setText] = useState(moneyText(value));
  if (value !== parseMoney(text)) setText(moneyText(value));
  const handle = (t: string) => {
    if (!/^\d*\.?\d{0,2}$/.test(t)) return;
    setText(t);
    onChange(parseMoney(t));
  };
  return (
    <FieldFrame label={label} error={error} helper={helper}>
      <View style={s.input}>
        <AppText muted>৳</AppText>
        <TextInput
          accessibilityLabel={label}
          value={text}
          onChangeText={handle}
          keyboardType="decimal-pad"
          placeholder={placeholder}
          placeholderTextColor={s.colors.textMuted}
          style={[styles.bare, { color: s.colors.text }]}
        />
      </View>
    </FieldFrame>
  );
}

export function QtyStepper({
  value,
  onChange,
  min = 0,
  step = 1,
}: {
  value: number;
  onChange: (qty: number) => void;
  min?: number;
  step?: number;
}) {
  const { colors } = useTheme();
  const [text, setText] = useState(String(value));
  const [prevValue, setPrevValue] = useState(value);
  if (value !== prevValue) {
    setPrevValue(value);
    const parsed = text === '' || text === '.' ? NaN : Number(text);
    if (!Number.isFinite(parsed) || roundQty(parsed) !== value) {
      setText(String(value));
    }
  }
  const set = (q: number) => {
    const next = Math.max(min, roundQty(q));
    setText(String(next));
    onChange(next);
  };
  const btn = (icon: 'minus' | 'plus', delta: number) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={icon === 'minus' ? 'Decrease' : 'Increase'}
      onPress={() => set(value + delta)}
      style={[styles.stepBtn, { backgroundColor: colors.surfaceMuted }]}
    >
      <MaterialCommunityIcons name={icon} size={20} color={colors.text} />
    </Pressable>
  );
  return (
    <View style={styles.stepper}>
      {btn('minus', -step)}
      <TextInput
        accessibilityLabel="Quantity"
        value={text}
        keyboardType="decimal-pad"
        onChangeText={(t) => {
          if (!/^\d*\.?\d{0,3}$/.test(t)) return;
          setText(t);
          if (t === '' || t === '.') return;
          const n = roundQty(Number(t));
          if (Number.isFinite(n) && n >= min) {
            onChange(n);
          }
        }}
        onBlur={() => setText(String(value))}
        style={[styles.stepInput, { color: colors.text, borderColor: colors.border }]}
      />
      {btn('plus', step)}
    </View>
  );
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.seg, { backgroundColor: colors.surfaceMuted }]}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <Pressable
            key={o.value}
            accessibilityRole="button"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(o.value)}
            style={[styles.segItem, on && { backgroundColor: colors.accent }]}
          >
            <AppText variant="secondary" bold={on} style={{ color: on ? '#FFFFFF' : colors.text }}>
              {o.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

export function SearchBar({
  value,
  onChangeText,
  placeholder = 'Search',
}: {
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
}) {
  const { colors } = useTheme();
  return (
    <View style={[styles.search, { backgroundColor: colors.surfaceMuted }]}>
      <MaterialCommunityIcons name="magnify" size={20} color={colors.textMuted} />
      <TextInput
        accessibilityLabel={placeholder}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textMuted}
        style={[styles.bare, { color: colors.text }]}
      />
      {value ? (
        <Pressable accessibilityLabel="Clear search" onPress={() => onChangeText('')} hitSlop={8}>
          <MaterialCommunityIcons name="close-circle" size={18} color={colors.textMuted} />
        </Pressable>
      ) : null}
    </View>
  );
}

export function Chip({
  label,
  selected,
  onPress,
}: {
  label: string;
  selected?: boolean;
  onPress: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? colors.primary : colors.surfaceMuted,
          borderColor: colors.border,
        },
      ]}
    >
      <AppText
        variant="secondary"
        bold={selected}
        style={{ color: selected ? colors.onPrimary : colors.text }}
      >
        {label}
      </AppText>
    </Pressable>
  );
}

export function ChipRow<T extends string>({
  options,
  value,
  onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.chips}
    >
      {options.map((o) => (
        <Chip
          key={o.value}
          label={o.label}
          selected={o.value === value}
          onPress={() => onChange(o.value)}
        />
      ))}
    </ScrollView>
  );
}

/** Keeps the time-of-day of `base`, takes the calendar day of `day`. */
function withDay(base: number, day: number): number {
  const b = new Date(base);
  const d = new Date(day);
  d.setHours(b.getHours(), b.getMinutes(), b.getSeconds(), b.getMilliseconds());
  return d.getTime();
}

export function DateField({
  label,
  value,
  onChange,
  error,
}: {
  label?: string;
  value: number;
  onChange: (ts: number) => void;
  error?: string;
}) {
  const s = useInputStyle(error);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(toDateInput(value));
  if (parseDateInput(text) !== null && toDateInput(value) !== text) setText(toDateInput(value));

  if (Platform.OS === 'web') {
    return (
      <TextField
        label={label}
        error={error}
        value={text}
        placeholder="YYYY-MM-DD"
        onChangeText={(t) => {
          setText(t);
          const parsed = parseDateInput(t);
          if (parsed !== null) onChange(withDay(value, parsed));
        }}
      />
    );
  }

  const picker = (
    <DateTimePicker
      value={new Date(value)}
      mode="date"
      display={Platform.OS === 'ios' ? 'inline' : 'default'}
      onChange={(e, d) => {
        if (Platform.OS === 'android') setOpen(false);
        if (e.type === 'set' && d) onChange(withDay(value, d.getTime()));
      }}
    />
  );
  return (
    <FieldFrame label={label} error={error}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label ?? 'Date'}
        onPress={() => setOpen(true)}
        style={s.input}
      >
        <MaterialCommunityIcons name="calendar" size={20} color={s.colors.textMuted} />
        <AppText>{formatDate(value)}</AppText>
      </Pressable>
      {Platform.OS === 'ios' ? (
        <BottomSheet visible={open} onClose={() => setOpen(false)} title={label ?? 'Date'}>
          {picker}
        </BottomSheet>
      ) : open ? (
        picker
      ) : null}
    </FieldFrame>
  );
}

const styles = StyleSheet.create({
  field: { gap: 4 },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderRadius: radius.card,
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    fontSize: 16,
  },
  multiline: { minHeight: 88, paddingTop: 10, textAlignVertical: 'top' },
  bare: { flex: 1, fontSize: 16, paddingVertical: 8 },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  stepBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepInput: {
    width: 56,
    height: 36,
    textAlign: 'center',
    borderWidth: 1,
    borderRadius: radius.row,
    fontSize: 16,
  },
  seg: { flexDirection: 'row', borderRadius: radius.pill, padding: 3, alignSelf: 'flex-start' },
  segItem: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: radius.pill },
  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderRadius: radius.card,
    paddingHorizontal: 12,
    minHeight: 44,
  },
  chips: { gap: 8, paddingVertical: 4 },
  chip: { paddingHorizontal: 14, paddingVertical: 6, borderRadius: radius.pill, borderWidth: 1 },
});
