import { Text, type TextProps } from 'react-native';
import { fontSize } from '@/theme/tokens';
import { useTheme } from '@/theme';

type Variant = 'title' | 'body' | 'secondary' | 'label';

export function AppText({
  variant = 'body',
  muted,
  bold,
  style,
  ...rest
}: TextProps & { variant?: Variant; muted?: boolean; bold?: boolean }) {
  const { colors } = useTheme();
  return (
    <Text
      {...rest}
      style={[
        {
          fontSize: fontSize[variant],
          color: muted ? colors.textMuted : colors.text,
          fontWeight: bold || variant === 'title' ? '700' : '400',
        },
        style,
      ]}
    />
  );
}
