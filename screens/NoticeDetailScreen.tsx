import { useState, useMemo, useEffect, useCallback, memo, useRef } from 'react';
import {
  Dimensions,
  Linking,
  Platform,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useMarkdown, Renderer } from 'react-native-marked';
import type { MarkedStyles } from 'react-native-marked';
import * as WebBrowser from 'expo-web-browser';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList, Notice } from '../lib/types';
import { fetchNoticeById } from '../lib/notices';
import { logEvent } from '../lib/events';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { BackButton } from '../components/ui/BackButton';
import { formatDateFull, metaOf, sourceOf } from '../lib/format';
import { useSourceLabels } from '../lib/sources';
import { CategoryBadge } from '../components/ui/CategoryBadge';
import { SourceBadge } from '../components/ui/SourceBadge';
import { DeadlineBox } from '../components/ui/DeadlineBox';
import { AddToCalendarButton } from '../components/ui/AddToCalendarButton';
import { SectionHeader } from '../components/ui/SectionHeader';
import { AttachmentRow } from '../components/ui/AttachmentRow';
import { InfoBox } from '../components/ui/InfoBox';
import { AiSummaryLabel } from '../components/ui/AiSummaryLabel';
import { BodyTextSkeleton } from '../components/ui/Skeleton';
import ImageViewing from 'react-native-image-viewing';
import { useBookmark } from '../lib/bookmarks';
import { BookmarkIcon } from '../components/ui/BookmarkIcon';
import { ShareIcon } from '../components/ui/ShareIcon';
import { InfoIcon } from '../components/ui/icons';
import { markAsRead } from '../lib/read';
import { supabase } from '../lib/supabase';
import { PressableScale } from '../components/ui/PressableScale';
import Animated, {
  FadeInDown, useSharedValue, useAnimatedStyle, useAnimatedScrollHandler, withSequence, withTiming,
} from 'react-native-reanimated';

type Props = NativeStackScreenProps<RootStackParamList, 'Detail'>;

const BODY_MIN = 100;

export default function NoticeDetailScreen({ route, navigation }: Props) {
  // 리스트는 경량 select(본문 제외)로 넘어올 수 있으므로, 상세에선 즉시 파라미터로
  // 그리되 본문/이미지/첨부/마크다운이 없으면 id로 단건 재조회해 채운다.
  const routeNotice = route.params.notice;
  const [notice, setNotice] = useState<Notice>(routeNotice);
  const { width } = useWindowDimensions();
  // edges=['top']이라 하단은 내비바 뒤로 흐름 → 스크롤 끝 여백(원문 버튼)에 insets.bottom 반영
  const insets = useSafeAreaInsets();
  const meta = metaOf(notice);
  const src = sourceOf(notice);
  const topic = meta?.topic ?? null;
  // 교차출처 중복 라벨(parser_key→이름)은 DB sources 기반 맵으로 해석.
  const sourceLabel = useSourceLabels();
  // body_markdown은 목록 쿼리에서 제외(페이로드 절감)되므로 상세에서 지연 로드.
  // 딥링크 등으로 이미 들어온 경우(meta.body_markdown 존재)엔 추가 패치 없음.
  const [md, setMd] = useState<string | null>(meta?.body_markdown ?? null);
  // 지연 로드 중 표시(원문 텍스트 깜빡임 대신 스켈레톤). 이미 md가 있으면 로딩 아님.
  const [mdLoading, setMdLoading] = useState<boolean>(meta?.body_markdown == null);
  const deadlineAt = meta?.deadline_at ?? null;
  const applyStartAt = meta?.apply_start_at ?? null;
  // 마감일이 있고 아직 지나지 않은 경우에만 캘린더 추가 버튼 노출 (지난 마감은 무의미)
  const canAddCalendar = !!deadlineAt && new Date(deadlineAt).getTime() > Date.now();
  const bodyText = notice.body_text ?? '';
  const images = notice.body_image_urls ?? [];
  const attachments = notice.attachment_urls ?? [];
  const imgWidth = width - SPACING.lg * 2;
  const [imgViewerIndex, setImgViewerIndex] = useState(0);
  const [imgViewerVisible, setImgViewerVisible] = useState(false);
  const { bookmarked, toggle: toggleBookmark } = useBookmark(notice.id);

  // 북마크 추가 시 아이콘 톡 튀는 팝 (마운트 시 이미 북마크여도 안 튀게 firstRun 가드)
  const bmScale = useSharedValue(1);
  const bmStyle = useAnimatedStyle(() => ({ transform: [{ scale: bmScale.value }] }));
  const bmFirstRun = useRef(true);
  useEffect(() => {
    if (bmFirstRun.current) { bmFirstRun.current = false; return; }
    if (bookmarked) bmScale.value = withSequence(withTiming(1.35, { duration: 120 }), withTiming(1, { duration: 170 }));
  }, [bookmarked]);

  // 읽기 진행 바: 스크롤 진행도(0~1)
  const scrollY = useSharedValue(0);
  const contentH = useSharedValue(0);
  const viewH = useSharedValue(0);
  const onScroll = useAnimatedScrollHandler((e) => {
    scrollY.value = e.contentOffset.y;
    viewH.value = e.layoutMeasurement.height;
    contentH.value = e.contentSize.height;
  });
  const progressStyle = useAnimatedStyle(() => {
    const max = Math.max(1, contentH.value - viewH.value);
    const p = Math.min(1, Math.max(0, scrollY.value / max));
    return { width: `${p * 100}%` };
  });

  // 상세 진입 시 자동 읽음 처리 + 진입 출처(surface) 이벤트 로깅(큐레이션 등 참여도 분석).
  useEffect(() => {
    markAsRead(notice.id);
    logEvent('notice_open', { noticeId: notice.id, meta: { surface: route.params.source ?? 'unknown' } });
  }, [notice.id]);

  // body_markdown 지연 로드 (목록에서 제외됨). 없을 때만 단건 조회.
  useEffect(() => {
    // 이미 본문(body_text)과 마크다운을 모두 갖고 들어온 경우(딥링크 등)엔 재조회 불필요.
    if (md != null && routeNotice.body_text !== undefined) { setMdLoading(false); return; }
    let alive = true;
    setMdLoading(true);
    (async () => {
      try {
        const full = await fetchNoticeById(routeNotice.id);
        if (alive && full) {
          setNotice(full);
          const m = metaOf(full)?.body_markdown ?? null;
          if (m) setMd(m);
        }
      } catch { /* 네트워크 실패 → 기존 파라미터/폴백으로 표시 */ }
      finally { if (alive) setMdLoading(false); }
    })();
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeNotice.id]);

  // 공유: 제목 + 출처 + 원문 링크 + 노티카우 출처 표기
  const onShare = async () => {
    const url = notice.source_url ?? '';
    const lines = [notice.title];
    const srcName = src?.name || sourceLabel(src?.parser_key);
    if (srcName) lines.push(`출처: ${srcName}`);
    if (url) lines.push(url);
    lines.push('');
    lines.push('✨ powered by NOTICAU');
    try {
      await Share.share({ message: lines.join('\n'), title: notice.title });
      logEvent('share', { noticeId: notice.id });
    } catch { /* 사용자 취소 등 무시 */ }
  };

  // InApp 브라우저로 열기 (referrer/세션 유지 → 학교 PHP 다운로드 핸들러 호환).
  // 실패 시 외부 브라우저 폴백.
  const open = useCallback(async (url: string | null | undefined) => {
    if (!url) return;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Linking.openURL(url).catch(() => {});
    }
  }, []);

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <BackButton onPress={() => navigation.goBack()} />
        <View style={styles.headerMeta}>
          {topic ? <CategoryBadge topic={topic} /> : null}
          <SourceBadge name={src?.name || sourceLabel(src?.parser_key)} parserKey={src?.parser_key} />
          <TouchableOpacity onPress={onShare} hitSlop={13} accessibilityRole="button" accessibilityLabel="공유">
            <ShareIcon size={22} color={COLORS.textTertiary} />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={toggleBookmark}
            hitSlop={13}
            accessibilityRole="button"
            accessibilityState={{ selected: bookmarked }}
            accessibilityLabel={bookmarked ? '북마크 해제' : '북마크'}
          >
            <Animated.View style={bmStyle}>
              <BookmarkIcon size={22} filled={bookmarked} color={bookmarked ? COLORS.accent : COLORS.textTertiary} />
            </Animated.View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.progressTrack}>
        <Animated.View style={[styles.progressFill, progressStyle]} />
      </View>

      <Animated.ScrollView contentContainerStyle={[styles.content, { paddingBottom: SPACING.xxl + insets.bottom }]} onScroll={onScroll} scrollEventThrottle={16}>
        <Text
          style={styles.title}
          {...(Platform.OS === 'ios'
            ? { lineBreakStrategyIOS: 'hangul-word' as const }
            : { android_hyphenationFrequency: 'none' as const })}
        >
          {notice.title}
        </Text>

        <Text style={styles.metaLine}>
          {formatDateFull(notice.posted_at)}
          {notice.author ? ` · ${notice.author}` : ''}
        </Text>

        {notice.dup_count && notice.dup_source_keys?.length ? (
          <View style={styles.dupRow}>
            <InfoIcon size={13} color={COLORS.textTertiary} />
            <Text style={styles.dupLine}>
              {notice.dup_source_keys.map(sourceLabel).join(', ')} 게시판에도 올라온 공지예요
            </Text>
          </View>
        ) : null}

        <DeadlineBox applyStartAt={applyStartAt} deadlineAt={deadlineAt} />
        {canAddCalendar ? <AddToCalendarButton notice={notice} deadlineAt={deadlineAt!} /> : null}

        <BodyBlock md={md} loading={mdLoading} bodyText={bodyText} sourceUrl={notice.source_url} onOpen={open} />

        {images.length > 0 ? (
          <>
            <SectionHeader level={2}>이미지</SectionHeader>
            {images.map((uri, i) => (
              <AutoImage
              key={`${uri}-${i}`}
              uri={uri}
              width={imgWidth}
              onPress={() => { setImgViewerIndex(i); setImgViewerVisible(true); }}
            />
            ))}
          </>
        ) : null}

        {attachments.length > 0 ? (
          <>
            <SectionHeader level={2}>첨부파일</SectionHeader>
            {attachments.map((url, i) => (
              <AttachmentRow key={`${url}-${i}`} url={url} sourceUrl={notice.source_url} />
            ))}
          </>
        ) : null}

        <TouchableOpacity onPress={() => open(notice.source_url)} style={styles.sourceBtn}>
          <Text style={styles.sourceBtnText}>원문 페이지 열기</Text>
        </TouchableOpacity>
      </Animated.ScrollView>

      {images.length > 0 && (
        <ImageViewing
          images={images.map(uri => ({ uri }))}
          imageIndex={imgViewerIndex}
          visible={imgViewerVisible}
          onRequestClose={() => setImgViewerVisible(false)}
          swipeToCloseEnabled
          doubleTapToZoomEnabled
        />
      )}
    </SafeAreaView>
  );
}

// body_markdown을 "## 핵심 요약" 섹션 / 나머지로 줄 단위 분리.
function splitSummary(md: string): { summary: string | null; rest: string } {
  const lines = md.trim().split('\n');
  if (lines[0]?.trim() === '## 핵심 요약') {
    let end = lines.length;
    for (let i = 1; i < lines.length; i++) {
      if (lines[i].startsWith('## ')) {
        end = i;
        break;
      }
    }
    const summary = lines.slice(1, end).join('\n').trim();
    const rest = lines.slice(end).join('\n').trim();
    return { summary: summary || null, rest };
  }
  return { summary: null, rest: md.trim() };
}

const BodyBlock = memo(function BodyBlock({
  md,
  loading,
  bodyText,
  sourceUrl,
  onOpen,
}: {
  md: string | null;
  loading: boolean;
  bodyText: string;
  sourceUrl: string | null;
  onOpen: (url: string | null) => void;
}) {
  const { summary, rest } = useMemo(
    () => (md ? splitSummary(md) : { summary: null, rest: '' }),
    [md],
  );
  // 훅은 조건 없이 항상 호출 — md null이면 빈 문자열 → 빈 배열 반환
  const summaryElements = useMarkdown(summary ?? '', { renderer: _summaryRenderer, styles: mdSummaryStyles });
  const bodyElements = useMarkdown(rest, { renderer: _bodyRenderer, styles: mdBodyStyles });

  // 마크다운 지연 로드 중: 원문 텍스트를 먼저 보였다가 교체하는 깜빡임 대신 스켈레톤.
  if (!md && loading) {
    return <BodyTextSkeleton />;
  }

  if (md) {
    return (
      <View style={styles.bodyWrap}>
        {summary && summaryElements.length > 0 ? (
          <Animated.View entering={FadeInDown.duration(420)}>
            <InfoBox tone="gradient">
              <View style={styles.summaryLabelRow}>
                <AiSummaryLabel />
              </View>
              {summaryElements}
            </InfoBox>
          </Animated.View>
        ) : null}
        {rest && bodyElements.length > 0 ? bodyElements : null}
      </View>
    );
  }
  if (bodyText.trim().length >= BODY_MIN) {
    return <Text style={styles.body}>{bodyText}</Text>;
  }
  return (
    <TouchableOpacity onPress={() => onOpen(sourceUrl)} style={styles.linkBtn}>
      <Text style={styles.linkBtnText}>원문에서 자세히 보기</Text>
    </TouchableOpacity>
  );
});

// 로드 후 원본 비율로 높이를 맞추는 이미지. onPress → 풀스크린 뷰어로 연결.
function AutoImage({ uri, width, onPress }: { uri: string; width: number; onPress?: () => void }) {
  const [ratio, setRatio] = useState(1.4);
  return (
    <PressableScale scaleTo={0.98} onPress={onPress} disabled={!onPress}>
      <Image
        source={{ uri }}
        style={{ width, height: width / ratio, marginTop: SPACING.md, borderRadius: RADIUS.box }}
        contentFit="contain"
        transition={250}
        cachePolicy="memory-disk"
        onLoad={(e) => {
          const { width: w, height: h } = e.source;
          if (w && h) setRatio(w / h);
        }}
      />
    </PressableScale>
  );
}

const styles = StyleSheet.create({
  // 상세는 읽기 화면 → 흰 배경(카드 양각 베이스가 아닌 단일 읽기 면)
  container: { flex: 1, backgroundColor: COLORS.surface },
  progressTrack: { height: 2.5, backgroundColor: COLORS.surface2 },
  progressFill: { height: '100%', backgroundColor: COLORS.accent },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  back: { fontSize: FONT.body, color: COLORS.text },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  content: { paddingHorizontal: SPACING.lg },
  title: {
    fontSize: FONT.display,
    fontWeight: WEIGHT.bold,
    color: COLORS.text,
    marginTop: SPACING.sm,
    lineHeight: 32,
  },
  metaLine: { fontSize: FONT.caption, color: COLORS.textSecondary, marginTop: SPACING.sm },
  dupRow: { flexDirection: 'row', alignItems: 'center', gap: 5, marginTop: SPACING.xs },
  dupLine: { fontSize: FONT.caption, color: COLORS.textTertiary, flexShrink: 1 },
  bodyWrap: { marginTop: SPACING.xs },
  summaryLabelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  summaryLabelText: {
    fontSize: FONT.caption,
    fontWeight: WEIGHT.semibold,
    color: COLORS.accentText,
  },
  body: { fontSize: FONT.body, color: COLORS.text, lineHeight: 22, marginTop: SPACING.lg },
  linkBtn: { marginTop: SPACING.lg, paddingVertical: SPACING.sm },
  linkBtnText: { fontSize: FONT.body, color: COLORS.accentText, fontWeight: WEIGHT.semibold },
  sourceBtn: {
    marginTop: SPACING.xxl,
    backgroundColor: COLORS.surface2,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  sourceBtnText: { fontSize: FONT.body, color: COLORS.accentText, fontWeight: WEIGHT.semibold },
});

// 문단의 단일 자식이 strong(accentSoft 배경)인지 = LLM이 ### 대신 볼드 줄로 쓴 소제목.
function isStrongOnlyParagraph(children: any): boolean {
  const arr = Array.isArray(children)
    ? children.filter((c) => c !== null && c !== undefined && c !== ' ' && c !== '')
    : [children];
  if (arr.length !== 1) return false;
  const node = arr[0];
  if (!node || typeof node !== 'object') return false;
  const style = node.props?.style;
  const styleArr = Array.isArray(style) ? style : [style];
  return styleArr.some((s: any) => s && typeof s === 'object' && s.backgroundColor === COLORS.accentSoft);
}

// ReactNode 트리에 accentSoft 배경(= strong 형광펜)이 있는지 재귀 탐색
function containsStrong(node: any): boolean {
  if (!node) return false;
  if (Array.isArray(node)) return node.some(containsStrong);
  if (typeof node !== 'object') return false;
  const style = node.props?.style;
  if (style) {
    const arr = Array.isArray(style) ? style : [style];
    if (arr.some((s: any) => s && typeof s === 'object' && s.backgroundColor === COLORS.accentSoft)) return true;
  }
  return containsStrong(node.props?.children);
}

// 공통: del(취소선 비활성), table(화면 폭 맞춤), list(조건부 마커)
class BaseRenderer extends Renderer {
  del(children: any, styles?: any): any {
    return (
      <Text key={this.getKey()} selectable style={{ ...(styles ?? {}), textDecorationLine: 'none' as const }}>
        {children}
      </Text>
    );
  }

  table(header: any, rows: any): any {
    const { width } = Dimensions.get('window');
    const available = width - SPACING.lg * 2;
    const numCols = header.length || 1;
    const colW = Math.floor(available / numCols);
    return (
      <View key={this.getKey()} style={{ borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.box, overflow: 'hidden', marginVertical: SPACING.sm }}>
        <View style={{ flexDirection: 'row', backgroundColor: COLORS.surface2 }}>
          {header.map((cell: any, i: number) => (
            <View key={i} style={{ width: colW, padding: 6, borderRightWidth: i < numCols - 1 ? StyleSheet.hairlineWidth : 0, borderRightColor: COLORS.border }}>
              {cell}
            </View>
          ))}
        </View>
        {rows.map((row: any, ri: number) => (
          <View key={ri} style={{ flexDirection: 'row', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border }}>
            {row.map((cell: any, ci: number) => (
              <View key={ci} style={{ width: colW, padding: 6, borderRightWidth: ci < row.length - 1 ? StyleSheet.hairlineWidth : 0, borderRightColor: COLORS.border }}>
                {cell}
              </View>
            ))}
          </View>
        ))}
      </View>
    );
  }
  text(children: any, styles?: any): any {
    return (
      <Text key={this.getKey()} selectable style={styles} lineBreakStrategyIOS="hangul-word">
        {children}
      </Text>
    );
  }

  heading(children: any, styles?: any): any {
    return (
      <Text key={this.getKey()} selectable style={styles} lineBreakStrategyIOS="hangul-word">
        {children}
      </Text>
    );
  }

  // 문단을 View가 아닌 "단일 selectable Text"로 감싼다. 라이브러리 기본은 children을
  // View로 감싸 inline Text들이 형제로 쪼개지는데(→ iOS에서 조각 단위로만 선택), 하나의
  // Text로 묶으면 굵은 글씨를 포함한 문단 전체를 드래그로 영역 선택·복사할 수 있다.
  paragraph(children: any, styles?: any): any {
    return (
      <Text key={this.getKey()} selectable style={styles} lineBreakStrategyIOS="hangul-word">
        {children}
      </Text>
    );
  }

  // strong 포함 항목: 마커 제거(lineHeight 충돌 방지) + 들여쓰기
  // strong 없는 항목: • 마커 정상 표시
  list(ordered: boolean, li: any[], _ls?: any, _ts?: any, startIndex?: number): any {
    const BW = 18;
    return (
      <View key={this.getKey()} style={{ marginLeft: SPACING.sm }}>
        {li.map((item: any, i: number) => {
          if (containsStrong(item)) {
            return (
              <View key={i} style={{ marginVertical: 2 }}>{item}</View>
            );
          }
          return (
            <View key={i} style={{ flexDirection: 'row', marginVertical: 2 }}>
              <Text style={{ width: BW, textAlign: 'center', fontSize: FONT.body, lineHeight: 26, color: COLORS.textSecondary }}>
                {ordered ? `${(startIndex ?? 1) + i}.` : '•'}
              </Text>
              <View style={{ flex: 1 }}>{item}</View>
            </View>
          );
        })}
      </View>
    );
  }
}

// 본문용: strong → accentSoft 배경 형광펜 + borderRadius:3 (모서리 둥글게 → 우측 점 완화)
class BodyRenderer extends BaseRenderer {
  // 문단 전체가 볼드 하나뿐(LLM이 ### 헤더 대신 볼드 줄로 쓴 소제목) → 위 여백 부여해 소제목처럼.
  paragraph(children: any, pstyle?: any): any {
    if (isStrongOnlyParagraph(children)) {
      return (
        <View key={this.getKey()} style={{ marginTop: SPACING.lg, marginBottom: 4 }}>
          {children}
        </View>
      );
    }
    return super.paragraph(children, pstyle);
  }

  strong(children: any, styles?: any): any {
    return (
      <Text
        key={this.getKey()}
        selectable
        style={{ ...(styles ?? {}), backgroundColor: COLORS.accentSoft, borderRadius: 3, lineHeight: 20 }}
      >
        {children}
      </Text>
    );
  }
}

// AI 요약용: strong override 없음 → 라이브러리 기본 bold만 (배경/색 변화 없음)
class SummaryRenderer extends BaseRenderer {}

const _bodyRenderer = new BodyRenderer();
const _summaryRenderer = new SummaryRenderer();

// 본문용 스타일. ## = h2 (22), ### = h3 (17).
// strong backgroundColor는 BodyRenderer.strong()에서 rgba()로 직접 적용.
const mdBodyStyles: MarkedStyles = {
  text: { fontSize: FONT.body, lineHeight: 26, color: COLORS.text },
  // paragraph 간격 16 → 단락 사이 공기 확보
  paragraph: { paddingVertical: 0, marginBottom: SPACING.lg },
  // h2: 위 섹션과 40 떨어지고 자기 내용과는 12로 가깝게
  h2: {
    fontSize: FONT.title, fontWeight: WEIGHT.bold, color: COLORS.text,
    marginTop: 28, marginBottom: SPACING.md, lineHeight: 30,
    borderBottomWidth: 0, paddingBottom: 0,
  },
  // h3: 위 내용과 16, 자기 내용과는 6으로 가깝게
  h3: {
    fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text,
    marginTop: SPACING.lg, marginBottom: 6, lineHeight: 26,
    borderBottomWidth: 0, paddingBottom: 0,
  },
  // strong backgroundColor는 BodyRenderer.strong()에서 직접 적용
  strong: { fontWeight: WEIGHT.bold, fontSize: FONT.body, color: COLORS.text },
  link: { fontSize: FONT.body, color: COLORS.accentText, fontStyle: 'normal' },
  list: { marginLeft: SPACING.sm },
  li: { fontSize: FONT.body, lineHeight: 26, color: COLORS.text },
  table: { borderWidth: 1, borderColor: COLORS.border },
  tableRow: { flexDirection: 'row' },
  tableCell: { padding: 8, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: COLORS.border },
};

// AI 요약용: subtitle(17)/lineHeight 26, strong은 Renderer override로 배경 없음
const mdSummaryStyles: MarkedStyles = {
  text: { fontSize: FONT.subtitle, lineHeight: 26, color: COLORS.text },
  paragraph: { paddingVertical: 0, marginBottom: SPACING.lg },
  strong: { fontWeight: WEIGHT.bold, fontSize: FONT.subtitle, color: COLORS.text },
  link: { fontSize: FONT.subtitle, color: COLORS.accentText, fontStyle: 'normal' },
  list: { marginLeft: SPACING.sm },
  li: { fontSize: FONT.subtitle, lineHeight: 26, color: COLORS.text },
};
