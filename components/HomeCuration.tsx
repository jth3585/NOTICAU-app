import { ActivityIndicator, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Notice } from '../lib/types';
import { NoticeCard } from './NoticeCard';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';

const CARD_W = 280;

type Props = {
  notices: Notice[];
  loadingMore: boolean;
  allSeen: boolean;
  onLoadMore: () => void;
  onPressNotice: (n: Notice) => void;
  isNew: (postedAt: string | null) => boolean;
};

export function HomeCuration({ notices, loadingMore, allSeen, onLoadMore, onPressNotice, isNew }: Props) {
  return (
    <View style={styles.section}>
      <Text style={styles.label}>AI 큐레이션</Text>

      {allSeen ? (
        <View style={styles.doneCard}>
          <Text style={styles.doneTitle}>오늘 다 확인했어요 ✨</Text>
          <Text style={styles.doneSub}>매일 새 추천이 준비돼요</Text>
          <TouchableOpacity style={styles.moreBtn} onPress={onLoadMore} disabled={loadingMore} activeOpacity={0.75}>
            {loadingMore ? <ActivityIndicator color="#fff" /> : <Text style={styles.moreBtnText}>추천 더보기</Text>}
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          horizontal
          data={notices}
          keyExtractor={(n) => n.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cards}
          renderItem={({ item }) => (
            <NoticeCard
              notice={item}
              width={CARD_W}
              isNew={isNew(item.posted_at)}
              onPress={() => onPressNotice(item)}
            />
          )}
          ListFooterComponent={
            <TouchableOpacity style={styles.moreCard} onPress={onLoadMore} disabled={loadingMore} activeOpacity={0.7}>
              {loadingMore ? <ActivityIndicator color={COLORS.accent} /> : <Text style={styles.moreCardText}>더보기 →</Text>}
            </TouchableOpacity>
          }
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { paddingTop: SPACING.md },
  label: {
    fontSize: FONT.caption, fontWeight: WEIGHT.bold, color: COLORS.textTertiary,
    textTransform: 'uppercase', letterSpacing: 0.8,
    paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md,
  },
  cards: { paddingLeft: SPACING.lg, paddingRight: SPACING.md, paddingBottom: SPACING.sm },
  moreCard: {
    width: 110,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  moreCardText: { fontSize: FONT.body, color: COLORS.accentText, fontWeight: WEIGHT.semibold },
  doneCard: {
    marginHorizontal: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.xl,
    alignItems: 'center',
    gap: SPACING.xs,
  },
  doneTitle: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text },
  doneSub: { fontSize: FONT.caption, color: COLORS.textSecondary },
  moreBtn: {
    marginTop: SPACING.sm,
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.xl,
    minWidth: 140,
    alignItems: 'center',
  },
  moreBtnText: { fontSize: FONT.body, fontWeight: WEIGHT.bold, color: '#fff' },
});
