import { StyleSheet, Text, View } from 'react-native';
import type { Notice } from '../lib/types';
import { COLORS, FONT, RADIUS, SHADOW, SPACING, WEIGHT } from '../lib/theme';
import { PressableScale } from './ui/PressableScale';
import { formatDateShort, formatScheduleBadge, metaOf, sourceOf } from '../lib/format';
import { CategoryBadge } from './ui/CategoryBadge';
import { SourceBadge } from './ui/SourceBadge';

export function NoticeCard({
  notice,
  onPress,
  onLongPress,
  isRead = false,
  isNew = false,
  unread = false,
  width,
  minHeight,
  titleLines = 2,
  keywordTag,
  countdown,
  dimOnPress = true,
}: {
  notice: Notice;
  onPress: () => void;
  onLongPress?: () => void; // 지정 시 길게 누르기 (예: 폴더로 이동)
  isRead?: boolean;
  isNew?: boolean;
  unread?: boolean;
  width?: number;      // 지정 시 가로 스크롤용 고정 너비 카드
  minHeight?: number;  // 지정 시 카드 최소 높이 (세로로 길게)
  titleLines?: number; // 제목 최대 줄 수 (기본 2)
  keywordTag?: string; // 지정 시 매칭 키워드 #태그 표시
  countdown?: string;  // 지정 시 D-day 대신 "N시간 M분 남음" 표시 (오늘마감 탭)
  dimOnPress?: boolean; // 누름 시 카드 dim. 스와이프 래핑 시 false(뒤 액션 비침 방지)
}) {
  const meta = metaOf(notice);
  const src = sourceOf(notice);
  const topic = meta?.topic ?? null;
  const badge = formatScheduleBadge(meta?.apply_start_at ?? null, meta?.deadline_at ?? null);
  const postedMD = formatDateShort(notice.posted_at);

  const badgeColor = badge?.kind === 'overdue'
    ? COLORS.textTertiary
    : badge?.kind === 'upcoming'
      ? COLORS.accentText
      : badge?.urgent
        ? COLORS.danger
        : COLORS.textSecondary;

  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      accessible
      accessibilityRole="button"
      accessibilityLabel={[topic, notice.title, countdown ?? badge?.label, isRead ? '읽음' : undefined].filter(Boolean).join(', ')}
      // 스와이프로 감싼 카드(dimOnPress=false)는 스케일 끔 — 미는 제스처와 겹치지 않게.
      scaleTo={dimOnPress ? 0.97 : 1}
      style={[
        styles.card,
        width != null && { width, marginHorizontal: 0, marginRight: SPACING.md, marginBottom: 0 },
        minHeight != null && { minHeight },
      ]}
    >
      <View style={styles.topRow}>
        <View style={styles.topLeft}>
          {(isNew || unread) ? <View style={styles.newDot} /> : null}
          {topic ? <CategoryBadge topic={topic} /> : null}
        </View>
        <SourceBadge parserKey={src?.parser_key ?? null} />
      </View>

      <Text style={[styles.title, isRead && styles.titleRead]} numberOfLines={titleLines} lineBreakStrategyIOS="hangul-word">
        {notice.title}
      </Text>

      <View style={styles.bottomRow}>
        {countdown ? (
          <Text style={[styles.dday, { color: COLORS.danger }]}>{countdown}</Text>
        ) : badge ? (
          <Text style={[styles.dday, { color: badgeColor }]}>{badge.label}</Text>
        ) : null}
        <Text style={styles.dim}>{postedMD}</Text>
        {keywordTag ? <Text style={[styles.kwTag, styles.kwTagRight]}>#{keywordTag}</Text> : null}
      </View>
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    padding: SPACING.lg,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    ...SHADOW.card,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm + 2, // 메타↔제목 살짝 더 분리(히어로 강조)
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  // 안읽은 새 공지: 좌상단 accent 점 하나로 통일
  newDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: COLORS.accent },
  title: {
    fontSize: FONT.subtitle,
    color: COLORS.text,
    fontWeight: WEIGHT.semibold,
    marginBottom: SPACING.sm,
  },
  titleRead: { color: COLORS.textSecondary },
  // marginTop:auto → 카드에 여유 높이(minHeight)가 있을 때만 메타를 바닥에 고정.
  bottomRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm, marginTop: 'auto' },
  dday: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold, fontVariant: ['tabular-nums'] },
  dim: { fontSize: FONT.caption, color: COLORS.textSecondary },
  kwTag: { fontSize: FONT.caption, color: COLORS.accentText, fontWeight: WEIGHT.semibold },
  kwTagRight: { marginLeft: 'auto' },
});
