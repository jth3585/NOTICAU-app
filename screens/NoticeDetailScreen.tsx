import { useState } from 'react';
import {
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
import Markdown from 'react-native-markdown-display';
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
              <AutoImage key={`${uri}-${i}`} uri={uri} width={imgWidth} />
            ))}
          </>
        ) : null}

        {attachments.length > 0 ? (
          <>
            <SectionHeader level={2}>첨부파일</SectionHeader>
            {attachments.map((url, i) => (
              <AttachmentRow key={`${url}-${i}`} url={url} />
            ))}
          </>
        ) : null}

        <TouchableOpacity onPress={() => open(notice.source_url)} style={styles.sourceBtn}>
          <Text style={styles.sourceBtnText}>원문 페이지 열기</Text>
        </TouchableOpacity>
      </ScrollView>
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
  if (md) {
    const { summary, rest } = splitSummary(md);
    return (
      <View style={styles.bodyWrap}>
        {summary ? (
          <InfoBox tone="gradient">
            <View style={styles.summaryLabelRow}>
              <SparkleIcon size={14} color={COLORS.accent} />
              <Text style={styles.summaryLabelText}>AI 요약</Text>
            </View>
            <Markdown style={mdStylesSummary} rules={mdRules}>
              {summary}
            </Markdown>
          </InfoBox>
        ) : null}
        {rest ? (
          <Markdown style={mdStyles} rules={mdRules}>
            {rest}
          </Markdown>
        ) : null}
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

// 로드 후 원본 비율로 높이를 맞추는 이미지
function AutoImage({ uri, width }: { uri: string; width: number }) {
  const [ratio, setRatio] = useState(1.4);
  return (
    <Image
      source={{ uri }}
      style={{ width, height: width / ratio, marginTop: SPACING.md, borderRadius: RADIUS.box }}
      resizeMode="contain"
      onLoad={(e) => {
        const { width: w, height: h } = e.nativeEvent.source;
        if (w && h) setRatio(w / h);
      }}
    />
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

// 본문 텍스트 노드를 selectable로 (복사 가능).
// 마지막 행 borderBottom 생략 → 표 외곽선과 중복 방지 (헤더 행은 항상 구분선).
const mdRules = {
  text: (node: any, _children: any, _parent: any, styles: any) => (
    <Text key={node.key} selectable selectionColor={COLORS.accentSoft} style={styles.text}>
      {node.content}
    </Text>
  ),
  // 부모 paragraph/heading도 selectable로 만들어야 단락 단위 선택이 동작 (RN 중첩 Text 규칙)
  paragraph: (node: any, children: any, _parent: any, styles: any) => (
    <Text key={node.key} selectable selectionColor={COLORS.accentSoft} style={styles.paragraph}>
      {children}
    </Text>
  ),
  heading1: (node: any, children: any, _parent: any, styles: any) => (
    <Text key={node.key} selectable selectionColor={COLORS.accentSoft} style={styles.heading1}>
      {children}
    </Text>
  ),
  heading2: (node: any, children: any, _parent: any, styles: any) => (
    <Text key={node.key} selectable selectionColor={COLORS.accentSoft} style={styles.heading2}>
      {children}
    </Text>
  ),
  heading3: (node: any, children: any, _parent: any, styles: any) => (
    <Text key={node.key} selectable selectionColor={COLORS.accentSoft} style={styles.heading3}>
      {children}
    </Text>
  ),
  tr: (node: any, children: any, parent: any, styles: any) => {
    const direct = parent?.[parent.length - 1];
    const inThead = direct?.type === 'thead' || direct?.type === 'table_head';
    const siblings: any[] = direct?.children ?? [];
    const last = siblings[siblings.length - 1];
    const isLast = !!last && last.key === node.key;
    const showBottom = inThead || !isLast;
    return (
      <View
        key={node.key}
        style={[
          styles.tr,
          showBottom && {
            borderBottomWidth: StyleSheet.hairlineWidth,
            borderBottomColor: COLORS.border,
          },
        ]}
      >
        {children}
      </View>
    );
  },
};

// react-native-markdown-display 룰 스타일 (디자인 토큰)
// 마크다운 ## = heading2, ### = heading3.
const mdStyles = StyleSheet.create({
  body: { color: COLORS.text, fontSize: FONT.body, lineHeight: 24 },
  heading1: { fontSize: FONT.title, fontWeight: WEIGHT.bold, color: COLORS.text, marginTop: SPACING.xl, marginBottom: SPACING.sm },
  // 그 외 ## → SectionHeader level 1. 섹션 분리 명확히: 위 40, 아래 16
  heading2: { fontSize: FONT.title, fontWeight: WEIGHT.bold, color: COLORS.text, marginTop: 40, marginBottom: SPACING.lg },
  // ### → SectionHeader level 2
  heading3: { fontSize: FONT.subtitle, fontWeight: WEIGHT.bold, color: COLORS.text, marginTop: SPACING.xl, marginBottom: SPACING.sm },
  paragraph: { marginTop: 0, marginBottom: SPACING.md, fontSize: FONT.body, lineHeight: 24, color: COLORS.text },
  // 옅은 블루 형광펜 (본문 ≤3개/섹션). paddingHorizontal 제거 → 좌우 점 어색함 해소.
  strong: { fontWeight: WEIGHT.bold, color: COLORS.text, backgroundColor: COLORS.accentSoft },
  // 들여쓰기 최소화 (한국어 가독성)
  bullet_list: { marginLeft: SPACING.xs },
  ordered_list: { marginLeft: SPACING.xs },
  // 마커 베이스라인 정렬 (마침표처럼 낮게 떨어지는 문제 해소)
  bullet_list_icon: { color: COLORS.textSecondary, marginRight: SPACING.sm, fontSize: FONT.body, lineHeight: 24, alignSelf: 'flex-start' as const },
  ordered_list_icon: { color: COLORS.textSecondary, marginRight: SPACING.sm, fontSize: FONT.body, lineHeight: 24, alignSelf: 'flex-start' as const },
  list_item: { marginVertical: SPACING.xs }, // 항목 간 숨 쉴 공간
  link: { color: COLORS.accentText },
  // 표: overflow hidden + tr 후킹으로 외곽선 중복 방지
  table: { borderWidth: 1, borderColor: COLORS.border, borderRadius: RADIUS.box, marginVertical: SPACING.sm, overflow: 'hidden' },
  thead: { backgroundColor: COLORS.surface },
  th: { padding: 8, fontWeight: WEIGHT.bold, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: COLORS.border },
  td: { padding: 8, borderRightWidth: StyleSheet.hairlineWidth, borderRightColor: COLORS.border },
  tr: { flexDirection: 'row' },
});

// AI 요약용 변형: 본문/문단을 subtitle(17)/lineHeight 25로 키움 — AI요약 > 본문 위계.
const mdStylesSummary = {
  ...mdStyles,
  body: { color: COLORS.text, fontSize: FONT.subtitle, lineHeight: 25 },
  paragraph: { marginTop: 0, marginBottom: SPACING.md, fontSize: FONT.subtitle, lineHeight: 25, color: COLORS.text },
  // 그라데이션 배경 위 형광펜은 색 충돌 → bold만
  strong: { fontWeight: WEIGHT.bold, color: COLORS.text },
};
