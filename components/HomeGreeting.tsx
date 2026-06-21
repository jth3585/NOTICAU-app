import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT, SPACING, TEXT, WEIGHT } from '../lib/theme';
import { AnimatedCount } from './ui/AnimatedCount';

// KST(UTC+9) 기준 시간대 인사
function timeGreeting(kstHour: number): string {
  if (kstHour >= 5 && kstHour < 11) return '좋은 아침이에요';
  if (kstHour >= 11 && kstHour < 17) return '좋은 오후예요';
  if (kstHour >= 17 && kstHour < 22) return '좋은 저녁이에요';
  return '늦은 시간이네요';
}

type Props = {
  nickname: string | null;
  deadlineSoonCount: number; // 마감 임박(오늘·내일) 공지 수
  newCount: number;          // 오늘 새 공지 수
};

export function HomeGreeting({ nickname, deadlineSoonCount, newCount }: Props) {
  const kstHour = (new Date().getUTCHours() + 9) % 24;
  const greeting = timeGreeting(kstHour);
  const title = nickname ? `${nickname}님, ${greeting}` : greeting;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>{title}</Text>
      {/* 보조 줄: 마감 임박 > 새 공지 > 다 봄. 숫자만 카운트업+강조 */}
      {deadlineSoonCount > 0 ? (
        <Text style={styles.sub}>
          오늘 마감인 공지 <AnimatedCount value={deadlineSoonCount} style={styles.subStrong} />건 있어요
        </Text>
      ) : newCount > 0 ? (
        <Text style={styles.sub}>
          오늘 새 공지 <AnimatedCount value={newCount} style={styles.subStrong} />건이에요
        </Text>
      ) : (
        <Text style={styles.sub}>모든 공지를 확인했어요</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: SPACING.lg, paddingTop: SPACING.lg, paddingBottom: SPACING.xl },
  title: { ...TEXT.pageTitle, lineHeight: 34 },
  sub: { fontSize: FONT.body, color: COLORS.textSecondary, marginTop: SPACING.sm },
  subStrong: { fontWeight: WEIGHT.bold, color: COLORS.textSecondary, fontVariant: ['tabular-nums'] },
});
