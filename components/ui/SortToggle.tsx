import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS, FONT, SPACING, WEIGHT } from '../../lib/theme';
import type { SortMode } from '../../lib/format';

const OPTIONS: ReadonlyArray<readonly [SortMode, string]> = [
  ['deadline', '마감일순'],
  ['posted', '등록일순'],
];

export function SortToggle({ mode, onChange }: { mode: SortMode; onChange: (m: SortMode) => void }) {
  return (
    <View style={styles.row}>
      {OPTIONS.map(([key, label]) => {
        const active = mode === key;
        return (
          <TouchableOpacity key={key} onPress={() => onChange(key)} activeOpacity={0.7}>
            <Text style={[styles.label, active ? styles.active : styles.inactive]}>{label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
  },
  label: { fontSize: FONT.caption, paddingVertical: SPACING.xs },
  active: { color: COLORS.accent, fontWeight: WEIGHT.bold },
  inactive: { color: COLORS.textTertiary, fontWeight: WEIGHT.semibold },
});
