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
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../lib/types';
import { COLORS, FONT, RADIUS, SPACING, sourceLabel } from '../lib/constants';
import { formatDateFull, formatDeadlineDetail, metaOf, sourceOf } from '../lib/format';
import { Badge } from '../components/Badge';

type Props = NativeStackScreenProps<RootStackParamList, 'Detail'>;

const BODY_MIN = 100; // 이보다 짧으면 원문 링크만

export default function NoticeDetailScreen({ route, navigation }: Props) {
  const { notice } = route.params;
  const { width } = useWindowDimensions();
  const meta = metaOf(notice);
  const src = sourceOf(notice);
  const topic = meta?.topic ?? null;
  const dl = formatDeadlineDetail(meta?.deadline_at ?? null);
  const imgWidth = width - SPACING.lg * 2;

  const body = notice.body_text ?? '';
  const hasBody = body.trim().length >= BODY_MIN;
  const images = notice.body_image_urls ?? [];
  const attachments = notice.attachment_urls ?? [];

  const open = (url: string | null | undefined) => {
    if (url) Linking.openURL(url);
  };

  const ddayColor = dl?.dday.overdue
    ? COLORS.accentDim
    : dl?.dday.urgent
      ? COLORS.accent
      : COLORS.text;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* 커스텀 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={8}>
          <Text style={styles.back}>‹ 뒤로</Text>
        </TouchableOpacity>
        <View style={styles.headerMeta}>
          {topic ? <Badge label={topic} /> : null}
          {src?.parser_key ? <Badge label={sourceLabel(src.parser_key)} variant="source" /> : null}
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>{notice.title}</Text>

        <Text style={styles.metaLine}>
          {formatDateFull(notice.posted_at)}
          {notice.author ? ` · ${notice.author}` : ''}
        </Text>

        {dl ? (
          <View style={styles.deadlineCard}>
            <Text style={[styles.deadlineDday, { color: ddayColor }]}>
              {dl.dday.overdue
                ? '마감됨'
                : `마감 ${dl.dday.label}${dl.time ? ` ${dl.time}까지` : ''}`}
            </Text>
            <Text style={styles.deadlineAbs}>{dl.abs}</Text>
          </View>
        ) : null}

        {hasBody ? (
          <Text style={styles.body}>{body}</Text>
        ) : (
          <TouchableOpacity onPress={() => open(notice.source_url)} style={styles.linkBtn}>
            <Text style={styles.linkBtnText}>원문에서 자세히 보기</Text>
          </TouchableOpacity>
        )}

        {images.map((uri, i) => (
          <AutoImage key={`${uri}-${i}`} uri={uri} width={imgWidth} />
        ))}

        {attachments.length > 0 ? (
          <View style={styles.attachWrap}>
            <Text style={styles.attachLabel}>📎 첨부 {attachments.length}개</Text>
            {attachments.map((url, i) => (
              <TouchableOpacity key={`${url}-${i}`} onPress={() => open(url)}>
                <Text style={styles.attachItem}>첨부파일 {i + 1}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <TouchableOpacity onPress={() => open(notice.source_url)} style={styles.sourceBtn}>
          <Text style={styles.sourceBtnText}>원문 페이지 열기</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// 로드 후 원본 비율로 높이를 맞추는 이미지
function AutoImage({ uri, width }: { uri: string; width: number }) {
  const [ratio, setRatio] = useState(1.4); // 로드 전 임시 (세로형 가정)
  return (
    <Image
      source={{ uri }}
      style={{ width, height: width / ratio, marginTop: SPACING.md, borderRadius: RADIUS.card }}
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
  content: { paddingHorizontal: SPACING.lg, paddingBottom: SPACING.xl },
  title: {
    fontSize: FONT.detailTitle,
    fontWeight: '700',
    color: COLORS.text,
    marginTop: SPACING.sm,
  },
  metaLine: { fontSize: FONT.meta, color: COLORS.textDim, marginTop: SPACING.sm },
  deadlineCard: {
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.card,
    padding: SPACING.lg,
    marginTop: SPACING.lg,
  },
  deadlineDday: { fontSize: FONT.cardTitle, fontWeight: '700' },
  deadlineAbs: { fontSize: FONT.meta, color: COLORS.textDim, marginTop: SPACING.xs },
  body: {
    fontSize: FONT.body,
    color: COLORS.text,
    lineHeight: 22,
    marginTop: SPACING.lg,
  },
  linkBtn: { marginTop: SPACING.lg, paddingVertical: SPACING.sm },
  linkBtnText: { fontSize: FONT.body, color: COLORS.text, fontWeight: '600' },
  attachWrap: { marginTop: SPACING.xl },
  attachLabel: { fontSize: FONT.body, color: COLORS.text, fontWeight: '600' },
  attachItem: {
    fontSize: FONT.body,
    color: COLORS.text,
    paddingVertical: SPACING.sm,
    marginLeft: SPACING.sm,
  },
  sourceBtn: {
    marginTop: SPACING.xl,
    backgroundColor: COLORS.card,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  sourceBtnText: { fontSize: FONT.body, color: COLORS.text, fontWeight: '600' },
});
