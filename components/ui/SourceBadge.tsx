import { StyleSheet, Text } from 'react-native';
import { COLORS, FONT } from '../../lib/theme';
import { sourceLabel } from '../../lib/constants';

// "본교 / 경영대 / 경영학부" 조용한 메타 라벨 (배경 없음).
// 카테고리 배지(11px 색칩)가 주인공 → 출처는 더 작고 옅게(11px, tertiary).
export function SourceBadge({ parserKey }: { parserKey: string | null }) {
  const label = sourceLabel(parserKey);
  if (!label) return null;
  return <Text style={styles.text}>{label}</Text>;
}

const styles = StyleSheet.create({
  text: { fontSize: FONT.micro, lineHeight: 14, color: COLORS.textTertiary, includeFontPadding: false },
});
