import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Notice } from '../lib/types';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { formatDateShort, formatDday, metaOf, sourceOf } from '../lib/format';
import { CategoryBadge } from './ui/CategoryBadge';
import { SourceBadge } from './ui/SourceBadge';

export function NoticeCard({
  notice,
  onPress,
  isRead = false,
  isNew = false,
  unread = false,
  width,
  keywordTag,
}: {
  notice: Notice;
  onPress: () => void;
  isRead?: boolean;
  isNew?: boolean;
  unread?: boolean;
  width?: number;      // 지정 시 가로 스크롤용 고정 너비 카드
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
      activeOpacity={0.6}
      style={[styles.card, width != null && { width, marginHorizontal: 0, marginRight: SPACING.md, marginBottom: 0 }]}
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

      <Text style={[styles.title, isRead && styles.titleRead]} numberOfLines={2} lineBreakStrategyIOS="hangul-word">
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
  bottom: { fontSize: FONT.caption },
  dday: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold },
  dim: { fontSize: FONT.caption, color: COLORS.textSecondary },
  kwTag: { fontSize: FONT.caption, color: COLORS.accentText, fontWeight: WEIGHT.semibold },
});
