import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Switch, View } from 'react-native';
import { formatTaka } from '@/lib/money';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { AppText } from './AppText';
import type { IconName } from './icons';

export function ListRow({
  title,
  subtitle,
  left,
  right,
  onPress,
}: {
  title: string;
  subtitle?: string;
  left?: ReactNode;
  right?: ReactNode;
  onPress?: () => void;
}) {
  const { colors } = useTheme();
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={!onPress}
      style={[styles.row, { backgroundColor: colors.surface, borderColor: colors.border }]}
    >
      {left}
      <View style={styles.flex}>
        <AppText numberOfLines={1}>{title}</AppText>
        {subtitle ? (
          <AppText variant="label" muted numberOfLines={1}>
            {subtitle}
          </AppText>
        ) : null}
      </View>
      {right}
    </Pressable>
  );
}

type SettingsRowProps = {
  icon?: IconName;
  label: string;
  destructive?: boolean;
  onPress?: () => void;
} & (
  | { kind?: 'arrow' | 'chevron' }
  | { kind: 'value'; value: string }
  | { kind: 'switch'; value: boolean; onValueChange: (v: boolean) => void }
  | { kind: 'expandable'; children: ReactNode; defaultOpen?: boolean }
);

export function SettingsRow(props: SettingsRowProps) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(props.kind === 'expandable' && !!props.defaultOpen);
  const tint = props.destructive ? colors.danger : colors.accent;
  const press = props.kind === 'expandable' ? () => setOpen((o) => !o) : props.onPress;
  let trailing: ReactNode = (
    <MaterialCommunityIcons name="arrow-right" size={20} color={colors.textMuted} />
  );
  if (props.kind === 'chevron') {
    trailing = <MaterialCommunityIcons name="chevron-right" size={22} color={colors.textMuted} />;
  } else if (props.kind === 'expandable') {
    trailing = (
      <MaterialCommunityIcons
        name={open ? 'chevron-up' : 'chevron-down'}
        size={22}
        color={colors.textMuted}
      />
    );
  } else if (props.kind === 'value') {
    trailing = (
      <AppText variant="secondary" muted>
        {props.value}
      </AppText>
    );
  } else if (props.kind === 'switch') {
    trailing = (
      <Switch
        value={props.value}
        onValueChange={props.onValueChange}
        trackColor={{ true: colors.accent }}
      />
    );
  }
  return (
    <View>
      <Pressable
        accessibilityRole={props.kind === 'switch' ? 'switch' : 'button'}
        onPress={props.kind === 'switch' ? () => props.onValueChange(!props.value) : press}
        style={[styles.settings, { backgroundColor: colors.surfaceMuted }]}
      >
        {props.icon ? <MaterialCommunityIcons name={props.icon} size={22} color={tint} /> : null}
        <AppText style={[styles.flex, props.destructive && { color: colors.danger }]}>
          {props.label}
        </AppText>
        {trailing}
      </Pressable>
      {props.kind === 'expandable' && open ? (
        <View style={styles.expanded}>{props.children}</View>
      ) : null}
    </View>
  );
}

type Tone = 'auto' | 'neutral' | 'positive' | 'negative';

/** Formats paisa as ৳. `auto`: >0 green (receivable), <0 red, 0 muted. */
export function AmountText({
  paisa,
  tone = 'neutral',
  decimal = false,
  bold = true,
  variant = 'body',
}: {
  paisa: number;
  tone?: Tone;
  decimal?: boolean;
  bold?: boolean;
  variant?: 'title' | 'body' | 'secondary' | 'label';
}) {
  const { colors } = useTheme();
  const color =
    tone === 'positive'
      ? colors.success
      : tone === 'negative'
        ? colors.danger
        : tone === 'auto'
          ? paisa > 0
            ? colors.success
            : paisa < 0
              ? colors.danger
              : colors.textMuted
          : colors.text;
  return (
    <AppText variant={variant} bold={bold} style={{ color }}>
      {formatTaka(paisa, decimal)}
    </AppText>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  settings: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 14,
    borderRadius: radius.row,
  },
  expanded: { paddingLeft: 12, paddingTop: 8, gap: 8 },
});
