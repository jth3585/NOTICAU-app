import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { COLORS, FONT, RADIUS, SPACING } from '../lib/constants';

// 가로 스크롤 단일선택 칩. 선택=filled, 비선택=outlined.
// InboxScreen에서 FlatList의 sticky ListHeaderComponent로 사용 → 배경 불투명 필요.
export function CategoryChips({
  topics,
  selected,
  onSelect,
}: {
  topics: readonly string[];
  selected: string;
  onSelect: (topic: string) => void;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={styles.row}
      contentContainerStyle={styles.content}
    >
      {topics.map((t) => {
        const active = t === selected;
        return (
          <TouchableOpacity
            key={t}
            onPress={() => onSelect(t)}
            activeOpacity={0.7}
            style={[styles.chip, active ? styles.chipActive : styles.chipInactive]}
          >
            <Text style={[styles.label, active ? styles.labelActive : styles.labelInactive]}>
              {t}
            </Text>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  row: {
    backgroundColor: COLORS.bg, // sticky 시 뒤 콘텐츠 비침 방지
  },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    gap: SPACING.sm,
  },
  chip: {
    borderRadius: RADIUS.badge,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 2,
    borderWidth: 1,
  },
  chipActive: {
    backgroundColor: COLORS.text,
    borderColor: COLORS.text,
  },
  chipInactive: {
    backgroundColor: 'transparent',
    borderColor: COLORS.badgeBg,
  },
  label: {
    fontSize: FONT.meta,
  },
  labelActive: {
    color: COLORS.bg,
  },
  labelInactive: {
    color: COLORS.textDim,
  },
});
