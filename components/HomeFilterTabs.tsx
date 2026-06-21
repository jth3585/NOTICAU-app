import { useCallback, useEffect, useState } from 'react';
import { Dimensions, FlatList, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { LinearGradient } from 'expo-linear-gradient';
import type { Notice, UserKeyword } from '../lib/types';
import { type HomeTab, firstMatchedKeyword } from '../lib/homeFeed';
import { matchKeyword } from '../lib/matching';
import { metaOf, formatTimeRemaining } from '../lib/format';
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
  onManageKeywords: () => void; // 키워드 관리 화면으로 (칩 추가 / 빈 상태 CTA)
  initialTab?: HomeTab | null; // 알림 딥링크로 강제 선택할 탭
};

export function HomeFilterTabs({ newList, keywordList, deadlineList, keywords, onPressNotice, onManageKeywords, initialTab }: Props) {
  // 키워드매치 탭의 키워드 칩 필터 (null = 전체)
  const [kwFilter, setKwFilter] = useState<string | null>(null);
  // 공지가 있는 탭 우선 (새공지 → 키워드매치 → 오늘마감). 없으면 null.
  const firstNonEmpty = (): HomeTab | null =>
    newList.length ? 'new' : keywordList.length ? 'keyword' : deadlineList.length ? 'deadline' : null;

  // 초기 선택: 딥링크 지정 탭 > 공지 있는 첫 탭
  const [tab, setTab] = useState<HomeTab>(() => initialTab ?? firstNonEmpty() ?? 'new');

  // 딥링크로 탭이 지정되면(워밍 상태 포함) 해당 탭으로 전환
  useEffect(() => {
    if (initialTab) setTab(initialTab);
  }, [initialTab]);

  // 홈 재진입(앱 시작·다른 탭에서 복귀) 시, 현재 탭이 비어 있으면 공지 있는 탭으로 점프.
  useFocusEffect(useCallback(() => {
    setTab((prev) => {
      const curLen = prev === 'new' ? newList.length : prev === 'keyword' ? keywordList.length : deadlineList.length;
      if (curLen > 0) return prev;
      return firstNonEmpty() ?? prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newList, keywordList, deadlineList]));

  // 오늘마감 탭에서 남은 시간 실시간 갱신 (30초마다 재계산). 분 표시라 30초면 충분.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (tab !== 'deadline') return;
    const id = setInterval(() => setTick((t) => t + 1), 30000);
    return () => clearInterval(id);
  }, [tab]);

  // 키워드매치: 특정 키워드 칩 선택 시 그 키워드로 필터
  const keywordVisible = kwFilter === null
    ? keywordList
    : keywordList.filter((n) => matchKeyword(`${n.title} ${n.body_text ?? ''}`.toLowerCase(), kwFilter));
  const list = tab === 'new' ? newList : tab === 'keyword' ? keywordVisible : deadlineList;
  const emptyText =
    tab === 'new' ? '최근 24시간 내 새 공지가 없어요'
    : tab === 'keyword' ? (kwFilter ? `'${kwFilter}' 매칭 공지가 없어요` : '최근 24시간 내 키워드 매칭 공지가 없어요')
    : '24시간 내 마감인 공지가 없어요';

  return (
    <View>
      <View style={styles.tabs}>
        {TABS.map((t) => {
          const active = t.key === tab;
          if (active) {
            return (
              <TouchableOpacity key={t.key} onPress={() => setTab(t.key)} activeOpacity={0.85} accessibilityRole="button" accessibilityState={{ selected: true }} accessibilityLabel={t.label}>
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
              accessibilityRole="button"
              accessibilityState={{ selected: false }}
              accessibilityLabel={t.label}
            >
              <Text style={styles.tabText}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {tab === 'keyword' && keywords.length === 0 ? (
        // 등록된 키워드가 아예 없을 때 — 추가 유도
        <View style={styles.empty}>
          <Text style={styles.emptyText}>관심 키워드를 추가하면 매칭 공지를 모아드려요</Text>
          <TouchableOpacity style={styles.ctaBtn} onPress={onManageKeywords} activeOpacity={0.85} accessibilityRole="button" accessibilityLabel="키워드 추가하러 가기">
            <Text style={styles.ctaText}>키워드 추가하러 가기</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <>
          {tab === 'keyword' ? (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.kwChips}>
              <KwChip label="전체" active={kwFilter === null} onPress={() => setKwFilter(null)} />
              {keywords.map((k) => (
                <KwChip key={k.keyword} label={k.keyword} active={kwFilter === k.keyword} onPress={() => setKwFilter(k.keyword)} />
              ))}
              <TouchableOpacity style={styles.addChip} onPress={onManageKeywords} activeOpacity={0.7} accessibilityRole="button" accessibilityLabel="키워드 추가">
                <Text style={styles.addChipText}>＋ 키워드</Text>
              </TouchableOpacity>
            </ScrollView>
          ) : null}

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
                  countdown={tab === 'deadline' ? (formatTimeRemaining(metaOf(item)?.deadline_at ?? null) ?? undefined) : undefined}
                  onPress={() => onPressNotice(item)}
                />
              )}
            />
          )}
        </>
      )}
    </View>
  );
}

function KwChip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.kwChip, active && styles.kwChipActive]}
      onPress={onPress}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
    >
      <Text style={[styles.kwChipText, active && styles.kwChipTextActive]}>{label}</Text>
    </TouchableOpacity>
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
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
  },
  emptyText: { fontSize: FONT.body, color: COLORS.textSecondary, textAlign: 'center' },
  ctaBtn: {
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.pill,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.xl,
  },
  ctaText: { fontSize: FONT.caption, fontWeight: WEIGHT.bold, color: '#fff' },
  // 키워드 필터 칩 행
  kwChips: { flexDirection: 'row', gap: SPACING.sm, paddingHorizontal: SPACING.lg, paddingBottom: SPACING.md, alignItems: 'center' },
  kwChip: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 1,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surface,
  },
  kwChipActive: { backgroundColor: COLORS.accentSoft, borderColor: COLORS.accent },
  kwChipText: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold, color: COLORS.textSecondary },
  kwChipTextActive: { color: COLORS.accentText },
  // 점선 테두리 '＋ 키워드' 추가 칩
  addChip: {
    borderRadius: RADIUS.pill,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs + 1,
    borderWidth: 1,
    borderColor: COLORS.textTertiary,
    borderStyle: 'dashed',
  },
  addChipText: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold, color: COLORS.textTertiary },
});
