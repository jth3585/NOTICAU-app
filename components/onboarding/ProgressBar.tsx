import { StyleSheet, View } from 'react-native';
import { COLORS, RADIUS } from '../../lib/theme';

export function ProgressBar({ step, total = 7 }: { step: number; total?: number }) {
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${(step / total) * 100}%` as any }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    height: 3,
    backgroundColor: COLORS.surface2,
    borderRadius: RADIUS.pill,
    overflow: 'hidden',
  },
  fill: {
    height: '100%',
    backgroundColor: COLORS.accent,
    borderRadius: RADIUS.pill,
  },
});
