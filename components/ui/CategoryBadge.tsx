import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';

export function CategoryBadge({ topic, size = 'sm' }: { topic: string; size?: 'sm' | 'md' }) {
  const c = COLORS.categories[topic as keyof typeof COLORS.categories];
  const main = c?.main ?? COLORS.textSecondary;
  const soft = c?.soft ?? COLORS.surface2;
  return (
    <View style={[styles.badge, size === 'md' && styles.badgeMd, { backgroundColor: soft }]}>
      <Text style={[styles.text, size === 'md' && styles.textMd, { color: main }]} numberOfLines={1}>
        {topic}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    borderRadius: RADIUS.badge,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
  },
  badgeMd: {
    paddingVertical: SPACING.sm - 2,
    paddingHorizontal: SPACING.md,
    borderRadius: RADIUS.box,
  },
  text: { fontSize: FONT.micro, lineHeight: 14, fontWeight: WEIGHT.semibold, includeFontPadding: false },
  // md는 fontSize가 커지므로 lineHeight도 함께 키워야 위쪽 글자가 잘리지 않음
  textMd: { fontSize: FONT.body, lineHeight: FONT.body + 6 },
});
