import { StyleSheet, Text } from 'react-native';
import { COLORS, FONT, WEIGHT } from '../../lib/theme';
import { formatDeadlineDetail } from '../../lib/format';
import { InfoBox } from './InfoBox';

// deadlineAt(ISO) → "마감 D-N HH:MM까지" + "YYYY-MM-DD HH:MM". 없으면 null.
export function DeadlineBox({ deadlineAt }: { deadlineAt: string | null }) {
  const dl = formatDeadlineDetail(deadlineAt);
  if (!dl) return null;
  const main = dl.dday.overdue
    ? '마감됨'
    : `마감 ${dl.dday.label}${dl.time ? ` ${dl.time}까지` : ''}`;
  return (
    <InfoBox tone="danger">
      <Text style={styles.main}>{main}</Text>
      <Text style={styles.abs}>{dl.abs}</Text>
    </InfoBox>
  );
}

const styles = StyleSheet.create({
  main: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.danger },
  abs: { fontSize: FONT.caption, color: COLORS.textSecondary, marginTop: 2 },
});
