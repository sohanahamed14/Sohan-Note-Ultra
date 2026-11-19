import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Image, StyleSheet, View } from 'react-native';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';

export function ProductThumb({
  uri,
  size = 48,
}: {
  uri?: string | null;
  size?: number;
}) {
  const { colors } = useTheme();
  if (uri) {
    return (
      <Image
        source={{ uri }}
        style={[
          styles.img,
          { width: size, height: size, borderColor: colors.border, backgroundColor: colors.surfaceMuted },
        ]}
        resizeMode="cover"
      />
    );
  }
  return (
    <View
      style={[
        styles.placeholder,
        {
          width: size,
          height: size,
          backgroundColor: colors.primarySoft,
          borderColor: colors.border,
        },
      ]}
    >
      <MaterialCommunityIcons
        name="package-variant-closed"
        size={Math.round(size * 0.5)}
        color={colors.onPrimary}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  img: { borderRadius: radius.card, borderWidth: 1 },
  placeholder: {
    borderRadius: radius.card,
    borderWidth: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
