import { useState } from 'react';
import {
  Image,
  Linking,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  useWindowDimensions,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Markdown from 'react-native-markdown-display';
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

  const open = (url: string | null | undefined) => {
    if (url) Linking.openURL(url);
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
        <Text style={styles.title}>{notice.title}</Text>

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
          <InfoBox tone="accent">
            <Markdown style={mdStyles}>{summary}</Markdown>
          </InfoBox>
        ) : null}
        {rest ? <Markdown style={mdStyles}>{rest}</Markdown> : null}
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
    lineHeight: 34,
  },
  metaLine: { fontSize: FONT.caption, color: COLORS.textSecondary, marginTop: SPACING.sm },
  bodyWrap: { marginTop: SPACING.lg },
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

// react-native-markdown-display 룰 스타일 (디자인 토큰)
// 마크다운 ## = heading2, ### = heading3.
const mdStyles = StyleSheet.create({
  body: { color: COLORS.text, fontSize: FONT.body, lineHeight: 22 },
  heading1: {
    fontSize: FONT.title,
    fontWeight: WEIGHT.bold,
    color: COLORS.text,
    marginTop: SPACING.xl,
    marginBottom: SPACING.sm,
  },
  heading2: {
    // 그 외 ## → SectionHeader level 1
    fontSize: FONT.title,
    fontWeight: WEIGHT.bold,
    color: COLORS.text,
    marginTop: SPACING.xxl,
    marginBottom: SPACING.md,
  },
  heading3: {
    // ### → SectionHeader level 2
    fontSize: FONT.subtitle,
    fontWeight: WEIGHT.bold,
    color: COLORS.text,
    marginTop: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  paragraph: {
    marginTop: 0,
    marginBottom: SPACING.md,
    fontSize: FONT.body,
    lineHeight: 22,
    color: COLORS.text,
  },
  strong: { fontWeight: WEIGHT.bold, color: COLORS.text },
  bullet_list: { marginLeft: SPACING.lg },
  ordered_list: { marginLeft: SPACING.lg },
  bullet_list_icon: { color: COLORS.textSecondary },
  ordered_list_icon: { color: COLORS.textSecondary },
  link: { color: COLORS.accentText },
  table: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: RADIUS.box,
    marginVertical: SPACING.sm,
  },
  th: {
    padding: 6,
    borderColor: COLORS.border,
    borderWidth: StyleSheet.hairlineWidth,
    fontWeight: WEIGHT.bold,
  },
  td: { padding: 6, borderColor: COLORS.border, borderWidth: StyleSheet.hairlineWidth },
});
