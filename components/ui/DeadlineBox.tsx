import { StyleSheet, Text } from 'react-native';
import { COLORS, FONT, SPACING, WEIGHT } from '../../lib/theme';
import { formatDateShort, formatDeadlineDetail } from '../../lib/format';

// 한 줄 인라인. 색 위계:
//   overdue → textTertiary "마감됨 · M/D"
//   urgent(<=3d) → danger
//   여유(4d+) → textSecondary (덜 강조 — 페이지 지배 안 함)
export function DeadlineBox({ deadlineAt }: { deadlineAt: string | null }) {
  const dl = formatDeadlineDetail(deadlineAt);
  if (!dl) return null;

  const mdShort = formatDateShort(deadlineAt);
  const timeStr = dl.time ?? '';

  let text: string;
  let color: string;
  if (dl.dday.overdue) {
    text = `🕒 마감됨 · ${mdShort}${timeStr ? ` ${timeStr}` : ''}`;
    color = COLORS.textTertiary;
  } else {
    text = `🕒 마감 ${dl.dday.label} · ${mdShort}${timeStr ? ` ${timeStr}까지` : ''}`;
    color = dl.dday.urgent ? COLORS.danger : COLORS.textSecondary;
  }

  return <Text style={[styles.text, { color }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  text: {
    fontSize: FONT.body,
    fontWeight: WEIGHT.semibold,
    lineHeight: 24, // 🕒 이모지 잘림 방지
    marginVertical: SPACING.sm,
  },
});
