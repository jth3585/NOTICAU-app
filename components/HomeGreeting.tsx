import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { COLORS, FONT, SPACING, TEXT, WEIGHT } from '../lib/theme';
import { AnimatedCount } from './ui/AnimatedCount';
import { BellIcon } from './ui/icons';

// KST(UTC+9) 기준 시간대 인사
function timeGreeting(kstHour: number): string {
  if (kstHour >= 5 && kstHour < 11) return '좋은 아침이에요';
  if (kstHour >= 11 && kstHour < 17) return '좋은 오후예요';
  if (kstHour >= 17 && kstHour < 22) return '좋은 저녁이에요';
  return '오늘도 수고했어요';
}

type Props = {
  nickname: string | null;
  deadlineSoonCount: number; // 마감 임박(오늘·내일) 공지 수
  newCount: number;          // 오늘 새 공지 수
  hasUnreadNotifications?: boolean; // 🔔 빨간 점
  onPressNotifications?: () => void; // 🔔 → 알림함
};

export function HomeGreeting({
  nickname, deadlineSoonCount, newCount, hasUnreadNotifications = false, onPressNotifications,
}: Props) {
  const kstHour = (new Date().getUTCHours() + 9) % 24;
  const greeting = timeGreeting(kstHour);
  const title = nickname ? `${nickname}님, ${greeting}` : greeting;

  return (
    <View style={styles.wrap}>
      {/* 제목 줄: 인사말 + 우측 🔔 알림함(안 읽은 알림 있으면 빨간 점) */}
      <View style={styles.titleRow}>
        <Text style={styles.title}>{title}</Text>
        {onPressNotifications ? (
          <TouchableOpacity
            onPress={onPressNotifications}
            hitSlop={10}
            activeOpacity={0.6}
            style={styles.bellBtn}
            accessibilityRole="button"
            accessibilityLabel={hasUnreadNotifications ? '알림, 읽지 않은 알림 있음' : '알림'}
          >
            <BellIcon size={24} color={COLORS.text} />
            {hasUnreadNotifications ? <View style={styles.bellDot} /> : null}
          </TouchableOpacity>
        ) : null}
      </View>
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
  // 긴 닉네임은 제목이 줄바꿈되고 벨은 첫 줄 높이에 맞춰 우측 상단에 고정
  titleRow: { flexDirection: 'row', alignItems: 'flex-start', gap: SPACING.md },
  title: { ...TEXT.pageTitle, lineHeight: 34, flex: 1 },
  bellBtn: { height: 34, justifyContent: 'center', paddingHorizontal: 2 },
  bellDot: {
    position: 'absolute', top: 5, right: 1, width: 8, height: 8, borderRadius: 4,
    backgroundColor: COLORS.danger, borderWidth: 1.5, borderColor: COLORS.bg,
  },
  sub: { fontSize: FONT.body, color: COLORS.textSecondary, marginTop: SPACING.sm },
  subStrong: { fontWeight: WEIGHT.bold, color: COLORS.textSecondary, fontVariant: ['tabular-nums'] },
});
