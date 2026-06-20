import { StyleSheet, Text, View } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';
import { SparkleIcon } from './SparkleIcon';

// 공유 시 캡처되는 브랜드 카드. 화면 밖에 렌더해 두고 view-shot으로 이미지화한다.
export const SHARE_CARD_W = 340;

export function ShareCard({
  title,
  topic,
  metaLine,
}: {
  title: string;
  topic?: string | null;
  metaLine?: string | null;
}) {
  return (
    <LinearGradient
      colors={COLORS.accentGradient}
      start={{ x: 0, y: 0 }}
      end={{ x: 1, y: 1 }}
      style={styles.card}
    >
      <View style={styles.brandRow}>
        <SparkleIcon size={18} color="#fff" />
        <Text style={styles.brand}>NOTICAU</Text>
      </View>

      {topic ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{topic}</Text>
        </View>
      ) : null}

      <Text style={styles.title} numberOfLines={4}>{title}</Text>
      {metaLine ? <Text style={styles.meta}>{metaLine}</Text> : null}

      <View style={styles.divider} />
      <Text style={styles.footer}>중앙대 공지, 한 곳에서 · NOTICAU</Text>
    </LinearGradient>
  );
}

const styles = StyleSheet.create({
  card: {
    width: SHARE_CARD_W,
    padding: SPACING.xl,
    borderRadius: 24,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', gap: SPACING.xs, marginBottom: SPACING.lg },
  brand: { color: '#fff', fontSize: FONT.body, fontWeight: WEIGHT.bold, letterSpacing: 0.5 },
  badge: {
    alignSelf: 'flex-start',
    backgroundColor: 'rgba(255,255,255,0.22)',
    borderRadius: RADIUS.pill,
    paddingVertical: 4,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.md,
  },
  badgeText: { color: '#fff', fontSize: FONT.caption, fontWeight: WEIGHT.bold },
  title: { color: '#fff', fontSize: 22, fontWeight: WEIGHT.bold, lineHeight: 31 },
  meta: { color: 'rgba(255,255,255,0.88)', fontSize: FONT.caption, marginTop: SPACING.md },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.35)', marginVertical: SPACING.lg },
  footer: { color: 'rgba(255,255,255,0.9)', fontSize: FONT.caption, fontWeight: WEIGHT.semibold },
});
