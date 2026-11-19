import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useRef, useState, type ComponentRef } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import type { SetupProgress, SetupStepId } from '@/services/dashboard';
import { useTheme } from '@/theme';
import { radius } from '@/theme/tokens';
import { AppText, Button, Card, type IconName } from '@/ui';

const STEP_ICON: Record<SetupStepId, { icon: IconName; color: string }> = {
  shop_profile: { icon: 'store-edit-outline', color: '#1A5DD6' },
  first_product: { icon: 'package-variant-plus', color: '#D97706' },
  first_contact: { icon: 'account-plus-outline', color: '#7C3AED' },
  first_sale: { icon: 'cash-register', color: '#2E9E5B' },
  payment_qr: { icon: 'qrcode', color: '#0891B2' },
  online_shop: { icon: 'storefront-outline', color: '#E11D48' },
};

type Props = {
  progress: SetupProgress;
  onNavigate: (route: string) => void;
  onDismiss: () => void;
};

export function SetupProgressCard({ progress, onNavigate, onDismiss }: Props) {
  const { colors } = useTheme();
  const scrollRef = useRef<ComponentRef<typeof ScrollView>>(null);
  const [cardWidth, setCardWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  if (progress.dismissed) return null;

  const handleScrollEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    if (cardWidth <= 0) return;
    const idx = Math.round(e.nativeEvent.contentOffset.x / cardWidth);
    setActiveIndex(Math.max(0, Math.min(progress.steps.length - 1, idx)));
  };

  const scrollToStep = (index: number) => {
    setActiveIndex(index);
    if (cardWidth > 0) {
      scrollRef.current?.scrollTo({ x: index * cardWidth, animated: true });
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.headerRow}>
        <View style={styles.flex}>
          <AppText variant="secondary" muted>
            Complete these steps to set up your business
          </AppText>
          <View style={styles.progressMeta}>
            <AppText variant="secondary" bold style={{ color: colors.accent }}>
              {progress.percent}% complete
            </AppText>
            <AppText variant="label" muted>
              ({progress.completedCount}/{progress.totalCount} done)
            </AppText>
          </View>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss setup guide"
          onPress={onDismiss}
          hitSlop={8}
          style={styles.closeBtn}
        >
          <MaterialCommunityIcons name="close" size={18} color={colors.textMuted} />
        </Pressable>
      </View>

      <View style={[styles.track, { backgroundColor: colors.surfaceMuted }]}>
        <View
          style={[
            styles.fill,
            {
              backgroundColor: progress.allDone ? colors.success : colors.primary,
              width: `${progress.percent}%`,
            },
          ]}
        />
      </View>

      <View
        style={styles.carouselWrap}
        onLayout={(e) => {
          const w = Math.floor(e.nativeEvent.layout.width);
          if (w > 0 && w !== cardWidth) setCardWidth(w);
        }}
      >
        <ScrollView
          ref={scrollRef}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          onMomentumScrollEnd={handleScrollEnd}
          scrollEventThrottle={16}
        >
          {progress.steps.map((step) => {
            const meta = STEP_ICON[step.id];
            return (
              <View
                key={step.id}
                style={[
                  styles.slide,
                  {
                    width: cardWidth > 0 ? cardWidth : 280,
                    backgroundColor: colors.surfaceMuted,
                  },
                ]}
              >
                <View
                  style={[
                    styles.iconBox,
                    {
                      backgroundColor: step.completed
                        ? colors.success + '22'
                        : meta.color + '20',
                    },
                  ]}
                >
                  <MaterialCommunityIcons
                    name={step.completed ? 'check-circle' : meta.icon}
                    size={28}
                    color={step.completed ? colors.success : meta.color}
                  />
                </View>

                <View style={styles.slideBody}>
                  <AppText bold numberOfLines={1}>
                    {step.title}
                  </AppText>
                  <AppText variant="label" muted numberOfLines={2}>
                    {step.description}
                  </AppText>
                  <View style={styles.ctaRow}>
                    <Button
                      label={step.ctaLabel}
                      variant={step.completed ? 'outline' : 'primary'}
                      onPress={() => onNavigate(step.route)}
                      style={styles.ctaBtn}
                    />
                  </View>
                </View>
              </View>
            );
          })}
        </ScrollView>
      </View>

      <View style={styles.dots}>
        {progress.steps.map((step, i) => {
          const active = i === activeIndex;
          return (
            <Pressable
              key={step.id}
              accessibilityRole="button"
              accessibilityLabel={`Step ${i + 1}: ${step.title}`}
              onPress={() => scrollToStep(i)}
              hitSlop={6}
              style={[
                styles.dot,
                {
                  backgroundColor: active
                    ? colors.primary
                    : step.completed
                      ? colors.success
                      : colors.border,
                  width: active ? 18 : 7,
                },
              ]}
            />
          );
        })}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { gap: 10 },
  headerRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  flex: { flex: 1, gap: 2 },
  progressMeta: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  closeBtn: { padding: 2 },
  track: { height: 6, borderRadius: 3, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 3 },
  carouselWrap: { width: '100%', overflow: 'hidden', borderRadius: radius.card },
  slide: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 12,
    borderRadius: radius.card,
    gap: 12,
  },
  iconBox: {
    width: 52,
    height: 52,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slideBody: { flex: 1, gap: 4 },
  ctaRow: { flexDirection: 'row', marginTop: 4 },
  ctaBtn: { minHeight: 34, paddingHorizontal: 14, paddingVertical: 4 },
  dots: { flexDirection: 'row', justifyContent: 'center', alignItems: 'center', gap: 6 },
  dot: { height: 7, borderRadius: 4 },
});
