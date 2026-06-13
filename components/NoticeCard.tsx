import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Notice } from '../lib/types';
import { COLORS, FONT, RADIUS, SHADOW, SPACING, WEIGHT } from '../lib/theme';
import { formatDateShort, formatDday, metaOf, sourceOf } from '../lib/format';
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
}) {
  const meta = metaOf(notice);
  const src = sourceOf(notice);
  const topic = meta?.topic ?? null;
  const dday = formatDday(meta?.deadline_at ?? null);
  const postedMD = formatDateShort(notice.posted_at);

  const ddayColor = dday?.overdue
    ? COLORS.textTertiary
    : dday?.urgent
      ? COLORS.danger
      : COLORS.textSecondary;

  return (
    <TouchableOpacity
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={300}
      activeOpacity={0.6}
      style={[
        styles.card,
        width != null && { width, marginHorizontal: 0, marginRight: SPACING.md, marginBottom: 0 },
        minHeight != null && { minHeight },
      ]}
    >
      <View style={styles.topRow}>
        {topic ? <CategoryBadge topic={topic} /> : <View />}
        <View style={styles.topRight}>
          {unread ? <View style={styles.unreadDot} /> : null}
          {isNew ? (
            <View style={styles.newBadge}>
              <Text style={styles.newText}>N</Text>
            </View>
          ) : null}
          <SourceBadge parserKey={src?.parser_key ?? null} />
        </View>
      </View>

      <Text style={[styles.title, isRead && styles.titleRead]} numberOfLines={titleLines} lineBreakStrategyIOS="hangul-word">
        {notice.title}
      </Text>

      <Text style={styles.bottom}>
        {dday ? (
          <>
            <Text style={[styles.dday, { color: ddayColor }]}>{dday.label}</Text>
            <Text style={styles.dim}> · {postedMD}</Text>
          </>
        ) : (
          <Text style={styles.dim}>{postedMD}</Text>
        )}
        {keywordTag ? <Text style={styles.kwTag}>  #{keywordTag}</Text> : null}
      </Text>
    </TouchableOpacity>
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
  topRight: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs },
  newBadge: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: COLORS.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  newText: { fontSize: 9, fontWeight: WEIGHT.bold, color: '#fff' },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: COLORS.accent },
  title: {
    fontSize: FONT.subtitle,
    color: COLORS.text,
    fontWeight: WEIGHT.semibold,
    marginBottom: SPACING.sm,
  },
  titleRead: { color: COLORS.textSecondary },
  // marginTop:auto → 카드에 여유 높이(minHeight)가 있을 때만 메타를 바닥에 고정.
  // 높이가 콘텐츠에 맞는 일반 카드에서는 무효과.
  bottom: { fontSize: FONT.caption, marginTop: 'auto' },
  dday: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold },
  dim: { fontSize: FONT.caption, color: COLORS.textSecondary },
  kwTag: { fontSize: FONT.caption, color: COLORS.accentText, fontWeight: WEIGHT.semibold },
});
