import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { Notice } from '../lib/types';
import { COLORS, FONT, RADIUS, SHADOW, SPACING, WEIGHT } from '../lib/theme';
import { PressableScale } from './ui/PressableScale';

// 카테고리별 '글로우 전용' 워시 톤. 칩색과 분리해 아주 연하고 채도 낮게 —
// 흰 카드에 은은히 녹아드는 정도(색이 도드라지지 않고 무드만 살짝).
const GLOW_COLORS: Record<string, string> = {
  '학사정보': '#D6D9F7',   // 연한 라벤더
  '장학&등록금': '#CDEEE0', // 연한 민트
  '채용&인턴': '#E1D7F5',   // 연한 라일락
  '교내외활동': '#D2ECF3',  // 연한 하늘
  '창업': '#F6DCE8',        // 연한 로즈
  '재학상태': '#F7E9CE',    // 연한 크림앰버
  '기숙사': '#CFECE6',      // 연한 틸
  '시설&시스템': '#E0E3E8', // 연한 그레이
};

// #RRGGBB → rgba(r,g,b,a)
function toRgba(hex: string, alpha: number): string {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)}, ${parseInt(h.slice(2, 4), 16)}, ${parseInt(h.slice(4, 6), 16)}, ${alpha})`;
}
import { formatDateShort, formatScheduleBadge, metaOf, sourceOf } from '../lib/format';
import { CategoryBadge } from './ui/CategoryBadge';
import { SourceBadge } from './ui/SourceBadge';
import { useSourceLabels } from '../lib/sources';

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
  glow = false,
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
  glow?: boolean; // 카드 하단에 카테고리 색 은은한 글로우 (AI 큐레이션용)
}) {
  const meta = metaOf(notice);
  const src = sourceOf(notice);
  const sourceLabel = useSourceLabels();
  // 표시 이름: 조인된 sources.name 우선, 없으면 DB 라벨 캐시(parser_key→이름)로 폴백.
  // → 목록 쿼리가 name을 안 실어온 경로/구버전 페이로드에서도 cau_ 노출 방지.
  const sourceName = src?.name || sourceLabel(src?.parser_key);
  const topic = meta?.topic ?? null;
  // 카드 하단 글로우 색: 카테고리 main 색 (없으면 글로우 생략)
  const glowColor = glow && topic ? (GLOW_COLORS[topic] ?? null) : null;
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
      {glowColor ? (
        <LinearGradient
          // 'transparent'(=검은색 알파0)는 색→투명 보간에서 거뭇한 띠를 만든다.
          // 같은 색의 알파만 0→값으로 페이드 → 흰 카드에 자연스럽게 녹아듦(검은기 없음).
          colors={[toRgba(glowColor, 0.22), toRgba(glowColor, 0)]}
          style={styles.glow}
          pointerEvents="none"
        />
      ) : null}
      {/* 경계 직전에 박스색(흰색) 얇은 안쪽 테두리 → 글로우가 카드 가장자리에 닿지 않고 끊김 */}
      {glowColor ? <View style={styles.innerEdge} pointerEvents="none" /> : null}
      <View style={styles.topRow}>
        <View style={styles.topLeft}>
          {(isNew || unread) ? <View style={styles.newDot} /> : null}
          {topic ? <CategoryBadge topic={topic} /> : null}
        </View>
        <View style={styles.topRight}>
          <SourceBadge name={sourceName} parserKey={src?.parser_key} />
          {notice.dup_count ? <Text style={styles.dupTag}>· 외 {notice.dup_count}곳</Text> : null}
        </View>
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
    overflow: 'hidden', // 하단 글로우가 카드 둥근 모서리를 넘지 않게 클립
    ...SHADOW.card,
  },
  // 카드 하단에 은은히 깔리는 카테고리 글로우 (AI 큐레이션). 콘텐츠 뒤(첫 자식) 렌더.
  glow: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    height: '72%',
  },
  // 카드 안쪽 얇은 흰색 테두리 — 글로우를 경계에서 살짝 떼어 깨끗한 가장자리 유지.
  innerEdge: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    borderRadius: RADIUS.card,
    borderWidth: 1,
    borderColor: COLORS.surface,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm + 2, // 메타↔제목 살짝 더 분리(히어로 강조)
  },
  topLeft: { flexDirection: 'row', alignItems: 'center', gap: 6, flexShrink: 1 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 3, flexShrink: 0 },
  // SourceBadge와 동일한 메타 스타일(micro, tertiary)
  dupTag: { fontSize: FONT.micro, lineHeight: 14, color: COLORS.textTertiary, includeFontPadding: false },
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
