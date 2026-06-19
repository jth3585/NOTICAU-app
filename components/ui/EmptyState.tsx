import type { ReactNode } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { MotiView } from 'moti';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';

// 빈 화면 공통 컴포넌트: 크고 흐린 아이콘 + 제목(+보조문구) + (선택)액션 버튼.
// 자체 아이콘 시스템을 그대로 써서 브랜드 톤 유지.
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
    <MotiView
      style={styles.wrap}
      from={{ opacity: 0, translateY: 10 }}
      animate={{ opacity: 1, translateY: 0 }}
      transition={{ type: 'timing', duration: 400 }}
    >
      <View style={styles.iconBox}>{icon}</View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <TouchableOpacity style={styles.action} onPress={onAction} activeOpacity={0.8}>
          <Text style={styles.actionText}>{actionLabel}</Text>
        </TouchableOpacity>
      ) : null}
    </MotiView>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', justifyContent: 'center', paddingHorizontal: SPACING.xl, paddingVertical: SPACING.xxl },
  iconBox: {
    width: 76, height: 76, borderRadius: 38,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: COLORS.surface2,
    marginBottom: SPACING.lg,
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
