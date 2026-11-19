import type { ReactNode } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { MAX_WIDTH } from '@/theme/tokens';

type Props = {
  header?: ReactNode;
  children: ReactNode;
  /** Wrap body in a ScrollView (default true). Use false when body is a FlatList. */
  scroll?: boolean;
  /** Body padding 16 (default true). */
  padded?: boolean;
  /** Absolutely positioned overlay (e.g. Fab). */
  overlay?: ReactNode;
};

export function Screen({ header, children, scroll = true, padded = true, overlay }: Props) {
  const { colors } = useTheme();
  const pad = padded ? styles.padded : null;
  return (
    <KeyboardAvoidingView
      style={[styles.root, { backgroundColor: colors.bg }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      {header}
      <View style={styles.body}>
        {scroll ? (
          <ScrollView
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={[styles.content, pad]}
          >
            {children}
          </ScrollView>
        ) : (
          <View style={[styles.content, styles.flex, pad]}>{children}</View>
        )}
        {overlay}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  flex: { flex: 1 },
  body: { flex: 1, width: '100%', maxWidth: MAX_WIDTH, alignSelf: 'center' },
  content: { flexGrow: 1, gap: 12 },
  padded: { padding: 16 },
});
