import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import Animated, { FadeInDown } from 'react-native-reanimated';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';

// 빈 화면 공통 컴포넌트: 동심원 링 + 그라디언트 헤일로 위 아이콘 → 일러스트 톤.
// 제목(+보조문구) + (선택)액션 버튼. 자체 아이콘 시스템을 그대로 써서 브랜드 톤 유지.
export function EmptyState({
  icon,
  title,
  subtitle,
  actionLabel,
  onAction,
}: {
  icon: ReactNode;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <Animated.View style={styles.wrap} entering={FadeInDown.duration(400)}>
      <View style={styles.illust}>
        {/* 동심원 링 (은은한 브랜드 색) */}
        <View style={[styles.ring, styles.ringOuter]} />
        <View style={[styles.ring, styles.ringInner]} />
        {/* 그라디언트 헤일로 + 아이콘 */}
        <LinearGradient
          colors={[COLORS.accentSoft, COLORS.surface]}
          start={{ x: 0.2, y: 0 }}
          end={{ x: 0.8, y: 1 }}
          style={styles.halo}
        >
          {icon}
        </LinearGradient>
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity style={styles.action} onPress={onAction} activeOpacity={0.8}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </Animated.View>
  );
}

const RING = 'rgba(74,144,226,0.13)'; // accent 저투명 링

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl, paddingVertical: SPACING.xxl },
  illust: { width: 128, height: 128, alignItems: 'center', justifyContent: 'center', marginBottom: SPACING.lg },
  ring: { position: 'absolute', borderRadius: 999, borderWidth: 1, borderColor: RING },
  ringOuter: { width: 128, height: 128 },
  ringInner: { width: 100, height: 100 },
  halo: {
    width: 76, height: 76, borderRadius: 38,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: COLORS.accent, shadowOpacity: 0.18, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  title: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text, textAlign: 'center' },
  subtitle: { fontSize: FONT.caption, color: COLORS.textSecondary, textAlign: 'center', marginTop: SPACING.xs, lineHeight: 19 },
  action: {
    marginTop: SPACING.lg,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.pill,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.xl,
  },
  actionText: { fontSize: FONT.caption, fontWeight: WEIGHT.bold, color: '#fff' },
});
