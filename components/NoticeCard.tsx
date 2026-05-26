import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Notice } from '../lib/types';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { formatDateShort, formatDday, metaOf, sourceOf } from '../lib/format';
import { CategoryBadge } from './ui/CategoryBadge';
import { SourceBadge } from './ui/SourceBadge';

export function NoticeCard({ notice, onPress }: { notice: Notice; onPress: () => void }) {
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
    <TouchableOpacity onPress={onPress} activeOpacity={0.6} style={styles.card}>
      <View style={styles.topRow}>
        {topic ? <CategoryBadge topic={topic} /> : <View />}
        <SourceBadge parserKey={src?.parser_key ?? null} />
      </View>

      <Text style={styles.title} numberOfLines={2}>
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
  title: {
    fontSize: FONT.subtitle,
    color: COLORS.text,
    fontWeight: WEIGHT.semibold,
    marginBottom: SPACING.sm,
  },
  bottom: { fontSize: FONT.caption },
  dday: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold },
  dim: { fontSize: FONT.caption, color: COLORS.textSecondary },
});
