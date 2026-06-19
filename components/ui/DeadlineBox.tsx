import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT, SPACING, WEIGHT } from '../../lib/theme';
import { formatDateShort, formatDeadlineDetail, formatScheduleBadge } from '../../lib/format';
import { ClockIcon } from './icons';

// 한 줄 인라인. 신청 시작/마감을 함께 고려:
//   신청 시작 전 → accent "신청 D-N · M/D부터"
//   신청 중      → urgent(<=3d) danger / 여유 textSecondary "마감 D-N · M/D 까지"
//   마감 후      → textTertiary "마감됨 · M/D"
export function DeadlineBox({ applyStartAt, deadlineAt }: { applyStartAt: string | null; deadlineAt: string | null }) {
  const badge = formatScheduleBadge(applyStartAt, deadlineAt);
  if (!badge) return null;

  // 신청 시작 전: 시작 안내 (accent)
  if (badge.kind === 'upcoming') {
    const md = formatDateShort(applyStartAt);
    const text = badge.label === '신청 시작'
      ? `오늘 신청 시작 · ${md}`
      : `${badge.label} · ${md}부터`;
    return (
      <View style={styles.row}>
        <ClockIcon size={16} color={COLORS.accentText} />
        <Text style={[styles.text, { color: COLORS.accentText }]}>{text}</Text>
      </View>
    );
  }

  // 신청 중 / 마감 후: 마감 정보
  const dl = formatDeadlineDetail(deadlineAt);
  if (!dl) return null;
  const mdShort = formatDateShort(deadlineAt);
  const timeStr = dl.time ?? '';

  let text: string;
  let color: string;
  if (dl.dday.overdue) {
    text = `마감됨 · ${mdShort}${timeStr ? ` ${timeStr}` : ''}`;
    color = COLORS.textTertiary;
  } else {
    text = `마감 ${dl.dday.label} · ${mdShort}${timeStr ? ` ${timeStr}까지` : ''}`;
    color = dl.dday.urgent ? COLORS.danger : COLORS.textSecondary;
  }

  return (
    <View style={styles.row}>
      <ClockIcon size={16} color={color} />
      <Text style={[styles.text, { color }]}>{text}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginVertical: SPACING.sm,
  },
  text: {
    fontSize: FONT.body,
    fontWeight: WEIGHT.semibold,
    lineHeight: 24,
  },
});
