import { useState, useMemo } from 'react';
import {
  Dimensions,
  Image,
  Linking,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useMarkdown, Renderer } from 'react-native-marked';
import type { MarkedStyles } from 'react-native-marked';
import * as WebBrowser from 'expo-web-browser';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../lib/types';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../lib/theme';
import { formatDateFull, metaOf, sourceOf } from '../lib/format';
import { CategoryBadge } from '../components/ui/CategoryBadge';
import { SourceBadge } from '../components/ui/SourceBadge';
import { DeadlineBox } from '../components/ui/DeadlineBox';
import { SectionHeader } from '../components/ui/SectionHeader';
import { AttachmentRow } from '../components/ui/AttachmentRow';
import { InfoBox } from '../components/ui/InfoBox';
import { SparkleIcon } from '../components/ui/SparkleIcon';
import ImageViewing from 'react-native-image-viewing';

type Props = NativeStackScreenProps<RootStackParamList, 'Detail'>;

const BODY_MIN = 100;

export default function NoticeDetailScreen({ route, navigation }: Props) {
  const { notice } = route.params;
  const { width } = useWindowDimensions();
  const meta = metaOf(notice);
  const src = sourceOf(notice);
  const topic = meta?.topic ?? null;
  const md = meta?.body_markdown ?? null;
  const bodyText = notice.body_text ?? '';
  const images = notice.body_image_urls ?? [];
  const attachments = notice.attachment_urls ?? [];
  const imgWidth = width - SPACING.lg * 2;
  const [imgViewerIndex, setImgViewerIndex] = useState(0);
  const [imgViewerVisible, setImgViewerVisible] = useState(false);

  // InApp 브라우저로 열기 (referrer/세션 유지 → 학교 PHP 다운로드 핸들러 호환).
  // 실패 시 외부 브라우저 폴백.
  const open = async (url: string | null | undefined) => {
    if (!url) return;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Linking.openURL(url).catch(() => {});
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={styles.back}>‹ 뒤로</Text>
        </TouchableOpacity>
        <View style={styles.headerMeta}>
          {topic ? <CategoryBadge topic={topic} /> : null}
          <SourceBadge parserKey={src?.parser_key ?? null} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
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

        <DeadlineBox deadlineAt={meta?.deadline_at ?? null} />

        <BodyBlock md={md} bodyText={bodyText} sourceUrl={notice.source_url} onOpen={open} />

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
      </ScrollView>

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

function BodyBlock({
  md,
  bodyText,
  sourceUrl,
  onOpen,
}: {
  md: string | null;
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

  if (md) {
    return (
      <View style={styles.bodyWrap}>
        {summary && summaryElements.length > 0 ? (
          <InfoBox tone="gradient">
            <View style={styles.summaryLabelRow}>
              <SparkleIcon size={14} color={COLORS.accent} />
              <Text style={styles.summaryLabelText}>AI 요약</Text>
            </View>
            {summaryElements}
          </InfoBox>
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
}

// 로드 후 원본 비율로 높이를 맞추는 이미지. onPress → 풀스크린 뷰어로 연결.
function AutoImage({ uri, width, onPress }: { uri: string; width: number; onPress?: () => void }) {
  const [ratio, setRatio] = useState(1.4);
  return (
    <TouchableOpacity activeOpacity={0.85} onPress={onPress} disabled={!onPress}>
      <Image
        source={{ uri }}
        style={{ width, height: width / ratio, marginTop: SPACING.md, borderRadius: RADIUS.box }}
        resizeMode="contain"
        onLoad={(e) => {
          const { width: w, height: h } = e.nativeEvent.source;
          if (w && h) setRatio(w / h);
        }}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
  },
  back: { fontSize: FONT.body, color: COLORS.text },
  headerMeta: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  content: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xxl },
  title: {
    fontSize: FONT.display,
    fontWeight: WEIGHT.bold,
    color: COLORS.text,
    marginTop: SPACING.sm,
    lineHeight: 32,
  },
  metaLine: { fontSize: FONT.caption, color: COLORS.textSecondary, marginTop: SPACING.sm },
  bodyWrap: { marginTop: SPACING.lg },
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
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  sourceBtnText: { fontSize: FONT.body, color: COLORS.accentText, fontWeight: WEIGHT.semibold },
});

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
        <View style={{ flexDirection: 'row', backgroundColor: COLORS.surface }}>
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
  // strong 포함 항목: 마커 제거(lineHeight 충돌 방지) + 들여쓰기
  // strong 없는 항목: • 마커 정상 표시
  list(ordered: boolean, li: any[], _ls?: any, _ts?: any, startIndex?: number): any {
    const BW = 18;
    return (
      <View key={this.getKey()} style={{ marginLeft: SPACING.sm }}>
        {li.map((item: any, i: number) => {
          if (containsStrong(item)) {
            return (
              <View key={i} style={{ marginVertical: 2, paddingLeft: BW }}>{item}</View>
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
    marginTop: 40, marginBottom: SPACING.md, lineHeight: 30,
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
