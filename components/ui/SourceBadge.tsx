import { StyleSheet, Text } from 'react-native';
import { COLORS, FONT } from '../../lib/theme';

// "본교 / 경영경제대학 / 경영학부" 조용한 메타 라벨 (배경 없음).
// 표시 이름은 DB sources.name(공지에 조인돼 옴)을 그대로 쓴다 → 새 출처도 재빌드 없이 표시됨.
// name이 없을 때만 parser_key 원문으로 폴백.
export function SourceBadge({ name, parserKey }: { name?: string | null; parserKey?: string | null }) {
  const label = name || parserKey || '';
  if (!label) return null;
  return <Text style={styles.text}>{label}</Text>;
}

const styles = StyleSheet.create({
  text: { fontSize: FONT.micro, lineHeight: 14, color: COLORS.textTertiary, includeFontPadding: false },
});
