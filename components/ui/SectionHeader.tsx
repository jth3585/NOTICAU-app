import type { ReactNode } from 'react';
import { StyleSheet, Text } from 'react-native';
import { COLORS, FONT, SPACING, WEIGHT } from '../../lib/theme';

export function SectionHeader({ children, level = 1 }: { children: ReactNode; level?: 1 | 2 }) {
  return <Text style={[styles.base, level === 1 ? styles.l1 : styles.l2]}>{children}</Text>;
}

const styles = StyleSheet.create({
  base: {
    color: COLORS.text,
    fontWeight: WEIGHT.bold,
    marginTop: SPACING.xxl,
    marginBottom: SPACING.md,
  },
  l1: { fontSize: FONT.title },
  l2: { fontSize: FONT.subtitle },
});
