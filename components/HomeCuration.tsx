import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import Animated, { FadeIn, FadeInDown } from 'react-native-reanimated';
import type { Notice } from '../lib/types';
import { NoticeCard } from './NoticeCard';
import { COLORS, FONT, RADIUS, SPACING, TEXT, WEIGHT } from '../lib/theme';
import { SparkleIcon } from './ui/SparkleIcon';
import { ChevronRightIcon } from './ui/icons';
import { Celebration } from './ui/Celebration';

type Props = {
  notices: Notice[];
  allSeen: boolean;
  onGoToAll: () => void;        // 전체 공지 탭으로 이동
  onPressNotice: (n: Notice) => void;
  isNew: (postedAt: string | null) => boolean;
};

export function HomeCuration({ notices, allSeen, onGoToAll, onPressNotice, isNew }: Props) {
  return (
    <View style={styles.section}>
      <View style={styles.labelRow}>
        <SparkleIcon size={13} color={COLORS.accent} />
        <Text style={styles.label}>AI 큐레이션</Text>
      </View>

      {allSeen ? (
        <Animated.View style={styles.doneCard} entering={FadeIn.duration(360)}>
          <Celebration />
          <View style={styles.doneTitleRow}>
            <Text style={styles.doneTitle}>오늘 추천 공지를 다 읽었어요</Text>
            <SparkleIcon size={16} color={COLORS.accent} />
          </View>
          <Text style={styles.doneSub}>전체 공지에서 더 둘러보세요</Text>
          <TouchableOpacity style={styles.moreBtn} onPress={onGoToAll} activeOpacity={0.75}>
            <Text style={styles.moreBtnText}>전체 공지 보기</Text>
            <ChevronRightIcon size={16} color="#fff" />
          </TouchableOpacity>
        </Animated.View>
      ) : (
        <View>
          {notices.map((item, i) => (
            <Animated.View key={item.id} entering={FadeInDown.duration(320).delay(i * 55)}>
              <NoticeCard
                notice={item}
                isNew={isNew(item.posted_at)}
                onPress={() => onPressNotice(item)}
              />
            </Animated.View>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: SPACING.xl },
  labelRow: {
    flexDirection: 'row', alignItems: 'center', gap: SPACING.xs,
    paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg,
  },
  label: { ...TEXT.sectionLabel },
  doneCard: {
    marginHorizontal: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.xl,
    alignItems: 'center',
    gap: SPACING.xs,
  },
  doneTitleRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  doneTitle: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
  doneSub: { fontSize: FONT.caption, color: COLORS.textSecondary },
  moreBtn: {
    marginTop: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.xl,
    minWidth: 140,
    justifyContent: 'center',
  },
  moreBtnText: { fontSize: FONT.body, fontWeight: WEIGHT.bold, color: '#fff' },
});
