import { memo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONT, RADIUS, SHADOW, SPACING, WEIGHT } from '../lib/theme';
import { sourceOf } from '../lib/format';
import { useSourceLabels } from '../lib/sources';
import { eventBadge, eventDateTile, formatEventWhen, type EventNotice } from '../lib/eventsFeed';
import { PressableScale } from './ui/PressableScale';
import { SourceBadge } from './ui/SourceBadge';

// 행사 탭 카드: 위에 포스터, 아래에 D-day · 행사 이름 · 시간/장소 · 주최.
// NoticeCard 와 같은 틀(흰 카드 + 16 라운드 + 미세 그림자)을 쓰고 색은 포스터에만 둔다.
//  - grid: 2열 그리드용(포스터 3:4)
//  - hero: 맨 위 캐러셀용 큰 카드(포스터 4:5, 제목 한 단계 크게)
// 포스터가 없는 글은 같은 크기의 날짜 타일로 채워 격자를 유지한다.
// 포스터 글자는 이 크기에서 읽히지 않으므로 날짜·장소는 언제나 텍스트로 따로 적는다.

const ASPECT = { grid: 3 / 4, hero: 4 / 5 } as const;

function EventPosterCardBase({
  notice,
  onPress,
  width,
  variant = 'grid',
  isRead = false,
}: {
  notice: EventNotice;
  onPress: () => void;
  width: number;
  variant?: 'grid' | 'hero';
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
  const hero = variant === 'hero';
  const posterH = Math.round(width / ASPECT[variant]);

  const badgeColor = badge?.tone === 'live' ? COLORS.accentText : badge?.tone === 'urgent' ? COLORS.danger : COLORS.textSecondary;

  return (
    <PressableScale
      onPress={onPress}
      accessible
      accessibilityRole="button"
      accessibilityLabel={[title, badge?.label, detail, sourceName, isRead ? '읽음' : undefined].filter(Boolean).join(', ')}
      style={[styles.card, { width }]}
    >
      <View style={[styles.poster, { height: posterH }]}>
        <Poster notice={notice} tile={tile} hero={hero} />
      </View>

      <View style={styles.body}>
        {badge ? <Text style={[styles.badge, { color: badgeColor }]}>{badge.label}</Text> : null}
        <Text
          style={[hero ? styles.titleHero : styles.title, isRead && styles.titleRead]}
          numberOfLines={2}
          lineBreakStrategyIOS="hangul-word"
        >
          {title}
        </Text>
        {detail ? <Text style={styles.detail} numberOfLines={1}>{detail}</Text> : null}
        {!ev.open ? <Text style={styles.memberTag} numberOfLines={1}>내 학과·단과대 행사</Text> : null}

        <View style={styles.sourceRow}>
          <SourceBadge name={sourceName} parserKey={src?.parser_key} />
          {notice.dup_count ? <Text style={styles.dupTag}>· 외 {notice.dup_count}곳</Text> : null}
        </View>
      </View>
    </PressableScale>
  );
}

export const EventPosterCard = memo(EventPosterCardBase);

type Tile = ReturnType<typeof eventDateTile>;

// 포스터 칸. 비율이 칸과 비슷한 세로 포스터는 꽉 채우고, 정사각·가로 이미지는 잘리지 않게
// 통째로 얹은 뒤 남는 자리를 같은 이미지의 흐린 확대본으로 메운다.
function Poster({ notice, tile, hero }: { notice: EventNotice; tile: Tile; hero: boolean }) {
  const uri = notice.event.cover_url ?? null;
  // 불러오지 못한 주소를 기억해 두고 날짜 타일로 대신한다(주소가 바뀌면 다시 시도).
  const [failedUri, setFailedUri] = useState<string | null>(null);
  if (!uri || failedUri === uri) return <DateFallback tile={tile} hero={hero} />;

  const ratio = notice.event.cover_ratio ?? null;
  const fits = ratio == null || (ratio >= 0.6 && ratio <= 0.95);
  // 일정 미정·상시 참여는 찍을 날짜가 없으므로 도장을 생략한다.
  const stamped = tile.sub !== '' || tile.top === '마감';
  const deadline = tile.top === '마감';
  const long = tile.main.length > 2; // "11/20"

  return (
    <>
      {!fits ? (
        <>
          <Image source={{ uri }} style={StyleSheet.absoluteFill} contentFit="cover" blurRadius={24} recyclingKey={notice.id} />
          <View style={styles.blurVeil} />
        </>
      ) : null}
      <Image
        source={{ uri }}
        style={StyleSheet.absoluteFill}
        contentFit={fits ? 'cover' : 'contain'}
        contentPosition={fits ? 'top' : 'center'}
        transition={150}
        recyclingKey={notice.id}
        onError={() => setFailedUri(uri)}
        accessible={false}
      />
      {stamped ? (
        <View style={[styles.stamp, hero && styles.stampHero]}>
          <Text style={[styles.stampTop, hero && styles.stampTopHero, deadline && styles.stampTopDeadline]} maxFontSizeMultiplier={STAMP_SCALE}>
            {tile.top}
          </Text>
          <Text
            style={[styles.stampMain, hero && styles.stampMainHero, long && (hero ? styles.stampMainHeroLong : styles.stampMainLong)]}
            maxFontSizeMultiplier={STAMP_SCALE}
          >
            {tile.main}
          </Text>
        </View>
      ) : null}
    </>
  );
}

// 글자 크기 설정을 크게 써도 날짜 도장이 포스터를 덮지 않게 확대 폭을 제한한다.
const STAMP_SCALE = 1.2;

// 포스터가 없는 행사: 날짜를 크게 쓴 타일. 도장과 같이 월 · 일만 적고 요일은 카드의 시간 줄에 둔다.
function DateFallback({ tile, hero }: { tile: Tile; hero: boolean }) {
  const undated = tile.sub === '' && tile.top !== '마감';
  const long = tile.main.length > 2; // "11/20", "미정", "상시"
  return (
    <LinearGradient
      colors={undated ? [COLORS.surface2, '#F6F7F9'] : [COLORS.accentSoft, '#F5F9FE']}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.fallback}
    >
      {tile.top ? <Text style={[styles.fbTop, undated && styles.fbMuted]}>{tile.top}</Text> : null}
      <Text
        style={[
          styles.fbMain,
          hero && styles.fbMainHero,
          long && (hero ? styles.fbMainHeroLong : styles.fbMainLong),
          undated && styles.fbMuted,
        ]}
      >
        {tile.main}
      </Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    ...SHADOW.card,
  },
  // 그림자가 잘리지 않게 카드 자체는 overflow 를 두지 않고, 포스터 칸만 위쪽 모서리를 깎는다.
  poster: {
    borderTopLeftRadius: RADIUS.card,
    borderTopRightRadius: RADIUS.card,
    overflow: 'hidden',
    backgroundColor: COLORS.surface2,
  },
  // 흐린 배경이 포스터 본체보다 튀지 않게 살짝 눌러 준다.
  // (RN 0.88 에서 StyleSheet.absoluteFillObject 가 없어져 직접 적는다.)
  blurVeil: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(245, 247, 250, 0.35)' },

  // 포스터 위 날짜 도장: 흰 타일에 작은 회색 월 + 굵은 일, 두 줄만(요일은 카드의 시간 줄에 있다).
  // 흰 포스터 위에서도 경계가 보이도록 옅은 그림자를 둔다.
  stamp: {
    position: 'absolute',
    top: SPACING.sm,
    left: SPACING.sm,
    minWidth: 42,
    paddingHorizontal: 7,
    paddingTop: 6,
    paddingBottom: 5,
    borderRadius: RADIUS.box,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    shadowColor: COLORS.text,
    shadowOpacity: 0.14,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  stampHero: { top: SPACING.md, left: SPACING.md, minWidth: 50, paddingHorizontal: 9, paddingTop: SPACING.sm, paddingBottom: 7, borderRadius: 14 },
  stampTop: { fontSize: 10, lineHeight: 12, fontWeight: WEIGHT.semibold, color: COLORS.textTertiary, includeFontPadding: false },
  stampTopHero: { fontSize: FONT.micro, lineHeight: 14 },
  stampTopDeadline: { color: COLORS.danger },
  stampMain: { fontSize: 19, lineHeight: 22, fontWeight: WEIGHT.bold, color: COLORS.text, letterSpacing: -0.3, fontVariant: ['tabular-nums'], includeFontPadding: false },
  stampMainHero: { fontSize: 24, lineHeight: 27 },
  stampMainLong: { fontSize: 15, lineHeight: 22 },
  stampMainHeroLong: { fontSize: 18, lineHeight: 27 },

  fallback: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2 },
  fbTop: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold, color: COLORS.accentText },
  fbMain: { fontSize: 44, lineHeight: 50, fontWeight: WEIGHT.bold, color: COLORS.accentText, fontVariant: ['tabular-nums'] },
  fbMainHero: { fontSize: 60, lineHeight: 66 },
  fbMainLong: { fontSize: 26, lineHeight: 32 },
  fbMainHeroLong: { fontSize: 34, lineHeight: 40 },
  fbMuted: { color: COLORS.textSecondary },

  body: { flexGrow: 1, padding: SPACING.md, gap: SPACING.xs },
  badge: { fontSize: FONT.caption, fontWeight: WEIGHT.semibold, fontVariant: ['tabular-nums'] },
  title: { fontSize: FONT.body, lineHeight: 21, fontWeight: WEIGHT.semibold, color: COLORS.text },
  titleHero: { fontSize: FONT.subtitle, lineHeight: 23, fontWeight: WEIGHT.semibold, color: COLORS.text },
  titleRead: { color: COLORS.textSecondary },
  detail: { fontSize: FONT.caption, color: COLORS.textSecondary },
  memberTag: { fontSize: FONT.micro, fontWeight: WEIGHT.semibold, color: COLORS.accentText },
  // 줄 높이가 다른 카드끼리 나란히 놓여도 주최가 카드 바닥에 맞도록 아래로 민다.
  sourceRow: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 'auto', paddingTop: SPACING.xs },
  dupTag: { fontSize: FONT.micro, lineHeight: 14, color: COLORS.textTertiary, includeFontPadding: false },
});
