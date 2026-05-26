import type { ReactNode } from 'react';
import { StyleSheet, View } from 'react-native';
import { COLORS, RADIUS, SPACING } from '../../lib/theme';

type Tone = 'accent' | 'danger' | keyof typeof COLORS.categories;

function resolveTone(tone: Tone): { bar: string; bg: string } {
  if (tone === 'accent') return { bar: COLORS.accent, bg: COLORS.accentSoft };
  if (tone === 'danger') return { bar: COLORS.danger, bg: COLORS.dangerSoft };
  const c = COLORS.categories[tone];
  return { bar: c.main, bg: c.soft };
}

export function InfoBox({ children, tone = 'accent' }: { children: ReactNode; tone?: Tone }) {
  const { bar, bg } = resolveTone(tone);
  return <View style={[styles.box, { backgroundColor: bg, borderLeftColor: bar }]}>{children}</View>;
}

const styles = StyleSheet.create({
  box: {
    borderLeftWidth: 4,
    borderRadius: RADIUS.box,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    marginVertical: SPACING.sm,
  },
});
