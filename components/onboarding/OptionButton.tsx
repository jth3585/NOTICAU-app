import { StyleSheet, Text, TouchableOpacity } from 'react-native';
import { COLORS, FONT, RADIUS, SPACING, WEIGHT } from '../../lib/theme';

type Props = {
  label: string;
  selected: boolean;
  onPress: () => void;
  sublabel?: string;
};

export function OptionButton({ label, selected, onPress, sublabel }: Props) {
  return (
    <TouchableOpacity
      style={[styles.btn, selected && styles.btnSelected]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
      {sublabel ? (
        <Text style={[styles.sublabel, selected && styles.sublabelSelected]}>{sublabel}</Text>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: RADIUS.card,
    paddingVertical: SPACING.md + 2,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.surface,
  },
  btnSelected: {
    borderColor: COLORS.accent,
    backgroundColor: COLORS.accentSoft,
  },
  label: {
    fontSize: FONT.body,
    fontWeight: WEIGHT.semibold,
    color: COLORS.text,
  },
  labelSelected: { color: COLORS.accentText },
  sublabel: {
    fontSize: FONT.caption,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  sublabelSelected: { color: COLORS.accentText },
});
