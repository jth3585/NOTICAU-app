import { Dimensions, StyleSheet, View } from 'react-native';
import ContentLoader, { Rect } from 'react-content-loader/native';
import { COLORS, RADIUS, SHADOW, SPACING } from '../../lib/theme';

const SCREEN_W = Dimensions.get('window').width;

// 카드 한 장 스켈레톤: 실제 카드처럼 흰 박스(양각) 안에 배지/제목 두 줄 placeholder.
function CardSkeleton() {
  const cardW = SCREEN_W - SPACING.lg * 2;
  const innerW = cardW - SPACING.lg * 2;
  return (
    <View style={styles.card}>
      <ContentLoader
        speed={1.1}
        width={innerW}
        height={58}
        backgroundColor={COLORS.surface2}
        foregroundColor={COLORS.border}
      >
        <Rect x="0" y="0" rx="6" ry="6" width="64" height="16" />
        <Rect x="0" y="28" rx="5" ry="5" width={String(innerW)} height="13" />
        <Rect x="0" y="46" rx="5" ry="5" width={String(Math.round(innerW * 0.55))} height="13" />
      </ContentLoader>
    </View>
  );
}

// 세로 목록(전체공지/북마크 등) 로딩 placeholder.
export function NoticeListSkeleton({ count = 6 }: { count?: number }) {
  return (
    <View style={styles.list}>
      {Array.from({ length: count }).map((_, i) => <CardSkeleton key={i} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  list: { paddingTop: SPACING.sm },
  card: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.md,
    padding: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderRadius: RADIUS.card,
    ...SHADOW.card,
  },
});
