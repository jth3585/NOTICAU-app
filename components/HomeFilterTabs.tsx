import { useState } from 'react';
import { Dimensions, FlatList, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { Notice, UserKeyword } from '../lib/types';
import { type HomeTab, firstMatchedKeyword } from '../lib/homeFeed';
import { NoticeCard } from './NoticeCard';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';

const TABS: { key: HomeTab; label: string }[] = [
  { key: 'new', label: '새공지' },
  { key: 'keyword', label: '키워드매치' },
  { key: 'deadline', label: '오늘마감' },
];

// 레퍼런스 비율: 좁고 세로로 긴 포트레이트 카드. 다음 카드가 우측에 크게 걸쳐 가로 스크롤 암시.
const CARD_W = Math.round(Dimensions.get('window').width * 0.62);
const CARD_MIN_H = Math.round(CARD_W * 1.08); // 세로로 긴 비율

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
          if (active) {
            return (
              <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} activeOpacity={0.85}>
                <LinearGradient
                  colors={COLORS.accentGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}
                  style={styles.tab}
                >
                  <Text style={[styles.tabText, styles.tabTextActive]}>{t.label}</Text>
                </LinearGradient>
              </TouchableOpacity>
            );
          }
          return (
            <TouchableOpacity
              key={t.key}
              style={[styles.tab, styles.tabInactive]}
              onPress={() => setTab(t.key)}
              activeOpacity={0.7}
            >
              <Text style={styles.tabText}>{t.label}</Text>
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
              titleLines={4}
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
  tabs: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.lg },
  tab: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  tabInactive: { backgroundColor: COLORS.surface },
  tabText: { fontSize: FONT.body, color: COLORS.text, fontWeight: WEIGHT.semibold },
  tabTextActive: { color: '#fff', fontWeight: WEIGHT.bold },
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
