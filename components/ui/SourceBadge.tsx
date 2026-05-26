import { StyleSheet, Text } from 'react-native';
import { COLORS, FONT } from '../../lib/theme';
import { sourceLabel } from '../../lib/constants';

// "본교 / 경영대 / 경영학부" 작은 라벨 (배경 없음)
export function SourceBadge({ parserKey }: { parserKey: string | null }) {
  const label = sourceLabel(parserKey);
  if (!label) return null;
  return <Text style={styles.text}>{label}</Text>;
}

const styles = StyleSheet.create({
  text: { fontSize: FONT.caption, color: COLORS.textSecondary },
});
