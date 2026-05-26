import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';

export function CategoryBadge({ topic }: { topic: string }) {
  const c = COLORS.categories[topic as keyof typeof COLORS.categories];
  const main = c?.main ?? COLORS.textSecondary;
  const soft = c?.soft ?? COLORS.surface2;
  return (
    <View style={[styles.badge, { backgroundColor: soft }]}>
      <Text style={[styles.text, { color: main }]} numberOfLines={1}>
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
    alignSelf: 'flex-start',
  },
  text: { fontSize: FONT.micro, fontWeight: WEIGHT.semibold },
});
