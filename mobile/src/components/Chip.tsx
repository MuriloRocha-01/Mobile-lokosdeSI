import { Pressable, StyleSheet, Text } from 'react-native'
import { tap } from '../utils/haptics'
import { radius } from '../config/theme'
import type { ThemeColors } from '../config/theme'
import { useTheme } from '../hooks/useTheme'

interface Props {
  label: string
  selected: boolean
  onPress: () => void
  /** Cor do destaque quando marcado (padrão: violeta). */
  color?: string
}

/** Uma opção em forma de "pílula" (dia, hora, repetição, lembrete...). Grande o bastante para tocar com o polegar. */
export function Chip({ label, selected, onPress, color: customColor }: Props) {
  const { colors } = useTheme()
  const styles = createStyles(colors)
  const color = customColor ?? colors.primary
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      onPress={() => {
        tap()
        onPress()
      }}
      style={[styles.chip, selected && { backgroundColor: `${color}22`, borderColor: color }]}
    >
      <Text style={[styles.text, selected && { color }]}>{label}</Text>
    </Pressable>
  )
}

const createStyles = (colors: ThemeColors) => StyleSheet.create({
  chip: { minHeight: 44, paddingHorizontal: 14, borderRadius: 21, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  text: { color: colors.muted, fontSize: 15, fontWeight: '600' },
})
