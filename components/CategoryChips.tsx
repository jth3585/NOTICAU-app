import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';

// 가로 스크롤 단일선택 칩 (pill). 선택=filled, 비선택=outlined.
// InboxScreen에서 FlatList sticky ListHeaderComponent → 배경 불투명 필요.
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
  row: { backgroundColor: COLORS.bg },
  content: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.xs, // 칩 자체 패딩과 이중되지 않게 얇게 (필터 줄 슬림)
    gap: SPACING.sm,
  },
  chip: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md + 2,
    paddingVertical: SPACING.sm,
    borderWidth: 1,
  },
  chipActive: { backgroundColor: COLORS.text, borderColor: COLORS.text },
  chipInactive: { backgroundColor: 'transparent', borderColor: COLORS.border },
  label: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold },
  labelActive: { color: COLORS.bg },
  labelInactive: { color: COLORS.textSecondary },
});
