import { useState } from 'react';
import { Dimensions, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Notice, UserKeyword } from '../lib/types';
import { type HomeTab, firstMatchedKeyword } from '../lib/homeFeed';
import { NoticeCard } from './NoticeCard';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';

const TABS: { key: HomeTab; label: string }[] = [
  { key: 'new', label: '새공지' },
  { key: 'keyword', label: '키워드매치' },
  { key: 'deadline', label: '오늘마감' },
];

// 원안 비율: 카드 1개 + 다음 카드 살짝 걸침 (화면 너비의 ~80%), 세로로 길게.
const CARD_W = Math.round(Dimensions.get('window').width * 0.8);
const CARD_MIN_H = 172;

type Props = {
  newList: Notice[];
  keywordList: Notice[];
  deadlineList: Notice[];
  keywords: UserKeyword[];
  onPressNotice: (n: Notice) => void;
};

export function HomeFilterTabs({ newList, keywordList, deadlineList, keywords, onPressNotice }: Props) {
  const [tab, setTab] = useState<HomeTab>('new');

  const list = tab === 'new' ? newList : tab === 'keyword' ? keywordList : deadlineList;
  const emptyText =
    tab === 'new' ? '최근 24시간 내 새 공지가 없어요'
    : tab === 'keyword' ? '최근 24시간 내 키워드 매칭 공지가 없어요'
    : '24시간 내 마감인 공지가 없어요';

  return (
    <View>
      <View style={styles.tabs}>
        {TABS.map((t) => {
          const active = t.key === tab;
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, active && styles.tabActive]}
              onPress={() => setTab(t.key)}
              activeOpacity={0.7}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {list.length === 0 ? (
        <View style={styles.empty}>
          <Text style={styles.emptyText}>{emptyText}</Text>
        </View>
      ) : (
        <FlatList
          horizontal
          data={list}
          keyExtractor={(n) => n.id}
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.cards}
          renderItem={({ item }) => (
            <NoticeCard
              notice={item}
              width={CARD_W}
              minHeight={CARD_MIN_H}
              titleLines={3}
              keywordTag={tab === 'keyword' ? (firstMatchedKeyword(item, keywords) ?? undefined) : undefined}
              onPress={() => onPressNotice(item)}
            />
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md },
  tab: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.surface,
  },
  tabActive: { backgroundColor: COLORS.accent },
  tabText: { fontSize: FONT.caption, color: COLORS.textSecondary, fontWeight: WEIGHT.semibold },
  tabTextActive: { color: '#fff' },
  cards: { paddingLeft: SPACING.lg, paddingRight: SPACING.md, paddingBottom: SPACING.sm },
  empty: {
    marginHorizontal: SPACING.lg,
    paddingVertical: SPACING.xl,
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
  },
  emptyText: { fontSize: FONT.body, color: COLORS.textSecondary },
});
