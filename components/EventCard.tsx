import { StyleSheet, Text, View } from 'react-native';
import { COLORS, FONT, RADIUS, SHADOW, SPACING, WEIGHT } from '../lib/theme';
import { sourceOf } from '../lib/format';
import { useSourceLabels } from '../lib/sources';
import { eventBadge, eventDateTile, formatEventWhen, type EventNotice } from '../lib/eventsFeed';
import { PressableScale } from './ui/PressableScale';
import { SourceBadge } from './ui/SourceBadge';

// 행사 탭 카드: 왼쪽 날짜 타일 + 행사 이름 / 시간·장소 / 주최.
// NoticeCard 와 같은 카드 톤(흰 카드 + 미세 그림자)을 쓰되, '언제'가 한눈에 보이도록 날짜를 앞세운다.
export function EventCard({
  notice,
  onPress,
  isRead = false,
}: {
  notice: EventNotice;
  onPress: () => void;
  isRead?: boolean;
}) {
  const ev = notice.event;
  const src = sourceOf(notice);
  const sourceLabel = useSourceLabels();
  const sourceName = src?.name || sourceLabel(src?.parser_key);
  const tile = eventDateTile(notice);
  const when = formatEventWhen(notice);
  const badge = eventBadge(notice);
  // 뽑아낸 행사 이름이 있으면 그걸 제목으로(말머리·수식어가 빠져 읽기 쉽다), 없으면 공지 제목.
  const title = ev.name || notice.title;
  const detail = [when, ev.place].filter(Boolean).join(' · ');
  const undated = tile.sub === '' && tile.top !== '마감';

  const badgeColor = badge?.tone === 'live' ? COLORS.accentText : badge?.tone === 'urgent' ? COLORS.danger : COLORS.textSecondary;

  return (
    <PressableScale
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={[title, badge?.label, detail, sourceName, isRead ? '읽음' : undefined].filter(Boolean).join(', ')}
      style={styles.card}
    >
      <View style={[styles.tile, undated && styles.tileMuted]}>
        {tile.top ? <Text style={styles.tileTop}>{tile.top}</Text> : null}
        <Text style={[styles.tileMain, tile.main.length > 2 && styles.tileMainSmall, undated && styles.tileMainMuted]}>
          {tile.main}
        </Text>
        {tile.sub ? <Text style={styles.tileSub}>{tile.sub}</Text> : null}
      </View>

      <View style={styles.body}>
        <View style={styles.topRow}>
          {badge ? <Text style={[styles.badge, { color: badgeColor }]}>{badge.label}</Text> : <View />}
          <View style={styles.sourceWrap}>
            <SourceBadge name={sourceName} parserKey={src?.parser_key} />
            {notice.dup_count ? <Text style={styles.dupTag}>· 외 {notice.dup_count}곳</Text> : null}
          </View>
        </View>

        <Text style={[styles.title, isRead && styles.titleRead]} numberOfLines={2} lineBreakStrategyIOS="hangul-word">
          {title}
        </Text>

        {detail ? <Text style={styles.detail} numberOfLines={1}>{detail}</Text> : null}
        {!ev.open ? <Text style={styles.memberTag}>우리 학과·단과대 행사</Text> : null}
      </View>
    </PressableScale>
  );
}

const TILE = 56;

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    gap: SPACING.md,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    padding: SPACING.lg,
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    ...SHADOW.card,
  },
  tile: {
    width: TILE,
    minHeight: TILE + 8,
    borderRadius: RADIUS.box,
    backgroundColor: COLORS.accentSoft,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: SPACING.xs,
  },
  tileMuted: { backgroundColor: COLORS.surface2 },
  tileTop: { fontSize: FONT.micro, fontWeight: WEIGHT.semibold, color: COLORS.accentText },
  tileMain: { fontSize: FONT.title, fontWeight: WEIGHT.bold, color: COLORS.accentText, fontVariant: ['tabular-nums'] },
  // "11/20", "미정", "상시" 처럼 3글자 이상이면 타일을 넘지 않게 한 단계 작게
  tileMainSmall: { fontSize: FONT.body },
  tileMainMuted: { color: COLORS.textSecondary },
  tileSub: { fontSize: FONT.micro, fontWeight: WEIGHT.semibold, color: COLORS.accentText },
  body: { flex: 1, minWidth: 0 },
  topRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginBottom: SPACING.xs + 2,
  },
  badge: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold, fontVariant: ['tabular-nums'] },
  sourceWrap: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 1, justifyContent: 'flex-end' },
  dupTag: { fontSize: FONT.micro, lineHeight: 14, color: COLORS.textTertiary, includeFontPadding: false },
  title: { fontSize: FONT.subtitle, fontWeight: WEIGHT.semibold, color: COLORS.text },
  titleRead: { color: COLORS.textSecondary },
  detail: { fontSize: FONT.caption, color: COLORS.textSecondary, marginTop: SPACING.xs + 2 },
  memberTag: { fontSize: FONT.micro, fontWeight: WEIGHT.semibold, color: COLORS.accentText, marginTop: SPACING.xs + 2 },
});
