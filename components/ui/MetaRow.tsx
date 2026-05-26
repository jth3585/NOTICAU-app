import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT, SPACING } from '../../lib/theme';

// 가로 라벨+값 (표 대체)
export function MetaRow({ label, value }: { label: string; value: string | ReactNode }) {
  return (
    <View style={styles.row}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.value}>
        {typeof value === 'string' ? <Text style={styles.valueText}>{value}</Text> : value}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', marginVertical: SPACING.xs },
  label: { width: 80, fontSize: FONT.caption, color: COLORS.textSecondary },
  value: { flex: 1 },
  valueText: { fontSize: FONT.body, color: COLORS.text },
});
