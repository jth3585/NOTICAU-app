import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT, RADIUS, SPACING } from '../lib/constants';

// topic: 옅은 배경 pill (카테고리 배지)
// source: 배경 없는 dim 라벨 (출처 표기)
export function Badge({
  label,
  variant = 'topic',
}: {
  label: string;
  variant?: 'topic' | 'source';
}) {
  const isSource = variant === 'source';
  return (
    <View style={[styles.base, isSource ? styles.source : styles.topic]}>
      <Text style={[styles.text, isSource && styles.sourceText]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  base: {
    borderRadius: RADIUS.badge,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  topic: {
    backgroundColor: COLORS.badgeBg,
  },
  source: {
    backgroundColor: 'transparent',
    paddingHorizontal: 0,
  },
  text: {
    fontSize: FONT.badge,
    color: COLORS.text,
  },
  sourceText: {
    color: COLORS.textDim,
  },
});
