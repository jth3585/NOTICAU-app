import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import type { Notice } from '../lib/types';
import { COLORS, FONT, RADIUS, SPACING, sourceLabel } from '../lib/constants';
import { formatDateShort, formatDday, metaOf, sourceOf } from '../lib/format';
import { Badge } from './Badge';

export function NoticeCard({ notice, onPress }: { notice: Notice; onPress: () => void }) {
  const meta = metaOf(notice);
  const src = sourceOf(notice);
  const topic = meta?.topic ?? null;
  const dday = formatDday(meta?.deadline_at ?? null);
  const postedMD = formatDateShort(notice.posted_at);

  // 하단 줄 색: 마감 임박/지남 표시
  const ddayColor = dday?.overdue
    ? COLORS.accentDim
    : dday?.urgent
      ? COLORS.accent
      : COLORS.textDim;

  return (
    <TouchableOpacity onPress={onPress} activeOpacity={0.6} style={styles.card}>
      <View style={styles.topRow}>
        {topic ? <Badge label={topic} /> : <View />}
        {src?.parser_key ? <Badge label={sourceLabel(src.parser_key)} variant="source" /> : null}
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
    backgroundColor: COLORS.card,
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
    fontSize: FONT.cardTitle,
    color: COLORS.text,
    fontWeight: '600',
    marginBottom: SPACING.sm,
  },
  bottom: {
    fontSize: FONT.meta,
  },
  dday: {
    fontSize: FONT.meta,
    fontWeight: '600',
  },
  dim: {
    fontSize: FONT.meta,
    color: COLORS.textDim,
  },
});
