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
  // 마감 알약 배경: 임박=빨강틴트, 신청예정=파랑틴트, 그 외/마감=옅은 회색
  const pillBg = badge?.kind === 'upcoming'
    ? COLORS.accentSoft
    : badge?.urgent
      ? COLORS.dangerSoft
      : COLORS.surface2;

  return (
    <PressableScale
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      // 스와이프로 감싼 카드(dimOnPress=false)는 press-in 지연을 줘서, 미는 제스처가 먼저
      // 활성화되면 스케일이 발동 전에 취소되게 → 스케일·스와이프 둘 다 살림.
      scaleTo={0.97}
      pressInDelay={dimOnPress ? 0 : 90}
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
          <View style={[styles.pill, { backgroundColor: COLORS.dangerSoft }]}>
            <Text style={[styles.pillText, { color: COLORS.danger }]}>{countdown}</Text>
          </View>
        ) : badge ? (
          <View style={[styles.pill, { backgroundColor: pillBg }]}>
            <Text style={[styles.pillText, { color: badgeColor }]}>{badge.label}</Text>
          </View>
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
    marginBottom: SPACING.sm,
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, flexShrink: 1 },
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
  // 마감 알약 — 리스트를 내릴 때 긴급도가 한눈에 들어오는 스캔 신호
  pill: { paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: RADIUS.pill },
  pillText: { fontSize: FONT.micro, fontWeight: WEIGHT.bold, fontVariant: ['tabular-nums'] },
  dim: { fontSize: FONT.caption, color: COLORS.textSecondary },
  kwTag: { fontSize: FONT.caption, color: COLORS.accentText, fontWeight: WEIGHT.semibold },
  kwTagRight: { marginLeft: 'auto' },
});
